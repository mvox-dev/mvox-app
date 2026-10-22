import { afterEach, describe, it, expect } from 'vitest';
import type { Copy, Edition, Lending } from '$lib/library/libraryData';
import { deriveWorkAvailability } from '$lib/library/libraryData';
import { createLendingView, formatLoanRange, isOverdue } from './lendingView';
import { resetDeviceClock, setDeviceClock, TALLINN_SUMMER_NIGHT } from '$lib/testing/deviceClock';

const lending = (id: string, copyId: string, returnedAt = ''): Lending => ({
	id,
	copyId,
	memberId: `m-${id}`,
	assignedAt: `2026-09-0${id.length}`,
	assignedUntil: '',
	returnedAt
});
const copy = (id: string, editionId: string): Copy => ({ id, name: id, copyNumber: 1, editionId });
const edition = (id: string, workId: string): Edition => ({
	id,
	name: id,
	publisher: '',
	workId,
	externalLinks: [],
	files: []
});

function setup() {
	return {
		lendings: [] as Lending[],
		allCopies: [copy('c1', 'e1'), copy('c2', 'e1'), copy('c3', 'e2')],
		allEditions: [edition('e1', 'w1'), edition('e2', 'w2')]
	};
}

describe('activeLendingForCopy', () => {
	it('returns the first active lending in array order when a copy has two', () => {
		const lib = setup();
		lib.lendings = [lending('a', 'c1'), lending('bb', 'c1'), lending('ccc', 'c2')];
		const view = createLendingView(lib);
		expect(view.activeLendingForCopy('c1')?.id).toBe('a');
		expect(view.activeLendingForCopy('c2')?.id).toBe('ccc');
	});

	it('skips returned lendings and answers undefined for a copy never lent', () => {
		const lib = setup();
		lib.lendings = [lending('a', 'c1', '2026-09-02'), lending('bb', 'c1')];
		const view = createLendingView(lib);
		expect(view.activeLendingForCopy('c1')?.id).toBe('bb');
		expect(view.activeLendingForCopy('c3')).toBeUndefined();
	});

	it('follows a replaced lendings array', () => {
		const lib = setup();
		lib.lendings = [lending('a', 'c1')];
		const view = createLendingView(lib);
		expect(view.activeLendingForCopy('c1')?.id).toBe('a');
		lib.lendings = [lending('bb', 'c1')];
		expect(view.activeLendingForCopy('c1')?.id).toBe('bb');
		lib.lendings = [];
		expect(view.activeLendingForCopy('c1')).toBeUndefined();
	});
});

describe('workAvailability', () => {
	it('equals deriveWorkAvailability for every work', () => {
		const lib = setup();
		lib.lendings = [lending('a', 'c1'), lending('bb', 'c1'), lending('ccc', 'c3', '2026-09-09')];
		const view = createLendingView(lib);
		for (const workId of ['w1', 'w2', 'w-none']) {
			expect(view.workAvailability(workId)).toEqual(
				deriveWorkAvailability(workId, lib.allEditions, lib.allCopies, lib.lendings)
			);
		}
		expect(view.workAvailability('w1')).toEqual({ available: 1, total: 2 });
	});

	it('follows replaced lendings, copies and editions', () => {
		const lib = setup();
		const view = createLendingView(lib);
		expect(view.workAvailability('w1')).toEqual({ available: 2, total: 2 });
		lib.lendings = [lending('a', 'c2')];
		expect(view.workAvailability('w1')).toEqual({ available: 1, total: 2 });
		lib.allCopies = [...lib.allCopies, copy('c4', 'e1')];
		expect(view.workAvailability('w1')).toEqual({ available: 2, total: 3 });
		lib.allEditions = [edition('e1', 'w2'), edition('e2', 'w2')];
		expect(view.workAvailability('w1')).toEqual({ available: 0, total: 0 });
		expect(view.workAvailability('w2')).toEqual({ available: 3, total: 4 });
	});
});

describe('isOverdue: a loan is due through the last day on the device', () => {
	afterEach(resetDeviceClock);

	it.each([
		['01:30 summer time in Tallinn', TALLINN_SUMMER_NIGHT, 'Europe/Tallinn', '2026-10-20', '2026-10-21'],
		['00:30 winter time in Tallinn', '2026-12-20T22:30:00Z', 'Europe/Tallinn', '2026-12-20', '2026-12-21'],
		['22:30 in New York, a day behind UTC', '2026-10-21T02:30:00Z', 'America/New_York', '2026-10-19', '2026-10-20']
	])('at %s, yesterday is overdue and today is not', (_when, instant, zone, yesterday, today) => {
		setDeviceClock(instant, zone);
		expect(isOverdue(yesterday)).toBe(true);
		expect(isOverdue(today)).toBe(false);
	});
});

describe('formatLoanRange', () => {
	it.each([
		['both dates', '2026-10-01', '2026-10-20', '2026-10-01 – 2026-10-20'],
		['only the start', '2026-10-01', '', '2026-10-01'],
		['only the due date', '', '2026-10-20', 'until 2026-10-20'],
		['neither', '', '', '']
	])('%s', (_case, from, to, shown) => {
		expect(formatLoanRange(from, to)).toBe(shown);
	});
});
