// #329 (+ review) — the fact/unknown split, at its own seam.
//
// The component and both pages share this predicate precisely so "the row says
// unknown" and "the page owes a scoped read" can never disagree. The table
// below is that agreement, case by case.
import { describe, expect, it } from 'vitest';
import type { PickerOption, WorkRow } from './types';
import {
	pinnedEditionLabel,
	readerEditionUnknown,
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

describe('rowEditionUnknown (the EDITOR feed)', () => {
	// #331 — byte-identical to 25d72cd, and pinned as such. This predicate also
	// drives `pickerPinIsUnknown`, which takes the '' (= unpin) entry out of the
	// picker; relaxing the pin shape here (item 4) would make that removal
	// permanent under a complete read, where `unresolvedEditionWorkIds` owes no
	// scoped read that could ever name the pin. Item 4 ships on
	// `readerEditionUnknown` only — see the suite below.
	it('a COMPLETE read is always a fact, however empty', () => {
		expect(rowEditionUnknown(row(), [], false, NONE)).toBe(false);
		expect(rowEditionUnknown(row({ editionId: 'ed-9' }), [], false, NONE)).toBe(false);
		// ...including a dangling pin on a work that HAS other matched options.
		expect(rowEditionUnknown(row({ editionId: 'ed-9' }), [ED1], false, NONE)).toBe(false);
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

// #331 — the reader's feed. Its third argument is the ROW's own `truncated`
// (`pickableEditionsPartial` reports on a manage read she never triggers), and
// it differs from the editor feed on exactly ONE axis: item 4. Everything else
// must agree, or "the row says unknown" and "the page owes a scoped read" come
// apart — so the shared cases are asserted against BOTH predicates here.
describe('readerEditionUnknown (the READER feed)', () => {
	it('a pin nothing can name is unknown even under a COMPLETE read — a dangling reference is still a pin', () => {
		expect(readerEditionUnknown(row({ editionId: 'ed-9' }), [], false, NONE)).toBe(true);
		// ...including when the work has OTHER matched options: the pin still
		// matches none of them, and rendering it as "nothing pinned" is the
		// same false claim.
		expect(readerEditionUnknown(row({ editionId: 'ed-9' }), [ED1], false, NONE)).toBe(true);
	});

	it('is the ONLY divergence: nothing pinned under a complete read stays a known absence', () => {
		expect(readerEditionUnknown(row(), [], false, NONE)).toBe(false);
		expect(readerEditionUnknown(row(), [ED1], false, NONE)).toBe(false);
	});

	it('a pin we CAN name is a fact either way — by its own name or a matched option', () => {
		for (const truncated of [false, true]) {
			expect(readerEditionUnknown(row({ editionId: 'ed-1' }), [ED1], truncated, NONE)).toBe(false);
			expect(
				readerEditionUnknown(row({ editionId: 'ed-9', editionName: 'Peters' }), [], truncated, NONE)
			).toBe(false);
		}
	});

	// CHARACTERISATION, not a ruling (#337). The `kind !== 'repertoire'` gate is
	// #329's and lives on main; this pins TODAY's behaviour so #331 cannot be read
	// as having settled it. It is a known gap — a program_item's `edition` is a
	// required reference, so "No pinned edition" is false for it too — and #337
	// carries the reader-feed fix, which will replace this expectation.
	it('a program row is never unknown TODAY, dangling pin or not — #337 gap, pinned as-is', () => {
		expect(readerEditionUnknown(row({ kind: 'program', editionId: 'ed-9' }), [], false, NONE)).toBe(
			false
		);
	});

	it('a work the scoped read has answered for is a fact — dangling pin included', () => {
		const resolved = new Set(['work-1']);
		expect(readerEditionUnknown(row({ editionId: 'ed-9' }), [], false, resolved)).toBe(false);
		expect(readerEditionUnknown(row({ editionId: 'ed-9' }), [], true, resolved)).toBe(false);
	});

	it('agrees with the editor feed on every TRUNCATED row — the divergence is complete-read-only', () => {
		const cases: WorkRow[] = [
			row(),
			row({ editionId: 'ed-9' }),
			row({ editionId: 'ed-1' }),
			row({ editionId: 'ed-9', editionName: 'Peters' }),
			row({ kind: 'program' })
		];
		for (const r of cases) {
			for (const options of [[], [ED1]]) {
				expect(readerEditionUnknown(r, options, true, NONE)).toBe(
					rowEditionUnknown(r, options, true, NONE)
				);
			}
		}
	});
});

describe('unresolvedEditionWorkIds', () => {
	it('is empty under a complete read — the ordinary case owes no extra request', () => {
		expect(unresolvedEditionWorkIds([row()], {}, false, NONE)).toEqual([]);
	});

	// #331 — item 4 changes a READER's WORDING for a dangling pin under a
	// complete read, never the read plan ("No new read is issued on any path"):
	// under a COMPLETE collective-wide read every readable edition was already
	// in it, so a scoped re-read can resolve nothing a dangling reference points
	// at. This plan reads the EDITOR feed, which item 4 does not touch at all —
	// so the answer is empty for the plainer reason too.
	it('stays empty under a complete read even for a pin nothing can name — unknown wording owes NO scoped read', () => {
		expect(unresolvedEditionWorkIds([row({ editionId: 'ed-9' })], {}, false, NONE)).toEqual([]);
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
