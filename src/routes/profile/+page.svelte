<script lang="ts">
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import { getToken, getUser, getLastProvider } from '$lib/auth/storage';
	import { selectedCollectiveStore } from '$lib/collectives/store';
	import {
		listMyProfiles,
		profilesByLevel,
		resolveField,
		type Level,
		type MyProfile
	} from '$lib/profile/profileData';
	import { completionGateStore, resolveGate } from '$lib/profile/completionGate';
	import {
		planLoadedDuplicateRepairs,
		applyConflictResolution,
		FieldMoveError,
		type FieldKey
	} from '$lib/profile/fieldMove';
	import { createFieldMoveQueue } from '$lib/profile/fieldMoveQueue';
	import { createProfileEditQueue } from '$lib/profile/profileEditQueue';
	import { createAutosave } from '$lib/profile/autosave';
	import ProfileField from '$lib/components/profile/ProfileField.svelte';
	import VisibilityRepairBanner from '$lib/components/profile/VisibilityRepairBanner.svelte';
	import LanguageSelector from '$lib/components/LanguageSelector.svelte';
	import { timeFormatStore, setTimeFormat, type TimeFormat } from '$lib/preferences/timeFormat';
	import { isAuthExpiredError } from '$lib/entu/request';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import { createRouteLoadMachine, type RouteLoadStatus } from '$lib/loading/routeLoad';
	// #193 — linked auth providers + "Link another account".
	import { listLinkedIdentities, type LinkedIdentity } from '$lib/profile/linkedIdentities';
	import { mintSelfLinkInvite, SelfLinkMintError } from '$lib/invite/inviteData';
	import { AUTH_PROVIDERS, providerLabel } from '$lib/auth/providers';
	import { createNonce } from '$lib/auth/state';
	import { buildOAuthInitUrl } from '../auth/[provider]/build-oauth-init-url';

	// #60 — identity display: which account + provider the user is signed in with.
	// Informational only (no interactivity); multi-provider linking is parked.
	const identityUser = getUser();
	const identityAccount = identityUser?.email || identityUser?.name || '';
	const identityProvider = providerLabel(getLastProvider());

	const FIELDS: readonly FieldKey[] = ['name', 'email'];
	const otherField = (f: FieldKey): FieldKey => (f === 'name' ? 'email' : 'name');

	const LEVELS: readonly Level[] = ['public', 'domain', 'private'];

	const selected = $derived($selectedCollectiveStore);

	let status = $state<RouteLoadStatus>('loading');

	// Unified draft: one value per field (not per level).
	let draft = $state<{ name: string; email: string }>({ name: '', email: '' });
	// Confirmed state stays per-entity (the backend model is per-entity).
	function emptyConfirmed(): Record<Level, { id: string | null; name: string; email: string }> {
		return {
			public: { id: null, name: '', email: '' },
			domain: { id: null, name: '', email: '' },
			private: { id: null, name: '', email: '' }
		};
	}
	let confirmed = $state(emptyConfirmed());

	// Per-field save-in-flight markers (replaces per-level pendingLevels for autosave feedback).
	let savingFields = $state(new Set<FieldKey>());
	let failedFields = $state(new Set<FieldKey>());

	// Per-level pending/failed still needed for the queue internals.
	let pendingLevels = $state(new Set<Level>());

	let loadedProfiles = $state<MyProfile[]>([]);
	let transport = $state<Record<FieldKey, Level | null>>({ name: null, email: null });
	let moveFailed = $state(new Set<FieldKey>());
	let repairWorking = $state(new Set<FieldKey>());
	let repairFailed = $state(new Set<FieldKey>());
	// #257 — the repair confirmation announcement, house idiom (event-create-status /
	// roster-reorder-status): a PERSISTENT sr-only role="status" region driven by plain
	// state, set imperatively on success, cleared at the START of the next repair
	// attempt (never a timer — the app has zero auto-dismiss patterns).
	let repairStatus = $state('');
	let busy = $state(false);
	let pendingMoveTo: Record<FieldKey, Level | null> = { name: null, email: null };

	// #193 — linked auth providers, loaded alongside the profile fields but kept
	// on its OWN try/catch (below): a hiccup reading them must not take down the
	// name/email editing surface, which is the page's primary purpose.
	let linkedIdentities = $state<LinkedIdentity[]>([]);
	let linkPickerOpen = $state(false);
	let linkBusy = $state(false);
	let linkError = $state<string | null>(null);
	// #193 (review F1) — an UNKNOWN identity list is not a known-empty one. Every
	// user has at least one bound identity, so an empty `linkedIdentities` after a
	// failed read is a display LIE. This flag keeps the two states apart: the
	// section says what broke, and linking stays blocked (the picker CTA disables)
	// while the bound set is unknown.
	let linkedLoadFailed = $state(false);

	// #193 (review F3) — focus custody across the activator→picker swap. The
	// picker REPLACES the CTA, so the focused node leaves the DOM; without an
	// explicit hand-off a keyboard user lands on <body> and has to tab from the
	// top of the page to reach the buttons that just appeared.
	let linkAnotherEl = $state<HTMLButtonElement | null>(null);
	let linkPickerEl = $state<HTMLDivElement | null>(null);

	/** The step name used when the identity read — not a mint — is what failed. */
	const IDENTITY_READ_STEP = 'identity-read';

	// #193 (review F1) — the RETURN leg. run-link-callback.ts lands every
	// redemption-side failure back here as `/profile?link_error=<code>` and a
	// success as `/profile?linked=1`. Without a consumer the user came back to a
	// completely normal-looking profile and never learned that the link failed.
	// Read ONCE at init (not $derived): the outcome belongs to the navigation that
	// mounted this page, and starting a new link attempt must be able to clear it.
	// The value arrives from a URL the user controls, and lands in a role="alert"
	// node — so the code is a CLOSED whitelist, matching exactly what
	// run-link-callback.ts emits. Anything else is not ours and is never echoed.
	function returnLinkErrorMessage(code: string): string {
		switch (code) {
			case 'conflict':
				return m.profile_link_error_conflict();
			case 'dead':
				return m.profile_link_error_dead();
			case 'failed':
				return m.profile_link_error_failed();
			case 'already_linked':
				return m.profile_link_error_already_linked();
			// unexpected / invalid / persist_failed — no user-actionable distinction,
			// but the step stays NAMED rather than being swallowed into a generic
			// "linking failed" (the whole point of the fail-loudly rule).
			case 'unexpected':
			case 'invalid':
			case 'persist_failed':
				return m.profile_link_error_step({ step: code });
			default:
				return m.profile_link_error_failed();
		}
	}

	const returnLinkErrorCode = page.url.searchParams.get('link_error');
	let returnLinkError = $state<string | null>(
		returnLinkErrorCode ? returnLinkErrorMessage(returnLinkErrorCode) : null
	);
	let linkSucceeded = $state(!returnLinkErrorCode && page.url.searchParams.get('linked') === '1');

	// #219 — the after-the-fact same-identity case: run-link-callback.ts detected
	// (against the pre-mint snapshot) that the round trip changed nothing, and
	// lands back here as `/profile?link_noop=same_identity`. Gama ruling: this is
	// NOT an error — the user did nothing wrong — so it gets its own neutral,
	// role="status" rendering, never the alert node. Same closed-whitelist
	// treatment as `link_error`: the code is attacker-shaped input, and an
	// unrecognized value renders nothing and is never echoed.
	function returnLinkNoopMessage(code: string): string | null {
		switch (code) {
			case 'same_identity':
				return m.profile_link_noop_same_identity();
			default:
				return null;
		}
	}
	const returnLinkNoopCode = page.url.searchParams.get('link_noop');
	let linkNoop = $state<string | null>(
		!returnLinkErrorCode && returnLinkNoopCode ? returnLinkNoopMessage(returnLinkNoopCode) : null
	);

	/** The alert node shows whichever leg spoke last: mint-side, then return-side. */
	const shownLinkError = $derived(linkError ?? returnLinkError);

	/**
	 * #219 — the linked-identities list de-duplicates by uid+provider (first
	 * occurrence in entity order wins). A same-identity re-link (see
	 * run-link-callback.ts) can leave — or, before its server-side cleanup lands,
	 * HAS left — two bound-identity entries with identical uid+provider and
	 * different _ids; one identity must render as one row. The template still
	 * keys by `_id`, so a genuine second account at the same provider (different
	 * uid) stays two rows.
	 */
	const dedupedLinkedIdentities = $derived.by(() => {
		const seen = new Set<string>();
		const out: LinkedIdentity[] = [];
		for (const identity of linkedIdentities) {
			const key = `${identity.uid} ${identity.provider}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(identity);
		}
		return out;
	});

	/**
	 * #193 (review F1) — linking is PER-COLLECTIVE, not account-wide: the mint runs
	 * against the selected collective's {db, personId}, so the second identity is
	 * bound to that collective's person entity alone. The list already re-reads per
	 * selected collective; naming the collective in the heading and the success line
	 * keeps the words matching what actually happened. (Account-wide linking is a
	 * separate product decision, not a copy change.)
	 */
	const linkScopeName = $derived(selected?.name ?? '');

	const domainNameMissing = $derived($completionGateStore === 'incomplete');

	const nameRes = $derived(resolveField(loadedProfiles, 'name'));
	const emailRes = $derived(resolveField(loadedProfiles, 'email'));
	const resFor = (f: FieldKey) => (f === 'name' ? nameRes : emailRes);
	const repairPlans = $derived(planLoadedDuplicateRepairs(loadedProfiles));
	const planFor = (f: FieldKey) => repairPlans.find((p) => p.field === f);

	// A field is movable only when EXACTLY ONE entity holds it. Zero holders means
	// there is no value to move — `onmove` bails on `holders.length !== 1` and
	// `ProfileField` carries no staged/pending target level, so enabling the picker
	// for an empty field would render buttons that silently swallow the click.
	// (Pre-typing tier selection would need real per-field staging state that
	// `activeLevelFor`/`onAutosave` consult — a separate change, not a picker flag.)
	// More than one holder is a conflict, handled by the conflict branch below.
	const movableFor = (f: FieldKey) => resFor(f).holders.length === 1;
	const isConflict = (f: FieldKey) => resFor(f).holders.length > 1 && planFor(f) === undefined;
	const conflictLevelsFor = (f: FieldKey): Level[] =>
		isConflict(f) ? resFor(f).holders.slice(1).map((h) => h.level) : [];
	/** #131 — each level's OWN value for a field, so ProfileField can preview a conflicting tier. */
	const conflictValuesFor = (f: FieldKey): Record<Level, string> => ({
		public: confirmed.public[f],
		domain: confirmed.domain[f],
		private: confirmed.private[f]
	});

	/** The level currently holding this field (narrowest non-empty, or 'domain' default). */
	const activeLevelFor = (f: FieldKey): Level =>
		resFor(f).holders[0]?.level ?? 'domain';

	const writesInFlight = $derived(busy || pendingLevels.size > 0);

	function isDirty(field: FieldKey): boolean {
		const level = activeLevelFor(field);
		return draft[field] !== confirmed[level][field];
	}

	function withFieldSet(s: Set<FieldKey>, field: FieldKey, add: boolean): Set<FieldKey> {
		const next = new Set(s);
		if (add) next.add(field);
		else next.delete(field);
		return next;
	}

	// #160 — `loadedProfiles` (not `confirmed`) is what drives the tier picker's
	// enabled-state (via resolveField().holders → movableFor/resFor). It is
	// populated by loadForSelected(), but the autosave queue's settle callbacks
	// (reconcile/recordCreatedId) previously updated ONLY `confirmed` — so a
	// first-save CREATE never appeared in `loadedProfiles` and the picker stayed
	// stale until a reload re-fetched. Keep the two in sync at every settle point:
	// one profile entity per level, so replacing any existing holder at `level`
	// mirrors exactly what a reload's `profilesByLevel` would produce.
	function upsertLoadedProfile(level: Level, id: string, name: string, email: string): void {
		loadedProfiles = [
			...loadedProfiles.filter((p) => p._sharing !== level),
			{ _id: id, name, email, _sharing: level }
		];
	}

	function resetState() {
		draft = { name: '', email: '' };
		confirmed = emptyConfirmed();
		savingFields = new Set();
		failedFields = new Set();
		pendingLevels = new Set();
		loadedProfiles = [];
		transport = { name: null, email: null };
		moveFailed = new Set();
		repairWorking = new Set();
		repairFailed = new Set();
		repairStatus = '';
		busy = false;
		pendingMoveTo = { name: null, email: null };
		linkedIdentities = [];
		linkedLoadFailed = false;
		linkPickerOpen = false;
		linkBusy = false;
		linkError = null;
		autosaveCtrl.destroy();
	}

	/**
	 * #193 (review F1) — the linked-identities read, isolated from the profile
	 * fields load. It never rejects: a failure is recorded as `linkedLoadFailed`
	 * (a NAMED, rendered state), not as an empty list. The one exception is a
	 * session-expired rejection, which is a different failure class entirely
	 * (#107): entuFetch already cleared the stale session and fired the sign-in
	 * redirect, so the page says so instead of blaming the identity read.
	 */
	async function loadLinkedIdentities(
		cfg: { db: string; token: string },
		personId: string,
		g: number
	): Promise<void> {
		try {
			const linked = await listLinkedIdentities(cfg, personId);
			if (g !== routeLoad.generation) return;
			linkedIdentities = linked.identities;
			linkedLoadFailed = false;
		} catch (linkedErr) {
			if (g !== routeLoad.generation) return;
			if (isAuthExpiredError(linkedErr)) {
				status = 'session-expired';
				return;
			}
			console.error('profile: linked identities load failed', linkedErr);
			linkedIdentities = [];
			linkedLoadFailed = true;
		}
	}

	/** Retry ONLY the linked-identities read — the profile fields are already loaded. */
	function retryLinkedIdentities(): void {
		const ctx = activeContext();
		if (!ctx) return;
		void loadLinkedIdentities(ctx.cfg, ctx.personId, routeLoad.generation);
	}

	// #232 — the shared route-load machine (Status union, generation guard,
	// loadForSelected sequencing) extracted into $lib/loading/routeLoad; this
	// page's fetch BODY (below, `load`) and its page-specific `resetState` stay
	// verbatim. The machine never invents 'ready' — `load` writes it itself,
	// mid-body, before its linked-identities tail (unchanged from before).
	const routeLoad = createRouteLoadMachine({
		name: 'profile',
		selected: () => selected,
		setStatus: (s) => {
			status = s;
		},
		reset: () => {
			resetState();
			queue.reset();
			moveQueue.reset();
		},
		async load({ cfg, selected: current, g, isCurrent }) {
			const personId = current.personId;
			const profiles = await listMyProfiles(cfg, personId);
			if (!isCurrent()) return;
			loadedProfiles = profiles;
			const byLevel = profilesByLevel(profiles);
			const nextConfirmed = emptyConfirmed();
			for (const level of LEVELS) {
				const p = byLevel[level];
				if (p) {
					nextConfirmed[level] = { id: p._id, name: p.name, email: p.email };
				}
			}
			confirmed = nextConfirmed;

			// Populate unified draft from resolved field values.
			const nameResolved = resolveField(profiles, 'name');
			const emailResolved = resolveField(profiles, 'email');
			const nextDraft = {
				name: nameResolved.value,
				email: emailResolved.value
			};

			// #39 prefill: if no domain entity and name is empty, use provider name.
			if (nextDraft.name === '' && nextConfirmed.domain.id === null) {
				const providerName = getUser()?.name?.trim();
				if (providerName) {
					nextDraft.name = providerName;
				}
			}

			draft = nextDraft;
			status = 'ready';

			// #193 — linked-identities read, own failure handling: a hiccup here must
			// not take down the name/email editing surface above (already 'ready').
			await loadLinkedIdentities(cfg, personId, g);
		}
	});

	function loadForSelected(): Promise<void> {
		return routeLoad.loadForSelected();
	}

	function refreshCompletionGate(): void {
		const current = selected;
		const token = getToken();
		if (current && token) {
			// #260 — capture the load generation the SAME way loadForSelected does, so a
			// resolveGate settle answering a collective the user has since switched away
			// from can never overwrite the app-wide gate SSOT with stale-context state.
			const g = routeLoad.generation;
			resolveGate({ db: current.db, token }, current.personId).then(
				(state) => {
					if (g !== routeLoad.generation) return;
					completionGateStore.set(state);
				},
				(err) => {
					// #260/#257 — a stale settle's rejection must not surface (the race
					// fix); a LIVE rejection is a real failure to resolve membership
					// standing and must not vanish, so it gets the same console.error
					// every other failure in this file gets.
					if (g !== routeLoad.generation) return;
					console.error('profile: completion gate refresh failed', err);
				}
			);
		}
	}

	const queue = createProfileEditQueue(
		{
			setPending(level, isPending) {
				const next = new Set(pendingLevels);
				if (isPending) next.add(level);
				else next.delete(level);
				pendingLevels = next;
			},
			reconcile(level, profileId, fields) {
				// Which fields this settle answers for: the ones dispatched AT this level,
				// i.e. whose active level was `level` BEFORE the mirror below rewrites it.
				// `activeLevelFor` reads holders off `loadedProfiles`, and the mirror
				// replaces this level's entity — so a save that CLEARS a field drops its
				// only holder and flips `activeLevelFor` to the 'domain' fallback. Reading
				// it after the mirror would then miss the field and leave its `savingFields`
				// marker set forever (a tier button stuck at aria-busy="true").
				const affected = FIELDS.filter((f) => activeLevelFor(f) === level);
				confirmed = { ...confirmed, [level]: { id: profileId, name: fields.name, email: fields.email } };
				// #160 — mirror the confirm onto loadedProfiles too, so the tier picker
				// (which reads holders off loadedProfiles, not confirmed) reacts without
				// a reload.
				upsertLoadedProfile(level, profileId, fields.name, fields.email);
				// Clear per-field saving/failed on successful reconcile.
				for (const f of affected) {
					savingFields = withFieldSet(savingFields, f, false);
					failedFields = withFieldSet(failedFields, f, false);
				}
				if (level === 'domain') {
					refreshCompletionGate();
				}
			},
			recordCreatedId(level, profileId) {
				confirmed = { ...confirmed, [level]: { ...confirmed[level], id: profileId } };
				// #160 — partial failure: the shell was created but fields were not
				// confirmed, so it holds NO value and is deliberately not a holder
				// (`resolveField` counts only non-empty values) — the tier picker stays
				// locked, as it should. What mirroring it onto loadedProfiles buys is the
				// `dst` lookup in `onmove`: a later move INTO this tier finds the orphan
				// shell and reuses it, instead of creating a second entity at the same
				// level. (The retry's no-duplicate guarantee comes from `confirmed[level].id`
				// above, which feeds `existingId`.)
				upsertLoadedProfile(level, profileId, confirmed[level].name, confirmed[level].email);
			},
			markFailed(level) {
				for (const f of FIELDS) {
					if (activeLevelFor(f) === level) {
						savingFields = withFieldSet(savingFields, f, false);
						failedFields = withFieldSet(failedFields, f, true);
					}
				}
			}
		},
		() => routeLoad.generation
	);

	const moveQueue = createFieldMoveQueue(
		{
			setTransport(field, level, on) {
				transport = { ...transport, [field]: on ? level : null };
			},
			onCreateConfirmed() {},
			onMoveConfirmed(field) {
				busy = false;
				moveFailed = withFieldSet(moveFailed, field, false);
				void loadForSelected();
				if (field === 'name') refreshCompletionGate();
			},
			onMoveFailed(field, err) {
				busy = false;
				if (err instanceof FieldMoveError && err.phase === 'delete') {
					void loadForSelected();
				} else {
					if (err instanceof FieldMoveError && err.createdTargetId) {
						const id = err.createdTargetId;
						const toLevel = pendingMoveTo[field];
						if (toLevel && !loadedProfiles.some((p) => p._id === id)) {
							loadedProfiles = [...loadedProfiles, { _id: id, name: '', email: '', _sharing: toLevel }];
						}
					}
					moveFailed = withFieldSet(moveFailed, field, true);
				}
			},
			onRepairConfirmed(field) {
				busy = false;
				repairWorking = withFieldSet(repairWorking, field, false);
				repairFailed = withFieldSet(repairFailed, field, false);
				// #257 — set AFTER the reload, not before: loadForSelected()'s reset
				// runs on every call (including this one) and would wipe an
				// eagerly-set repairStatus straight back to ''.
				// #257 review F2 — and gated on the load generation, the same way
				// refreshCompletionGate is (#260). loadForSelected() bumps the
				// generation synchronously at its top and RESOLVES on every branch,
				// superseded ones included; without this guard a repair on
				// collective A whose reload is still in flight when the user
				// switches to B would announce A's confirmation over B's profile,
				// after B's own load already cleared repairStatus.
				const reload = loadForSelected();
				const g = routeLoad.generation;
				void reload.then(() => {
					if (g !== routeLoad.generation) return;
					repairStatus = m.profile_repair_done();
				});
			},
			onRepairFailed(field) {
				busy = false;
				repairWorking = withFieldSet(repairWorking, field, false);
				repairFailed = withFieldSet(repairFailed, field, true);
			}
		},
		() => routeLoad.generation
	);

	function activeContext(): { cfg: { db: string; token: string }; personId: string } | null {
		const current = selected;
		if (!current) {
			status = 'no-collective';
			return null;
		}
		const token = getToken();
		if (!token) {
			console.error('profile: no auth token in storage on a protected route');
			status = 'load-error';
			return null;
		}
		return { cfg: { db: current.db, token }, personId: current.personId };
	}

	// #193 — "Link another account": open the native provider picker. No mint
	// happens until a provider is actually picked (the token is a live 24h
	// bearer credential — never pre-minted).
	async function openLinkPicker(): Promise<void> {
		linkPickerOpen = true;
		linkError = null;
		// A new attempt supersedes the previous round trip's verdict (which is
		// pinned to the URL and would otherwise linger through the whole session).
		returnLinkError = null;
		linkSucceeded = false;
		linkNoop = null;
		// #193 (review F3) — the picker replaces the activator, so the focused node
		// is about to be removed. Hand focus to the first provider button (#219:
		// every provider stays enabled while linkedLoadFailed is false, so this is
		// simply the first one in AUTH_PROVIDERS order).
		await tick();
		linkPickerEl
			?.querySelector<HTMLButtonElement>('[data-testid^="profile-link-provider-"]:not([disabled])')
			?.focus();
	}

	/** #193 (review F3) — a way BACK out of the picker, with focus returned to the CTA. */
	async function closeLinkPicker(): Promise<void> {
		linkPickerOpen = false;
		linkError = null;
		await tick();
		linkAnotherEl?.focus();
	}

	function linkErrorMessage(e: unknown): string {
		if (e instanceof SelfLinkMintError) {
			// The rights gap is the one reason with its own user-actionable wording.
			if (e.reason === 'missing-self-editor') return m.profile_link_error_missing_rights();
			// #193 (review F2) — every OTHER mint failure keeps its step NAMED rather
			// than collapsing into "linking failed, try again". `stale-invite-cleanup`
			// in particular is not retry-fixable client-side (inviteData.ts aborts
			// before the mint when the stale-placeholder DELETE fails), so a bare
			// "you can try again" would be actively misleading.
			return m.profile_link_error_step({ step: e.phase });
		}
		return m.profile_link_error_failed();
	}

	// Mint a self-invite on the user's OWN person AT CLICK TIME, then hand off to
	// the second-provider OAuth round trip with `intent: 'link'`. The token rides
	// the localStorage OAuth-state blob only — it never enters any URL. A mint
	// failure (e.g. the missing-self-_editor rights gap) surfaces loudly here and
	// launches nothing.
	async function handleLinkProvider(providerId: string): Promise<void> {
		// #219 — an already-linked provider is a legitimate pick now (the pre-mint
		// refusal is gone): entu-api's same-person branch still reports a clean
		// `redeemed`, so the guard moved to the callback (run-link-callback.ts),
		// which detects the no-op against the `linkedSnapshot` minted below. The
		// only remaining reason to refuse a mint here is an UNKNOWN bound set —
		// the list never loaded, so there is nothing to snapshot (review F1).
		if (linkedLoadFailed) {
			linkError = m.profile_link_error_step({ step: IDENTITY_READ_STEP });
			return;
		}
		const ctx = activeContext();
		if (!ctx) return;
		linkBusy = true;
		linkError = null;
		returnLinkError = null;
		linkSucceeded = false;
		linkNoop = null;
		try {
			const { inviteToken } = await mintSelfLinkInvite(ctx.cfg, ctx.personId);
			const url = buildOAuthInitUrl({
				provider: providerId,
				origin: page.url.origin,
				returnTo: '/profile?linked=1',
				intent: 'link',
				nonce: createNonce(),
				invite: { db: ctx.cfg.db, token: inviteToken },
				linkPersonId: ctx.personId,
				// #219 — the pre-mint snapshot of the CURRENT identities, replayed by
				// the callback's same-identity duplicate check.
				linkedSnapshot: linkedIdentities.map(({ _id, uid, provider }) => ({
					_id,
					uid,
					provider
				}))
			});
			window.location.href = url;
		} catch (e) {
			console.error('profile: self-link mint failed', e);
			linkBusy = false;
			linkError = linkErrorMessage(e);
		}
	}

	// The autosave onSave callback — dispatches through the existing queue.
	function onAutosave(field: FieldKey): void {
		if (!isDirty(field)) return;
		const activeLevel = activeLevelFor(field);

		// Name-private guard (loud failure, never silent return).
		if (field === 'name' && activeLevel === 'private') {
			throw new Error('name-private guard: name cannot be saved at private level');
		}

		const ctx = activeContext();
		if (!ctx) return;
		// Pin sibling value to the target entity's confirmed value — NEVER the unified draft.
		const fields = {
			name: field === 'name' ? draft.name : confirmed[activeLevel].name,
			email: field === 'email' ? draft.email : confirmed[activeLevel].email
		};

		savingFields = withFieldSet(savingFields, field, true);
		failedFields = withFieldSet(failedFields, field, false);
		queue.request({
			cfg: ctx.cfg,
			personId: ctx.personId,
			level: activeLevel,
			existingId: confirmed[activeLevel].id,
			fields
		});
	}

	const autosaveCtrl = createAutosave({ idleMs: 2_000, onSave: onAutosave });

	function onmove(field: FieldKey, toLevel: Level) {
		if (writesInFlight) return;

		// Name-private guard (loud failure on the move path).
		if (field === 'name' && toLevel === 'private') {
			throw new Error('name-private guard: name cannot be moved to private level');
		}

		const res = resFor(field);
		if (res.holders.length !== 1) return;
		const from = res.holders[0];
		if (from.level === toLevel) return;
		const ctx = activeContext();
		if (!ctx) return;
		const src = loadedProfiles.find((p) => p._id === from.id);
		if (!src) return;
		const dst = loadedProfiles.find((p) => p._sharing === toLevel) ?? null;
		const other = otherField(field);
		pendingMoveTo = { ...pendingMoveTo, [field]: toLevel };
		moveFailed = withFieldSet(moveFailed, field, false);
		busy = true;
		moveQueue.move({
			cfg: ctx.cfg,
			personId: ctx.personId,
			field,
			fromLevel: from.level,
			toLevel,
			value: res.value,
			srcId: from.id,
			dstId: dst ? dst._id : null,
			srcSibling: src[other],
			dstSibling: dst ? dst[other] : ''
		});
	}

	function onrepair(field: FieldKey) {
		if (writesInFlight) return;
		const plan = planFor(field);
		if (!plan) return;
		const ctx = activeContext();
		if (!ctx) return;
		repairFailed = withFieldSet(repairFailed, field, false);
		repairWorking = withFieldSet(repairWorking, field, true);
		// #257 — cleared at the START of the attempt, house pattern
		// (eventCreateStatus/reorderStatus): a stale confirmation must not linger
		// through a new attempt, and clearing here (not on settle) means a failed
		// retry shows no confirmation at all rather than a stale one.
		repairStatus = '';
		busy = true;
		moveQueue.repair({ cfg: ctx.cfg, field, clear: plan.clear });
	}

	// #131 — browse-then-confirm: second tap on a previewed conflict tier
	// converges every OTHER holder onto that tier's value, then reloads (the
	// pre-existing repair-detection machinery picks up the now-same-value
	// duplicate on the next load).
	function handleResolve(field: FieldKey, level: Level) {
		if (writesInFlight) return;
		const res = resFor(field);
		const other = otherField(field);
		const chosenValue = confirmed[level][field];
		const sync = res.holders
			.filter((h) => h.level !== level)
			.map((h) => ({ id: h.id, sibling: confirmed[h.level][other] }));
		const ctx = activeContext();
		if (!ctx) return;
		busy = true;
		applyConflictResolution({ cfg: ctx.cfg, field, value: chosenValue, sync })
			.then(async () => {
				busy = false;
				// Deferred to the next microtask tick: lets any synchronous
				// caller-side setup that follows a resolve (e.g. reconfiguring what
				// the next load will see) land before the reload's read fires.
				await tick();
				loadForSelected();
			})
			.catch((e) => {
				busy = false;
				console.error('profile: conflict resolution failed', e);
			});
	}

	function handleValueChange(field: FieldKey, value: string) {
		draft = { ...draft, [field]: value };
		autosaveCtrl.keystroke(field);
	}

	function handleBlur(field: FieldKey) {
		autosaveCtrl.blur(field);
	}

	// #205 — Escape-cancels-edit: ProfileField reverts its own draft locally
	// (bind:value), but the PENDING idle-autosave timer for the cancelled
	// keystrokes lives here — it must die too, or a cancelled edit would still
	// autosave a few seconds later.
	//
	// #205 review round 3 F1 — killing the timer only covers the edits that
	// never reached the server. Cross the 2s idle window mid-edit and the
	// autosave has ALREADY written the half-typed value; `cancel()` then clears
	// a timer that no longer exists, the display snaps back to the pre-edit
	// value, and Entu silently keeps the mid-edit one — divergent, with no
	// dirty indicator to admit it. ProfileField has already written the
	// pre-edit value back through `bind:value` by the time this runs, so
	// `isDirty` is now measured against what the mid-edit autosave confirmed:
	// true exactly when a write landed that the cancel has to undo, false (a
	// no-op) in the ordinary case where nothing was autosaved. The flush goes
	// through the same `onAutosave` seam as every other save — no second write
	// path — and defers to `writesInFlight` like the other write entry points,
	// since a save still in flight owns the level's queue slot.
	function handleCancel(field: FieldKey) {
		autosaveCtrl.cancel(field);
		if (!writesInFlight && isDirty(field)) onAutosave(field);
	}

	function handleVisibilityChange(field: FieldKey, toLevel: Level) {
		// Fire autosave if dirty BEFORE the move (cross-queue lock will block the move
		// until the save settles).
		autosaveCtrl.visibilityChange(field);
		onmove(field, toLevel);
	}

	$effect(() => {
		void selected;
		loadForSelected().catch((e) => {
			console.error('profile: load failed', e);
			status = 'load-error';
		});
	});
</script>

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<div class="mx-auto flex w-full max-w-md flex-col gap-4">
		<h1 class="font-display text-2xl">{m.profile_title()}</h1>

		<div class="flex flex-col items-start gap-1">
			{#if identityAccount}
				<p data-testid="profile-identity" class="text-sm text-ink-2">
					{#if identityProvider}
						{m.profile_signed_in_as({ account: identityAccount, provider: identityProvider })}
					{:else}
						{identityAccount}
					{/if}
				</p>
			{/if}
			<a class="text-sm text-ink-2 underline" href="/auth/logout">{m.profile_sign_out()}</a>
		</div>

		<!--
			#123 — app chrome, like sign-out above: not gated on `status` /
			collective selection. Language choice must be reachable whether or
			not a collective is selected.
		-->
		<div class="flex flex-col items-start gap-1">
			<span class="text-sm text-ink-2">{m.profile_language_label()}</span>
			<LanguageSelector />
		</div>

		<!--
			#207 rule 5 — the AM/PM preference control: app chrome, like the
			language selector above, not gated on `status` / collective selection.
			localStorage-backed, per-device (Gama ruling 2026-09-02) — the hint
			line states that fact, not a note about the control itself.
		-->
		<div class="flex flex-col items-start gap-1">
			<label for="profile-time-format" class="text-sm text-ink-2">
				{m.profile_time_format_label()}
			</label>
			<select
				id="profile-time-format"
				data-testid="profile-time-format"
				value={$timeFormatStore}
				onchange={(e) =>
					setTimeFormat((e.currentTarget as HTMLSelectElement).value as TimeFormat)}
				class="border border-ink-5 bg-paper px-2 py-1 text-ink"
			>
				<option value="24h">{m.profile_time_format_24h()}</option>
				<option value="ampm">{m.profile_time_format_ampm()}</option>
			</select>
			<p data-testid="profile-time-format-hint" class="text-xs text-ink-3">
				{m.profile_time_format_hint()}
			</p>
		</div>

		<!-- #257 — the repair confirmation announcement. House idiom
			(event-create-status / roster-reorder-status): a PERSISTENT sr-only
			role="status" live region whose text is set imperatively.
			#257 review F1 — it sits ABOVE the `status` gate, exactly like
			roster-reorder-status sits above roster's gate, and for the reason
			roster's comment states: a live region announces only CHANGES to its
			contents, so one mounted alongside its own text is announced by nothing.
			Inside the ready branch it would be DESTROYED and remounted on every
			repair success, because the success path calls loadForSelected(), whose
			machine writes 'loading' synchronously — the region would only ever
			appear with the text already in it. `sr-only` is absolutely positioned,
			so it takes no slot in this flex column, and it renders harmlessly in
			the no-collective / error states (resetState() clears `repairStatus`, so
			nothing stale can sit there). VisibilityRepairBanner itself stays
			untouched — its unmount on success is unchanged; the announcement is the
			PAGE's job. -->
		<div data-testid="profile-repair-status" role="status" aria-live="polite" class="sr-only">
			{repairStatus}
		</div>

		{#if status === 'no-collective'}
			<p data-testid="profile-no-collective" class="text-sm">{m.profile_no_collective()}</p>
		{:else if status === 'loading'}
			<p class="text-sm" aria-busy="true">...</p>
		{:else if status === 'session-expired'}
			<SessionExpiredNotice />
		{:else if status === 'load-error'}
			<div data-testid="profile-load-error" class="flex flex-col gap-2" role="alert">
				<p class="text-sm text-red-700">{m.profile_load_error()}</p>
				<button
					type="button"
					data-testid="profile-retry-load"
					class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
					onclick={() => loadForSelected()}
				>
					{m.profile_load_retry()}
				</button>
			</div>
		{:else}
			<p class="text-sm text-ink-2">{m.profile_intro()}</p>
			{#if domainNameMissing}
				<p
					data-testid="profile-completion-required"
					class="rounded-md bg-amber-100 px-4 py-3 text-sm text-amber-900"
					role="status"
				>
					{m.profile_completion_required()}
				</p>
			{/if}

			{#each repairPlans as plan (plan.field)}
				<VisibilityRepairBanner
					field={plan.field}
					widerLevels={plan.widerLevels}
					severity="loaded"
					working={repairWorking.has(plan.field)}
					failed={repairFailed.has(plan.field)}
					{onrepair}
				/>
			{/each}

			<!-- #257 — the field list's missing title + operating instruction, a real
				sectioning heading matching the Linked Accounts h2 below (the page's
				only other sectioning precedent). profile_intro above stays as the
				page's own introduction; this is the control's own explanation. -->
			<h2 class="text-sm font-semibold">{m.profile_visibility_title()}</h2>
			<p class="text-sm text-ink-2">{m.profile_visibility_intro()}</p>

			<div class="flex flex-col gap-6">
				{#each FIELDS as field (field)}
					<ProfileField
						{field}
						bind:value={draft[field]}
						activeLevel={activeLevelFor(field)}
						transportLevel={transport[field]}
						leakLevels={planFor(field)?.widerLevels ?? []}
						saving={savingFields.has(field)}
						movable={movableFor(field)}
						conflict={isConflict(field)}
						conflictLevels={conflictLevelsFor(field)}
						conflictValues={conflictValuesFor(field)}
						disabled={writesInFlight}
						moveFailed={moveFailed.has(field)}
						saveFailed={failedFields.has(field)}
						onvisibilitychange={handleVisibilityChange}
						onvaluechange={handleValueChange}
						onblur={handleBlur}
						onresolve={handleResolve}
						oncancel={handleCancel}
					/>
				{/each}
			</div>

			<!-- #193 — linked auth providers + "Link another account". Display
				source is the person entity's ACTUAL bound identities
				(listLinkedIdentities), never the localStorage last-provider (which
				only knows how THIS session logged in). -->
			<section
				data-testid="profile-linked-accounts"
				class="flex flex-col gap-2 border-t border-ink/10 pt-4"
			>
				<h2 class="text-sm font-semibold">
					{m.profile_linked_accounts_title({ collective: linkScopeName })}
				</h2>
				{#if dedupedLinkedIdentities.length > 0}
					<ul class="flex flex-col gap-1">
						{#each dedupedLinkedIdentities as identity (identity._id)}
							<li data-testid={`profile-linked-identity-${identity._id}`} class="text-sm text-ink-2">
								{providerLabel(identity.provider)}{#if identity.email}
									&nbsp;— {identity.email}
								{/if}
							</li>
						{/each}
					</ul>
				{/if}

				<!-- #193 (review F1) — the identity read FAILED: say so, and keep the
					list's absence from reading as "you have no linked accounts". Linking
					stays blocked below, because the no-duplicate rule is derived from
					exactly this list. -->
				{#if linkedLoadFailed}
					<div
						data-testid="profile-linked-load-error"
						role="alert"
						class="flex flex-col items-start gap-2"
					>
						<p class="text-sm text-red-700">
							{m.profile_link_error_step({ step: IDENTITY_READ_STEP })}
						</p>
						<button
							type="button"
							data-testid="profile-linked-retry"
							class="rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
							onclick={retryLinkedIdentities}
						>
							{m.profile_load_retry()}
						</button>
					</div>
				{/if}

				{#if !linkPickerOpen}
					<button
						type="button"
						data-testid="profile-link-another"
						bind:this={linkAnotherEl}
						class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink"
						disabled={linkedLoadFailed}
						onclick={openLinkPicker}
					>
						{m.profile_link_another()}
					</button>
				{:else}
					<p class="text-sm text-ink-2">{m.profile_link_choose_provider()}</p>
					<div class="flex flex-col gap-2" bind:this={linkPickerEl}>
						{#each AUTH_PROVIDERS as provider (provider.id)}
							<button
								type="button"
								data-testid={`profile-link-provider-${provider.id}`}
								class="rounded-md border border-ink px-4 py-2 text-left text-sm hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink"
								disabled={linkBusy || linkedLoadFailed}
								aria-busy={linkBusy}
								onclick={() => handleLinkProvider(provider.id)}
							>
								{provider.label()}
							</button>
						{/each}
						<button
							type="button"
							data-testid="profile-link-cancel"
							class="self-start rounded-md border border-ink/40 px-4 py-2 text-sm hover:bg-ink hover:text-paper"
							onclick={closeLinkPicker}
						>
							{m.profile_link_cancel()}
						</button>
					</div>
				{/if}

				{#if shownLinkError}
					<p data-testid="profile-link-error" role="alert" class="text-sm text-red-700">
						{shownLinkError}
					</p>
				{:else if linkSucceeded}
					<p data-testid="profile-link-success" role="status" class="text-sm text-ink-2">
						{m.profile_link_success({ collective: linkScopeName })}
					</p>
				{:else if linkNoop}
					<p data-testid="profile-link-noop" role="status" class="text-sm text-ink-2">
						{linkNoop}
					</p>
				{/if}
			</section>
		{/if}
	</div>
</main>
