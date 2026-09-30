import {
	activeLendingForMemberInEdition,
	deriveCopyAvailability,
	deriveEditionAvailability,
	deriveWorkAvailability,
	type CopyAvailability,
	type Lending
} from '$lib/library/libraryData';
import type { LibraryState } from '$lib/library/libraryState';
import { isoDateFormatter } from '$lib/preferences/timeFormat';

// Lending dates are tabular: the ISO date in UTC, so a date-only value never slides a day.
const dateFmt = isoDateFormatter('UTC');

export function formatDate(isoDate: string): string {
	if (!isoDate) return '';
	return dateFmt.format(new Date(isoDate));
}

export function isOverdue(assignedUntil: string): boolean {
	if (!assignedUntil) return false;
	const today = new Date().toISOString().slice(0, 10);
	return assignedUntil < today;
}

export interface Availability {
	available: number;
	total: number;
}

/** Lending reads over the page's state. Each call reads the state when it runs, so a
 *  component calling one from its template stays reactive. */
export interface LendingView {
	activeLendingForCopy(copyId: string): Lending | undefined;
	copyAvailability(copyId: string): CopyAvailability;
	workAvailability(workId: string): Availability;
	editionAvailability(editionId: string): Availability;
	editionCopyIds(editionId: string): Set<string>;
	memberLending(memberId: string, copyIds: Set<string>): Lending | undefined;
}

export function createLendingView(
	lib: Pick<LibraryState, 'lendings' | 'allCopies' | 'allEditions'>
): LendingView {
	return {
		activeLendingForCopy: (copyId) =>
			lib.lendings.find((l) => l.copyId === copyId && l.returnedAt === ''),
		copyAvailability: (copyId) => deriveCopyAvailability(copyId, lib.lendings),
		workAvailability: (workId) =>
			deriveWorkAvailability(workId, lib.allEditions, lib.allCopies, lib.lendings),
		editionAvailability: (editionId) =>
			deriveEditionAvailability(editionId, lib.allCopies, lib.lendings),
		editionCopyIds: (editionId) =>
			new Set(lib.allCopies.filter((c) => c.editionId === editionId).map((c) => c.id)),
		memberLending: (memberId, copyIds) =>
			activeLendingForMemberInEdition(memberId, copyIds, lib.lendings)
	};
}
