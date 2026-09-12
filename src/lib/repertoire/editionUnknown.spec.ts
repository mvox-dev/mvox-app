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
	readerEditionUnknownReason,
	rowEditionUnknown,
	unresolvedEditionWorkIds
} from './editionUnknown';
import * as editionUnknownModule from './editionUnknown';

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

/** #337 — the triggering shape, byte-for-byte what workRows.spec.ts's 'falls
 *  back to the item name and blanks the join when the edition is unreadable'
 *  fence pins as `buildWorkRows`' program-branch output when the
 *  collective-wide edition read did not carry the item's edition: the REQUIRED
 *  `editionId` survives off the program_item itself, everything joined through
 *  the edition (workId, editionName) degrades to ''. */
function programRow(overrides: Partial<WorkRow> = {}): WorkRow {
	return row({
		id: 'pi-9',
		kind: 'program',
		workId: '',
		editionId: 'ed-gone',
		workName: 'Ghost piece',
		composer: '',
		status: null,
		ordinal: 1,
		...overrides
	});
}

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

	// #337 fence — the reader-feed change is WORDING ONLY. This feed also gates
	// `pickerPinIsUnknown` and `unresolvedEditionWorkIds`; a program row must
	// never reach either, pin or no pin, truncated or not.
	it('stays SHUT for a program row holding an unnameable pin — #337 touches the reader feed only', () => {
		for (const truncated of [false, true]) {
			expect(rowEditionUnknown(programRow(), [], truncated, NONE)).toBe(false);
			expect(rowEditionUnknown(programRow(), [ED1], truncated, NONE)).toBe(false);
		}
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

	// #337 — replaces the characterisation this suite carried ('a program row is
	// never unknown TODAY, dangling pin or not'). A program_item's `edition` is a
	// REQUIRED reference, so a program row with `editionId` set whose label
	// nothing resolves holds a real pin the read could not name — "No pinned
	// edition" is a claim that row cannot express. Unknown under BOTH truncation
	// states: this is the same unnameable-pin branch item 4 opened for the
	// reader, and that branch never needed truncation.
	it("a program row's unnameable pin is UNKNOWN for a reader, truncated or not (#337)", () => {
		for (const truncated of [false, true]) {
			expect(readerEditionUnknown(programRow(), [], truncated, NONE)).toBe(true);
			// ...including when the row somehow has matched options: the pin still
			// matches none of them, same rule as the repertoire pin shape.
			expect(readerEditionUnknown(programRow(), [ED1], truncated, NONE)).toBe(true);
		}
	});

	// #337 fence — a program row with NO editionId IS producible (`edition` is
	// schema-required, but `mandatory: true` is a soft UI hint in Entu, and
	// listProgramItems fabricates '' for an absent/unread reference instead of
	// dropping the item the way listRepertoireItems drops a work-less one), and
	// it must still NOT take the zero-options unknown shape on either feed: that
	// shape asks "is anything pinned?", a question a program row cannot pose.
	// A chosen rule, not an impossibility claim.
	it('a program row with no editionId never takes the zero-options shape, on either feed', () => {
		for (const truncated of [false, true]) {
			expect(readerEditionUnknown(programRow({ editionId: '' }), [], truncated, NONE)).toBe(false);
			expect(rowEditionUnknown(programRow({ editionId: '' }), [], truncated, NONE)).toBe(false);
		}
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

// #342 — WHY a reader's row is unknown, at the same seam. The wording split
// (truncated names incompleteness; a dangling pin does not) needs the render
// site to tell the two states apart, and #342's amendment put that
// discriminator in scope: `readerEditionUnknownReason` returns 'truncated' |
// 'dangling' | null with `readerEditionUnknown`'s EXACT wiring, so the boolean
// and the reason can never diverge. It reports a distinction #329/#331/#337
// already make — never a new one: every case below is a row those rulings
// already call unknown (or a fact), only now the unknown says which kind.
describe('readerEditionUnknownReason (#342 — the READER feed, with a reason)', () => {
	it("a pin nothing can name under a TRUNCATED read is 'truncated' — incompleteness is a true claim there", () => {
		expect(readerEditionUnknownReason(row({ editionId: 'ed-9' }), [], true, NONE)).toBe(
			'truncated'
		);
		expect(readerEditionUnknownReason(row({ editionId: 'ed-9' }), [ED1], true, NONE)).toBe(
			'truncated'
		);
	});

	it("a pin nothing can name under a COMPLETE read is 'dangling' — nothing is incomplete, and nothing resolves it (#331 item 4's shape)", () => {
		expect(readerEditionUnknownReason(row({ editionId: 'ed-9' }), [], false, NONE)).toBe(
			'dangling'
		);
		// ...including when the work has OTHER matched options: the pin still
		// matches none of them.
		expect(readerEditionUnknownReason(row({ editionId: 'ed-9' }), [ED1], false, NONE)).toBe(
			'dangling'
		);
	});

	it("the zero-options shape is 'truncated' or null, NEVER 'dangling' — it requires truncation to fire at all", () => {
		// Truncated, nothing pinned, zero options: the unknown that IS about an
		// incomplete list.
		expect(readerEditionUnknownReason(row(), [], true, NONE)).toBe('truncated');
		// Complete, nothing pinned: a known absence — null, not a reason.
		expect(readerEditionUnknownReason(row(), [], false, NONE)).toBe(null);
		expect(readerEditionUnknownReason(row(), [ED1], false, NONE)).toBe(null);
		// The sweep: no editionId === '' case may ever come back 'dangling' — a
		// dangling REFERENCE needs a reference.
		for (const options of [[], [ED1]] as const) {
			for (const truncated of [false, true]) {
				for (const resolved of [NONE, new Set(['work-1'])]) {
					expect(
						readerEditionUnknownReason(row(), [...options], truncated, resolved)
					).not.toBe('dangling');
					expect(
						readerEditionUnknownReason(programRow({ editionId: '' }), [...options], truncated, resolved)
					).not.toBe('dangling');
				}
			}
		}
	});

	it("a PROGRAM row's unnameable pin takes the same two reasons through the #337 gate", () => {
		expect(readerEditionUnknownReason(programRow(), [], true, NONE)).toBe('truncated');
		expect(readerEditionUnknownReason(programRow(), [ED1], true, NONE)).toBe('truncated');
		expect(readerEditionUnknownReason(programRow(), [], false, NONE)).toBe('dangling');
		expect(readerEditionUnknownReason(programRow(), [ED1], false, NONE)).toBe('dangling');
	});

	it('a stated fact has NO reason — nameable pins and answered works are null either way', () => {
		for (const truncated of [false, true]) {
			expect(readerEditionUnknownReason(row({ editionId: 'ed-1' }), [ED1], truncated, NONE)).toBe(
				null
			);
			expect(
				readerEditionUnknownReason(
					row({ editionId: 'ed-9', editionName: 'Peters' }),
					[],
					truncated,
					NONE
				)
			).toBe(null);
			expect(
				readerEditionUnknownReason(row({ editionId: 'ed-9' }), [], truncated, new Set(['work-1']))
			).toBe(null);
		}
	});

	it('the EDITOR feed has NO reason surface — its step-4 collapse to bare `partial` cannot produce dangling', () => {
		// The export set is the assertion: exactly ONE reason function exists in
		// this module, and it is the reader's. No `rowEditionUnknownReason`, no
		// editor variant under any name.
		const reasonExports = Object.keys(editionUnknownModule).filter((name) =>
			/reason/i.test(name)
		);
		expect(reasonExports).toEqual(['readerEditionUnknownReason']);
	});

	it('the boolean wrapper is byte-identical to `reason !== null` — the shim can never diverge', () => {
		const rows: WorkRow[] = [
			row(),
			row({ editionId: 'ed-9' }),
			row({ editionId: 'ed-1' }),
			row({ editionId: 'ed-9', editionName: 'Peters' }),
			row({ kind: 'program' }),
			programRow(),
			programRow({ editionId: '' })
		];
		for (const r of rows) {
			for (const options of [[], [ED1]] as const) {
				for (const truncated of [false, true]) {
					for (const resolved of [NONE, new Set(['work-1'])]) {
						expect(readerEditionUnknown(r, [...options], truncated, resolved)).toBe(
							readerEditionUnknownReason(r, [...options], truncated, resolved) !== null
						);
					}
				}
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

	// #337 fence — "No new read on any path": a program row's unknown wording
	// never puts a work id on the scoped-read plan. Doubly shut: this plan reads
	// the EDITOR feed (which stays closed to program rows), and the producible
	// unknown program row has `workId: ''` anyway (the work is joined THROUGH
	// the edition the read could not carry).
	it('a program row never adds to the read plan, however unknown its pin', () => {
		expect(unresolvedEditionWorkIds([programRow()], {}, true, NONE)).toEqual([]);
	});
});

// (*MVOX:Josquin* — #329 review)
// (*MVOX:Tallis* — #337 RED: the program-row characterisation replaced with
// the reader rule; editor-feed and zero-options fences pinned)
// (*MVOX:Tallis* — #342 RED: readerEditionUnknownReason — truncated vs
// dangling, boolean shim pinned byte-identical)
