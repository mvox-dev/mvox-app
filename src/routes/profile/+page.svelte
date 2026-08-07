<script lang="ts">
	// T4.6/#26 — the member's own profile-edit surface. Protected automatically
	// (not on the guard allowlist; see +layout.ts / guard.ts — same as /admin/invite).
	//
	// Three visibility LEVELS (public / domain / private), each backed by its own
	// `profile` entity whose `_sharing` is the sole visibility gate (T4.3 §1). A level
	// is created LAZILY on her first save into it (AC1) — a level she never saves has
	// no entity. Every create funnels through createProfile via createOwnProfile
	// (T4.4 sole-create-path); the honest round trip (AC2) lives in the queue: a level
	// flips to "saved" ONLY after the server confirms the write's id, never on dispatch.
	import { m } from '$lib/paraglide/messages.js';
	import { getToken, getUser } from '$lib/auth/storage';
	import { selectedCollectiveStore } from '$lib/collectives/store';
	import {
		listMyProfiles,
		profilesByLevel,
		resolveField,
		type Level,
		type MyProfile
	} from '$lib/profile/profileData';
	import { completionGateStore, resolveGate } from '$lib/profile/completionGate';
	import { planLoadedDuplicateRepairs, FieldMoveError, type FieldKey } from '$lib/profile/fieldMove';
	import { createFieldMoveQueue } from '$lib/profile/fieldMoveQueue';
	import { createProfileEditQueue } from '$lib/profile/profileEditQueue';
	import ProfileLevelCard from '$lib/components/profile/ProfileLevelCard.svelte';
	import VisibilityFieldRow from '$lib/components/profile/VisibilityFieldRow.svelte';
	import VisibilityRepairBanner from '$lib/components/profile/VisibilityRepairBanner.svelte';

	const FIELDS: readonly FieldKey[] = ['name', 'email'];
	const otherField = (f: FieldKey): FieldKey => (f === 'name' ? 'email' : 'name');

	const LEVELS: readonly Level[] = ['public', 'domain', 'private'];

	const selected = $derived($selectedCollectiveStore);

	type Status = 'loading' | 'no-collective' | 'load-error' | 'ready';

	// `generation` is bumped on every (re)load; the write-settle handlers no-op their
	// UI callbacks if it changed since dispatch — so a collective switch mid-save can
	// never bleed one collective's write onto another's display (the YELLOW-RSVP.1
	// residual RSVP left unfixed on its write path). It is a NON-reactive guard token
	// (never rendered): a plain let, not $state — mutating it must not re-trigger the
	// load $effect.
	let generation = 0;
	let status = $state<Status>('loading');
	let loadError = $state('');

	// `draft` is bound to the inputs (what she is typing). `confirmed` is the last
	// SERVER-confirmed value per level (id + fields); its `id` is null until a level's
	// first save is confirmed. "Saved" is confirmed === draft. Keeping them separate is
	// how AC2 holds by construction — there is no premature optimistic field mutation.
	function emptyDraft(): Record<Level, { name: string; email: string }> {
		return {
			public: { name: '', email: '' },
			domain: { name: '', email: '' },
			private: { name: '', email: '' }
		};
	}
	function emptyConfirmed(): Record<Level, { id: string | null; name: string; email: string }> {
		return {
			public: { id: null, name: '', email: '' },
			domain: { id: null, name: '', email: '' },
			private: { id: null, name: '', email: '' }
		};
	}
	let draft = $state(emptyDraft());
	let confirmed = $state(emptyConfirmed());

	// Per-level UI markers — reassigned (never mutated) per Svelte 5 runes.
	let pendingLevels = $state(new Set<Level>());
	let failedLevels = $state(new Set<Level>());
	let savedLevels = $state(new Set<Level>());

	// ── T4.7/#27 — visibility MOVES. `loadedProfiles` is the raw read the narrower-wins
	// resolver + duplicate detector run over. `transport` holds the icon mid-move per field.
	// `moveFailed`/`repairWorking`/`repairFailed` are fail-loud surfacing markers. `busy` is
	// the single-flight mirror that disables new moves while one is in flight (the queue's
	// own single-flight is authoritative; this is just the visual gate).
	let loadedProfiles = $state<MyProfile[]>([]);
	let transport = $state<Record<FieldKey, Level | null>>({ name: null, email: null });
	let moveFailed = $state(new Set<FieldKey>());
	let repairWorking = $state(new Set<FieldKey>());
	let repairFailed = $state(new Set<FieldKey>());
	let busy = $state(false);
	// The in-flight move's target level per field — captured on dispatch so a create-phase
	// failure (whose callback carries only `field` + `err`) can record the minted shell at
	// the right level for an idempotent retry. Non-rendered → a plain (non-$state) let.
	let pendingMoveTo: Record<FieldKey, Level | null> = { name: null, email: null };

	// T4.8/#28 — the completion banner makes the redirect-to-/profile honest (not a
	// silent bounce): one i18n key tells her why she is here. Consumes the SSOT
	// `completionGateStore` (the module's declared current-user surface) rather than the
	// raw `loadedProfiles` read, so it stays truthful ACROSS a save: an ordinary domain
	// value-save reconciles the store (release refresh below) but never re-reads
	// loadedProfiles, so a loadedProfiles-derived banner would keep telling her to add a
	// name she just added. NEVER a person.* fallback — the non-display IS the mechanism.
	const domainNameMissing = $derived($completionGateStore === 'incomplete');

	const nameRes = $derived(resolveField(loadedProfiles, 'name'));
	const emailRes = $derived(resolveField(loadedProfiles, 'email'));
	const resFor = (f: FieldKey) => (f === 'name' ? nameRes : emailRes);
	const repairPlans = $derived(planLoadedDuplicateRepairs(loadedProfiles));
	const planFor = (f: FieldKey) => repairPlans.find((p) => p.field === f);

	// A field is MOVABLE only when exactly one entity holds it. 0 holders → nothing to
	// move (set it via the level card); ≥2 holders → a duplicate/conflict to reconcile
	// first. The icons go visibly disabled otherwise — never enabled-but-inert (the
	// standing "no silent no-op click" rule).
	const movableFor = (f: FieldKey) => resFor(f).holders.length === 1;
	// A holders≥2 state with NO repair plan is a DISTINCT-value conflict: the same field
	// carries different values at ≥2 levels (a legitimate T4.6 state, not an unfinished
	// move — so no privacy-repair banner). Surface it on the row (a note + conflict
	// markers) so the wider holder is not silently hidden behind a single active icon.
	const isConflict = (f: FieldKey) => resFor(f).holders.length > 1 && planFor(f) === undefined;
	const conflictLevelsFor = (f: FieldKey): Level[] =>
		isConflict(f) ? resFor(f).holders.slice(1).map((h) => h.level) : [];

	// Cross-queue write lock. A visibility MOVE and a T4.6 value-SAVE both write through
	// the non-atomic whole-pair `saveProfileFields` and can target the SAME entity — an
	// unsynchronized overlap can clobber a move's delete-from-old (resurrecting the moved
	// value) or collide on already-deleted value-ids. The move queue's single-flight only
	// covers move-vs-move; this derived signal serializes moves AGAINST level-saves too:
	// no move starts while any level-save is pending (below), and no level-save starts
	// while a move is in flight (`!busy` gate on each card's canSave).
	const writesInFlight = $derived(busy || pendingLevels.size > 0);

	function withSet(s: Set<FieldKey>, field: FieldKey, add: boolean): Set<FieldKey> {
		const next = new Set(s);
		if (add) next.add(field);
		else next.delete(field);
		return next;
	}

	function resetState() {
		draft = emptyDraft();
		confirmed = emptyConfirmed();
		pendingLevels = new Set();
		failedLevels = new Set();
		savedLevels = new Set();
		loadedProfiles = [];
		transport = { name: null, email: null };
		moveFailed = new Set();
		repairWorking = new Set();
		repairFailed = new Set();
		busy = false;
		pendingMoveTo = { name: null, email: null };
	}

	async function loadForSelected(): Promise<void> {
		const current = selected;
		const g = ++generation;
		resetState();
		// Release any level still marked in-flight in the queue's own `pending` set —
		// the page is NOT remounted on a same-route collective switch, so a stale
		// request from the previous collective would otherwise keep its level's backstop
		// closed and SILENTLY swallow a fresh same-level save. resetState() clears only
		// the page's markers; the queue owns its own set (a stale settle still no-ops
		// its UI via the generation guard).
		queue.reset();
		moveQueue.reset();
		if (!current) {
			status = 'no-collective';
			return;
		}
		const token = getToken();
		if (!token) {
			// Inconsistency on a protected route — fail loud as a load error, never a
			// silent empty form.
			loadError = 'no auth token in storage on a protected route';
			status = 'load-error';
			return;
		}
		status = 'loading';
		const cfg = { db: current.db, token };
		const personId = current.personId;
		try {
			const profiles = await listMyProfiles(cfg, personId);
			if (g !== generation) return; // superseded by a newer selection
			loadedProfiles = profiles;
			const byLevel = profilesByLevel(profiles);
			const nextDraft = emptyDraft();
			const nextConfirmed = emptyConfirmed();
			for (const level of LEVELS) {
				const p = byLevel[level];
				if (p) {
					nextConfirmed[level] = { id: p._id, name: p.name, email: p.email };
					nextDraft[level] = { name: p.name, email: p.email };
				}
			}
			if (nextDraft.domain.name === '' && nextConfirmed.domain.id === null) {
				const providerName = getUser()?.name?.trim();
				if (providerName) {
					nextDraft.domain.name = providerName;
				}
			}
			draft = nextDraft;
			confirmed = nextConfirmed;
			status = 'ready';
		} catch (e) {
			if (g !== generation) return;
			loadError = e instanceof Error ? e.message : String(e);
			status = 'load-error';
		}
	}

	// T4.8/#28 — re-read the SSOT completion gate after ANY confirmed local write that
	// could change domain-name presence. BIDIRECTIONAL by design: not only does a
	// completion OPEN the gate ('complete'), a within-session removal must RE-CLOSE it
	// ('incomplete') — otherwise a member who clears her domain name (empty-save) or moves
	// it off the domain tier (T4.7) keeps a stale 'complete' and is wrongly shown as a
	// member with no domain name until a full reload re-runs the layout's Effect A (which
	// keys only on auth + selected collective, never on a local mutation). Re-read (never
	// cache past the write) so it reflects the server. Generation is irrelevant here: this
	// only fires from callbacks that are themselves generation-guarded (reconcile /
	// onMoveConfirmed no-op on a collective switch).
	function refreshCompletionGate(): void {
		const current = selected;
		const token = getToken();
		if (current && token) {
			resolveGate({ db: current.db, token }, current.personId).then((state) =>
				completionGateStore.set(state)
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
				// A fresh attempt clears the previous attempt's stale failed/saved markers.
				if (isPending) {
					if (failedLevels.has(level)) {
						const f = new Set(failedLevels);
						f.delete(level);
						failedLevels = f;
					}
					if (savedLevels.has(level)) {
						const s = new Set(savedLevels);
						s.delete(level);
						savedLevels = s;
					}
				}
			},
			reconcile(level, profileId, fields) {
				// SUCCESS: the server-confirmed id + fields become the confirmed value.
				confirmed = { ...confirmed, [level]: { id: profileId, name: fields.name, email: fields.email } };
				const s = new Set(savedLevels);
				s.add(level);
				savedLevels = s;
				// T4.8/#28 — re-resolve the completion gate on ANY server-confirmed domain
				// save (reconcile fires only after the write id is confirmed — an honest
				// round trip). NOT guarded on a non-empty name: a domain save that CLEARS
				// the name (empty-save on an existing entity — canSave permits it) must
				// re-CLOSE the gate to 'incomplete', not leave a stale 'complete'. The
				// bidirectional re-read lives in refreshCompletionGate. A collective switch
				// mid-save can't misfire it: reconcile itself is generation-guarded.
				if (level === 'domain') {
					refreshCompletionGate();
				}
			},
			recordCreatedId(level, profileId) {
				// PARTIAL: the shell was created but the fields were NOT confirmed. Record
				// the id (so a retry UPDATES the shell, no duplicate) but leave the fields
				// unconfirmed — markFailed will surface the error and keep her draft.
				confirmed = { ...confirmed, [level]: { ...confirmed[level], id: profileId } };
			},
			markFailed(level) {
				const f = new Set(failedLevels);
				f.add(level);
				failedLevels = f;
			}
		},
		() => generation
	);

	// ── T4.7/#27 — the honest visibility-move orchestrator. Callbacks flip transport /
	// markers only on SERVER-confirmed settles; after a completed move OR repair we
	// re-load (a truthful round trip) so the resolver + duplicate detector re-derive from
	// the real server state. A delete-phase move failure re-loads too: the value is now
	// live in BOTH entities, and the reload lets `planLoadedDuplicateRepairs` surface it
	// as the active privacy-repair banner (AC3). A create-phase failure created no
	// duplicate, so it only marks the row error.
	const moveQueue = createFieldMoveQueue(
		{
			setTransport(field, level, on) {
				transport = { ...transport, [field]: on ? level : null };
			},
			onCreateConfirmed() {
				// The value is now in the new entity (server-confirmed); the src spinner is
				// turned on by setTransport. The visible narrower-wins render settles on the
				// final re-load after the delete confirms — no premature optimistic mutation.
			},
			onMoveConfirmed(field) {
				busy = false;
				moveFailed = withSet(moveFailed, field, false);
				void loadForSelected();
				// T4.8/#28 — a NAME move on/off the domain tier changes domain-name presence
				// (domain→wider re-closes the gate; wider→domain opens it). Re-resolve the
				// SSOT gate so a within-session move can't strand a stale 'complete'. Only a
				// name move can affect it; an email move re-reads harmlessly but is skipped.
				if (field === 'name') refreshCompletionGate();
			},
			onMoveFailed(field, err) {
				busy = false;
				if (err instanceof FieldMoveError && err.phase === 'delete') {
					// Create landed, delete didn't → a live duplicate. Re-load to surface the
					// privacy-repair banner (AC3) rather than a passive per-row error.
					void loadForSelected();
				} else {
					// Create-phase failure: value still only in the source, no duplicate. If a
					// shell was minted before its field-write failed, `createdTargetId` carries
					// it — RECORD that shell in loadedProfiles (at the move's target level) so a
					// retry finds it (dstId set → the add-branch UPDATES it) instead of minting a
					// SECOND empty shell. Mirrors T4.6's recordCreatedId. The shell holds no
					// value, so the resolver/duplicate-detector ignore it.
					if (err instanceof FieldMoveError && err.createdTargetId) {
						const id = err.createdTargetId;
						const toLevel = pendingMoveTo[field];
						if (toLevel && !loadedProfiles.some((p) => p._id === id)) {
							loadedProfiles = [...loadedProfiles, { _id: id, name: '', email: '', _sharing: toLevel }];
						}
					}
					moveFailed = withSet(moveFailed, field, true);
				}
			},
			onRepairConfirmed(field) {
				busy = false;
				repairWorking = withSet(repairWorking, field, false);
				repairFailed = withSet(repairFailed, field, false);
				void loadForSelected();
			},
			onRepairFailed(field) {
				busy = false;
				repairWorking = withSet(repairWorking, field, false);
				repairFailed = withSet(repairFailed, field, true); // preserve-on-error: banner KEPT
			}
		},
		() => generation
	);

	/** Resolve the live cfg/personId, or fail loud into `status` exactly as onsave does. */
	function activeContext(): { cfg: { db: string; token: string }; personId: string } | null {
		const current = selected;
		if (!current) {
			status = 'no-collective';
			return null;
		}
		const token = getToken();
		if (!token) {
			loadError = 'no auth token in storage on a protected route';
			status = 'load-error';
			return null;
		}
		return { cfg: { db: current.db, token }, personId: current.personId };
	}

	function onmove(field: FieldKey, toLevel: Level) {
		// Refuse while ANY profile-entity write is in flight — a move must not overlap a
		// concurrent level-save on a shared entity (cross-queue lock). The row's icons are
		// also disabled in this window, so this is a backstop, not the sole guard.
		if (writesInFlight) return;
		const res = resFor(field);
		// A move needs exactly one current holder. Unset (0) → nothing to move; duplicated
		// (>1) → the repair banner / conflict note is the action, not a move (the row's
		// icons are disabled in that state — this guard is the backstop).
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
		moveFailed = withSet(moveFailed, field, false);
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
		// Same cross-queue lock as onmove — a repair (delete-from-old) must not overlap a
		// concurrent level-save on a shared entity.
		if (writesInFlight) return;
		const plan = planFor(field);
		if (!plan) return;
		const ctx = activeContext();
		if (!ctx) return;
		repairFailed = withSet(repairFailed, field, false);
		repairWorking = withSet(repairWorking, field, true);
		busy = true;
		moveQueue.repair({ cfg: ctx.cfg, field, clear: plan.clear });
	}

	function isDirty(level: Level): boolean {
		return draft[level].name !== confirmed[level].name || draft[level].email !== confirmed[level].email;
	}

	function canSave(level: Level): boolean {
		if (pendingLevels.has(level)) return false;
		if (!isDirty(level)) return false;
		// Allow clearing fields on an EXISTING entity (id set); block creating an empty
		// shell (id null with both fields blank).
		if (confirmed[level].id !== null) return true;
		return draft[level].name.trim() !== '' || draft[level].email.trim() !== '';
	}

	function onsave(level: Level) {
		const current = selected;
		if (!current) {
			// The same inconsistency the load path recognizes — fail loud, never a
			// silent no-op click (standing FAIL-LOUD rule; the #15 silent-stuck hazard).
			status = 'no-collective';
			return;
		}
		const token = getToken();
		if (!token) {
			// Token cleared mid-session (another-tab logout / expiry) on a protected
			// route. Surface it exactly as the load path does — bounce her to reload/
			// re-auth — rather than swallowing the save with no signal.
			loadError = 'no auth token in storage on a protected route';
			status = 'load-error';
			return;
		}
		const cfg = { db: current.db, token };
		queue.request({
			cfg,
			personId: current.personId,
			level,
			existingId: confirmed[level].id,
			fields: { name: draft[level].name, email: draft[level].email }
		});
	}

	$effect(() => {
		// Depend on `selected`; run the async load out-of-band so a rejection can never
		// escape as an unhandled rejection from the effect (loadForSelected already
		// fails loud into `status`, but its synchronous prologue must not throw here).
		void selected;
		loadForSelected().catch((e) => {
			loadError = e instanceof Error ? e.message : String(e);
			status = 'load-error';
		});
	});
</script>

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<div class="mx-auto flex w-full max-w-md flex-col gap-4">
		<h1 class="font-display text-2xl">{m.profile_title()}</h1>

		{#if status === 'no-collective'}
			<p data-testid="profile-no-collective" class="text-sm">{m.profile_no_collective()}</p>
		{:else if status === 'loading'}
			<p class="text-sm" aria-busy="true">…</p>
		{:else if status === 'load-error'}
			<div data-testid="profile-load-error" class="flex flex-col gap-2" role="alert">
				<p class="text-sm text-red-700">{m.profile_load_error({ message: loadError })}</p>
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
			<div class="flex flex-col gap-4">
				{#each LEVELS as level (level)}
					<ProfileLevelCard
						{level}
						bind:name={draft[level].name}
						bind:email={draft[level].email}
						pending={pendingLevels.has(level)}
						saveFailed={failedLevels.has(level)}
						saved={savedLevels.has(level) && !isDirty(level)}
						canSave={canSave(level) && !busy}
						onsave={() => onsave(level)}
					/>
				{/each}
			</div>

			<!-- T4.7/#27 — visibility control: per-field icons + the ACTIVE interrupted-move
			     privacy-repair banner (never a passive two-lit-icons state). -->
			<section class="flex flex-col gap-3" aria-label={m.profile_visibility_title()}>
				<div class="flex flex-col gap-1">
					<h2 class="font-display text-lg">{m.profile_visibility_title()}</h2>
					<p class="text-xs text-ink-2">{m.profile_visibility_intro()}</p>
				</div>

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

				{#each FIELDS as field (field)}
					<VisibilityFieldRow
						{field}
						value={resFor(field).value}
						currentLevel={resFor(field).holders[0]?.level ?? null}
						transportLevel={transport[field]}
						leakLevels={planFor(field)?.widerLevels ?? []}
						movable={movableFor(field)}
						conflict={isConflict(field)}
						conflictLevels={conflictLevelsFor(field)}
						disabled={writesInFlight}
						moveFailed={moveFailed.has(field)}
						{onmove}
					/>
				{/each}
			</section>
		{/if}
	</div>
</main>
