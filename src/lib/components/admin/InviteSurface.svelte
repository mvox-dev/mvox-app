<script lang="ts">
	// #140/S3 — extracted from src/routes/admin/invite/+page.svelte so the SAME
	// live invite surface (state machine, data seams, testids) can render both
	// standalone (backward-compat /admin/invite URL) AND embedded inside the
	// merged /admin page's "Invite Members" section. No behavior change from
	// the original T4.5/#31 page — see history there for the full rationale
	// (database-not-organization picker, person-scoped org resolution, bearer
	// secret handling, 401 recovery). Contract: src/routes/page.admin-invite.spec.ts,
	// src/routes/page.admin-invite-session-expired.spec.ts,
	// src/routes/page.navshell-merge.spec.ts (embedded usage).
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getToken } from '$lib/auth/storage';
	import { collectiveState } from '$lib/collectives/store';
	import {
		createInvite,
		InviteCreateError,
		resolveInviteParentId,
		mintSelfLinkInvite,
		SelfLinkMintError
	} from '$lib/invite/inviteData';
	import { buildInviteUrl } from '$lib/invite/invite-links';
	import { parseInviteToken } from '$lib/invite/parse-invite-token';
	// #301 — the owner-only person-targeted invite path: `resolveOwnerTier`
	// gates the select (mint onto an existing person is owner-gated, #294's
	// live 403), `listJoinStates` derives who counts as uninvited (contents of
	// the linked-identity property, never presence — same #294 discipline the
	// roster's badges use). Both REUSED verbatim, never reimplemented here.
	import { resolveOwnerTier, type OwnerTier } from '$lib/nav/adminStore';
	import { listJoinStates, type JoinState } from '$lib/profile/linkedIdentities';
	// #107 review F2 — a 401 here used to land in the generic 'load-error'
	// (Retry against a token already deleted from localStorage) or, on the write
	// path, in 'create-error'. Both are misleading: the session is gone.
	import { isAuthExpiredError } from '$lib/entu/request';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import { isoDateFormatter } from '$lib/preferences/timeFormat';
	// #232 — the base 5-state union comes from the shared route-load machine's
	// type (no generation/loadForSelected sequencing extracted here: this
	// surface's load-prerequisites flow has no staleness counter today, and
	// grafting one on would be a behavior change, not an extraction).
	import type { RouteLoadStatus } from '$lib/loading/routeLoad';

	// #140/S3 — CONTROLLED MODE: the merged /admin page has ALREADY resolved a
	// db + org (resolveDatabaseEntityId, same underlying "the collective"
	// concept resolveInviteParentId answers — #161) by the time it mounts this component —
	// redoing that resolution here would race the parent's own readiness by a
	// full extra async round trip (page.navshell-merge.spec.ts: the invite
	// section must be submit-ready in the SAME settle as the role-management
	// sections, not one tick behind). When both are supplied, adopt them
	// directly instead of re-fetching. The standalone /admin/invite route
	// passes neither, so it keeps the original independent resolution
	// unchanged (page.admin-invite.spec.ts, page.admin-invite-session-expired.spec.ts).
	//
	// #140/S3 review F1 — in controlled mode the db picker is NOT rendered.
	// It used to be (always), while both self-resolution effects early-returned
	// on `presetDb && presetDbEntityId`: picking a DIFFERENT collective moved `dbId`
	// to db B but left `dbEntityId` at the parent's org of db A, and `canSubmit`
	// (both non-empty) stayed true — a createInvite against db B parenting the
	// member under an org id that only exists in db A. Silently orphaned, the
	// same wrong-org-parent class TU.1/#109 fixed. The embedded surface acts on
	// the collective the /admin page has already selected (its own picker lives
	// in the nav/collectives surface), so the name renders as static text and
	// presetDb/presetDbEntityId stay the single source of truth — role management
	// and invites can no longer target two different collectives at once.
	//
	// `heading` — the standalone route needs the page-level <h1>; embedded under
	// /admin's own <h1> it must be an <h2> (heading hierarchy, review F2).
	//
	// `layout` — #235: the standalone /admin/invite route is full-bleed, so the
	// component's own `mx-auto`/`max-w-md` are the SOLE centering mechanism
	// there ('standalone', default — today's classes, byte-identical). The
	// /admin embed already sits inside its own centered `max-w-2xl` column
	// whose sibling sections are plain `flex flex-col gap-3`; re-centering
	// AGAIN inside that column double-constrains the width and renders the
	// invite section visibly narrower/indented vs. its siblings. `'embedded'`
	// drops exactly those two tokens so it fills the column flush like them.
	// #301 — an admin's OWN person id and the collective's roster, both
	// OPTIONAL and CONTROLLED-MODE-only in effect: the person-select feature
	// needs "who is the viewer" (for `resolveOwnerTier`) and "who could be
	// invited" (to derive the uninvited list), and the embedding /admin page
	// already has both loaded for its own purposes (see admin/+page.svelte).
	// The standalone /admin/invite route supplies neither, so the feature is
	// naturally absent there — no separate gate needed beyond `controlled`.
	type InvitablePerson = { personId: string; name: string };

	let {
		presetDb = '',
		presetDbEntityId = '',
		presetDbName = '',
		heading = 'h1',
		layout = 'standalone',
		viewerPersonId = '',
		roster = []
	}: {
		presetDb?: string;
		presetDbEntityId?: string;
		presetDbName?: string;
		heading?: 'h1' | 'h2';
		layout?: 'standalone' | 'embedded';
		viewerPersonId?: string;
		roster?: InvitablePerson[];
	} = $props();
	const rootClasses = $derived(
		layout === 'embedded' ? 'flex w-full flex-col gap-4' : 'mx-auto flex w-full max-w-md flex-col gap-4'
	);
	// Deliberate ONE-TIME snapshot for seeding local $state below — the
	// controlled-mode sync effect (further down) is what stays reactive to
	// LATER prop changes; `untrack` here just tells the compiler this initial
	// read is intentional, not a missed reactivity dependency.
	const initialPresetDb = untrack(() => presetDb);
	const initialPresetDbEntityId = untrack(() => presetDbEntityId);

	type Status = RouteLoadStatus | 'no-access' | 'creating' | 'done' | 'create-error';

	// The enumerable set: mvox collectives (databases) this account has a person
	// in — NOT organization entities. Today that's exactly one (polyphony).
	const availableDbs = $derived(
		$collectiveState.status === 'ready' ? $collectiveState.collectives : []
	);

	// CONTROLLED MODE — the caller supplied BOTH halves of the (db, org) pair.
	// Single predicate, used by the self-resolution effects AND the template, so
	// "does not self-resolve" and "renders no picker" can never disagree.
	const controlled = $derived(presetDb !== '' && presetDbEntityId !== '');
	// Display-only label for the fixed collective in controlled mode.
	const presetLabel = $derived(
		presetDbName || availableDbs.find((c) => c.db === presetDb)?.name || presetDb
	);

	let status = $state<Status>(initialPresetDb && initialPresetDbEntityId ? 'ready' : 'loading');
	let dbId = $state(initialPresetDb);
	// The member's required org-entity parent — resolved internally per chosen
	// `dbId` (never rendered as a picker; see #67 note in the original page).
	let dbEntityId = $state(initialPresetDbEntityId);
	// Tracks which db's prerequisites are CURRENTLY resolved — set by a
	// successful `loadPrerequisites` OR by the controlled-mode sync below.
	// Effect B reads this to skip a redundant fetch when the caller already
	// supplied a resolved org for the current `dbId`.
	let resolvedForDb = $state(initialPresetDb && initialPresetDbEntityId ? initialPresetDb : '');

	// Done-panel state — the token-carrying link exists ONLY here (component state).
	// #207 rule 7 (PO standing rule, Gama's 2026-09-02 rulings) — numeric date
	// text renders as the ISO calendar date, `YYYY-MM-DD` (en-CA gives ISO date
	// format), never a browser-locale rendering.
	const inviteExpiryDateFmt = isoDateFormatter();

	let inviteLink = $state('');
	let inviteExpiryDate = $state('');
	let copied = $state(false);
	let copyFailed = $state(false);

	let createError = $state<{ personId?: string } | null>(null);

	const canSubmit = $derived(dbId !== '' && dbEntityId !== '');

	// #301 — the person-select's own prerequisite state. `ownerTier` starts
	// 'loading' and — per the issue's explicit instruction — 'loading' AND
	// 'error' both render as NOT-SHOWN (`showPersonSelect` below): a select
	// that appeared before the tier is actually known would 403 on submit for
	// a non-owner, and an unresolved answer is not the same claim as "not an
	// owner".
	let ownerTier = $state<OwnerTier | 'loading'>('loading');
	let joinStates = $state<Record<string, JoinState>>({});
	// STATED CHOICE (b): `listJoinStates` fails LOUD (any single person's HTTP
	// failure rejects the whole fan-out — #294 discipline, never a partial
	// list). Caught here as "we do not know who is uninvited": `joinStates`
	// stays empty (the select stays absent, never stale or partial) and this
	// flag renders one visible note. The blank-invite path does not read
	// `joinStates` at all, so it is untouched by this failure. Reachable only
	// on the owner path — see `loadPersonInviteData`, which does not read the
	// list for a tier that could never render the select.
	let personListError = $state(false);
	// '' = the always-present default ("a new person" — today's behavior).
	let selectedPersonId = $state('');
	let personMintError = $state<{ name: string; ownerOnly: boolean } | null>(null);

	const uninvitedPersons = $derived(roster.filter((p) => joinStates[p.personId] === 'absent'));
	const selectedPerson = $derived(
		uninvitedPersons.find((p) => p.personId === selectedPersonId) ?? null
	);
	// The select's OWN placement rule, independent of `canSubmit`: owner-tier
	// AND at least one uninvited person, both required — see the issue's "(if
	// any)" requirement (a control that can only be refused is never shown).
	const showPersonSelect = $derived(controlled && ownerTier === 'owner' && uninvitedPersons.length > 0);
	// #294's reused one-line explanation — a CONFIRMED non-owner tier only
	// ('editor' or 'none'); 'loading'/'error' render neither this note nor the
	// select (same STATED CHOICE (a) as above, applied consistently: an
	// unresolved tier must never be presented as a positive claim either way).
	const ownerNoteVisible = $derived(controlled && (ownerTier === 'editor' || ownerTier === 'none'));

	// The submit button's visible text IS its accessible name (no aria-label
	// anywhere on it) — STATED CHOICE (d): the label flip is driven by this ONE
	// derived value the template renders verbatim, so "which behavior will
	// fire" and "what the button says" can never drift apart.
	const submitLabel = $derived(
		status === 'creating'
			? m.admin_invite_creating()
			: selectedPerson
				? m.admin_invite_submit_person({ name: selectedPerson.name })
				: m.admin_invite_submit()
	);

	// Guards against re-fetching the SAME owner-tier/uninvited-list answer on
	// every unrelated re-render — mirrors `resolvedForDb`'s role above, just
	// keyed on the four inputs this read actually depends on.
	let resolvedPersonDataKey = '';

	async function loadPersonInviteData(
		cfg: { db: string; token: string },
		dbEntityIdForTier: string,
		personIdForTier: string,
		personIds: string[]
	): Promise<void> {
		personListError = false;
		// #301 review F2 — SEQUENTIAL, not a `Promise.all` pair, for two reasons
		// the coupling caused:
		//   1. `listJoinStates` is a fan-out of ONE linked-identity-property GET
		//      per roster person. The select it feeds can only ever render for
		//      an owner (`showPersonSelect`), so for an editor-/none-tier admin
		//      those N requests fired on every /admin load and their result was
		//      discarded unread. The tier answer decides whether the list is
		//      needed AT ALL, so it must come first.
		//   2. `Promise.all` rejects as a unit: one person's failed read skipped
		//      the `ownerTier` assignment entirely, stranding the tier at
		//      'loading' — which made `ownerNoteVisible` false and showed a
		//      non-owner admin the red list-failure note instead of #294's
		//      owner-rights explanation. Assigning the tier first means a list
		//      failure can no longer swallow it.
		// `resolveOwnerTier` answers 'error' rather than throwing (adminStore.ts),
		// so the assignment below always lands; the catch is belt-and-braces
		// against an unexpected throw, and keeps the same "unresolved tier
		// renders neither the select nor the note" meaning.
		let tier: OwnerTier;
		try {
			tier = await resolveOwnerTier(cfg, personIdForTier, undefined, dbEntityIdForTier);
		} catch (e) {
			console.error('admin/invite: owner-tier read failed — the select stays absent', e);
			tier = 'error';
		}
		ownerTier = tier;
		if (tier !== 'owner') {
			// Nothing to list for: the select cannot render for this tier.
			joinStates = {};
			return;
		}
		try {
			joinStates = await listJoinStates(cfg, personIds);
		} catch (e) {
			console.error(
				'admin/invite: person-select prerequisite read failed — the select stays absent',
				e
			);
			joinStates = {};
			personListError = true;
		}
	}

	// #301 — `controlled`-only: the select's placement ("between invite-db-fixed
	// and the submit button") only exists alongside the fixed collective line,
	// which only renders in controlled mode.
	$effect(() => {
		if (!controlled || !presetDbEntityId || !viewerPersonId) return;
		const token = getToken();
		if (!token) return;
		const personIds = roster.map((p) => p.personId);
		const key = `${presetDb}|${presetDbEntityId}|${viewerPersonId}|${personIds.join(',')}`;
		if (key === resolvedPersonDataKey) return;
		resolvedPersonDataKey = key;
		void loadPersonInviteData({ db: presetDb, token }, presetDbEntityId, viewerPersonId, personIds);
	});

	// Plain (non-reactive) flag, not $state — mirrors +layout.svelte's
	// `lastAuthStatus`/`hydrating` pattern. Once the picker has been shown once
	// (either the sole-db bootstrap resolved, or a multi-db "none chosen yet"
	// ready state was reached), a LATER db switch keeps the select mounted and
	// just disables submit while it re-resolves — it never collapses back to the
	// bare loading spinner, which would unmount the select mid-interaction.
	let hasShownForm = !!(initialPresetDb && initialPresetDbEntityId);

	async function loadPrerequisites(targetDb: string): Promise<void> {
		if (!hasShownForm) status = 'loading';
		dbEntityId = '';
		const token = getToken();
		if (!token) {
			// Inconsistency on a protected route — fail loudly as a load error, never
			// silently as "not admin".
			console.error('admin/invite: no auth token in storage on a protected route');
			status = 'load-error';
			return;
		}
		const cfg = { db: targetDb, token };
		try {
			// `resolvePersonParentId` and `resolveInviteParentId` now resolve the SAME database
			// entity (#161 review fix round 2 — both delegate to
			// `resolveDatabaseEntityId`), so one resolve covers both call sites instead
			// of firing two identical GETs.
			const resolvedDbEntityId = await resolveInviteParentId(cfg);
			dbEntityId = resolvedDbEntityId;
			resolvedForDb = targetDb;
			status = 'ready';
			hasShownForm = true;
		} catch (e) {
			// Checked FIRST: a 401 is not "not admin" and not a load failure.
			if (isAuthExpiredError(e)) {
				status = 'session-expired';
				return;
			}
			if (e instanceof InviteCreateError && e.reason === 'not-visible') {
				// Labeled HEURISTIC: the prerequisites are not visible to this account.
				// The authoritative admin gate stays Entu's parent-expander check on the
				// create POST. Only `not-visible` lands here — an HTTP/network failure is
				// NEVER presented as "not admin".
				status = 'no-access';
			} else {
				console.error('admin/invite: load failed', e);
				status = 'load-error';
			}
		}
	}

	// CONTROLLED-MODE SYNC — adopt a caller-supplied db + already-resolved org
	// directly. Runs before effects A/B below and marks `resolvedForDb`, so
	// effect B's fetch is skipped entirely: no async gap between this
	// component's readiness and its embedding parent's.
	$effect(() => {
		if (controlled) {
			dbId = presetDb;
			dbEntityId = presetDbEntityId;
			resolvedForDb = presetDb;
			hasShownForm = true;
			status = 'ready';
		}
	});

	// EFFECT A — derive dbId from the available collectives: no-collective gate,
	// sole-collective preselect. Pure state derivation, no fetches — kept
	// separate from effect B below so a preselect-write doesn't also re-fire the
	// fetch-triggering effect a second time in the same settle (each effect only
	// reruns on an ACTUAL dependency value change, so splitting the write from
	// the read-and-fetch keeps loadPrerequisites to exactly one call per db).
	$effect(() => {
		if (controlled) return; // controlled mode — never self-resolves
		if (availableDbs.length === 0) {
			status = 'no-collective';
			dbId = '';
			dbEntityId = '';
			hasShownForm = false;
			resolvedForDb = '';
			return;
		}
		if (dbId === '' && availableDbs.length === 1) {
			dbId = availableDbs[0].db; // sole database preselected, select still rendered
		}
	});

	// EFFECT B — react to the resolved dbId: load its prerequisites, or (multiple
	// databases, none chosen yet) show the picker with submit disabled. Skips
	// the fetch outright when `dbId` is already resolved (controlled-mode sync
	// above, or a prior successful load for this same db).
	$effect(() => {
		if (controlled) return; // controlled mode — never self-resolves
		if (availableDbs.length === 0) return; // effect A already set no-collective
		if (dbId) {
			if (dbId === resolvedForDb) return; // already resolved — no redundant fetch
			void loadPrerequisites(dbId);
		} else {
			status = 'ready';
			hasShownForm = true;
		}
	});

	async function submit(): Promise<void> {
		if (!dbId || !canSubmit || status === 'creating') return;
		const token = getToken();
		if (!token) {
			console.error('admin/invite: no auth token in storage on a protected route');
			createError = {};
			status = 'create-error';
			return;
		}
		const cfg = { db: dbId, token };
		// #301 review F1 — BOTH error surfaces clear at the single entry point,
		// not one each inside its own branch. Each branch clearing only its own
		// variable left the other one rendered: a failed mint naming Cilla stayed
		// on screen under a button that now says "Create invite" (and the mirror
		// case stacked `invite-admin-error` and `invite-mint-error` together). An
		// error message must never outlive the action it describes.
		createError = null;
		personMintError = null;

		// #301 — the person-targeted path. STATED CHOICE (c): `createInvite` is
		// structurally UNREACHABLE from here — this branch returns before falling
		// through to the blank-invite call below, on every exit (success,
		// session-expiry, and the mint-failure catch). Selecting an existing
		// person and calling `createInvite` would mint a SECOND person/member for
		// someone who already exists (#294's central avoidance) — that duplicate
		// -identity outcome is the reason this split exists at all.
		if (selectedPersonId) {
			const targetPersonId = selectedPersonId;
			const targetName = selectedPerson?.name ?? '';
			status = 'creating';
			try {
				const { inviteToken } = await mintSelfLinkInvite(cfg, targetPersonId);
				inviteLink = buildInviteUrl(window.location.origin, inviteToken);
				const parsed = parseInviteToken(inviteToken, Date.now());
				inviteExpiryDate =
					parsed.status === 'invalid' ? '' : inviteExpiryDateFmt.format(new Date(parsed.expMs));
				copied = false;
				copyFailed = false;
				selectedPersonId = '';
				try {
					// Re-derive THIS person's state from the platform's own truth —
					// never a local splice — same discipline the roster's
					// `refreshJoinState` uses after its own mint/withdraw calls.
					const updated = await listJoinStates(cfg, [targetPersonId]);
					joinStates = { ...joinStates, ...updated };
				} catch (refreshErr) {
					console.error(
						'admin/invite: post-mint join-state refresh failed — the list may show a stale entry until the next reload',
						refreshErr
					);
				}
				status = 'done';
			} catch (e) {
				if (isAuthExpiredError(e)) {
					status = 'session-expired';
					return;
				}
				// #301 — a DIFFERENT error class from `InviteCreateError` (item 5): its
				// OWN error surface, never funneled through the createInvite
				// partial-failure UI (that UI describes a person entity that got
				// CREATED, which this path never does). 403/'missing-self-editor' is
				// caught HERE too, surfaced as the owner-rights meaning rather than
				// the raw platform text.
				console.error('admin/invite: person-targeted mint failed', e);
				const ownerOnly = e instanceof SelfLinkMintError && e.reason === 'missing-self-editor';
				personMintError = { name: targetName, ownerOnly };
				status = 'create-error';
			}
			return;
		}

		status = 'creating';
		try {
			const result = await createInvite(cfg, { dbEntityId });
			inviteLink = buildInviteUrl(window.location.origin, result.inviteToken);
			// The shown expiry is the minted token's OWN exp — never an assumed +7d.
			const parsed = parseInviteToken(result.inviteToken, Date.now());
			inviteExpiryDate =
				parsed.status === 'invalid' ? '' : inviteExpiryDateFmt.format(new Date(parsed.expMs));
			copied = false;
			copyFailed = false;
			status = 'done';
		} catch (e) {
			if (isAuthExpiredError(e)) {
				status = 'session-expired';
				return;
			}
			console.error('admin/invite: create failed', e);
			if (e instanceof InviteCreateError) {
				createError = { personId: e.personId };
			} else {
				createError = {};
			}
			status = 'create-error'; // form values stay — retry enabled
		}
	}

	async function copyLink(): Promise<void> {
		copied = false;
		copyFailed = false;
		try {
			// No silent no-op: an unavailable clipboard (non-secure context) fails
			// visibly; the readonly input stays manually copyable.
			if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable in this context');
			await navigator.clipboard.writeText(inviteLink);
			copied = true;
		} catch (e) {
			console.error('admin/invite: copy failed', e);
			copyFailed = true;
		}
	}

	function createAnother(): void {
		// Discards the link for good — the token was shown once and is not stored.
		inviteLink = '';
		inviteExpiryDate = '';
		copied = false;
		copyFailed = false;
		createError = null;
		// #301 — back to the default selection too. `joinStates` itself is left
		// untouched: a successful mint already re-derived the just-invited
		// person's own entry (see `submit`), so the uninvited list here is
		// already current, not a stale pre-mint snapshot.
		selectedPersonId = '';
		personMintError = null;
		status = 'ready';
	}
</script>

<div class={rootClasses}>
	<!-- #140/S3 review F2 — heading LEVEL follows the embedding context: the
	     standalone /admin/invite route is the page itself (h1, text-2xl, as it
	     was before the extraction), the embedded section sits under /admin's own
	     h1 (h2, text-lg). -->
	<svelte:element
		this={heading}
		class={heading === 'h1' ? 'font-display text-2xl' : 'font-display text-lg'}
	>
		{m.admin_invite_title()}
	</svelte:element>

	{#if status === 'no-collective'}
		<p data-testid="invite-admin-no-collective" class="text-sm">
			{m.admin_invite_no_collective()}
		</p>
	{:else if status === 'loading'}
		<p class="text-sm" aria-busy="true">…</p>
	{:else if status === 'no-access'}
		<p data-testid="invite-admin-no-access" class="text-sm" role="alert">
			{m.admin_invite_no_access()}
		</p>
	{:else if status === 'session-expired'}
		<SessionExpiredNotice />
	{:else if status === 'load-error'}
		<div data-testid="invite-admin-load-error" class="flex flex-col gap-2" role="alert">
			<p class="text-sm text-red-700">{m.admin_invite_load_error()}</p>
			<button
				type="button"
				data-testid="invite-admin-retry-load"
				class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
				onclick={() => dbId && loadPrerequisites(dbId)}
			>
				{m.admin_invite_retry_load()}
			</button>
		</div>
	{:else if status === 'done'}
		<div data-testid="invite-admin-result" class="flex flex-col gap-3">
			<label class="flex flex-col gap-1 text-sm">
				{m.admin_invite_link_label()}
				<input
					data-testid="invite-link"
					readonly
					value={inviteLink}
					class="rounded-md border border-ink px-3 py-2 font-mono"
				/>
			</label>
			<button
				type="button"
				data-testid="invite-copy"
				class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
				onclick={copyLink}
			>
				{copied ? m.admin_invite_copied() : m.admin_invite_copy()}
			</button>
			{#if copyFailed}
				<p class="text-sm text-red-700" role="alert">{m.admin_invite_copy_error()}</p>
			{/if}
			<p data-testid="invite-bearer-warning" class="text-sm text-red-700">
				{m.admin_invite_bearer_warning()}
				{m.admin_invite_show_once({ date: inviteExpiryDate })}
			</p>
			<button
				type="button"
				class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
				onclick={createAnother}
			>
				{m.admin_invite_create_another()}
			</button>
		</div>
	{:else}
		<!-- ready | creating | create-error: the form -->
		{#if createError}
			<div data-testid="invite-admin-error" class="flex flex-col gap-1" role="alert">
				<p class="text-sm text-red-700">
					{m.admin_invite_error()}
				</p>
				{#if createError.personId}
					<p data-testid="invite-partial-failure" class="text-sm text-red-700">
						{m.admin_invite_partial_failure({ personId: createError.personId })}
					</p>
				{/if}
			</div>
		{/if}
		{#if personMintError}
			<!-- #301 item 5 — a SelfLinkMintError's OWN surface: a DIFFERENT
			     operation (mint onto an EXISTING person) from createInvite's
			     partial-failure case (a person entity that got CREATED), so it never
			     shares that UI or its message. 403/'missing-self-editor' is caught
			     HERE too and rendered as the owner-rights meaning, never the raw
			     platform text — see the `submit()` catch branch. -->
			<div data-testid="invite-mint-error" class="flex flex-col gap-1" role="alert">
				<p class="text-sm text-red-700">
					{personMintError.ownerOnly
						? m.admin_invite_mint_owner_only()
						: m.admin_invite_mint_error({ name: personMintError.name })}
				</p>
			</div>
		{/if}
		<div class="flex flex-col gap-3">
			{#if controlled}
				<!-- Controlled mode: the collective is FIXED by the embedding page
				     (which resolved db + org together). Rendering a picker here would
				     let `dbId` drift away from the `dbEntityId` that came with it — see the
				     review-F1 note in the script block. Static text, same label. -->
				<p data-testid="invite-db-fixed" class="flex flex-col gap-1 text-sm">
					<span>{m.admin_invite_db_label()}</span>
					<span class="font-medium">{presetLabel}</span>
				</p>
			{:else}
				<label class="flex flex-col gap-1 text-sm">
					{m.admin_invite_db_label()}
					<select
						data-testid="invite-db"
						value={dbId}
						onchange={(e) => (dbId = e.currentTarget.value)}
						class="rounded-md border border-ink px-3 py-2"
					>
						<!-- Explicit empty-value option, ALWAYS present (not `{#if}`-gated) so
						     the option SET never changes shape mid-interaction: a native
						     <select> silently defaults its DOM selection to the FIRST real
						     option whenever '' has no matching option, fighting the '' state
						     (the multi-collective "none chosen yet" case). One-way `value=` +
						     explicit `onchange` (not `bind:value`) — `bind:value`'s own
						     controlled-select sync effect raced this page's async prerequisite
						     effect in testing, landing on the wrong option. -->
						<option value="" disabled hidden>—</option>
						{#each availableDbs as c (c.db)}
							<option value={c.db}>{c.name}</option>
						{/each}
					</select>
				</label>
			{/if}
			<!-- #301 — the owner-only person select, "between the collective line and
			     the submit button" (issue's own placement spec). Exactly one of the
			     three states below is true at a time: the list read failed (loud
			     note, blank invite still works), the select itself (owner + at least
			     one uninvited person), or the #294 owner-rights note (a CONFIRMED
			     non-owner tier). 'loading'/'error' render NONE of the three — an
			     unresolved tier is not a positive claim in either direction. -->
			{#if personListError}
				<p data-testid="invite-person-list-error" class="text-sm text-red-700" role="alert">
					{m.admin_invite_person_list_error()}
				</p>
			{:else if showPersonSelect}
				<label class="flex flex-col gap-1 text-sm">
					{m.admin_invite_person_label()}
					<select
						data-testid="invite-person-select"
						value={selectedPersonId}
						onchange={(e) => {
							selectedPersonId = e.currentTarget.value;
							// #301 review F1 — changing the selection changes WHICH action
							// the button performs, so both error notes go with it: a note
							// describing the previous action must not sit under a button
							// now offering the other one.
							createError = null;
							personMintError = null;
						}}
						class="rounded-md border border-ink px-3 py-2"
					>
						<!-- The default is a REAL choice (today's unchanged behavior), never
						     a `disabled hidden` prompt — issue #301, per the #288 rule: "a
						     new person" is a thing an admin may deliberately want. -->
						<option value="">{m.admin_invite_person_new()}</option>
						{#each uninvitedPersons as p (p.personId)}
							<option value={p.personId}>{p.name}</option>
						{/each}
					</select>
				</label>
			{:else if ownerNoteVisible}
				<p data-testid="invite-owner-note" class="text-xs text-ink-2">
					{m.roster_member_invite_owner_only()}
				</p>
			{/if}
			<button
				type="button"
				data-testid="invite-admin-submit"
				disabled={!canSubmit || status === 'creating'}
				class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper disabled:opacity-50"
				onclick={submit}
			>
				{submitLabel}
			</button>
		</div>
	{/if}
</div>

<!-- (*MVOX:Palestrina* — #140/S3 GREEN, extracted from admin/invite/+page.svelte -->
