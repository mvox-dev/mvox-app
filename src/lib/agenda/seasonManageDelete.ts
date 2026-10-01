import { m } from '$lib/paraglide/messages.js';
// deleteErrors.ts's discriminators live in their own module so the page's
// specs can `vi.mock` seasonManage wholesale without breaking them; the
// 'partial-event' case is dead here since the standalone-event delete left.
import {
	isDeleteForbidden,
	isSeriesCascadePartial,
	isSeasonCascadePartial
} from '$lib/seasons/deleteErrors';

export interface SeasonManageDeleteError {
	list: 'series' | 'season';
	reason: 'write' | 'forbidden' | 'partial' | 'partial-season';
	deleted?: number;
	total?: number;
}

export function seasonManageDeleteFailure(
	list: 'series' | 'season',
	reason: unknown
): SeasonManageDeleteError {
	if (isDeleteForbidden(reason)) return { list, reason: 'forbidden' };
	if (list === 'season' && isSeasonCascadePartial(reason)) {
		const partial = reason as { deletedCount?: number; totalCount?: number };
		return {
			list,
			reason: 'partial-season',
			deleted: partial.deletedCount ?? 0,
			total: partial.totalCount ?? 0
		};
	}
	if (isSeriesCascadePartial(reason)) {
		const partial = reason as { deletedCount?: number; totalCount?: number };
		return {
			list,
			reason: 'partial',
			deleted: partial.deletedCount ?? 0,
			total: partial.totalCount ?? 0
		};
	}
	return { list, reason: 'write' };
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
