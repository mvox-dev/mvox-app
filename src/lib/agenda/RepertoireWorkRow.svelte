<!-- #648 — one row of the "Works" element: the work, its links and its manage controls. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { PickerOption, RepertoireStatus, WorkRow } from '$lib/repertoire/types';
	import {
		pinnedEditionLabel,
		rowEditionUnknown as isEditionUnknown,
		readerEditionUnknownReason as getReaderEditionUnknownReason
	} from '$lib/repertoire/editionUnknown';
	import { rovingKeydown } from '$lib/a11y/roving';

	interface Props {
		row: WorkRow;
		index: number;
		rowCount: number;
		canEditRepertoire: boolean;
		canEditProgramme: boolean;
		editionOptions: PickerOption[];
		pickableEditionsPartial: boolean;
		editionsResolvedWorkIds: ReadonlySet<string>;
		pendingKeys: ReadonlySet<string>;
		isOffline: boolean;
		heldFileIds: ReadonlySet<string> | null;
		partLinkDb: string | undefined;
		activeStatus: RepertoireStatus;
		onstatusfocus: (status: RepertoireStatus) => void;
		onpdfclick?: (fileId: string) => void;
		onstatuschange?: (itemId: string, status: RepertoireStatus) => void;
		onpinedition?: (itemId: string, editionId: string) => void;
		onremoveitem?: (itemId: string) => void;
		onmoveitem?: (itemId: string, direction: 'up' | 'down') => void;
	}
	const {
		row,
		index,
		rowCount,
		canEditRepertoire,
		canEditProgramme,
		editionOptions,
		pickableEditionsPartial,
		editionsResolvedWorkIds,
		pendingKeys,
		isOffline,
		heldFileIds,
		partLinkDb,
		activeStatus,
		onstatusfocus,
		onpdfclick,
		onstatuschange,
		onpinedition,
		onremoveitem,
		onmoveitem
	}: Props = $props();

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

	function handleStatusGroupKeydown(e: KeyboardEvent): void {
		rovingKeydown(e, { selector: 'button:not([disabled])' });
	}

	/** A held part renders the link instead of the PDF button: same destination, one control. */
	function isPartLinked(row: WorkRow): boolean {
		if (partLinkDb === undefined || partLinkDb === '') return false;
		if (row.fileId === '') return false;
		return heldFileIds !== null && heldFileIds.has(row.fileId);
	}

	/** Shared with the caller, which picks the works to read scoped from the same predicate. */
	function rowEditionUnknown(row: WorkRow): boolean {
		return isEditionUnknown(row, editionOptions, pickableEditionsPartial, editionsResolvedWorkIds);
	}
	/** The reader's split uses the row's own truncated flag; 'dangling' is a pin that a
	 *  complete read cannot name. */
	function readerEditionUnknownReason(row: WorkRow): 'truncated' | 'dangling' | null {
		return getReaderEditionUnknownReason(
			row,
			editionOptions,
			row.truncated ?? false,
			editionsResolvedWorkIds
		);
	}
	function rowEditionLabel(row: WorkRow): string {
		return pinnedEditionLabel(row, editionOptions);
	}

	/** Unmatched pin → '': a select shows an unmatched value as its first option. */
	function pickerValue(row: WorkRow): string {
		return editionOptions.some((opt) => opt.id === row.editionId) ? row.editionId : '';
	}

	/** An unknown pin gets no unpin choice: that would erase a value we cannot show. Reads
	 *  the editor feed; the looser reader rule would make the removal permanent. */
	function pickerPinIsUnknown(row: WorkRow): boolean {
		return row.editionId !== '' && rowEditionUnknown(row);
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

	function domainOf(url: string): string {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}

	const readerReason = $derived(canEditRepertoire ? null : readerEditionUnknownReason(row));
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
		{#each editionOptions as opt (opt.id)}
			<option value={opt.id}>{opt.label}</option>
		{/each}
	</select>
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

<span data-testid="work-name" class="text-sm text-ink">{row.workName}</span>
<span data-testid="work-composer" class="text-xs text-ink-2">{row.composer}</span>
{#if row.status !== null && !canEditRepertoire}
	<!-- An editor's status buttons show the status, so the chip is for readers only. -->
	<span
		data-testid="work-status-badge"
		class="w-fit rounded-full border border-ink-4 px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-ink-2 uppercase"
	>
		{statusLabel(row.status)}
	</span>
{/if}
{#if canEditRepertoire && rowEditionUnknown(row)}
	<!-- Truncated read not yet settled by a scoped read: unknown, and the picker stays open. -->
	<span data-testid="work-edition-unknown" class="text-xs text-ink-3 italic">
		{m.repertoire_edition_unknown()}
	</span>
	{@render editionPicker(row)}
{:else if canEditRepertoire && editionOptions.length > 0}
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
{#if canEditRepertoire || canEditProgramme}
	<div
		data-testid="work-manage-row"
		class="flex flex-wrap items-center gap-2 border-t border-ink-5 pt-2 mt-1"
	>
		{#if canEditRepertoire}
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
						tabindex={activeStatus === opt.value ? 0 : -1}
						onfocus={() => onstatusfocus(opt.value)}
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
		{:else if canEditProgramme}
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
				disabled={pendingKeys.has(row.id) || index === rowCount - 1 || isOffline}
				aria-label={m.repertoire_move_down_aria_label({ work: row.workName })}
				onclick={() => handleMove(row.id, 'down')}
			>
				{m.repertoire_move_down()}
			</button>
			{@render removeButton(row)}
		{/if}
	</div>
{/if}
