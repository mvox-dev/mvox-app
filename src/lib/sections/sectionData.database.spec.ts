import { describe, expect, it, vi } from 'vitest';
import { listSections } from './sectionData';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

// #161 RED — collective = database: a TOP-LEVEL section's owning collective is
// the `_parent` entry with `entity_type === 'database'`, not `'organization'`
// (#159 deleted every organization instance). `SectionNode.dbEntityId` keeps its name
// but must carry the DATABASE entity id — the picker's sibling-scoped duplicate
// check and the roster page's create threading both key on it.

const cfg: EntuCfg = { db: 'polyphony', token: 'jwt' };
const DB_ENTITY = '69c7f8688489bfcb0e81aff1';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

describe('listSections — top-level sections carry the DATABASE entity as their collective (#161)', () => {
	it("a root parented to the database entity: parentId null, dbEntityId = the `entity_type: 'database'` reference; a sub-section keeps parentId = its section and dbEntityId null", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{
						_id: 'sec-sop',
						name: [{ string: 'Soprano' }],
						display_order: [{ number: 1 }],
						_parent: [{ reference: DB_ENTITY, entity_type: 'database' }]
					},
					{
						_id: 'sec-sop-2',
						name: [{ string: 'Soprano II' }],
						display_order: [{ number: 2 }],
						_parent: [{ reference: 'sec-sop', entity_type: 'section' }]
					}
				],
				count: 2
			})
		);
		const roots = await listSections(cfg, fetchImpl);
		expect(roots).toHaveLength(1);

		const root = roots[0];
		expect(root.id).toBe('sec-sop');
		expect(root.parentId).toBeNull();
		expect(root.dbEntityId).toBe(DB_ENTITY);

		expect(root.children).toHaveLength(1);
		expect(root.children[0].id).toBe('sec-sop-2');
		expect(root.children[0].parentId).toBe('sec-sop');
		expect(root.children[0].dbEntityId).toBeNull();
	});

	it('a root whose only parent is a LEGACY organization entry resolves dbEntityId null — organization is not a collective identity anymore', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{
						_id: 'sec-legacy',
						name: [{ string: 'Alto' }],
						_parent: [{ reference: 'org-legacy', entity_type: 'organization' }]
					}
				],
				count: 1
			})
		);
		const roots = await listSections(cfg, fetchImpl);
		expect(roots).toHaveLength(1);
		expect(roots[0].dbEntityId).toBeNull();
	});
});

// (*MVOX:Tallis* — #161 RED)
