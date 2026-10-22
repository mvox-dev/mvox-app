import {
	activeLendingForMemberInEdition,
	deriveCopyAvailability,
	deriveEditionAvailability,
	isActiveLending,
	type Copy,
	type CopyAvailability,
	type Edition,
	type Lending
} from '$lib/library/libraryData';
import type { LibraryState } from '$lib/library/libraryState';
import { m } from '$lib/paraglide/messages.js';
import { isoDateFormatter, localDayKey } from '$lib/preferences/timeFormat';

// Lending dates are tabular: the ISO date in UTC, so a date-only value never slides a day.
const dateFmt = isoDateFormatter('UTC');

export function formatDate(isoDate: string): string {
	if (!isoDate) return '';
	return dateFmt.format(new Date(isoDate));
}

export function isOverdue(assignedUntil: string): boolean {
	if (!assignedUntil) return false;
	return assignedUntil < localDayKey(new Date());
}

export function formatLoanRange(from: string, to: string): string {
	if (from && to) return m.library_loan_range({ from: formatDate(from), to: formatDate(to) });
	if (to) return m.library_loan_until({ date: formatDate(to) });
	return formatDate(from);
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

// Array order, first wins: the same answer `.find` gave when a copy has two active lendings.
function activeLendingByCopy(lendings: Lending[]): Map<string, Lending> {
	const byCopy = new Map<string, Lending>();
	for (const l of lendings) {
		if (isActiveLending(l) && !byCopy.has(l.copyId)) byCopy.set(l.copyId, l);
	}
	return byCopy;
}

function availabilityByWork(
	editions: Edition[],
	copies: Copy[],
	lendings: Lending[]
): Map<string, Availability> {
	const worksOfEdition = new Map<string, Set<string>>();
	for (const e of editions) {
		if (e.workId === undefined) continue;
		const works = worksOfEdition.get(e.id) ?? new Set<string>();
		works.add(e.workId);
		worksOfEdition.set(e.id, works);
	}
	const lentCopyIds = new Set(lendings.filter(isActiveLending).map((l) => l.copyId));
	const byWork = new Map<string, Availability>();
	for (const c of copies) {
		for (const workId of worksOfEdition.get(c.editionId) ?? []) {
			const tally = byWork.get(workId) ?? { available: 0, total: 0 };
			tally.total += 1;
			if (!lentCopyIds.has(c.id)) tally.available += 1;
			byWork.set(workId, tally);
		}
	}
	return byWork;
}

// Rebuilt when the array it was built from is replaced: every writer reassigns, none mutates.
function memo<A extends unknown[], R>(build: (...args: A) => R): (...args: A) => R {
	let last: { args: A; value: R } | undefined;
	return (...args) => {
		if (last && last.args.every((a, i) => a === args[i])) return last.value;
		last = { args, value: build(...args) };
		return last.value;
	};
}

export function createLendingView(
	lib: Pick<LibraryState, 'lendings' | 'allCopies' | 'allEditions'>
): LendingView {
	const lendingByCopy = memo(activeLendingByCopy);
	const workTally = memo(availabilityByWork);
	return {
		activeLendingForCopy: (copyId) => lendingByCopy(lib.lendings).get(copyId),
		copyAvailability: (copyId) => deriveCopyAvailability(copyId, lib.lendings),
		workAvailability: (workId) => {
			const tally = workTally(lib.allEditions, lib.allCopies, lib.lendings).get(workId);
			return tally ? { ...tally } : { available: 0, total: 0 };
		},
		editionAvailability: (editionId) =>
			deriveEditionAvailability(editionId, lib.allCopies, lib.lendings),
		editionCopyIds: (editionId) =>
			new Set(lib.allCopies.filter((c) => c.editionId === editionId).map((c) => c.id)),
		memberLending: (memberId, copyIds) =>
			activeLendingForMemberInEdition(memberId, copyIds, lib.lendings)
	};
}
