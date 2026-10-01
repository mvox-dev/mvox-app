<script lang="ts">
	import PartialNotice from '$lib/components/PartialNotice.svelte';
	import RadioChips from '$lib/components/RadioChips.svelte';
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { selectedCollectiveStore } from '$lib/collectives/store';
	import { loadRoster, type RosterRow } from '$lib/roster/rosterData';
	import type { ListRead } from '$lib/entu/listRead';
	import { listJoinStateDetails } from '$lib/profile/linkedIdentities';
	import { mintSelfLinkInvite, withdrawInvite } from '$lib/invite/inviteData';
	import { resolveOwnerTier } from '$lib/nav/adminStore';
	import {
		deactivateMember,
		reinstateMember,
		loadActiveAndArchivedRosters,
		listDeactivateBlockers
	} from '$lib/roster/memberLifecycle';
	import {
		loadMemberRecord,
		createMemberRecord,
		updateMemberRecord,
		MemberRecordPartialSaveError
	} from '$lib/roster/memberRecord';
	import { resolveMyLibraryId } from '$lib/library/librarianStore';
	import { listSections, groupBySection, type SectionNode, type SectionGroup } from '$lib/sections/sectionData';
	import {
		assignMemberSection,
		unassignMemberSection,
		createSection,
		reorderSections,
		deleteSection,
		reparentSection,
		renameSection
	} from '$lib/sections/sectionActions';
	import { adminStore } from '$lib/nav/adminStore';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';
	import { isAuthExpiredError } from '$lib/entu/request';
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
		type RosterActions,
		type RosterViewMode
	} from '$lib/roster/rosterPageState';
	import { createMemberOps } from '$lib/roster/rosterMemberOps';
	import { bareJoinStates } from '$lib/roster/joinStateView';
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
				console.error('roster: load failed', rowResult.reason);
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
				console.error('roster: join-state load failed, showing no join-state badges', e);
				roster.joinStateDetails = {};
				roster.joinStates = {};
			}

			if (sectionResult.status === 'rejected') {
				if (isAuthExpiredError(sectionResult.reason)) {
					status = 'session-expired';
					return;
				}
				console.error('roster: section tree load failed', sectionResult.reason);
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
			console.error('roster: archived half failed, loading the active list alone', e);
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
		loadForSelected().catch((e) => {
			console.error('roster: load failed', e);
			status = 'load-error';
		});
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
	const groupById = $derived.by(() => {
		const map = new Map<string, SectionGroup>();
		for (const g of groups) if (g.sectionId !== null) map.set(g.sectionId, g);
		return map;
	});
	const unassignedGroup = $derived(groups.find((g) => g.sectionId === null) ?? null);

	const sectionNameById = $derived(
		new Map(flattenSections(roster.sections).map((n) => [n.id, n.name]))
	);

	const flatRows = $derived([...roster.rows].sort((a, b) => a.name.localeCompare(b.name)));

	const rootDbEntityBySectionId = $derived.by(() => {
		const map = new Map<string, string | null>();
		function walk(nodes: SectionNode[], rootOrg: string | null): void {
			for (const n of nodes) {
				const org = n.parentId === null ? (n.dbEntityId ?? null) : rootOrg;
				map.set(n.id, org);
				walk(n.children, org);
			}
		}
		walk(roster.sections, null);
		return map;
	});

	function isOwnDbEntitySection(id: string): boolean {
		const org = rootDbEntityBySectionId.get(id) ?? null;
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

	const VIEW_MODE_LABEL: Record<RosterViewMode, () => string> = {
		collapsed: m.roster_view_collapsed,
		expanded: m.roster_view_expanded,
		arrange: m.roster_view_arrange
	};
	const viewModeOptions = $derived(
		(Object.keys(VIEW_MODE_LABEL) as RosterViewMode[])
			.filter((mode) => mode !== 'arrange' || admin === 'admin')
			.map((mode) => ({
				value: mode,
				label: VIEW_MODE_LABEL[mode](),
				testid: `roster-view-chip-${mode}`
			}))
	);

	const arrangeRows = $derived(
		listArrangeRows(visibleSections, (id) => groupById.get(id)?.memberCount ?? 0)
	);

	// Lazy: page specs mock these modules partially, and an eager read of a missing export throws.
	const actions: RosterActions = {
		assignMemberSection: (...a) => assignMemberSection(...a),
		unassignMemberSection: (...a) => unassignMemberSection(...a),
		deactivateMember: (...a) => deactivateMember(...a),
		reinstateMember: (...a) => reinstateMember(...a),
		listDeactivateBlockers: (...a) => listDeactivateBlockers(...a),
		resolveMyLibraryId: (...a) => resolveMyLibraryId(...a),
		mintSelfLinkInvite: (...a) => mintSelfLinkInvite(...a),
		withdrawInvite: (...a) => withdrawInvite(...a),
		listJoinStateDetails: (...a) => listJoinStateDetails(...a),
		loadMemberRecord: (...a) => loadMemberRecord(...a),
		createMemberRecord: (...a) => createMemberRecord(...a),
		updateMemberRecord: (...a) => updateMemberRecord(...a),
		isPartialSaveError: (e): e is MemberRecordPartialSaveError =>
			e instanceof MemberRecordPartialSaveError,
		listSections: (...a) => listSections(...a),
		createSection: (...a) => createSection(...a),
		reorderSections: (...a) => reorderSections(...a),
		deleteSection: (...a) => deleteSection(...a),
		reparentSection: (...a) => reparentSection(...a),
		renameSection: (...a) => renameSection(...a)
	};

	const ops = createMemberOps({
		roster,
		mo: memberOps,
		actions,
		cfg: () => currentCfg,
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
		cfg: () => currentCfg,
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

{#snippet memberRow(row: RosterRow, showSection: boolean, groupSectionId: string | null)}
	<MemberRow
		{row}
		{showSection}
		{groupSectionId}
		{admin}
		{selected}
		{isOffline}
		{roster}
		{memberOps}
		{ops}
		{sectionNameById}
	/>
{/snippet}

{#snippet sectionGroup(node: SectionNode)}
	{@const group = groupById.get(node.id)}
	{@const isExpanded = roster.expandedIds.has(node.id)}
	<section
		data-testid="section-group-{node.id}"
		data-depth={node.depth}
		class="flex flex-col"
		style="margin-left: {node.depth === 0 ? 0 : 1}rem"
	>
		<div class="flex items-center gap-2 py-1.5">
			<button
				type="button"
				data-testid="section-toggle-{node.id}"
				aria-expanded={isExpanded}
				aria-controls={isExpanded ? `section-region-${node.id}` : undefined}
				class="flex items-center gap-2 text-left"
				onclick={() => toggleSection(node.id)}
			>
				<span aria-hidden="true" class="text-ink-2">{isExpanded ? '▾' : '▸'}</span>
				<span data-testid="section-header-{node.id}" class="text-sm font-medium text-ink">
					{node.name} ({group?.memberCount ?? 0})
				</span>
			</button>
		</div>
		{#if node.parentDamaged}
			<p data-testid="section-parent-damaged-{node.id}" role="alert" class="text-sm text-red-700">
				{m.roster_section_parent_damaged({ name: node.name })}
			</p>
		{/if}
		{#if isExpanded}
			<div id="section-region-{node.id}" class="contents">
				<ul class="flex flex-col pl-5">
					{#each group?.members ?? [] as row (row.memberId)}
						{@render memberRow(row, false, node.id)}
					{/each}
				</ul>
				{#each node.children as child (child.id)}
					{@render sectionGroup(child)}
				{/each}
			</div>
		{/if}
	</section>
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

		<div data-testid="roster-reorder-status" role="status" aria-live="polite" class="sr-only">
			{arrange.reorderStatus}
		</div>

		{#if admin === 'admin'}
			<span
				id="section-reorder-instructions"
				data-testid="roster-reorder-instructions"
				class="sr-only"
			>
				{m.roster_section_reorder_instructions()}
			</span>
		{/if}

		<div
			data-testid="roster-section-remove-status"
			role="status"
			aria-live="polite"
			class="sr-only"
		>
			{arrange.removeStatus}
		</div>

		<div
			data-testid="roster-section-create-status"
			role="status"
			aria-live="polite"
			class="sr-only"
		>
			{arrange.pageCreateStatus}
		</div>

		<div
			data-testid="roster-section-rename-status"
			role="status"
			aria-live="polite"
			class="sr-only"
		>
			{arrange.renameStatus}
		</div>

		<div
			data-testid="roster-member-record-status"
			role="status"
			aria-live="polite"
			class="sr-only"
		>
			{memberOps.recordStatus}
		</div>

		{#if status === 'no-collective'}
			<p data-testid="roster-no-collective" class="text-sm">{m.roster_no_collective()}</p>
		{:else if status === 'loading'}
			<div
				data-testid="roster-skeleton"
				class="flex flex-col gap-3"
				aria-hidden="true"
				aria-busy="true"
			>
				{#each [0, 1, 2] as row (row)}
					<div data-testid="roster-skeleton-row" class="flex animate-pulse flex-col gap-1.5 py-2">
						<div class="h-3 w-1/2 rounded bg-ink-5"></div>
						<div class="h-2.5 w-1/3 rounded bg-ink-5"></div>
					</div>
				{/each}
			</div>
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
			<div data-testid="roster-empty" class="flex min-h-[30vh] items-center justify-center">
				<p class="font-display text-xl text-ink-2">{m.roster_empty()}</p>
			</div>
		{:else}
			{#if admin === 'admin' && roster.ownerTier !== 'owner' && roster.ownerTier !== 'loading'}
				<p data-testid="roster-invite-owner-note" class="text-xs text-ink-2">
					{m.roster_member_invite_owner_only()}
				</p>
			{/if}
			{#if roster.sectionsError}
				<div data-testid="roster-sections-load-error" class="flex flex-col gap-1" role="alert">
					<p class="text-sm text-red-700">{m.roster_sections_load_error()}</p>
				</div>
			{/if}
			{#if arrange.reorderError}
				<p data-testid="section-reorder-error" role="alert" class="text-sm text-red-700">
					{arrange.reparentPartial ? m.roster_section_reparent_partial() : m.roster_section_reorder_failed()}
				</p>
			{/if}
			{#if arrange.removeError}
				<p data-testid="section-remove-error" role="alert" class="text-sm text-red-700">
					{arrange.removeError.kind === 'not-empty'
						? m.roster_section_remove_not_empty({ name: arrange.removeError.name })
						: m.roster_section_remove_failed({ name: arrange.removeError.name })}
				</p>
			{/if}
			{#if arrange.reorderPending}
				<div
					data-testid="section-reorder-pending"
					role="status"
					aria-busy="true"
					aria-live="polite"
					class="flex items-center gap-2 text-xs text-ink-2"
				>
					<span
						aria-hidden="true"
						class="h-3 w-3 animate-spin rounded-full border-2 border-ink-3 border-t-transparent"
					></span>
					{m.roster_section_reorder_pending()}
				</div>
			{/if}
			<div class="flex items-center justify-between border-b border-ink-5 pb-1.5">
				<span class="text-xs tracking-wide text-ink-2 uppercase">{m.roster_column_name()}</span>
				{#if !roster.sectionsError}
					<button
						type="button"
						data-testid="roster-sort-toggle"
						aria-pressed={roster.view === 'flat'}
						class="text-xs tracking-wide text-ink-2 uppercase underline hover:text-ink"
						onclick={() => (roster.view = roster.view === 'grouped' ? 'flat' : 'grouped')}
					>
						{roster.view === 'grouped' ? m.roster_sort_alphabetical() : m.roster_sort_grouped()}
					</button>
				{/if}
			</div>

			{#if roster.view === 'grouped' && !roster.sectionsError}
				<RadioChips
					testid="roster-view-modes"
					label={m.roster_view_modes_label()}
					class="inline-flex flex-wrap items-center gap-1.5 self-start"
					options={viewModeOptions}
					selected={roster.viewMode}
					onselect={setViewMode}
					chipClass="rounded-full border px-2.5 py-1 text-xs tracking-wide uppercase"
					onClass="border-ink bg-ink text-paper"
					offClass="border-ink-4 text-ink-2 hover:text-ink"
				/>
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
					<div data-testid="roster-groups" class="flex flex-col">
						{#each visibleSections as node (node.id)}
							{@render sectionGroup(node)}
						{/each}
						{#if unassignedGroup}
							{@const isExpanded = roster.expandedIds.has('unassigned')}
							<section data-testid="section-group-unassigned" data-depth="0" class="flex flex-col">
								<button
									type="button"
									data-testid="section-toggle-unassigned"
									aria-expanded={isExpanded}
									aria-controls={isExpanded ? 'section-region-unassigned' : undefined}
									class="flex items-center gap-2 py-1.5 text-left"
									onclick={() => toggleSection('unassigned')}
								>
									<span aria-hidden="true" class="text-ink-2">{isExpanded ? '▾' : '▸'}</span>
									<span data-testid="section-header-unassigned" class="text-sm font-medium text-ink">
										{m.roster_unassigned()} ({unassignedGroup.memberCount})
									</span>
								</button>
								{#if isExpanded}
									<ul id="section-region-unassigned" class="flex flex-col pl-5">
										{#each unassignedGroup.members as row (row.memberId)}
											{@render memberRow(row, false, null)}
										{/each}
									</ul>
								{/if}
							</section>
						{/if}
					</div>
				{/if}
			{:else}
				<ul data-testid="roster-flat-list" class="flex flex-col">
					{#each flatRows as row (row.memberId)}
						{@render memberRow(row, true, null)}
					{/each}
				</ul>
			{/if}
		{/if}

		{#if admin === 'admin' && status === 'ready'}
			<InactiveList {roster} {memberOps} {ops} {isOffline} {sectionNameById} />
		{/if}
	</div>
</main>
