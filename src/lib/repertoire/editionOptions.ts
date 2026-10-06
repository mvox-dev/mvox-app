// Edition picker options for repertoire rows, shared by the agenda and the event page.
import type { ListRead } from '$lib/entu/listRead';
import type { Edition, Work } from '$lib/library/libraryData';
import type { PickerOption, WorkRow } from '$lib/repertoire/types';
import { reportProblem } from '$lib/problems/reportProblem';
import { workLabel } from '$lib/repertoire/workLabel';

export function editionsByWorkId(editions: readonly Edition[]): Map<string, Edition[]> {
	const map = new Map<string, Edition[]>();
	for (const edition of editions) {
		const workId = edition.workId ?? '';
		if (workId === '') continue;
		const list = map.get(workId);
		if (list) list.push(edition);
		else map.set(workId, [edition]);
	}
	return map;
}

export function editionLabel(edition: Edition): string {
	return edition.name || edition.publisher || edition.id;
}

export function editionOptionsByRowId(
	rows: Iterable<WorkRow>,
	scopedEditionsByWorkId: Record<string, PickerOption[]>,
	byWorkId: Map<string, Edition[]>
): Record<string, PickerOption[]> {
	const out: Record<string, PickerOption[]> = {};
	for (const row of rows) {
		if (row.kind !== 'repertoire' || row.workId === '' || out[row.id]) continue;
		const options =
			scopedEditionsByWorkId[row.workId] ??
			(byWorkId.get(row.workId) ?? []).map((edition) => ({
				id: edition.id,
				label: editionLabel(edition)
			}));
		if (options.length > 0) out[row.id] = options;
	}
	return out;
}

export function pickableEditionOptions(
	works: readonly Work[],
	editions: readonly Edition[]
): PickerOption[] {
	const workById = new Map(works.map((work) => [work.id, work]));
	return editions.map((edition) => {
		const work = workById.get(edition.workId ?? '');
		const prefix = work === undefined ? '' : workLabel(work);
		return {
			id: edition.id,
			label: prefix === '' ? editionLabel(edition) : `${prefix} — ${editionLabel(edition)}`
		};
	});
}

export function withoutProgrammed(options: PickerOption[], rows: readonly WorkRow[]): PickerOption[] {
	const programmed = new Set(rows.filter((row) => row.kind === 'program').map((row) => row.editionId));
	return options.filter((option) => !programmed.has(option.id));
}

export function readScopedEditions(
	workIds: readonly string[],
	requested: Set<string>,
	listEditions: (workId: string) => Promise<ListRead<Edition>>,
	isCurrent: () => boolean,
	onOptions: (workId: string, options: PickerOption[]) => void
): void {
	for (const workId of workIds) {
		if (requested.has(workId)) continue;
		requested.add(workId);
		listEditions(workId)
			.then((read) => {
				if (!isCurrent()) return;
				if (read.truncated) return;
				onOptions(
					workId,
					read.items.map((edition) => ({ id: edition.id, label: editionLabel(edition) }))
				);
			})
			.catch((e) => {
				if (isCurrent()) {
					reportProblem({ area: 'repertoire', action: 'loading the editions of a work', error: e });
				}
			});
	}
}
