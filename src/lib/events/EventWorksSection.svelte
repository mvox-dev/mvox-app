<script lang="ts">
	import { untrack } from 'svelte';
	import { openPart } from '$lib/parts/openPart';
	import { m } from '$lib/paraglide/messages.js';
	import { cfgFor } from '$lib/entu/cfg';
	import { refreshEventPageWorkRows } from '$lib/events/eventPageData';
	import { unresolvedEditionWorkIds } from '$lib/repertoire/editionUnknown';
	import {
		editionsByWorkId as editionsByWorkIdOf,
		editionOptionsByRowId as editionOptionsByRowIdOf,
		pickableEditionOptions,
		readScopedEditions,
		withoutProgrammed
	} from '$lib/repertoire/editionOptions';
	import { createRepertoireRowHandlers } from '$lib/repertoire/repertoireRowHandlers';
	import { dropRows, patchRows, restoreRow, setOrdinals } from '$lib/repertoire/workRowOps';
	import RepertoireElement, {
		ADD_PROGRAMME_KEY,
		ADD_WORK_KEY
	} from '$lib/components/agenda/RepertoireElement.svelte';
	import type { ManageRightsState, PickerOption } from '$lib/repertoire/types';
	import type { Collective } from '$lib/collectives/types';
	import type { EventDetail } from '$lib/events/eventDetail';
	import type { EventActions, EventPageState } from '$lib/events/eventPageState';
	import { withItem } from '$lib/collections/immutable';

	let {
		detail,
		selected,
		ev,
		isEditor,
		isOffline,
		generation,
		actions
	}: {
		detail: EventDetail;
		selected: Collective | null;
		ev: EventPageState;
		isEditor: boolean;
		isOffline: boolean;
		generation: () => number;
		actions: EventActions;
	} = $props();

	let mounted = true;
	$effect(() => () => {
		mounted = false;
	});

	const eventManageRights = $derived<ManageRightsState>(isEditor ? 'editor' : 'not-editor');

	let scopedEditionsByWorkId = $state<Record<string, PickerOption[]>>({});
	const scopedEditionWorkIdsRequested = new Set<string>();
	let managePendingKeys = $state<Set<string>>(new Set());
	let manageError = $state(false);
	let manageStatus = $state('');

	function manageCfg(): { db: string; token: string } | null {
		return selected ? cfgFor(selected.db) : null;
	}

	function handlePdfClick(fileId: string): void {
		if (!selected) return;
		const row = ev.workRows.find((r) => r.fileId === fileId);
		openPart(
			selected.db,
			fileId,
			row
				? {
						work: row.workName,
						composer: row.composer,
						edition: row.editionName,
						filename: row.fileName
					}
				: undefined
		);
	}

	function refreshWorks(): void {
		const cfg = manageCfg();
		if (!mounted || !cfg || !detail) return;
		const evId = detail.id;
		const seasonId = ev.seasonId;
		const g = generation();
		refreshEventPageWorkRows(cfg, [evId], seasonId, fetch, {
			includeInactive: ev.seasonManageRights === 'editor'
		})
			.then((byEvent) => {
				if (g !== generation()) return;
				ev.workRows = byEvent[evId] ?? [];
			})
			.catch(() => {
			});
		if (seasonId !== null && ev.seasonManageRights === 'editor') {
			actions.listRepertoireItems(cfg, seasonId)
				.then((items) => {
					if (g !== generation()) return;
					ev.seasonRepertoire = items;
				})
				.catch(() => {
				});
		}
	}

	const repertoireQueue = untrack(() =>
		actions.createRepertoireWriteQueue({
			setPending(key, pending) {
				managePendingKeys = withItem(managePendingKeys, key, pending);
				if (pending) {
					manageError = false;
					manageStatus = '';
				}
			},
			reconcile(key) {
				if (key === ADD_WORK_KEY || key === ADD_PROGRAMME_KEY) refreshWorks();
				manageStatus = m.repertoire_manage_saved();
			},
			revert(key) {
				console.error('event detail: repertoire write failed', key);
				refreshWorks();
				manageError = true;
			}
		})
	);

	const rowHandlers = createRepertoireRowHandlers({
		queue: repertoireQueue,
		get actions() {
			return actions;
		},
		rows: {
			list: () => ev.workRows,
			find: (itemId) => ev.workRows.find((row) => row.id === itemId),
			patch: (itemId, patch) => (ev.workRows = patchRows(ev.workRows, itemId, patch)),
			drop: (itemId) => (ev.workRows = dropRows(ev.workRows, itemId)),
			snapshot(itemId) {
				const index = ev.workRows.findIndex((r) => r.id === itemId);
				const row = ev.workRows[index];
				return () => (ev.workRows = restoreRow(ev.workRows, index, row));
			},
			setOrdinals: (_eventId, ordinalById) => (ev.workRows = setOrdinals(ev.workRows, ordinalById))
		},
		cfg: manageCfg,
		isOffline: () => isOffline,
		seasonId: () => ev.seasonId,
		editions: () => ev.libraryEditions,
		seasonRepertoire: {
			get: () => ev.seasonRepertoire,
			set: (items) => (ev.seasonRepertoire = items)
		}
	});

	const editionsByWorkId = $derived(editionsByWorkIdOf(ev.libraryEditions));

	const editionOptionsByRowId = $derived(
		editionOptionsByRowIdOf(ev.workRows, scopedEditionsByWorkId, editionsByWorkId)
	);

	const editionsResolvedWorkIds = $derived(new Set(Object.keys(scopedEditionsByWorkId)));

	const unknownEditionWorkIds = $derived(
		unresolvedEditionWorkIds(
			ev.workRows,
			editionOptionsByRowId,
			ev.libraryEditionsPartial,
			editionsResolvedWorkIds
		)
	);

	$effect(() => {
		const workIds = unknownEditionWorkIds;
		if (workIds.length === 0) return;
		const cfg = manageCfg();
		if (!cfg) return;
		const g = generation();
		readScopedEditions(
			workIds,
			scopedEditionWorkIdsRequested,
			(workId) => actions.listEditions(cfg, workId),
			() => g === generation(),
			(workId, options) => {
				scopedEditionsByWorkId = { ...scopedEditionsByWorkId, [workId]: options };
			}
		);
	});

	const pickableEditionsList = $derived(
		withoutProgrammed(pickableEditionOptions(ev.libraryWorks, ev.libraryEditions), ev.workRows)
	);

	const pickableWorksList = $derived(actions.pickableWorks(ev.libraryWorks, ev.seasonRepertoire));

	$effect(() => {
		if (ev.libraryPickersLoading || !ev.libraryPickersLoadSucceeded) return;
		ev.pickableWorksVisible = pickableWorksList.length > 0;
	});

	const showWorksSection = $derived(
		ev.workRows.length > 0 || ev.seasonManageRights === 'editor' || eventManageRights === 'editor'
	);

	const worksContext = $derived<'repertoire' | 'programme'>(
		ev.workRows.some((row) => row.kind === 'program') ? 'programme' : 'repertoire'
	);
</script>

{#if showWorksSection}
	<section
		data-testid="event-detail-works"
		class="mt-4 flex flex-col gap-2"
		aria-labelledby="event-detail-works-heading"
	>
		<h2 id="event-detail-works-heading" class="font-display text-lg text-ink-2">
			{m.event_detail_works_heading()}
		</h2>
		<RepertoireElement
			rows={ev.workRows}
			expanded={true}
			onpdfclick={handlePdfClick}
			heldFileIds={ev.heldFileIds}
			partLinkDb={selected?.db}
			manageRights={ev.seasonManageRights}
			seasonRights={ev.seasonManageRights}
			eventRights={eventManageRights}
			context={worksContext}
			{pickableWorksList}
			pickableWorksVisible={ev.pickableWorksVisible}
			pickableWorksPartial={ev.libraryWorksPartial}
			pickableEditions={pickableEditionsList}
			pickableEditionsPartial={ev.libraryEditionsPartial}
			{editionOptionsByRowId}
			{editionsResolvedWorkIds}
			pendingKeys={managePendingKeys}
			onaddwork={rowHandlers.addWork}
			onstatuschange={rowHandlers.statusChange}
			onpinedition={rowHandlers.pinEdition}
			onremoveitem={(itemId) => rowHandlers.removeItem(detail.id, itemId)}
			onmoveitem={(itemId, direction) => detail && rowHandlers.move(detail.id, itemId, direction)}
			onaddprogramitem={(editionId, ordinal) =>
				detail && rowHandlers.addProgramItem(detail.id, editionId, ordinal)}
		/>
		{#if manageError}
			<p data-testid="repertoire-manage-error" class="pt-2 text-xs text-red-700" role="alert">
				{m.repertoire_manage_error()}
			</p>
		{/if}
		<div data-testid="repertoire-manage-status" role="status" aria-live="polite" class="sr-only">
			{manageStatus}
		</div>
	</section>
{/if}
