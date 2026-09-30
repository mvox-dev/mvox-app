<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { m } from '$lib/paraglide/messages.js';
	import { cfgFor } from '$lib/entu/cfg';
	import { refreshEventPageWorkRows } from '$lib/events/eventPageData';
	import { unresolvedEditionWorkIds } from '$lib/repertoire/editionUnknown';
	import { workLabel } from '$lib/repertoire/workLabel';
	import RepertoireElement, {
		ADD_PROGRAMME_KEY,
		ADD_WORK_KEY
	} from '$lib/components/agenda/RepertoireElement.svelte';
	import type { Edition } from '$lib/library/libraryData';
	import type { ManageRightsState, PickerOption, RepertoireStatus, WorkRow } from '$lib/repertoire/types';
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
		goto(`/part/${fileId}?db=${selected.db}`, {
			state: row
				? {
						partLabel: {
							work: row.workName,
							composer: row.composer,
							edition: row.editionName,
							filename: row.fileName
						}
					}
				: {}
		});
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

	function findWorkRow(itemId: string): WorkRow | undefined {
		return ev.workRows.find((row) => row.id === itemId);
	}
	function patchWorkRow(itemId: string, patch: Partial<WorkRow>): void {
		ev.workRows = ev.workRows.map((row) => (row.id === itemId ? { ...row, ...patch } : row));
	}
	function dropWorkRow(itemId: string): void {
		ev.workRows = ev.workRows.filter((row) => row.id !== itemId);
	}
	function restoreWorkRow(index: number, row: WorkRow): void {
		if (ev.workRows.some((r) => r.id === row.id)) return;
		const next = [...ev.workRows];
		next.splice(Math.min(index, next.length), 0, row);
		ev.workRows = next;
	}
	function setWorkOrdinals(ordinalById: Map<string, number>): void {
		ev.workRows = ev.workRows.map((row) =>
			ordinalById.has(row.id) ? { ...row, ordinal: ordinalById.get(row.id)! } : row
		);
	}

	function handleAddWork(workId: string): void {
		if (isOffline) return;
		const cfg = manageCfg();
		if (!cfg || ev.seasonId === null) return;
		const sid = ev.seasonId;
		repertoireQueue.request(ADD_WORK_KEY, async () => {
			await actions.createRepertoireItem(cfg, { seasonId: sid, workId });
		});
	}

	function handleStatusChange(itemId: string, status: RepertoireStatus): void {
		if (isOffline) return;
		const cfg = manageCfg();
		const row = findWorkRow(itemId);
		if (!cfg || !row || row.kind !== 'repertoire') return;
		const before = row.status;
		repertoireQueue.request(itemId, () => actions.updateRepertoireStatus(cfg, itemId, status), {
			apply: () => patchWorkRow(itemId, { status }),
			rollback: () => patchWorkRow(itemId, { status: before })
		});
	}

	function handlePinEdition(itemId: string, editionId: string): void {
		if (isOffline) return;
		const cfg = manageCfg();
		const row = findWorkRow(itemId);
		if (!cfg || !row || row.kind !== 'repertoire') return;
		const before = { editionId: row.editionId, editionName: row.editionName };
		const editionName = ev.libraryEditions.find((e) => e.id === editionId)?.name ?? '';
		repertoireQueue.request(itemId, () => actions.pinEdition(cfg, itemId, editionId), {
			apply: () => patchWorkRow(itemId, { editionId, editionName }),
			rollback: () => patchWorkRow(itemId, before)
		});
	}

	function handleRemoveItem(itemId: string): void {
		if (isOffline) return;
		const cfg = manageCfg();
		const row = findWorkRow(itemId);
		if (!cfg || !row) return;
		const index = ev.workRows.findIndex((r) => r.id === itemId);
		if (row.kind === 'program') {
			repertoireQueue.request(itemId, () => actions.deleteProgramItem(cfg, itemId), {
				apply: () => dropWorkRow(itemId),
				rollback: () => restoreWorkRow(index, row)
			});
			return;
		}
		const repertoireBefore = ev.seasonRepertoire;
		repertoireQueue.request(itemId, () => actions.deleteRepertoireItem(cfg, itemId), {
			apply: () => {
				dropWorkRow(itemId);
				ev.seasonRepertoire = ev.seasonRepertoire.filter((item) => item.id !== itemId);
			},
			rollback: () => {
				restoreWorkRow(index, row);
				ev.seasonRepertoire = repertoireBefore;
			}
		});
	}

	function handleMoveItem(itemId: string, direction: 'up' | 'down'): void {
		if (isOffline) return;
		const cfg = manageCfg();
		if (!cfg || !detail) return;
		const items = ev.workRows
			.filter((row) => row.kind === 'program')
			.map((row) => ({ id: row.id, ordinal: row.ordinal ?? 0 }));
		const plan = actions.planProgramMove(items, itemId, direction);
		if (plan.length === 0) return;
		const key = `move:${detail.id}`;
		const before = new Map(
			plan.map((entry) => [entry.id, items.find((i) => i.id === entry.id)?.ordinal ?? 0])
		);
		const after = new Map(plan.map((entry) => [entry.id, entry.ordinal]));
		repertoireQueue.request(key, () => actions.reorderProgramItems(cfg, plan), {
			apply: () => setWorkOrdinals(after),
			rollback: () => setWorkOrdinals(before)
		});
	}

	function handleAddProgramItem(editionId: string, ordinal: number): void {
		if (isOffline) return;
		const cfg = manageCfg();
		if (!cfg || !detail) return;
		const eventIdForProgram = detail.id;
		repertoireQueue.request(ADD_PROGRAMME_KEY, async () => {
			await actions.createProgramItem(cfg, { eventId: eventIdForProgram, editionId, ordinal });
		});
	}

	const editionsByWorkId = $derived.by(() => {
		const map = new Map<string, Edition[]>();
		for (const edition of ev.libraryEditions) {
			const workId = edition.workId ?? '';
			if (workId === '') continue;
			const list = map.get(workId);
			if (list) list.push(edition);
			else map.set(workId, [edition]);
		}
		return map;
	});

	function editionLabel(edition: Edition): string {
		return edition.name || edition.publisher || edition.id;
	}

	const editionOptionsByRowId = $derived.by(() => {
		const out: Record<string, PickerOption[]> = {};
		for (const row of ev.workRows) {
			if (row.kind !== 'repertoire' || row.workId === '') continue;
			const options =
				scopedEditionsByWorkId[row.workId] ??
				(editionsByWorkId.get(row.workId) ?? []).map((edition) => ({
					id: edition.id,
					label: editionLabel(edition)
				}));
			if (options.length > 0) out[row.id] = options;
		}
		return out;
	});

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
		for (const workId of workIds) {
			if (scopedEditionWorkIdsRequested.has(workId)) continue;
			scopedEditionWorkIdsRequested.add(workId);
			actions.listEditions(cfg, workId)
				.then((read) => {
					if (g !== generation()) return;
					if (read.truncated) return;
					scopedEditionsByWorkId = {
						...scopedEditionsByWorkId,
						[workId]: read.items.map((edition) => ({
							id: edition.id,
							label: editionLabel(edition)
						}))
					};
				})
				.catch(() => {
				});
		}
	});

	const pickableEditionsList = $derived.by(() => {
		const workById = new Map(ev.libraryWorks.map((work) => [work.id, work]));
		const programmed = new Set(
			ev.workRows.filter((row) => row.kind === 'program').map((row) => row.editionId)
		);
		return ev.libraryEditions
			.filter((edition) => !programmed.has(edition.id))
			.map((edition) => {
				const work = workById.get(edition.workId ?? '');
				const prefix = work === undefined ? '' : workLabel(work);
				return {
					id: edition.id,
					label: prefix === '' ? editionLabel(edition) : `${prefix} — ${editionLabel(edition)}`
				};
			});
	});

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
			onaddwork={handleAddWork}
			onstatuschange={handleStatusChange}
			onpinedition={handlePinEdition}
			onremoveitem={handleRemoveItem}
			onmoveitem={handleMoveItem}
			onaddprogramitem={handleAddProgramItem}
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
