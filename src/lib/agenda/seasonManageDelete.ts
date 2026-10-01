import { m } from '$lib/paraglide/messages.js';
import { classifyDeleteFailure, type DeleteFailure } from '$lib/seasons/deleteErrors';

export interface SeasonManageDeleteError extends DeleteFailure {
	list: 'series' | 'season';
}

export function seasonManageDeleteFailure(
	list: 'series' | 'season',
	reason: unknown
): SeasonManageDeleteError {
	return { list, ...classifyDeleteFailure(list, reason) };
}

export function seasonManageDeleteErrorText(failure: SeasonManageDeleteError): string {
	switch (failure.reason) {
		case 'forbidden':
			return m.season_manage_delete_forbidden();
		case 'partial':
			return m.season_manage_delete_partial({
				deleted: failure.deleted ?? 0,
				total: failure.total ?? 0
			});
		case 'partial-season':
			return m.season_manage_season_delete_partial({
				deleted: failure.deleted ?? 0,
				total: failure.total ?? 0
			});
		default:
			return m.season_manage_delete_error();
	}
}

export interface SeasonManageDeleteSlot {
	pendingId: string | null;
	error: SeasonManageDeleteError | null;
	progress: { current: number; total: number } | null;
	readonly generation: number;
}

const DELETE_LOG_NAME = { season: 'season', series: 'event series' } as const;

export function runSeasonManageDelete<T>({
	slot,
	rowId,
	list,
	call,
	onDone
}: {
	slot: SeasonManageDeleteSlot;
	rowId: string;
	list: 'series' | 'season';
	call: (onProgress: (current: number, total: number) => void) => Promise<T>;
	onDone: (result: T) => void;
}): void {
	slot.error = null;
	slot.progress = null;
	slot.pendingId = rowId;
	const generation = slot.generation;
	call((current, total) => {
		if (generation === slot.generation) slot.progress = { current, total };
	})
		.then((result) => {
			if (generation === slot.generation) onDone(result);
		})
		.catch((e) => {
			console.error(`agenda: deleting ${DELETE_LOG_NAME[list]} failed`, rowId, e);
			if (generation === slot.generation) slot.error = seasonManageDeleteFailure(list, e);
		})
		.finally(() => {
			slot.pendingId = null;
			if (generation === slot.generation) slot.progress = null;
		});
}
