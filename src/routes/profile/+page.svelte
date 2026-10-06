<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { getToken, getUser } from '$lib/auth/storage';
	import { cfgFor } from '$lib/entu/cfg';
	import { selectedCollectiveStore } from '$lib/collectives/store';
	import {
		listMyProfiles,
		profilesByLevel,
		resolveField,
		type Level
	} from '$lib/profile/profileData';
	import { beginGateRead, completionGateStore, resolveGate } from '$lib/profile/completionGate';
	import { planLoadedDuplicateRepairs, type FieldKey } from '$lib/profile/fieldMove';
	import {
		FIELDS,
		createProfileFieldOps,
		createProfileFieldState,
		emptyConfirmed
	} from '$lib/profile/profileFieldOps';
	import ProfileField from '$lib/profile/ProfileField.svelte';
	import VisibilityRepairBanner from '$lib/profile/VisibilityRepairBanner.svelte';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import { createRouteLoadMachine, type RouteLoadStatus } from '$lib/loading/routeLoad';
	// The write gate. The main write has no button (a 2-second idle autosave), so the gate
	// sits in `onAutosave` and `handleValueChange` as well as on the controls.
	import { writesAvailable } from '$lib/net/online';
	import { mintSelfLinkInvite, SelfLinkMintError } from '$lib/invite/inviteData';
	import { listAllEditions } from '$lib/library/libraryData';
	import { updateRosterShowRealNames } from '$lib/collective/rosterNames';
	import ProfileChrome from '$lib/profile/ProfileChrome.svelte';
	import RosterNamesToggle from '$lib/profile/RosterNamesToggle.svelte';
	import LinkedAccountsSection from '$lib/profile/LinkedAccountsSection.svelte';
	import ProfileStorageSection from '$lib/profile/ProfileStorageSection.svelte';

	const LEVELS: readonly Level[] = ['public', 'domain', 'private'];

	const selected = $derived($selectedCollectiveStore);

	let status = $state<RouteLoadStatus>('loading');

	const pf = $state(createProfileFieldState());

	// The sections own their state; resetState() and the load body reach them here.
	let rosterNames = $state<RosterNamesToggle>();
	let linkedAccounts = $state<LinkedAccountsSection>();
	let storageSection = $state<ProfileStorageSection>();

	const domainNameMissing = $derived($completionGateStore === 'incomplete');

	const nameRes = $derived(resolveField(pf.loadedProfiles, 'name'));
	const emailRes = $derived(resolveField(pf.loadedProfiles, 'email'));
	const resFor = (f: FieldKey) => (f === 'name' ? nameRes : emailRes);
	const repairPlans = $derived(planLoadedDuplicateRepairs(pf.loadedProfiles));
	const planFor = (f: FieldKey) => repairPlans.find((p) => p.field === f);

	// Movable only with exactly one holder: with none there is no value to move, and the
	// picker would render buttons that swallow the click. More than one is a conflict.
	const movableFor = (f: FieldKey) => resFor(f).holders.length === 1;
	const isConflict = (f: FieldKey) => resFor(f).holders.length > 1 && planFor(f) === undefined;
	const conflictLevelsFor = (f: FieldKey): Level[] =>
		isConflict(f) ? resFor(f).holders.slice(1).map((h) => h.level) : [];
	/** #131 — each level's own value, so ProfileField can preview a conflicting tier. */
	const conflictValuesFor = (f: FieldKey): Record<Level, string> => ({
		public: pf.confirmed.public[f],
		domain: pf.confirmed.domain[f],
		private: pf.confirmed.private[f]
	});

	/** The level currently holding this field (narrowest non-empty, or 'domain' default). */
	const activeLevelFor = (f: FieldKey): Level =>
		resFor(f).holders[0]?.level ?? 'domain';

	const writesInFlight = $derived(pf.busy || pf.pendingLevels.size > 0);
	const isOffline = $derived(!$writesAvailable);

	function resetState() {
		Object.assign(pf, createProfileFieldState());
		linkedAccounts?.reset();
		rosterNames?.reset();
		storageSection?.reset();
		ops.reset();
	}

	// #232 — the machine never writes 'ready'; `load` does, before the linked-accounts read.
	const routeLoad = createRouteLoadMachine({
		name: 'profile',
		selected: () => selected,
		setStatus: (s) => {
			status = s;
		},
		reset: resetState,
		async load({ cfg, selected: current, g, isCurrent }) {
			const personId = current.personId;
			// Fired apart from the fields read: the roster-names control is app chrome and
			// must load even when listMyProfiles rejects.
			void rosterNames?.load(cfg, g);
			const profiles = await listMyProfiles(cfg, personId);
			if (!isCurrent()) return;
			pf.loadedProfiles = profiles;
			const byLevel = profilesByLevel(profiles);
			const nextConfirmed = emptyConfirmed();
			for (const level of LEVELS) {
				const p = byLevel[level];
				if (p) {
					nextConfirmed[level] = { id: p._id, name: p.name, email: p.email };
				}
			}
			pf.confirmed = nextConfirmed;

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

			pf.draft = nextDraft;
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
			// #800 — leaving the page does not drop it; a newer gate read does.
			const g = routeLoad.generation;
			const isCurrent = beginGateRead();
			const stale = () => g !== routeLoad.generation || !isCurrent();
			resolveGate({ db: current.db, token }, current.personId).then(
				(state) => {
					if (stale()) return;
					completionGateStore.set(state);
				},
				(err) => {
					// A stale rejection stays silent; a live one is a real failure and is logged.
					if (stale()) return;
					console.error('profile: completion gate refresh failed', err);
				}
			);
		}
	}

	const ops = createProfileFieldOps(pf, {
		isOffline: () => isOffline,
		writesInFlight: () => writesInFlight,
		resFor,
		planFor,
		activeLevelFor,
		activeContext,
		generation: () => routeLoad.generation,
		loadForSelected,
		refreshCompletionGate
	});

	function activeContext(): { cfg: { db: string; token: string }; personId: string } | null {
		const current = selected;
		if (!current) {
			status = 'no-collective';
			return null;
		}
		return { cfg: cfgFor(current.db), personId: current.personId };
	}

	function linkErrorMessage(e: unknown): string {
		if (e instanceof SelfLinkMintError) {
			if (e.reason === 'missing-self-editor') return m.profile_link_error_missing_rights();
			// Every other step stays named: some, like stale-invite-cleanup, no retry can fix.
			return m.profile_link_error_step({ step: e.phase });
		}
		return m.profile_link_error_failed();
	}

	$effect(() => {
		void selected;
		void loadForSelected();
	});
</script>

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<div class="mx-auto flex w-full max-w-md flex-col gap-4">
		<h1 class="font-display text-2xl">{m.profile_title()}</h1>

		<ProfileChrome />

		<RosterNamesToggle
			bind:this={rosterNames}
			{isOffline}
			generation={() => routeLoad.generation}
			{activeContext}
			updateRosterShowRealNames={(...a) => updateRosterShowRealNames(...a)}
		/>

		<!-- #257 — above the `status` gate: a live region announces only changes, and inside
			the ready branch the reload would remount it with its text already in it. -->
		<div data-testid="profile-repair-status" role="status" aria-live="polite" class="sr-only">
			{pf.repairStatus}
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
					working={pf.repairWorking.has(plan.field)}
					failed={pf.repairFailed.has(plan.field)}
					onrepair={ops.onrepair}
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
						bind:value={pf.draft[field]}
						activeLevel={activeLevelFor(field)}
						transportLevel={pf.transport[field]}
						leakLevels={planFor(field)?.widerLevels ?? []}
						saving={pf.savingFields.has(field)}
						movable={movableFor(field)}
						conflict={isConflict(field)}
						conflictLevels={conflictLevelsFor(field)}
						conflictValues={conflictValuesFor(field)}
						disabled={writesInFlight || isOffline}
						offline={isOffline}
						moveFailed={pf.moveFailed.has(field)}
						saveFailed={pf.failedFields.has(field)}
						onvisibilitychange={ops.handleVisibilityChange}
						onvaluechange={ops.handleValueChange}
						onblur={ops.handleBlur}
						onresolve={ops.handleResolve}
						oncancel={ops.handleCancel}
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
