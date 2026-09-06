import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { listSections } from './sectionData';

// #264 item 5 RED — fail-LOUD duplicate/missing `_parent` detection in the
// tree builder (PO ruling, the #258 fail-open class).
//
// Today sectionData.ts's pass 1 places every section by
// `.find(entity_type === 'section')` — a silent guess: a section holding TWO
// `_parent` values (the live Soprano II state after a half-landed reparent)
// renders wherever the first value points, and a section holding ZERO values
// renders as a normal root. Both are DAMAGED DATA under v4E
// `parentConstraint: 'exactly_one_of'`, and both used to be invisible.
//
// New pinned behavior (GREEN implements in sectionData.ts):
//
//   - DETECTION counts the section's raw `_parent` VALUES (all of them —
//     entity_type does not matter; the live duplicate was two `database`
//     refs). Exactly one value → clean, nothing changes. ZERO values or
//     TWO-PLUS values → the node is marked `parentDamaged: true`.
//   - A damaged node is NEVER silently placed by a guess: it surfaces as a
//     TOP-LEVEL node carrying the flag (name intact — the UI must be able to
//     NAME it), and the REST of the tree still builds — detection must not
//     throw the whole roster away (contrast the existing unresolvable-parent /
//     cycle throws, which stay for genuinely unbuildable trees).
//   - Clean nodes carry NO `parentDamaged` key (or `undefined`) — existing
//     full-shape fixture pins stay valid.
//   - A CHILD of a damaged section still attaches under it (the child's own
//     `_parent` is clean; only the damaged node's placement is unknowable).
//
// The UI half — the explicit damaged marker naming the section, no arrange
// affordances — is pinned on the real /roster route in
// page.roster-damaged-parent.spec.ts.

vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

interface RawSection {
	_id: string;
	name?: Array<{ string: string }>;
	display_order?: Array<{ number: number }>;
	_parent?: Array<{ reference: string; entity_type?: string }>;
}

function fetchFor(entities: RawSection[]) {
	return vi.fn().mockResolvedValue(json({ entities }));
}

const DB = 'db-1';

describe('listSections — ≠1 `_parent` values is DAMAGED DATA, surfaced loudly, never a silent guess (#264 item 5)', () => {
	it('TWO `_parent` values (the live Soprano II duplicate — both database refs): the node is marked parentDamaged and surfaces at top level with its name; clean siblings are untouched', async () => {
		const fetchImpl = fetchFor([
			{
				_id: 'sec-sop',
				name: [{ string: 'Soprano' }],
				display_order: [{ number: 1 }],
				_parent: [{ reference: DB, entity_type: 'database' }]
			},
			{
				_id: 'sec-sop2',
				name: [{ string: 'Soprano II' }],
				display_order: [{ number: 2 }],
				_parent: [
					{ reference: DB, entity_type: 'database' },
					{ reference: DB, entity_type: 'database' }
				]
			}
		]);

		const roots = await listSections(cfg, fetchImpl);

		const damaged = roots.find((n) => n.id === 'sec-sop2');
		expect(damaged, 'the damaged section must still be IN the tree').toBeDefined();
		expect(damaged!.parentDamaged).toBe(true);
		// The name survives — the UI marker must be able to NAME the section.
		expect(damaged!.name).toBe('Soprano II');
		// Top-level placement — never a silent guess at one of the two parents.
		expect(damaged!.depth).toBe(0);

		// The clean sibling is untouched, and carries NO damage key.
		const clean = roots.find((n) => n.id === 'sec-sop');
		expect(clean).toBeDefined();
		expect(clean!.parentDamaged).toBeUndefined();
	});

	it('TWO `_parent` values pointing at SECTIONS: still damaged — the node must NOT nest under `.find()`’s first hit', async () => {
		const fetchImpl = fetchFor([
			{
				_id: 'sec-a',
				name: [{ string: 'Alpha' }],
				display_order: [{ number: 1 }],
				_parent: [{ reference: DB, entity_type: 'database' }]
			},
			{
				_id: 'sec-b',
				name: [{ string: 'Beta' }],
				display_order: [{ number: 2 }],
				_parent: [{ reference: DB, entity_type: 'database' }]
			},
			{
				_id: 'sec-torn',
				name: [{ string: 'Torn' }],
				display_order: [{ number: 3 }],
				_parent: [
					{ reference: 'sec-a', entity_type: 'section' },
					{ reference: 'sec-b', entity_type: 'section' }
				]
			}
		]);

		const roots = await listSections(cfg, fetchImpl);

		// NOT under Alpha (the silent .find() guess), NOT under Beta — at top
		// level, flagged.
		const alpha = roots.find((n) => n.id === 'sec-a');
		const beta = roots.find((n) => n.id === 'sec-b');
		expect(alpha?.children ?? []).toEqual([]);
		expect(beta?.children ?? []).toEqual([]);
		const torn = roots.find((n) => n.id === 'sec-torn');
		expect(torn).toBeDefined();
		expect(torn!.parentDamaged).toBe(true);
	});

	it('ZERO `_parent` values: detection fires too — an orphan is damaged data, not a normal root', async () => {
		const fetchImpl = fetchFor([
			{
				_id: 'sec-sop',
				name: [{ string: 'Soprano' }],
				display_order: [{ number: 1 }],
				_parent: [{ reference: DB, entity_type: 'database' }]
			},
			{
				_id: 'sec-orphan',
				name: [{ string: 'Orphan' }],
				display_order: [{ number: 2 }],
				_parent: []
			}
		]);

		const roots = await listSections(cfg, fetchImpl);

		const orphan = roots.find((n) => n.id === 'sec-orphan');
		expect(orphan).toBeDefined();
		expect(orphan!.parentDamaged).toBe(true);
		expect(roots.find((n) => n.id === 'sec-sop')?.parentDamaged).toBeUndefined();
	});

	it('a CHILD of a damaged section still attaches under it — the child’s own `_parent` is clean, and the rest of the roster keeps rendering', async () => {
		const fetchImpl = fetchFor([
			{
				_id: 'sec-dup',
				name: [{ string: 'Duplicated' }],
				display_order: [{ number: 1 }],
				_parent: [
					{ reference: DB, entity_type: 'database' },
					{ reference: DB, entity_type: 'database' }
				]
			},
			{
				_id: 'sec-kid',
				name: [{ string: 'Kid' }],
				display_order: [{ number: 1 }],
				_parent: [{ reference: 'sec-dup', entity_type: 'section' }]
			}
		]);

		const roots = await listSections(cfg, fetchImpl);

		const dup = roots.find((n) => n.id === 'sec-dup');
		expect(dup).toBeDefined();
		expect(dup!.parentDamaged).toBe(true);
		expect(dup!.children.map((c) => c.id)).toEqual(['sec-kid']);
		expect(dup!.children[0].parentDamaged).toBeUndefined();
		expect(dup!.children[0].depth).toBe(1);
	});
});

// (*MVOX:Tallis* — #264 item 5 RED)
