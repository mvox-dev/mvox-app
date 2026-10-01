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
