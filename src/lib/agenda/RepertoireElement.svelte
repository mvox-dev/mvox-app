<!-- The "Works" element on an agenda event row: names, expanded rows and manage controls. -->
<script module lang="ts">
	// Svelte 5: a plain export in the instance script makes a prop, so these live here.

	export type { PickerOption } from '$lib/repertoire/types';

	/** Pending keys for the two "Add" controls; row actions key on their own item id. */
	export const ADD_WORK_KEY = '__add_work__';
	export const ADD_PROGRAMME_KEY = '__add_programme__';
</script>

<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { PickerOption, RepertoireStatus, WorkRow } from '$lib/repertoire/types';
	import type { Work } from '$lib/library/libraryData';
	import type { ManageRightsState } from '$lib/repertoire/repertoireActions';
	import { workLabel } from '$lib/repertoire/workLabel';
	import {
		pinnedEditionLabel,
		rowEditionUnknown as isEditionUnknown,
		readerEditionUnknownReason as getReaderEditionUnknownReason
	} from '$lib/repertoire/editionUnknown';
	import { rovingKeydown } from '$lib/a11y/roving';
	import { writesAvailable } from '$lib/net/online';

	// Stable default: a fresh Set per render would be a new prop value every time.
	const NO_RESOLVED_WORK_IDS: ReadonlySet<string> = new Set<string>();

	const STATUS_OPTIONS: { value: RepertoireStatus; label: () => string }[] = [
		{ value: 'learning', label: m.repertoire_status_learning },
		{ value: 'active', label: m.repertoire_status_active },
		{ value: 'retired', label: m.repertoire_status_retired },
		{ value: 'dropped', label: m.repertoire_status_dropped }
	];

	/** Same lookup as the management buttons, so no raw status leaks into a locale. */
	function statusLabel(status: RepertoireStatus): string {
		return STATUS_OPTIONS.find((opt) => opt.value === status)?.label() ?? status;
	}

	// Keyed by row: every row renders in this one instance, so a scalar would move all stops.
	let rovingStatusByRow = $state<Record<string, RepertoireStatus>>({});
	function activeStatusFor(row: WorkRow): RepertoireStatus {
		const roving = rovingStatusByRow[row.id];
		if (roving !== undefined) return roving;
		return row.status ?? 'active';
	}

	function handleStatusGroupKeydown(e: KeyboardEvent): void {
		rovingKeydown(e, { selector: 'button:not([disabled])' });
	}

	/** A held part renders the link instead of the PDF button: same destination, one control. */
	function isPartLinked(row: WorkRow): boolean {
		if (partLinkDb === undefined || partLinkDb === '') return false;
		if (row.fileId === '') return false;
		return heldFileIds !== null && heldFileIds.has(row.fileId);
	}

	/** Repertoire the collective is NOT singing. Only a season editor ever sees
	 *  these (`includeInactive`), and only so the status toggle is two-way. */
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
		/** Opt-in: with a db, a row whose part is on the device links to /part (see isPartLinked). */
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
		/** ordinal is computed here (append-to-end; reorder afterwards via
		 *  onmoveitem) so the caller only needs to know the chosen edition. */
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

	// Per-surface rights. A caller that supplies only `manageRights` gets exactly
	// the old behaviour: it governs `context`'s surface and the other stays shut.
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

	/** Repertoire ops (status / pin / remove) may touch this row: the surface is
	 *  the repertoire one AND the row is genuinely a repertoire_item. */
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

	/** Shared with the caller, which picks the works to read scoped from the same predicate. */
	function rowEditionUnknown(row: WorkRow): boolean {
		return isEditionUnknown(row, optionsFor(row), pickableEditionsPartial, editionsResolvedWorkIds);
	}
	/** The reader's split uses the row's own truncated flag; 'dangling' is a pin that a
	 *  complete read cannot name. */
	function readerEditionUnknownReason(row: WorkRow): 'truncated' | 'dangling' | null {
		return getReaderEditionUnknownReason(
			row,
			optionsFor(row),
			row.truncated ?? false,
			editionsResolvedWorkIds
		);
	}
	function rowEditionLabel(row: WorkRow): string {
		return pinnedEditionLabel(row, optionsFor(row));
	}

	/** Unmatched pin → '': a select shows an unmatched value as its first option. */
	function pickerValue(row: WorkRow): string {
		return optionsFor(row).some((opt) => opt.id === row.editionId) ? row.editionId : '';
	}

	/** An unknown pin gets no unpin choice: that would erase a value we cannot show. Reads
	 *  the editor feed; the looser reader rule would make the removal permanent. */
	function pickerPinIsUnknown(row: WorkRow): boolean {
		return row.editionId !== '' && rowEditionUnknown(row);
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

	function handleStatusChange(rowId: string, status: RepertoireStatus) {
		if (pendingKeys.has(rowId) || isOffline) return;
		onstatuschange?.(rowId, status);
	}

	function handlePinEdition(rowId: string, editionId: string) {
		if (pendingKeys.has(rowId) || isOffline) return;
		onpinedition?.(rowId, editionId);
	}

	function handleRemove(rowId: string) {
		if (pendingKeys.has(rowId) || isOffline) return;
		onremoveitem?.(rowId);
	}

	function handleMove(rowId: string, direction: 'up' | 'down') {
		if (pendingKeys.has(rowId) || isOffline) return;
		onmoveitem?.(rowId, direction);
	}

	// SSR/client-stable per-instance id, same pattern as SeasonSummary — the
	// collapsed toggle points aria-controls at the expanded region.
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

	function domainOf(url: string): string {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}
</script>

{#snippet editionPicker(row: WorkRow)}
	<select
		data-testid="work-edition-picker"
		class="w-full sm:w-auto"
		value={pickerValue(row)}
		disabled={pendingKeys.has(row.id) || isOffline}
		aria-label={m.repertoire_pin_edition_select_aria_label({ work: row.workName })}
		onchange={(e) => handlePinEdition(row.id, (e.currentTarget as HTMLSelectElement).value)}
	>
		{#if pickerPinIsUnknown(row)}
			<!-- The pin is real but unnameable: no unpin offer, see pickerPinIsUnknown. -->
			<option value="" disabled>{m.repertoire_edition_unknown()}</option>
		{:else}
			<option value="">{m.repertoire_pin_edition_label()}</option>
		{/if}
		{#each optionsFor(row) as opt (opt.id)}
			<option value={opt.id}>{opt.label}</option>
		{/each}
	</select>
{/snippet}

{#snippet workRowContent(row: WorkRow)}
	<span data-testid="work-name" class="text-sm text-ink">{row.workName}</span>
	<span data-testid="work-composer" class="text-xs text-ink-2">{row.composer}</span>
	{#if row.status !== null && !canEditRepertoireRow(row)}
		<!-- An editor's status buttons show the status, so the chip is for readers only. -->
		<span
			data-testid="work-status-badge"
			class="w-fit rounded-full border border-ink-4 px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-ink-2 uppercase"
		>
			{statusLabel(row.status)}
		</span>
	{/if}
	{@const readerReason = canEditRepertoireRow(row) ? null : readerEditionUnknownReason(row)}
	{#if canEditRepertoireRow(row) && rowEditionUnknown(row)}
		<!-- Truncated read not yet settled by a scoped read: unknown, and the picker stays open. -->
		<span data-testid="work-edition-unknown" class="text-xs text-ink-3 italic">
			{m.repertoire_edition_unknown()}
		</span>
		{@render editionPicker(row)}
	{:else if canEditRepertoireRow(row) && optionsFor(row).length > 0}
		{@render editionPicker(row)}
	{:else if rowEditionLabel(row) !== ''}
		<span data-testid="work-edition" class="text-xs text-ink-2">{rowEditionLabel(row)}</span>
	{:else if readerReason !== null}
		<!-- Reader's unknown state. readerReason is null for editors on purpose: the reader rule
		     is looser, and an editor must not reach this branch. -->
		<span data-testid="work-edition-unknown" class="text-xs text-ink-3 italic">
			{readerReason === 'dangling'
				? m.repertoire_edition_unknown_pinned()
				: m.repertoire_edition_unknown()}
		</span>
	{:else}
		<span data-testid="work-no-edition" class="text-xs text-ink-3 italic">{m.repertoire_no_edition()}</span>
	{/if}
	{#if row.notes !== ''}
		<span data-testid="work-notes" class="text-xs text-ink-2 italic">{row.notes}</span>
	{/if}
	<span class="flex flex-wrap items-center gap-2">
		{#if row.fileId !== ''}
			<!-- Not a control. Absent until heldFileIds answers: an absent badge is no claim. -->
			{#if heldFileIds !== null}
				<span data-testid="file-presence-{row.fileId}" class="text-xs text-ink-2">
					{heldFileIds.has(row.fileId)
						? m.file_presence_on_device()
						: m.file_presence_needs_network()}
				</span>
			{/if}
			{#if isPartLinked(row)}
				<!-- A plain click goes through onpdfclick so a stale label refreshes; modifier and
				     middle clicks are left to the browser. -->
				<a
					data-testid="part-link-{row.fileId}"
					href="/part/{row.fileId}?db={partLinkDb}"
					class="text-xs text-ink underline"
					aria-label={m.event_part_link_aria_label({ work: row.workName })}
					onclick={(e) => {
						if (!onpdfclick) return;
						if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
						e.preventDefault();
						onpdfclick(row.fileId);
					}}
				>
					{m.event_part_link()}
				</a>
			{:else}
				<button
					type="button"
					data-testid="work-link-pdf"
					class="text-xs text-ink underline"
					aria-label={m.repertoire_pdf_link_aria_label({ work: row.workName })}
					onclick={() => onpdfclick?.(row.fileId)}
				>
					{m.repertoire_pdf_link()}
				</button>
			{/if}
		{/if}
		{#if row.canBorrow}
			<a
				data-testid="work-link-borrow"
				href="/library"
				class="text-xs text-ink underline"
				aria-label={m.repertoire_borrow_link_aria_label({ work: row.workName })}
			>
				{m.repertoire_borrow_link()}
			</a>
		{/if}
		<!-- Unkeyed: external_link is multi-valued, so a url can repeat and a key would throw
		     each_key_duplicate. -->
		{#each row.externalLinks as link}
			<a
				data-testid="work-link-external"
				href={link}
				target="_blank"
				rel="noopener noreferrer"
				class="text-xs text-ink underline"
				aria-label={m.repertoire_external_link_aria_label({
					domain: domainOf(link),
					work: row.workName
				})}
			>
				{domainOf(link)}
			</a>
		{/each}
	</span>
{/snippet}

{#snippet removeButton(row: WorkRow)}
	<button
		type="button"
		data-testid="work-manage-remove"
		class="text-xs text-red underline disabled:cursor-default disabled:opacity-[0.45]"
		disabled={pendingKeys.has(row.id) || isOffline}
		aria-label={m.repertoire_remove_aria_label({ work: row.workName })}
		onclick={() => handleRemove(row.id)}
	>
		{m.repertoire_remove()}
	</button>
{/snippet}

{#snippet manageRowControls(row: WorkRow, index: number)}
	{#if canEditRepertoireRow(row) || canEditProgrammeRow(row)}
		<div
			data-testid="work-manage-row"
			class="flex flex-wrap items-center gap-2 border-t border-ink-5 pt-2 mt-1"
		>
			{#if canEditRepertoireRow(row)}
				<!-- Toolbar: arrows move focus only, never activate. -->
				<div
					data-testid="work-status-group-{row.id}"
					role="toolbar"
					tabindex="-1"
					aria-label={m.repertoire_status_group_label({ work: row.workName })}
					class="flex flex-wrap gap-1"
					onkeydown={handleStatusGroupKeydown}
				>
					{#each STATUS_OPTIONS as opt (opt.value)}
						<button
							type="button"
							data-testid={`work-status-${opt.value}`}
							class="rounded-full border border-ink-4 px-2 py-0.5 font-mono text-[9px] tracking-wide uppercase disabled:cursor-default disabled:opacity-[0.45] aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-paper"
							aria-pressed={(row.status ?? 'active') === opt.value}
							disabled={pendingKeys.has(row.id) || isOffline}
							tabindex={activeStatusFor(row) === opt.value ? 0 : -1}
							onfocus={() =>
								(rovingStatusByRow = { ...rovingStatusByRow, [row.id]: opt.value })}
							aria-label={m.repertoire_status_button_aria_label({
								status: opt.label(),
								work: row.workName
							})}
							onclick={() => handleStatusChange(row.id, opt.value)}
						>
							{opt.label()}
						</button>
					{/each}
				</div>
				<!-- Remove sits inside each branch: the id is a repertoire_item here and a program_item
				     below, and they go to different delete handlers. -->
				{@render removeButton(row)}
			{:else if canEditProgrammeRow(row)}
				<button
					type="button"
					data-testid="work-manage-move-up"
					class="text-xs text-ink underline disabled:cursor-default disabled:opacity-[0.45]"
					disabled={pendingKeys.has(row.id) || index === 0 || isOffline}
					aria-label={m.repertoire_move_up_aria_label({ work: row.workName })}
					onclick={() => handleMove(row.id, 'up')}
				>
					{m.repertoire_move_up()}
				</button>
				<button
					type="button"
					data-testid="work-manage-move-down"
					class="text-xs text-ink underline disabled:cursor-default disabled:opacity-[0.45]"
					disabled={pendingKeys.has(row.id) || index === orderedRows.length - 1 || isOffline}
					aria-label={m.repertoire_move_down_aria_label({ work: row.workName })}
					onclick={() => handleMove(row.id, 'down')}
				>
					{m.repertoire_move_down()}
				</button>
				{@render removeButton(row)}
			{/if}
		</div>
	{/if}
{/snippet}

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
							{@render workRowContent(row)}
							{@render manageRowControls(row, index)}
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
