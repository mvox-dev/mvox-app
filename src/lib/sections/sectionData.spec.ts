import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { RosterRow } from '$lib/roster/rosterData';
import {
	listSections,
	groupBySection,
	type SectionNode,
	type SectionGroup
} from './sectionData';

// TS.1/#95 RED — the section data layer. `sectionData.ts`'s exports are stubs that
// throw 'not implemented', so every assertion below FAILS until GREEN.
//
// Contract under test (see sectionData.ts module header):
//   - listSections: section entities → recursive tree, display_order-sorted at
//     every level, FAIL LOUD when any fetched section can't be placed in the tree.
//   - groupBySection: PURE rows+tree → pre-order flat group list with depth,
//     recursive member counts, every section emitted (empty included),
//     'Unassigned' last and only when non-empty.

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

/** Raw wire-shape section entity. `parent` = parent SECTION id; omitted → org-parented (root). */
function rawSection(id: string, name: string, order?: number, parent?: string) {
	return {
		_id: id,
		name: [{ string: name }],
		...(order === undefined ? {} : { display_order: [{ number: order }] }),
		_parent: parent
			? [{ reference: parent, entity_type: 'section' }]
			: [{ reference: 'org-1', entity_type: 'organization' }]
	};
}

// ── listSections — recursive tree, sorted by display_order ─────────────────────

describe('listSections — parses section entities into a recursive tree sorted by display_order', () => {
	it('URL: _type.string=section, props=name,display_order,_parent, an explicit limit', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await listSections(cfg, fetchImpl);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=section');
		expect(url).toContain('props=name,display_order,_parent');
		expect(url).toMatch(/limit=\d+/);
	});

	it('flat case — two org-parented sections arrive out of order → returned sorted by display_order, full SectionNode shape', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [rawSection('sec-alto', 'Alto', 2), rawSection('sec-sop', 'Soprano', 1)]
			})
		);
		const tree = await listSections(cfg, fetchImpl);
		expect(tree).toEqual<SectionNode[]>([
			{
				id: 'sec-sop',
				name: 'Soprano',
				displayOrder: 1,
				parentId: null,
				orgId: 'org-1',
				depth: 0,
				children: []
			},
			{
				id: 'sec-alto',
				name: 'Alto',
				displayOrder: 2,
				parentId: null,
				orgId: 'org-1',
				depth: 0,
				children: []
			}
		]);
	});

	it('recursive nesting — sub-sections nest under their parent (depth 1) and sub-sub-sections under those (depth 2), each level display_order-sorted', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					// Deliberately shuffled: children before parents, out of display order.
					rawSection('sec-sop2', 'Soprano 2', 2, 'sec-sop'),
					rawSection('sec-sop1a', 'Soprano 1a', 1, 'sec-sop1'),
					rawSection('sec-alto', 'Alto', 2),
					rawSection('sec-sop1', 'Soprano 1', 1, 'sec-sop'),
					rawSection('sec-sop', 'Soprano', 1)
				]
			})
		);
		const tree = await listSections(cfg, fetchImpl);
		expect(tree).toEqual<SectionNode[]>([
			{
				id: 'sec-sop',
				name: 'Soprano',
				displayOrder: 1,
				parentId: null,
				orgId: 'org-1',
				depth: 0,
				children: [
					{
						id: 'sec-sop1',
						name: 'Soprano 1',
						displayOrder: 1,
						parentId: 'sec-sop',
						orgId: null,
						depth: 1,
						children: [
							{
								id: 'sec-sop1a',
								name: 'Soprano 1a',
								displayOrder: 1,
								parentId: 'sec-sop1',
								orgId: null,
								depth: 2,
								children: []
							}
						]
					},
					{
						id: 'sec-sop2',
						name: 'Soprano 2',
						displayOrder: 2,
						parentId: 'sec-sop',
						orgId: null,
						depth: 1,
						children: []
					}
				]
			},
			{
				id: 'sec-alto',
				name: 'Alto',
				displayOrder: 2,
				parentId: null,
				orgId: 'org-1',
				depth: 0,
				children: []
			}
		]);
	});

	it('missing display_order → Infinity, sorts LAST within its level; equal orders tie-break by name', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					rawSection('sec-c', 'Chorus C'), // no display_order
					rawSection('sec-a', 'Alto', 1),
					rawSection('sec-b', 'Bass') // no display_order — name decides vs Chorus C
				]
			})
		);
		const tree = await listSections(cfg, fetchImpl);
		expect(tree).toEqual<SectionNode[]>([
			{
				id: 'sec-a',
				name: 'Alto',
				displayOrder: 1,
				parentId: null,
				orgId: 'org-1',
				depth: 0,
				children: []
			},
			{
				id: 'sec-b',
				name: 'Bass',
				displayOrder: Number.POSITIVE_INFINITY,
				parentId: null,
				orgId: 'org-1',
				depth: 0,
				children: []
			},
			{
				id: 'sec-c',
				name: 'Chorus C',
				displayOrder: Number.POSITIVE_INFINITY,
				parentId: null,
				orgId: 'org-1',
				depth: 0,
				children: []
			}
		]);
	});

	// TU.1/#109 review — the org must SURVIVE the parse. Live polyphony holds 16
	// sections across four test orgs, all org-parented: with the org discarded
	// they were one indistinguishable set of "siblings", which is what made the
	// picker refuse a top-level name that only exists in another org.
	it("carries each root's OWNING ORG (`_parent` entity_type 'organization'); a sub-section, being section-parented, has orgId null", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					// EFK's root + its child, and another org's same-named root.
					{
						_id: 'sec-efk-sop',
						name: [{ string: 'Soprano' }],
						display_order: [{ number: 1 }],
						_parent: [{ reference: 'org-efk', entity_type: 'organization' }]
					},
					{
						_id: 'sec-efk-sop2',
						name: [{ string: 'Soprano II' }],
						display_order: [{ number: 2 }],
						_parent: [{ reference: 'sec-efk-sop', entity_type: 'section' }]
					},
					{
						_id: 'sec-sireen-sop',
						name: [{ string: 'Soprano' }],
						display_order: [{ number: 3 }],
						_parent: [{ reference: 'org-sireen', entity_type: 'organization' }]
					}
				]
			})
		);
		const tree = await listSections(cfg, fetchImpl);
		expect(tree.map((n) => [n.id, n.orgId])).toEqual([
			['sec-efk-sop', 'org-efk'],
			['sec-sireen-sop', 'org-sireen']
		]);
		expect(tree[0].children[0].orgId).toBeNull();
	});

	it('fails loud on a non-2xx response, with the status surfaced', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		await expect(listSections(cfg, fetchImpl)).rejects.toThrow(/500/);
	});

	it("fails loud when a section's parent ref is not in the fetched set (unreadable/absent parent) — names BOTH ids, never silently drops the section", async () => {
		const orphanFetch = () =>
			vi.fn().mockResolvedValue(
				json({ entities: [rawSection('sec-child', 'Ghost child', 1, 'sec-ghost')] })
			);
		await expect(listSections(cfg, orphanFetch())).rejects.toThrow(/sec-child/);
		await expect(listSections(cfg, orphanFetch())).rejects.toThrow(/sec-ghost/);
	});

	it('fails loud on a parent CYCLE (A↔B: both fetched, neither reachable from a root) — completeness guard: every fetched section must appear in the tree', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					rawSection('sec-cyc-a', 'Cycle A', 1, 'sec-cyc-b'),
					rawSection('sec-cyc-b', 'Cycle B', 2, 'sec-cyc-a')
				]
			})
		);
		await expect(listSections(cfg, fetchImpl)).rejects.toThrow(/sec-cyc/);
	});

	it('empty section list → []', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		expect(await listSections(cfg, fetchImpl)).toEqual([]);
	});
});

// ── groupBySection — pure: rows + tree → pre-order groups ──────────────────────

function row(memberId: string, name: string, sectionIds: string[]): RosterRow {
	return { memberId, personId: `p-${memberId}`, name, email: `${memberId}@x.com`, sectionIds };
}

/** Literal fixture tree — Soprano ▸ (Soprano 1 ▸ Soprano 1a, Soprano 2), Alto. */
function fixtureTree(): SectionNode[] {
	const sop1a: SectionNode = {
		id: 'sec-sop1a',
		name: 'Soprano 1a',
		displayOrder: 1,
		parentId: 'sec-sop1',
		depth: 2,
		children: []
	};
	const sop1: SectionNode = {
		id: 'sec-sop1',
		name: 'Soprano 1',
		displayOrder: 1,
		parentId: 'sec-sop',
		depth: 1,
		children: [sop1a]
	};
	const sop2: SectionNode = {
		id: 'sec-sop2',
		name: 'Soprano 2',
		displayOrder: 2,
		parentId: 'sec-sop',
		depth: 1,
		children: []
	};
	const sop: SectionNode = {
		id: 'sec-sop',
		name: 'Soprano',
		displayOrder: 1,
		parentId: null,
		depth: 0,
		children: [sop1, sop2]
	};
	const alto: SectionNode = {
		id: 'sec-alto',
		name: 'Alto',
		displayOrder: 2,
		parentId: null,
		depth: 0,
		children: []
	};
	return [sop, alto];
}

describe('groupBySection — pure: members grouped by sectionIds, display_order pre-order, Unassigned at bottom', () => {
	it('full shape — pre-order group list with depth; members name-sorted within group; RECURSIVE member counts; Unassigned (sectionId null) LAST', () => {
		// Input deliberately shuffled — both across sections and within a section — to
		// prove groupBySection itself sorts (never relies on input order).
		const members: RosterRow[] = [
			row('m-pete', 'Pete Wilson', []), // unassigned
			row('m-carol', 'Carol Williams', ['sec-sop']),
			row('m-mia', 'Mia North', ['sec-sop1a']),
			row('m-gil', 'Gil Ots', ['sec-sop1']),
			row('m-bea', 'Bea Noe', ['sec-alto']),
			row('m-ada', 'Ada Lovelace', ['sec-sop']),
			row('m-eva', 'Eva Green', ['sec-sop1']),
			row('m-hana', 'Hana Tamm', ['sec-sop2'])
		];
		const groups = groupBySection(members, fixtureTree());
		expect(groups).toEqual<SectionGroup[]>([
			{
				sectionId: 'sec-sop',
				name: 'Soprano',
				depth: 0,
				// Recursive roll-up: 2 direct + Soprano 1 (2 + 1 in Soprano 1a) + Soprano 2 (1) = 6
				memberCount: 6,
				members: [row('m-ada', 'Ada Lovelace', ['sec-sop']), row('m-carol', 'Carol Williams', ['sec-sop'])]
			},
			{
				sectionId: 'sec-sop1',
				name: 'Soprano 1',
				depth: 1,
				memberCount: 3, // 2 direct + 1 in Soprano 1a
				members: [row('m-eva', 'Eva Green', ['sec-sop1']), row('m-gil', 'Gil Ots', ['sec-sop1'])]
			},
			{
				sectionId: 'sec-sop1a',
				name: 'Soprano 1a',
				depth: 2,
				memberCount: 1,
				members: [row('m-mia', 'Mia North', ['sec-sop1a'])]
			},
			{
				sectionId: 'sec-sop2',
				name: 'Soprano 2',
				depth: 1,
				memberCount: 1,
				members: [row('m-hana', 'Hana Tamm', ['sec-sop2'])]
			},
			{
				sectionId: 'sec-alto',
				name: 'Alto',
				depth: 0,
				memberCount: 1,
				members: [row('m-bea', 'Bea Noe', ['sec-alto'])]
			},
			{
				sectionId: null,
				name: '',
				depth: 0,
				memberCount: 1,
				members: [row('m-pete', 'Pete Wilson', [])]
			}
		]);
	});

	it('no unassigned members → NO Unassigned group emitted', () => {
		const groups = groupBySection([row('m-bea', 'Bea Noe', ['sec-alto'])], fixtureTree());
		expect(groups.some((g) => g.sectionId === null)).toBe(false);
	});

	it("a member whose sectionIds reference a section NOT in the tree lands in Unassigned — the member stays VISIBLE (deliberate presentational fallback: we can't render a group we can't read; contrast the fail-loud tree build, where a MISSING SECTION would hide members)", () => {
		const groups = groupBySection([row('m-x', 'Xed Out', ['sec-unknowable'])], fixtureTree());
		const unassigned = groups.find((g) => g.sectionId === null);
		expect(unassigned?.members).toEqual([row('m-x', 'Xed Out', ['sec-unknowable'])]);
	});

	it('a member with UNDEFINED sectionIds (pre-GREEN rows) lands in Unassigned', () => {
		const bare: RosterRow = { memberId: 'm-y', personId: 'p-y', name: 'Y Only', email: '' };
		const groups = groupBySection([bare], fixtureTree());
		const unassigned = groups.find((g) => g.sectionId === null);
		expect(unassigned?.members).toEqual([bare]);
	});

	it('EMPTY sections are still emitted (members: [], memberCount: 0) — the structure itself is the product', () => {
		const groups = groupBySection([], fixtureTree());
		expect(groups).toEqual<SectionGroup[]>([
			{ sectionId: 'sec-sop', name: 'Soprano', depth: 0, memberCount: 0, members: [] },
			{ sectionId: 'sec-sop1', name: 'Soprano 1', depth: 1, memberCount: 0, members: [] },
			{ sectionId: 'sec-sop1a', name: 'Soprano 1a', depth: 2, memberCount: 0, members: [] },
			{ sectionId: 'sec-sop2', name: 'Soprano 2', depth: 1, memberCount: 0, members: [] },
			{ sectionId: 'sec-alto', name: 'Alto', depth: 0, memberCount: 0, members: [] }
		]);
	});

	it('no sections at all → every member in a single Unassigned group', () => {
		const groups = groupBySection(
			[row('m-bea', 'Bea Noe', []), row('m-ada', 'Ada Lovelace', [])],
			[]
		);
		expect(groups).toEqual<SectionGroup[]>([
			{
				sectionId: null,
				name: '',
				depth: 0,
				memberCount: 2,
				members: [row('m-ada', 'Ada Lovelace', []), row('m-bea', 'Bea Noe', [])]
			}
		]);
	});

	// ── F1 code-review fix: multi-section members ──────────────────────────────

	it('F1: a member with sectionIds in TWO different sections is pushed into BOTH groups\' member lists — not collapsed onto just one', () => {
		const groups = groupBySection([row('m-multi', 'Multi Singer', ['sec-sop', 'sec-alto'])], fixtureTree());
		const sop = groups.find((g) => g.sectionId === 'sec-sop');
		const alto = groups.find((g) => g.sectionId === 'sec-alto');
		expect(sop?.members).toEqual([row('m-multi', 'Multi Singer', ['sec-sop', 'sec-alto'])]);
		expect(alto?.members).toEqual([row('m-multi', 'Multi Singer', ['sec-sop', 'sec-alto'])]);
		// She is counted in BOTH sections' memberCount — not deduplicated across sections.
		expect(sop?.memberCount).toBe(1);
		expect(alto?.memberCount).toBe(1);
		// And she is NOT also in Unassigned.
		expect(groups.some((g) => g.sectionId === null)).toBe(false);
	});

	it('F1: a member whose sectionIds mix a KNOWN and an UNKNOWN section id lands in the known group only, never Unassigned (at least one match is enough)', () => {
		const groups = groupBySection(
			[row('m-mixed', 'Mixed Ref', ['sec-alto', 'sec-unknowable'])],
			fixtureTree()
		);
		const alto = groups.find((g) => g.sectionId === 'sec-alto');
		expect(alto?.members).toEqual([row('m-mixed', 'Mixed Ref', ['sec-alto', 'sec-unknowable'])]);
		expect(groups.some((g) => g.sectionId === null)).toBe(false);
	});
});

// (*MVOX:Tallis* — TS.1/#95 RED)
// (*MVOX:Palestrina* — F1 code-review fix: multi-section members, TS.1/#95)
