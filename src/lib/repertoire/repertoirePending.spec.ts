import { describe, expect, it } from 'vitest';
import { createPendingMarks, mergePendingRows } from './repertoirePending';
import type { WorkRow } from './types';

function row(id: string, kind: WorkRow['kind'], ordinal: number | null): WorkRow {
	return {
		id,
		kind,
		workId: '',
		editionId: '',
		workName: id,
		composer: '',
		status: null,
		editionName: '',
		ordinal,
		fileId: '',
		fileName: '',
		externalLinks: [],
		canBorrow: false,
		notes: ''
	};
}

describe('createPendingMarks', () => {
	it('a move marks its rows pending with the key, and clears them all', () => {
		const marks = createPendingMarks(() => 'a');
		marks.mark('move:ev', ['p1', 'p2']);
		const on = marks.setPending(new Set(['other']), 'move:ev', true);
		expect(on).toEqual(new Set(['other', 'move:ev', 'p1', 'p2']));
		expect(marks.setPending(on, 'move:ev', false)).toEqual(new Set(['other']));
	});

	it('a settle after the context changed is stale, and pending still clears', () => {
		let context = 'a';
		const marks = createPendingMarks(() => context);
		marks.mark('move:ev', ['p1']);
		const on = marks.setPending(new Set(), 'move:ev', true);
		context = 'b';
		expect(marks.isCurrent('move:ev')).toBe(false);
		expect(marks.setPending(on, 'move:ev', false)).toEqual(new Set());
		expect(marks.settle('move:ev')).toBe(false);
	});

	it('a settle in the same context is current, once', () => {
		const marks = createPendingMarks(() => ({ db: 'x' }), (a, b) => a.db === b.db);
		marks.setPending(new Set(), 'k', true);
		expect(marks.isCurrent('k')).toBe(true);
		expect(marks.settle('k')).toBe(true);
		expect(marks.isCurrent('k')).toBe(false);
	});
});

describe('mergePendingRows', () => {
	const live = [row('p2', 'program', 0), row('p1', 'program', 1)];

	it('keeps the on-screen rows a pending reorder covers and shows a freshly added row', () => {
		const fresh = [row('p1', 'program', 0), row('p2', 'program', 1), row('p3', 'program', 2)];
		const merged = mergePendingRows(fresh, live, (key) => key === 'move:ev', 'ev');
		expect(merged).toEqual([row('p1', 'program', 1), row('p2', 'program', 0), row('p3', 'program', 2)]);
	});

	it('leaves out a row whose remove is pending', () => {
		const fresh = [row('r1', 'repertoire', null), row('r2', 'repertoire', null)];
		const merged = mergePendingRows(fresh, [row('r2', 'repertoire', null)], (key) => key === 'r1', 'ev');
		expect(merged).toEqual([row('r2', 'repertoire', null)]);
	});

	it('takes the read as is when nothing is pending', () => {
		const fresh = [row('p1', 'program', 0), row('p2', 'program', 1)];
		expect(mergePendingRows(fresh, live, () => false, 'ev')).toEqual(fresh);
	});
});
