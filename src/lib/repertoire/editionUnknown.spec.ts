// #329 (+ review) — the fact/unknown split, at its own seam.
//
// The component and both pages share this predicate precisely so "the row says
// unknown" and "the page owes a scoped read" can never disagree. The table
// below is that agreement, case by case.
import { describe, expect, it } from 'vitest';
import type { PickerOption, WorkRow } from './types';
import {
	pinnedEditionLabel,
	rowEditionUnknown,
	unresolvedEditionWorkIds
} from './editionUnknown';

const NONE: ReadonlySet<string> = new Set<string>();

function row(overrides: Partial<WorkRow> = {}): WorkRow {
	return {
		id: 'ri-1',
		kind: 'repertoire',
		workId: 'work-1',
		editionId: '',
		workName: 'Old warhorse',
		composer: 'Anon.',
		status: 'active',
		editionName: '',
		ordinal: null,
		fileId: '',
		externalLinks: [],
		canBorrow: false,
		notes: '',
		...overrides
	};
}

const ED1: PickerOption = { id: 'ed-1', label: '40-part original' };

describe('pinnedEditionLabel', () => {
	it("prefers the row's own resolved name", () => {
		expect(pinnedEditionLabel(row({ editionId: 'ed-1', editionName: 'Bärenreiter' }), [ED1])).toBe(
			'Bärenreiter'
		);
	});

	it('falls back to the matched option — how a scoped read names a pin the join could not', () => {
		expect(pinnedEditionLabel(row({ editionId: 'ed-1' }), [ED1])).toBe('40-part original');
	});

	it("is '' when nothing is pinned, and '' when the pin matches nothing", () => {
		expect(pinnedEditionLabel(row(), [ED1])).toBe('');
		expect(pinnedEditionLabel(row({ editionId: 'ed-9' }), [ED1])).toBe('');
	});
});

describe('rowEditionUnknown', () => {
	it('a COMPLETE read is always a fact, however empty', () => {
		expect(rowEditionUnknown(row(), [], false, NONE)).toBe(false);
		expect(rowEditionUnknown(row({ editionId: 'ed-9' }), [], false, NONE)).toBe(false);
	});

	it('truncated + zero options + nothing pinned = unknown, not a known absence', () => {
		expect(rowEditionUnknown(row(), [], true, NONE)).toBe(true);
	});

	it('truncated + a pin nothing can name = unknown, EVEN with other options matched', () => {
		// Review finding 3: keying on "the work has zero options" alone missed
		// this row entirely — it fell through to a picker whose unmatched value
		// displays as "nothing pinned".
		expect(rowEditionUnknown(row({ editionId: 'ed-9' }), [ED1], true, NONE)).toBe(true);
	});

	it('a pin we CAN name is a fact — truncation poisons negatives, never positives', () => {
		expect(rowEditionUnknown(row({ editionId: 'ed-1' }), [ED1], true, NONE)).toBe(false);
		expect(
			rowEditionUnknown(row({ editionId: 'ed-9', editionName: 'Peters' }), [], true, NONE)
		).toBe(false);
	});

	it('nothing pinned but options present is a fact: `editionId` is read off the item, not the join', () => {
		expect(rowEditionUnknown(row(), [ED1], true, NONE)).toBe(false);
	});

	it('a work the scoped read has answered for is a fact either way', () => {
		const resolved = new Set(['work-1']);
		expect(rowEditionUnknown(row(), [], true, resolved)).toBe(false);
		expect(rowEditionUnknown(row({ editionId: 'ed-9' }), [], true, resolved)).toBe(false);
	});

	it('a program row is never in this state — it carries no pin control at all', () => {
		expect(rowEditionUnknown(row({ kind: 'program' }), [], true, NONE)).toBe(false);
	});
});

describe('unresolvedEditionWorkIds', () => {
	it('is empty under a complete read — the ordinary case owes no extra request', () => {
		expect(unresolvedEditionWorkIds([row()], {}, false, NONE)).toEqual([]);
	});

	it('names each unknown row\'s work ONCE, however many rows share it', () => {
		const rows = [
			row({ id: 'ri-1' }),
			row({ id: 'ri-2' }),
			row({ id: 'ri-3', workId: 'work-2', editionId: 'ed-9' })
		];
		expect(unresolvedEditionWorkIds(rows, { 'ri-3': [ED1] }, true, NONE)).toEqual([
			'work-1',
			'work-2'
		]);
	});

	it('skips rows that are already facts, and works already answered for', () => {
		const rows = [row({ id: 'ri-1', editionId: 'ed-1' }), row({ id: 'ri-2', workId: 'work-2' })];
		expect(
			unresolvedEditionWorkIds(rows, { 'ri-1': [ED1] }, true, new Set(['work-2']))
		).toEqual([]);
	});

	it('skips a row with no resolvable work — there is no scoped read to make for it', () => {
		expect(unresolvedEditionWorkIds([row({ workId: '' })], {}, true, NONE)).toEqual([]);
	});
});

// (*MVOX:Josquin* — #329 review)
