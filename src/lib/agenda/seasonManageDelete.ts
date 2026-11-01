import { m } from '$lib/paraglide/messages.js';
import type { CollectiveIdentity } from '$lib/collectives/store';
import { reportProblem } from '$lib/problems/reportProblem';
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

const SEASON_DELETE_ID_PREFIX = '__season__:';

export const seasonDeleteRowId = (seasonId: string): string => `${SEASON_DELETE_ID_PREFIX}${seasonId}`;

/** True while a season delete runs; series deletes share the slot but do not count. */
export function isSeasonDeletePending(pendingId: string | null): boolean {
	return pendingId !== null && pendingId.startsWith(SEASON_DELETE_ID_PREFIX);
}

export interface SeasonManageDeleteSlot {
	pendingId: string | null;
	error: SeasonManageDeleteError | null;
	progress: { current: number; total: number } | null;
	whileCurrent(): () => boolean;
}

const DELETED = { season: 'a season', series: 'an event series' } as const;

export function runSeasonManageDelete<T>({
	slot,
	rowId,
	owner,
	list,
	call,
	onDone
}: {
	slot: SeasonManageDeleteSlot;
	rowId: string;
	owner: CollectiveIdentity | null;
	list: 'series' | 'season';
	call: (onProgress: (current: number, total: number) => void) => Promise<T>;
	onDone: (result: T) => void;
}): void {
	slot.error = null;
	slot.progress = null;
	slot.pendingId = rowId;
	const isDeleteCurrent = slot.whileCurrent();
	call((current, total) => {
		if (isDeleteCurrent()) slot.progress = { current, total };
	})
		.then((result) => {
			if (isDeleteCurrent()) onDone(result);
		})
		.catch((e) => {
			reportProblem({ area: 'agenda', action: `deleting ${DELETED[list]}`, error: e, owner });
			if (isDeleteCurrent()) slot.error = seasonManageDeleteFailure(list, e);
		})
		.finally(() => {
			if (!isDeleteCurrent()) return;
			slot.pendingId = null;
			slot.progress = null;
		});
}
