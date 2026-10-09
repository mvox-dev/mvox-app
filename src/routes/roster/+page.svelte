<script lang="ts">
	import { reportProblem } from '$lib/problems/reportProblem';
	import PartialNotice from '$lib/components/PartialNotice.svelte';
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { selectedCollectiveStore } from '$lib/collectives/store';
	import { loadRoster, type RosterRow } from '$lib/roster/rosterData';
	import type { ListRead } from '$lib/entu/listRead';
	import { listJoinStateDetails } from '$lib/profile/linkedIdentities';
	import { resolveOwnerTier } from '$lib/nav/adminStore';
	import { loadActiveAndArchivedRosters } from '$lib/roster/memberLifecycle';
	import { listSections, groupBySection } from '$lib/sections/sectionData';
	import { adminStore } from '$lib/nav/adminStore';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';
	import { isAuthExpiredError } from '$lib/entu/request';
	import { cfgFor } from '$lib/entu/cfg';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import { createRouteLoadMachine, type RouteLoadStatus } from '$lib/loading/routeLoad';
	// The write gate: every write here (member lifecycle, record, invites, section tree)
	// disables together while there is no usable online signal — one sentence saying why.
	import { writesAvailable } from '$lib/net/online';
	import {
		clearInvites,
		clearRosterState,
		createMemberOpsState,
		createRosterState,
		resetMemberOps,
		resetRosterState,
		resetSectionPicks,
		type RosterViewMode
	} from '$lib/roster/rosterPageState';
	import { createRosterActions } from '$lib/roster/rosterActions';
	import { createMemberOps } from '$lib/roster/rosterMemberOps';
	import { bareJoinStates } from '$lib/roster/joinStateView';
	import { groupsBySectionId, rootDbEntityBySectionId, viewModeOptions } from '$lib/roster/rosterView';
	import {
		clearStructuralWrites,
		createArrangeOps,
		createArrangeState,
		resetArrange
	} from '$lib/sections/sectionArrangeOps';
	import { createArrangeDrag } from '$lib/sections/sectionDrag';
	import { flattenSections, listArrangeRows } from '$lib/sections/sectionTree';
	import MemberRow from '$lib/roster/MemberRow.svelte';
	import InactiveList from '$lib/roster/InactiveList.svelte';
	import InactiveToggle from '$lib/roster/InactiveToggle.svelte';
	import ListOfStuff from '$lib/components/ListOfStuff.svelte';
	import RosterViewControls from '$lib/roster/RosterViewControls.svelte';
	import RosterListHeader from '$lib/roster/RosterListHeader.svelte';
	import RosterNotices from '$lib/roster/RosterNotices.svelte';
	import RosterSectionTree from '$lib/roster/RosterSectionTree.svelte';
	import RosterSkeleton from '$lib/roster/RosterSkeleton.svelte';
	import RosterStatusRegions from '$lib/roster/RosterStatusRegions.svelte';
	import SectionArrange from '$lib/sections/SectionArrange.svelte';
	import { toggled } from '$lib/collections/immutable';

	const selected = $derived($selectedCollectiveStore);
	const admin = $derived($adminStore);
	const isOffline = $derived(!$writesAvailable);

	let status = $state<RouteLoadStatus>('loading');

	const roster = $state(createRosterState());
	const memberOps = $state(createMemberOpsState());
	const arrange = $state(createArrangeState());

	const rosterPartial = $derived(roster.membersPartial || roster.inactivePartial);

	let currentCfg: EntuCfg | null = null;

	const routeLoad = createRouteLoadMachine({
		name: 'roster',
		selected: () => selected,
		setStatus: (s) => {
			status = s;
		},
		reset: ({ isSwitch }) => {
			clearStructuralWrites(arrange);
			resetSectionPicks(memberOps);
			untrack(() => {
				void arrangeOps.submitRename({ refocus: false, generation: routeLoad.generation - 1 });
			});
			resetArrange(arrange, { isSwitch });
			resetMemberOps(memberOps, { isSwitch });
			resetRosterState(roster, { isSwitch });
		},
		onNoCollective: () => {
			clearRosterState(roster);
			currentCfg = null;
			clearInvites(memberOps);
		},
		onNoToken: () => {
			currentCfg = null;
		},
		async load({ cfg, selected, isCurrent }) {
			currentCfg = cfg;
			const [rowResult, sectionResult, ownerTierResult] = await Promise.allSettled([
				readRosterHalves(cfg),
				listSections(cfg),
				resolveOwnerTier(cfg, selected.personId)
			]);
			if (!isCurrent()) return;

			if (rowResult.status === 'rejected') {
				if (isAuthExpiredError(rowResult.reason)) {
					status = 'session-expired';
					return;
				}
				reportProblem({ area: 'roster', action: 'load', error: rowResult.reason });
				status = 'load-error';
				return;
			}
			applyRosterHalves(rowResult.value);

			roster.ownerTier = ownerTierResult.status === 'fulfilled' ? ownerTierResult.value : 'error';

			try {
				const details = await listJoinStateDetails(cfg, roster.rows.map((r) => r.personId));
				if (!isCurrent()) return;
				roster.joinStateDetails = details;
				roster.joinStates = bareJoinStates(details);
			} catch (e) {
				if (!isCurrent()) return;
				reportProblem({ area: 'roster', action: 'loading the join states', error: e });
				roster.joinStateDetails = {};
				roster.joinStates = {};
			}

			if (sectionResult.status === 'rejected') {
				if (isAuthExpiredError(sectionResult.reason)) {
					status = 'session-expired';
					return;
				}
				reportProblem({ area: 'roster', action: 'loading the section tree', error: sectionResult.reason });
				roster.sections = [];
				roster.expandedIds = new Set();
				roster.sectionsError = true;
				roster.view = 'flat';
			} else {
				roster.sections = sectionResult.value;
				roster.expandedIds = new Set();
				roster.sectionsError = false;
			}
			status = 'ready';
		}
	});

	function loadForSelected(): Promise<void> {
		return routeLoad.loadForSelected();
	}

	type RosterHalves = {
		active: ListRead<RosterRow>;
		inactive: ListRead<RosterRow> | null;
		archivedFailed: boolean;
	};

	async function readRosterHalves(cfg: EntuCfg): Promise<RosterHalves> {
		const wantArchived = untrack(() => roster.showInactive);
		if (!wantArchived) {
			return { active: await loadRoster(cfg), inactive: null, archivedFailed: false };
		}
		try {
			const both = await loadActiveAndArchivedRosters(cfg);
			return { active: both.active, inactive: both.inactive, archivedFailed: false };
		} catch (e) {
			reportProblem({ area: 'roster', action: 'loading the archived roster', error: e });
			return { active: await loadRoster(cfg), inactive: null, archivedFailed: true };
		}
	}

	function applyRosterHalves(read: RosterHalves): void {
		roster.rows = read.active.items;
		roster.membersPartial = read.active.truncated;
		if (read.inactive) {
			roster.inactiveRows = read.inactive.items;
			roster.inactivePartial = read.inactive.truncated;
			roster.inactiveLoadError = false;
		} else if (read.archivedFailed) {
			roster.inactiveRows = [];
			roster.inactivePartial = false;
			roster.inactiveLoadError = true;
		}
	}

	$effect(() => {
		void selected;
		void loadForSelected();
	});

	const currentDbEntityId = $derived(
		roster.rows.find((r) => r.personId === selected?.personId)?.dbEntityId ??
			roster.rows.find((r) => r.dbEntityId)?.dbEntityId ??
			null
	);

	const visibleSections = $derived(
		currentDbEntityId === null
			? roster.sections
			: roster.sections.filter(
					(n) => n.parentDamaged === true || (n.dbEntityId ?? null) === currentDbEntityId
				)
	);

	const groups = $derived(groupBySection(roster.rows, visibleSections));
	const groupById = $derived(groupsBySectionId(groups));
	const unassignedGroup = $derived(groups.find((g) => g.sectionId === null) ?? null);

	const sectionNameById = $derived(
		new Map(flattenSections(roster.sections).map((n) => [n.id, n.name]))
	);

	const flatRows = $derived([...roster.rows].sort((a, b) => a.name.localeCompare(b.name)));

	const rootDbEntityById = $derived(rootDbEntityBySectionId(roster.sections));

	function isOwnDbEntitySection(id: string): boolean {
		const org = rootDbEntityById.get(id) ?? null;
		if (org === null || currentDbEntityId === null) return true;
		return org === currentDbEntityId;
	}

	function toggleSection(id: string): void {
		roster.expandedIds = toggled(roster.expandedIds, id);
	}

	const allSectionIdsList = $derived([
		...flattenSections(visibleSections).map((n) => n.id),
		...(unassignedGroup ? ['unassigned'] : [])
	]);

	function setViewMode(mode: RosterViewMode): void {
		roster.viewMode = mode;
		if (mode === 'collapsed') roster.expandedIds = new Set();
		else if (mode === 'expanded') roster.expandedIds = new Set(allSectionIdsList);
	}

	const modeOptions = $derived(viewModeOptions(admin === 'admin'));

	const arrangeRows = $derived(
		listArrangeRows(visibleSections, (id) => groupById.get(id)?.memberCount ?? 0)
	);

	const actions = createRosterActions();

	// Writes read the token now, not the one from load, so a cleared session sends nothing (#550).
	const writeCfg = () => (currentCfg ? cfgFor(currentCfg.db) : null);

	const ops = createMemberOps({
		roster,
		mo: memberOps,
		actions,
		cfg: writeCfg,
		generation: () => routeLoad.generation,
		isCurrent: (g) => routeLoad.isCurrent(g),
		isOffline: () => isOffline,
		currentDbEntityId: () => currentDbEntityId,
		loadForSelected,
		sessionExpired: () => {
			status = 'session-expired';
		},
		readRosterHalves,
		applyRosterHalves
	});

	const arrangeOps = createArrangeOps({
		roster,
		arrange,
		actions,
		cfg: writeCfg,
		generation: () => routeLoad.generation,
		isOffline: () => isOffline,
		visibleSections: () => visibleSections,
		currentDbEntityId: () => currentDbEntityId
	});

	const drag = createArrangeDrag({
		roster,
		arrange,
		ops: arrangeOps,
		isAdmin: () => admin === 'admin',
		visibleSections: () => visibleSections,
		arrangeRows: () => arrangeRows
	});
</script>

{#snippet inactiveFilter()}
	<InactiveToggle {roster} {ops} />
{/snippet}
{#snippet viewControls()}
	<RosterViewControls {roster} {modeOptions} onSetViewMode={setViewMode} />
{/snippet}

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<div class="mx-auto flex w-full max-w-md flex-col gap-4">
		<h1 class="font-display text-2xl">{m.roster_title()}</h1>

		{#if admin === 'admin' && isOffline}
			<p data-testid="roster-write-unavailable" class="text-sm text-ink-2">
				{m.write_unavailable_no_signal()}
			</p>
		{/if}

		{#if rosterPartial}
			<PartialNotice testid="roster-partial-notice" text={m.roster_partial_notice()} class="text-sm" />
		{/if}

		<RosterStatusRegions {arrange} {memberOps} {admin} />

		{#if status === 'no-collective'}
			<p data-testid="roster-no-collective" class="text-sm">{m.roster_no_collective()}</p>
		{:else if status === 'loading'}
			<RosterSkeleton />
		{:else if status === 'session-expired'}
			<SessionExpiredNotice />
		{:else if status === 'load-error'}
			<div data-testid="roster-load-error" class="flex flex-col gap-2" role="alert">
				<p class="text-sm text-red-700">{m.roster_load_error()}</p>
				<button
					type="button"
					data-testid="roster-retry-load"
					class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
					onclick={() => loadForSelected()}
				>
					{m.roster_retry()}
				</button>
			</div>
		{:else if roster.rows.length === 0 && roster.sections.length === 0}
			<ListOfStuff filter={admin === 'admin' && status === 'ready' ? inactiveFilter : undefined}>
				<div data-testid="roster-empty" class="flex min-h-[30vh] items-center justify-center">
					<p class="font-display text-xl text-ink-2">{m.roster_empty()}</p>
				</div>
				{#if admin === 'admin' && status === 'ready'}
					<InactiveList {roster} {memberOps} {ops} {isOffline} {sectionNameById} />
				{/if}
			</ListOfStuff>
		{:else}
			<RosterNotices {roster} {arrange} {admin} />
			<ListOfStuff filter={admin === 'admin' && status === 'ready' ? inactiveFilter : undefined} view={viewControls}>
				<RosterListHeader />
				{#if roster.view === 'grouped' && !roster.sectionsError}
					{#if roster.viewMode === 'arrange' && admin === 'admin'}
						<SectionArrange
							{roster}
							{arrange}
							ops={arrangeOps}
							{drag}
							{arrangeRows}
							{visibleSections}
							{admin}
							{isOffline}
							{isOwnDbEntitySection}
						/>
					{:else}
						<RosterSectionTree
							{visibleSections}
							{groupById}
							{unassignedGroup}
							onToggleSection={toggleSection}
							{admin}
							{selected}
							{isOffline}
							{roster}
							{memberOps}
							{ops}
							{sectionNameById}
						/>
					{/if}
				{:else}
					<ul data-testid="roster-flat-list" class="flex flex-col">
						{#each flatRows as row (row.memberId)}
							<MemberRow
								{row}
								showSection={true}
								groupSectionId={null}
								{admin}
								{selected}
								{isOffline}
								{roster}
								{memberOps}
								{ops}
								{sectionNameById}
							/>
						{/each}
					</ul>
				{/if}
				{#if admin === 'admin' && status === 'ready'}
					<InactiveList {roster} {memberOps} {ops} {isOffline} {sectionNameById} />
				{/if}
			</ListOfStuff>
		{/if}
	</div>
</main>
