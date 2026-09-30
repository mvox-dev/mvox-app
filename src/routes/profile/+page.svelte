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
	import ProfileField from '$lib/profile/ProfileField.svelte';
	import RedactedText from '$lib/components/RedactedText.svelte';
	import VisibilityRepairBanner from '$lib/profile/VisibilityRepairBanner.svelte';
	import LanguageSelector from '$lib/components/LanguageSelector.svelte';
	import { timeFormatStore, setTimeFormat, type TimeFormat } from '$lib/preferences/timeFormat';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import { createRouteLoadMachine, type RouteLoadStatus } from '$lib/loading/routeLoad';
	// The write gate. The main write has no button (a 2-second idle autosave), so the gate
	// sits in `onAutosave` and `handleValueChange` as well as on the controls.
	import { writesAvailable } from '$lib/net/online';
	import { mintSelfLinkInvite, SelfLinkMintError } from '$lib/invite/inviteData';
	import { providerLabel } from '$lib/auth/providers';
	import { listAllEditions } from '$lib/library/libraryData';
	import RosterNamesToggle from '$lib/profile/RosterNamesToggle.svelte';
	import LinkedAccountsSection from '$lib/profile/LinkedAccountsSection.svelte';
	import ProfileStorageSection from '$lib/profile/ProfileStorageSection.svelte';
	// #408 — a pure subscriber: the root layout starts the `beforeinstallprompt` adapter,
	// because Chromium fires that event once per page load, before this page mounts.
	import { installAffordance, promptInstall } from '$lib/install/installState';
	import { withItem } from '$lib/collections/immutable';

	// #60 — which account and provider the user is signed in with; display only.
	const identityUser = getUser();
	const identityAccount = identityUser?.email || identityUser?.name || '';
	const identityProvider = providerLabel(getLastProvider());

	const FIELDS: readonly FieldKey[] = ['name', 'email'];
	const otherField = (f: FieldKey): FieldKey => (f === 'name' ? 'email' : 'name');

	const LEVELS: readonly Level[] = ['public', 'domain', 'private'];

	const selected = $derived($selectedCollectiveStore);

	let status = $state<RouteLoadStatus>('loading');

	// #408 — the iOS Share-menu hint stays hidden until the button is pressed.
	let installIosHintShown = $state(false);

	function onInstallButtonClick(): void {
		if ($installAffordance === 'prompt') {
			// prompt() can reject once the banner was consumed; promptInstall has already
			// collapsed the affordance by then, so the button leaves rather than going inert.
			promptInstall().catch((err) => {
				console.error('profile: install prompt failed', err);
			});
		} else if ($installAffordance === 'ios-hint') {
			installIosHintShown = true;
		}
	}

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

	// Per-field save-in-flight markers for autosave feedback.
	let savingFields = $state(new Set<FieldKey>());
	let failedFields = $state(new Set<FieldKey>());

	let pendingLevels = $state(new Set<Level>());

	let loadedProfiles = $state<MyProfile[]>([]);
	let transport = $state<Record<FieldKey, Level | null>>({ name: null, email: null });
	let moveFailed = $state(new Set<FieldKey>());
	let repairWorking = $state(new Set<FieldKey>());
	let repairFailed = $state(new Set<FieldKey>());
	// #257 — set on repair success, cleared at the start of the next attempt, never a timer.
	let repairStatus = $state('');
	let busy = $state(false);
	let pendingMoveTo: Record<FieldKey, Level | null> = { name: null, email: null };

	// The sections own their state; resetState() and the load body reach them here.
	let rosterNames = $state<RosterNamesToggle>();
	let linkedAccounts = $state<LinkedAccountsSection>();
	let storageSection = $state<ProfileStorageSection>();

	const domainNameMissing = $derived($completionGateStore === 'incomplete');

	const nameRes = $derived(resolveField(loadedProfiles, 'name'));
	const emailRes = $derived(resolveField(loadedProfiles, 'email'));
	const resFor = (f: FieldKey) => (f === 'name' ? nameRes : emailRes);
	const repairPlans = $derived(planLoadedDuplicateRepairs(loadedProfiles));
	const planFor = (f: FieldKey) => repairPlans.find((p) => p.field === f);

	// Movable only with exactly one holder: with none there is no value to move, and the
	// picker would render buttons that swallow the click. More than one is a conflict.
	const movableFor = (f: FieldKey) => resFor(f).holders.length === 1;
	const isConflict = (f: FieldKey) => resFor(f).holders.length > 1 && planFor(f) === undefined;
	const conflictLevelsFor = (f: FieldKey): Level[] =>
		isConflict(f) ? resFor(f).holders.slice(1).map((h) => h.level) : [];
	/** #131 — each level's own value, so ProfileField can preview a conflicting tier. */
	const conflictValuesFor = (f: FieldKey): Record<Level, string> => ({
		public: confirmed.public[f],
		domain: confirmed.domain[f],
		private: confirmed.private[f]
	});

	/** The level currently holding this field (narrowest non-empty, or 'domain' default). */
	const activeLevelFor = (f: FieldKey): Level =>
		resFor(f).holders[0]?.level ?? 'domain';

	const writesInFlight = $derived(busy || pendingLevels.size > 0);
	const isOffline = $derived(!$writesAvailable);

	function isDirty(field: FieldKey): boolean {
		const level = activeLevelFor(field);
		return draft[field] !== confirmed[level][field];
	}

	function withFieldSet(s: Set<FieldKey>, field: FieldKey, add: boolean): Set<FieldKey> {
		return withItem(s, field, add);
	}

	// #160 — the tier picker reads holders off `loadedProfiles`, not `confirmed`, so every
	// settle mirrors onto it what a reload's `profilesByLevel` would produce.
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
		linkedAccounts?.reset();
		rosterNames?.reset();
		storageSection?.reset();
		autosaveCtrl.destroy();
	}

	// #232 — the machine never writes 'ready'; `load` does, before the linked-accounts read.
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
			// Fired apart from the fields read: the roster-names control is app chrome and
			// must load even when listMyProfiles rejects.
			void rosterNames?.load(cfg, g);
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

			// Both sections handle their own failures, so neither takes the fields down.
			void storageSection?.load(cfg, { db: cfg.db, personId }, g);
			await linkedAccounts?.load(cfg, personId, g);
		}
	});

	function loadForSelected(): Promise<void> {
		return routeLoad.loadForSelected();
	}

	function refreshCompletionGate(): void {
		const current = selected;
		const token = getToken();
		if (current && token) {
			// #260 — a settle for a collective the user has left must not overwrite the gate.
			const g = routeLoad.generation;
			resolveGate({ db: current.db, token }, current.personId).then(
				(state) => {
					if (g !== routeLoad.generation) return;
					completionGateStore.set(state);
				},
				(err) => {
					// A stale rejection stays silent; a live one is a real failure and is logged.
					if (g !== routeLoad.generation) return;
					console.error('profile: completion gate refresh failed', err);
				}
			);
		}
	}

	const queue = createProfileEditQueue(
		{
			setPending(level, isPending) {
				pendingLevels = withItem(pendingLevels, level, isPending);
			},
			reconcile(level, profileId, fields) {
				// Read before the mirror below: a save that clears a field drops its only holder,
				// and reading after would leave its `savingFields` marker set forever.
				const affected = FIELDS.filter((f) => activeLevelFor(f) === level);
				confirmed = { ...confirmed, [level]: { id: profileId, name: fields.name, email: fields.email } };
				upsertLoadedProfile(level, profileId, fields.name, fields.email);
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
				// #160 — an empty shell is no holder, but mirroring it lets a later move into
				// this tier reuse it instead of creating a second entity at the same level.
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
				// #257 — after the reload, whose reset would wipe it, and only if no switch
				// happened meanwhile: the reload resolves even when superseded.
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

	function linkErrorMessage(e: unknown): string {
		if (e instanceof SelfLinkMintError) {
			if (e.reason === 'missing-self-editor') return m.profile_link_error_missing_rights();
			// Every other step stays named: some, like stale-invite-cleanup, no retry can fix.
			return m.profile_link_error_step({ step: e.phase });
		}
		return m.profile_link_error_failed();
	}

	// The autosave onSave callback — dispatches through the existing queue.
	function onAutosave(field: FieldKey): void {
		// Offline: first, before the throw and the saving flips. The draft is kept as typed.
		if (isOffline) return;
		if (!isDirty(field)) return;
		const activeLevel = activeLevelFor(field);

		// Name-private guard (loud failure, never silent return).
		if (field === 'name' && activeLevel === 'private') {
			throw new Error('name-private guard: name cannot be saved at private level');
		}

		const ctx = activeContext();
		if (!ctx) return;
		// The sibling value comes from the target entity's confirmed value, never the draft.
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
		// Offline: before the name-private throw and before any pending/failed flip.
		if (isOffline) return;
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
		if (isOffline) return;
		if (writesInFlight) return;
		const plan = planFor(field);
		if (!plan) return;
		const ctx = activeContext();
		if (!ctx) return;
		repairFailed = withFieldSet(repairFailed, field, false);
		repairWorking = withFieldSet(repairWorking, field, true);
		// #257 — cleared at the start, so a failed retry shows no stale confirmation.
		repairStatus = '';
		busy = true;
		moveQueue.repair({ cfg: ctx.cfg, field, clear: plan.clear });
	}

	// #131 — a second tap on a previewed conflict tier converges every other holder onto
	// its value, then reloads; repair detection picks up the same-value duplicate.
	function handleResolve(field: FieldKey, level: Level) {
		if (isOffline) return;
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
				// Deferred a tick, so synchronous caller setup lands before the reload reads.
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
		// Offline the keystroke is kept but no timer is armed, and a leftover one is cancelled.
		if (isOffline) {
			autosaveCtrl.cancel(field);
			return;
		}
		autosaveCtrl.keystroke(field);
	}

	function handleBlur(field: FieldKey) {
		autosaveCtrl.blur(field);
	}

	// #205 — Escape kills the pending timer. If a mid-edit autosave already landed, the
	// reverted draft is now dirty against it, so the pre-edit value is written back.
	function handleCancel(field: FieldKey) {
		autosaveCtrl.cancel(field);
		if (!writesInFlight && isDirty(field)) onAutosave(field);
	}

	function handleVisibilityChange(field: FieldKey, toLevel: Level) {
		// Save first; the cross-queue lock holds the move until the save settles.
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
				<!-- #361 — with no email the account is a real name, so the sentence is wrapped
				     whole in the marker. -->
				<p data-testid="profile-identity" class="text-sm text-ink-2">
					<RedactedText
						>{#if identityProvider}{m.profile_signed_in_as({
								account: identityAccount,
								provider: identityProvider
							})}{:else}{identityAccount}{/if}</RedactedText
					>
				</p>
			{/if}
			<a class="text-sm text-ink-2 underline" href="/auth/logout">{m.profile_sign_out()}</a>
		</div>

		<!-- #123, #207, #408 — app chrome, not gated on `status` or collective selection. -->
		<div class="flex flex-col items-start gap-1">
			<span class="text-sm text-ink-2">{m.profile_language_label()}</span>
			<LanguageSelector />
		</div>

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

		{#if $installAffordance !== 'none'}
			<div class="flex flex-col items-start gap-1">
				<button
					type="button"
					data-testid="profile-install-button"
					class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
					onclick={onInstallButtonClick}
				>
					{m.profile_install_button()}
				</button>
				{#if $installAffordance === 'ios-hint' && installIosHintShown}
					<p data-testid="profile-install-ios-hint" class="text-xs text-ink-3">
						{m.profile_install_ios_hint()}
					</p>
				{/if}
			</div>
		{/if}

		<RosterNamesToggle
			bind:this={rosterNames}
			{isOffline}
			generation={() => routeLoad.generation}
			{activeContext}
		/>

		<!-- #257 — above the `status` gate: a live region announces only changes, and inside
			the ready branch the reload would remount it with its text already in it. -->
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

			<!-- #257 — the field list's own heading, matching the Linked Accounts h2 below. -->
			<h2 class="text-sm font-semibold">{m.profile_visibility_title()}</h2>
			<p class="text-sm text-ink-2">{m.profile_visibility_intro()}</p>
			<!-- #434 — the one visible reason for every write on the page, the sections' too;
			     the autosave has no button to disable. A typed draft is kept, not saved. -->
			{#if isOffline}
				<p data-testid="profile-write-unavailable" class="text-sm text-ink-2">
					{m.write_unavailable_no_signal()}
				</p>
			{/if}

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
						disabled={writesInFlight || isOffline}
						offline={isOffline}
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
		{/if}

		<LinkedAccountsSection
			bind:this={linkedAccounts}
			ready={status === 'ready'}
			{isOffline}
			scopeName={selected?.name ?? ''}
			generation={() => routeLoad.generation}
			{activeContext}
			onSessionExpired={() => {
				status = 'session-expired';
			}}
			mintSelfLinkInvite={(...a) => mintSelfLinkInvite(...a)}
			mintErrorMessage={linkErrorMessage}
		/>

		<ProfileStorageSection
			bind:this={storageSection}
			ready={status === 'ready'}
			generation={() => routeLoad.generation}
			{activeContext}
			listAllEditions={(...a) => listAllEditions(...a)}
		/>
	</div>
</main>
