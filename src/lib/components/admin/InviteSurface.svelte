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
	import { createInvite, InviteCreateError, resolveInviteParentId } from '$lib/invite/inviteData';
	import { buildInviteUrl } from '$lib/invite/invite-links';
	import { parseInviteToken } from '$lib/invite/parse-invite-token';
	// #107 review F2 — a 401 here used to land in the generic 'load-error'
	// (Retry against a token already deleted from localStorage) or, on the write
	// path, in 'create-error'. Both are misleading: the session is gone.
	import { isAuthExpiredError } from '$lib/entu/request';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import { isoDateFormatter } from '$lib/preferences/timeFormat';

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
	let {
		presetDb = '',
		presetDbEntityId = '',
		presetDbName = '',
		heading = 'h1'
	}: {
		presetDb?: string;
		presetDbEntityId?: string;
		presetDbName?: string;
		heading?: 'h1' | 'h2';
	} = $props();
	// Deliberate ONE-TIME snapshot for seeding local $state below — the
	// controlled-mode sync effect (further down) is what stays reactive to
	// LATER prop changes; `untrack` here just tells the compiler this initial
	// read is intentional, not a missed reactivity dependency.
	const initialPresetDb = untrack(() => presetDb);
	const initialPresetDbEntityId = untrack(() => presetDbEntityId);

	type Status =
		| 'loading'
		| 'no-collective'
		| 'no-access'
		| 'load-error'
		| 'session-expired'
		| 'ready'
		| 'creating'
		| 'done'
		| 'create-error';

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
		status = 'creating';
		createError = null;
		try {
			const result = await createInvite({ db: dbId, token }, { dbEntityId });
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
		status = 'ready';
	}
</script>

<div class="mx-auto flex w-full max-w-md flex-col gap-4">
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
			<button
				type="button"
				data-testid="invite-admin-submit"
				disabled={!canSubmit || status === 'creating'}
				class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper disabled:opacity-50"
				onclick={submit}
			>
				{status === 'creating' ? m.admin_invite_creating() : m.admin_invite_submit()}
			</button>
		</div>
	{/if}
</div>

<!-- (*MVOX:Palestrina* — #140/S3 GREEN, extracted from admin/invite/+page.svelte -->
