// The section tree builder fails loudly on duplicate or missing _parent values.
import { describe, expect, it, vi } from 'vitest';
import { listSections } from './sectionData';
import { json, testCfg } from '$lib/testing/entuFetchKit';

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

const cfg = testCfg('testdb');

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
		expect(damaged!.name).toBe('Soprano II');
		expect(damaged!.depth).toBe(0);

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

// (*MVOX:Tallis*)
