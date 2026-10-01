import { manageRightsFrom } from '$lib/repertoire/repertoireActions';
import type { ManageRightsState } from '$lib/repertoire/types';

export function manageRightsOrNone(
	entityId: string | null,
	owners: readonly string[],
	editors: readonly string[],
	personId: string
): ManageRightsState {
	return entityId === null ? 'not-editor' : manageRightsFrom(owners, editors, personId);
}
