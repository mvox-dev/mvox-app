// The `ink_layer` type (#1069, PO-Approved by Gama 2026-11-03): her marks on a part, private,
// its own grants, a child of her person, naming edition and file; one text value per page.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as extensions from './mvox-schema-extensions';

const def = (extensions as Record<string, unknown>).ink_layer as extensions.MvoxEntityDef;

describe('#1069 — ink_layer in the schema of record', () => {
	it('has a type-def members can resolve, a child of the person, created by her', () => {
		expect(def).toBeDefined();
		expect(def.name).toBe('ink_layer');
		expect(def.sharing).toBe('domain');
		expect(def.inheritsRights).toBe(true);
		expect(def.parents).toEqual([
			{ entity: 'person', required: true, parentCard: '1', childCard: '0..N', verb: 'marks' }
		]);
		expect(def.creators).toEqual([{ kind: 'self' }]);
		expect(def.commissionedBy).toBe('mvox-app#1069');
	});

	it('names the edition and the file, holds one text value per page and her page; all private', () => {
		expect(def.properties.map((p) => [p.name, p.type, p.list ?? false, p.required ?? false, p.sharing])).toEqual([
			['edition', 'reference', false, true, 'private'],
			['file', 'string', false, true, 'private'],
			['page_ink', 'text', true, false, 'private'],
			['last_page', 'number', false, false, 'private']
		]);
		for (const p of def.properties) {
			expect(p.descriptionEn, p.name).not.toBe('');
			expect(p.descriptionEt, p.name).not.toBe('');
		}
	});

	it('has its section in the catalog of docs/architecture/mvox-schema-extensions.md', () => {
		const doc = readFileSync(
			join(import.meta.dirname, '..', '..', '..', 'docs', 'architecture', 'mvox-schema-extensions.md'),
			'utf-8'
		);
		const start = doc.indexOf('### `ink_layer`');
		expect(start).toBeGreaterThan(doc.indexOf('## Entity catalog'));
		expect(start).toBeLessThan(doc.indexOf('## Property additions to existing types'));
		const rest = doc.slice(start + 1);
		const section = rest.slice(0, rest.search(/\n##+ /));
		for (const needle of ['`edition`', '`file`', '`page_ink`', '`last_page`', '`person`', 'private', '#1069']) {
			expect(section, needle).toContain(needle);
		}
	});
});

// (*MVOX:Josquin*)
