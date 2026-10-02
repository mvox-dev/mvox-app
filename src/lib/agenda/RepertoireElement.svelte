<!-- The "Works" element on an agenda event row: names, expanded rows and manage controls. -->
<script module lang="ts">
	// Svelte 5: a plain export in the instance script makes a prop, so these live here.

	export type { PickerOption } from '$lib/repertoire/types';

	export const ADD_WORK_KEY = '__add_work__';
	export const ADD_PROGRAMME_KEY = '__add_programme__';
</script>

<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { PickerOption, RepertoireStatus, WorkRow } from '$lib/repertoire/types';
	import type { Work } from '$lib/library/libraryData';
	import type { ManageRightsState } from '$lib/repertoire/repertoireActions';
	import { workLabel } from '$lib/repertoire/workLabel';
	import RepertoireWorkRow from '$lib/agenda/RepertoireWorkRow.svelte';
	import { writesAvailable } from '$lib/net/online';

	// Stable default: a fresh Set per render would be a new prop value every time.
	const NO_RESOLVED_WORK_IDS: ReadonlySet<string> = new Set<string>();

	// Keyed by row and held here, not in RepertoireWorkRow, so a row's stop survives a collapse.
	let rovingStatusByRow = $state<Record<string, RepertoireStatus>>({});
	function activeStatusFor(row: WorkRow): RepertoireStatus {
		const roving = rovingStatusByRow[row.id];
		if (roving !== undefined) return roving;
		return row.status ?? 'active';
	}

	/** Not being sung: only a season editor sees these, so the status toggle is two-way. */
	const INACTIVE_STATUSES = new Set<RepertoireStatus>(['retired', 'dropped']);
	function isInactive(row: WorkRow): boolean {
		return row.status !== null && INACTIVE_STATUSES.has(row.status);
	}

	interface Props {
		rows: WorkRow[];
		/** Sign and open the file at click time: Entu's signed url lives only 60 seconds. */
		onpdfclick?: (fileId: string) => void;
		/** fileIds the byte store holds; null until it answers, so no badge flickers. */
		heldFileIds?: ReadonlySet<string> | null;
		/** Opt-in: with a db, a row whose part is on the device links to /part (RepertoireWorkRow). */
		partLinkDb?: string;
		manageRights?: ManageRightsState;
		/** Governs repertoire_item writes; defaults to manageRights in repertoire context. */
		seasonRights?: ManageRightsState;
		/** Governs program_item writes; defaults to manageRights in programme context. */
		eventRights?: ManageRightsState;
		context?: 'repertoire' | 'programme';
		pickableWorksList?: Work[];
		/** Lets a page with two repertoire surfaces keep their "Add work" pending states apart. */
		addWorkKey?: string;
		/** Defaults to true: an empty list may be unloaded or failed, so only a caller that knows
		 *  the load completed with nothing left passes false. */
		pickableWorksVisible?: boolean;
		/** The works read was truncated: a missing work would read as "not in the library". */
		pickableWorksPartial?: boolean;
		pickableEditions?: PickerOption[];
		/** Defaults to options present; a page with an async, resettable source overrides it. */
		pickableEditionsVisible?: boolean;
		/** The editions read was truncated; a flag of its own, since the two reads are separate. */
		pickableEditionsPartial?: boolean;
		/** Per-row pin choices. An empty entry hides the pin control only under a complete read;
		 *  under a truncated read the row shows unknown and keeps the control. */
		editionOptionsByRowId?: Record<string, PickerOption[]>;
		/** Works whose editions a scoped read has settled: their empty options are a known absence. */
		editionsResolvedWorkIds?: ReadonlySet<string>;
		pendingKeys?: ReadonlySet<string>;
		/** The event page is the expanded view: open with no tap and no collapsed toggle. */
		expanded?: boolean;
		onaddwork?: (workId: string) => void;
		onstatuschange?: (itemId: string, status: RepertoireStatus) => void;
		onpinedition?: (itemId: string, editionId: string) => void;
		onremoveitem?: (itemId: string) => void;
		onmoveitem?: (itemId: string, direction: 'up' | 'down') => void;
		/** The ordinal is computed here (append to the end), so the caller passes the edition. */
		onaddprogramitem?: (editionId: string, ordinal: number) => void;
	}
	const {
		rows,
		onpdfclick,
		heldFileIds = null,
		partLinkDb,
		manageRights = 'not-editor',
		seasonRights,
		eventRights,
		context = 'repertoire',
		pickableWorksList = [],
		addWorkKey = ADD_WORK_KEY,
		pickableWorksVisible = true,
		pickableWorksPartial = false,
		pickableEditions = [],
		pickableEditionsVisible: pickableEditionsVisibleProp,
		pickableEditionsPartial = false,
		editionOptionsByRowId = {},
		editionsResolvedWorkIds = NO_RESOLVED_WORK_IDS,
		pendingKeys = new Set<string>(),
		expanded: forceExpanded = false,
		onaddwork,
		onstatuschange,
		onpinedition,
		onremoveitem,
		onmoveitem,
		onaddprogramitem
	}: Props = $props();

	// Per-surface rights: `manageRights` alone governs `context`'s surface; the other stays shut.
	const canManageRepertoire = $derived(
		(seasonRights ?? (context === 'repertoire' ? manageRights : 'not-editor')) === 'editor'
	);
	const canManageProgramme = $derived(
		(eventRights ?? (context === 'programme' ? manageRights : 'not-editor')) === 'editor'
	);
	const canManage = $derived(canManageRepertoire || canManageProgramme);

	const isOffline = $derived(!$writesAvailable);

	const pickableEditionsVisible = $derived(
		pickableEditionsVisibleProp ?? pickableEditions.length > 0
	);

	/** Repertoire ops need the repertoire surface AND a row that is a repertoire_item. */
	function canEditRepertoireRow(row: WorkRow): boolean {
		return canManageRepertoire && context === 'repertoire' && row.kind === 'repertoire';
	}
	/** Gated on kind, not ordinal: a missing ordinal defaults to 0, so it proves nothing. */
	function canEditProgrammeRow(row: WorkRow): boolean {
		return canManageProgramme && context === 'programme' && row.kind === 'program';
	}

	function optionsFor(row: WorkRow): PickerOption[] {
		return editionOptionsByRowId[row.id] ?? [];
	}

	let expandedState = $state(false);
	const isExpanded = $derived(forceExpanded || expandedState);

	let selectedWorkId = $state('');
	let selectedEditionForAdd = $state('');

	function handleAddWork() {
		if (!selectedWorkId || pendingKeys.has(addWorkKey) || isOffline) return;
		onaddwork?.(selectedWorkId);
		selectedWorkId = '';
	}

	function handleAddProgramItem() {
		if (!selectedEditionForAdd || pendingKeys.has(ADD_PROGRAMME_KEY) || isOffline) return;
		const knownOrdinals = rows.flatMap((r) => (r.ordinal !== null ? [r.ordinal] : []));
		const nextOrdinal = knownOrdinals.length === 0 ? 0 : Math.max(...knownOrdinals) + 1;
		onaddprogramitem?.(selectedEditionForAdd, nextOrdinal);
		selectedEditionForAdd = '';
	}

	const componentId = $props.id();
	const expandedRegionId = `works-expanded-${componentId}`;

	// Only active rows are named; inactive ones are counted, not advertised as live rep.
	const activeRows = $derived(rows.filter((r) => !isInactive(r)));
	const inactiveCount = $derived(rows.length - activeRows.length);
	const collapsedLine = $derived(
		[
			activeRows.map((r) => r.workName).join(' · '),
			inactiveCount > 0 ? m.repertoire_inactive_count({ count: inactiveCount }) : ''
		]
			.filter((part) => part !== '')
			.join(' · ')
	);

	const hasOrdinals = $derived(rows.length > 0 && rows.every((r) => r.ordinal !== null));
	// Sorted only with ordinals; the sort is stable, so tied ordinals keep read order.
	const orderedRows = $derived(
		hasOrdinals ? [...rows].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)) : rows
	);
</script>

{#snippet manageAddControls()}
	{#if canManage && isOffline}
		<p data-testid="repertoire-write-unavailable" class="text-xs text-ink-2">
			{m.write_unavailable_no_signal()}
		</p>
	{/if}
	{#if canManageRepertoire && context === 'repertoire'}
		<div data-testid="work-manage-add-work" class="flex flex-wrap items-center gap-2 pt-1">
			{#if pickableWorksVisible}
				<select
					data-testid="work-manage-add-work-select"
					class="w-full sm:w-auto"
					value={selectedWorkId}
					disabled={pendingKeys.has(addWorkKey) || isOffline}
					aria-label={m.repertoire_add_work_label()}
					onchange={(e) => (selectedWorkId = (e.currentTarget as HTMLSelectElement).value)}
				>
					<option value="">{m.repertoire_add_work_label()}</option>
					{#each pickableWorksList as w (w.id)}
						<option value={w.id}>{workLabel(w)}</option>
					{/each}
					<!-- A truncated read: a trailing disabled option says so inside the list. -->
					{#if pickableWorksPartial}
						<option data-testid="work-manage-add-work-partial-option" value="" disabled>
							{m.picker_partial_options_notice()}
						</option>
					{/if}
				</select>
				<button
					type="button"
					data-testid="work-manage-add-work-button"
					class="text-xs text-ink underline disabled:cursor-default disabled:opacity-[0.45]"
					disabled={pendingKeys.has(addWorkKey) || !selectedWorkId || isOffline}
					aria-label={m.repertoire_add_work_aria_label()}
					onclick={handleAddWork}
				>
					{m.repertoire_add_work_button()}
				</button>
			{/if}
		</div>
	{/if}
	<!-- Not the {:else} above: "Add to programme" creates an event's first program_item
	     while the event still shows the season repertoire. -->
	{#if canManageProgramme}
		<div data-testid="work-manage-add-programme" class="flex flex-wrap items-center gap-2 pt-1">
			{#if pickableEditionsVisible}
				<select
					data-testid="work-manage-add-programme-select"
					class="w-full sm:w-auto"
					value={selectedEditionForAdd}
					disabled={pendingKeys.has(ADD_PROGRAMME_KEY) || isOffline}
					aria-label={m.repertoire_add_programme_label()}
					onchange={(e) => (selectedEditionForAdd = (e.currentTarget as HTMLSelectElement).value)}
				>
					<option value="">{m.repertoire_add_programme_label()}</option>
					{#each pickableEditions as opt (opt.id)}
						<option value={opt.id}>{opt.label}</option>
					{/each}
					{#if pickableEditionsPartial}
						<option data-testid="work-manage-add-programme-partial-option" value="" disabled>
							{m.picker_partial_options_notice()}
						</option>
					{/if}
				</select>
			{/if}
			{#if selectedEditionForAdd}
				<button
					type="button"
					data-testid="work-manage-add-programme-button"
					class="text-xs text-ink underline disabled:cursor-default disabled:opacity-[0.45]"
					disabled={pendingKeys.has(ADD_PROGRAMME_KEY) || isOffline}
					aria-label={m.repertoire_add_programme_aria_label()}
					onclick={handleAddProgramItem}
				>
					{m.repertoire_add_programme_button()}
				</button>
			{/if}
		</div>
	{/if}
{/snippet}

{#if rows.length > 0}
	{#if !forceExpanded}
		<button
			type="button"
			data-testid="works-line"
			class="flex items-baseline gap-1.5 truncate text-left text-xs text-ink-2"
			aria-expanded={isExpanded}
			aria-controls={isExpanded ? expandedRegionId : undefined}
			onclick={() => (expandedState = !expandedState)}
		>
			<span aria-hidden="true">♫</span>
			<span class="truncate">{collapsedLine}</span>
		</button>
	{/if}
	{#if isExpanded}
		<div id={expandedRegionId} data-testid="works-expanded" class="flex flex-col gap-2 pt-1 pl-2">
			<!-- Season repertoire has no concert position, so <ul>. Rows key on id, never ordinal:
			     two program_items can share the default 0. -->
			<svelte:element
				this={hasOrdinals ? 'ol' : 'ul'}
				class={hasOrdinals
					? 'list-decimal divide-y divide-dashed divide-ink-5 pl-4'
					: 'divide-y divide-dashed divide-ink-5'}
			>
				{#each orderedRows as row, index (row.id)}
					<!-- No display utility on the <li>: display: flex drops list-item and the numbering. -->
					<li
						data-testid="work-row"
						data-inactive={isInactive(row) ? 'true' : undefined}
						data-status={row.status ?? undefined}
						class="py-2 first:pt-0 last:pb-0"
						class:opacity-60={isInactive(row)}
					>
						<div class="flex flex-col gap-0.5">
							<RepertoireWorkRow
								{row}
								{index}
								rowCount={orderedRows.length}
								canEditRepertoire={canEditRepertoireRow(row)}
								canEditProgramme={canEditProgrammeRow(row)}
								editionOptions={optionsFor(row)}
								{pickableEditionsPartial}
								{editionsResolvedWorkIds}
								{pendingKeys}
								{isOffline}
								{heldFileIds}
								{partLinkDb}
								activeStatus={activeStatusFor(row)}
								onstatusfocus={(status) =>
									(rovingStatusByRow = { ...rovingStatusByRow, [row.id]: status })}
								{onpdfclick}
								{onstatuschange}
								{onpinedition}
								{onremoveitem}
								{onmoveitem}
							/>
						</div>
					</li>
				{/each}
			</svelte:element>
			{@render manageAddControls()}
		</div>
	{/if}
{:else if canManage}
	<div data-testid="works-manage-empty" class="flex flex-col gap-2 pt-1">
		{@render manageAddControls()}
	</div>
{/if}