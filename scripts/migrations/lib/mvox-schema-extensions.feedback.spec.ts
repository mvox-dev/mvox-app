// mvox-app#395 slice 1/2 (RED) — the `feedback` type in the schema of record.
//
// Contract pinned here, for GREEN to satisfy:
//
// - `scripts/migrations/lib/mvox-schema-extensions.ts` exports
//   `feedback: MvoxEntityDef`, EXACTLY the shape below (full toEqual — no
//   partial matchers). Child of `member`; three fields — `screenshot` (file),
//   `doodle_layer` (text: #394's StrokeData JSON, src/lib/strokes/strokes.ts),
//   `description` (text). Type AND every field carry `_sharing: domain`,
//   each set explicitly (never omitted — the #265 inherit-from-parent trap).
//   `_inheritrights: true` (sectionActions.ts precedent: inheritance left
//   natural, per the #390/#395 ruling). Creator is the member themself —
//   `{ kind: 'self' }`, the first MvoxEntityDef to use it.
//
// - `docs/architecture/mvox-schema-extensions.md` carries its narrative
//   section under "Entity catalog", before "Property additions".
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as schema from './mvox-schema-extensions';

const EXPECTED_FEEDBACK_DEF = {
	name: 'feedback',
	blurb: "A member's feedback on the app: a screenshot, ink drawn over it, and a description.",
	sharing: 'domain',
	inheritsRights: true,
	parents: [
		{
			entity: 'member',
			required: true,
			parentCard: '1',
			childCard: '0..N',
			verb: 'gives'
		}
	],
	properties: [
		{
			name: 'screenshot',
			type: 'file',
			sharing: 'domain',
			descriptionEn: 'Screenshot of the page the member is giving feedback on.',
			descriptionEt: 'Kuvatõmmis lehest, mille kohta liige tagasisidet annab.',
			ordinal: 1
		},
		{
			name: 'doodle_layer',
			type: 'text',
			sharing: 'domain',
			note: "#394's StrokeData JSON (src/lib/strokes/strokes.ts serialize/parse) — ink drawn over the screenshot",
			descriptionEn: 'Ink drawn over the screenshot — stroke data as JSON (the #394 StrokeData format).',
			descriptionEt: 'Kuvatõmmisele joonistatud märkused — joonte andmed JSON-vormingus (#394 StrokeData).',
			ordinal: 2
		},
		{
			name: 'description',
			type: 'text',
			sharing: 'domain',
			descriptionEn: "The member's feedback in their own words.",
			descriptionEt: 'Liikme tagasiside tema enda sõnadega.',
			ordinal: 3
		}
	],
	creators: [{ kind: 'self' }],
	notes: [
		'mvox app extension — not part of the canonical v4E schema (upstream flow retired 2026-09-06; entu/research is historical reference only).',
		'Created by the member with their own key (`creators: self`) — Entu auto-grants the creator `_owner` on create; no extra grant.',
		"Instance `_sharing` is set EXPLICITLY to `domain` at create time, as #265 does: a type's `_sharing` is a ceiling, not a default (ER-1), and a child copies its parent's `_sharing` only when the parent is non-private (ER-13) — a feedback under a still-private member would otherwise stay private (PO ruling, Gama, 2026-09-28).",
		'`_inheritrights: true` — inheritance left natural (Mihkel, #390): rights on the member cascade to its feedback.',
		'Instances carry a `name` VALUE with no prop-def: page path + UTC submission date, never a member name or description text; the type stays at three fields (PO ruling, Gama, #395 body, 2026-09-29).'
	],
	commissionedBy: 'mvox-app#395'
};

describe('#395 — feedback in the schema of record', () => {
	it('exports `feedback: MvoxEntityDef` with the exact commissioned shape', () => {
		expect((schema as Record<string, unknown>).feedback).toEqual(EXPECTED_FEEDBACK_DEF);
	});

	it('type and every field are domain, each set explicitly — none left to inherit', () => {
		const def = (schema as Record<string, unknown>).feedback as typeof EXPECTED_FEEDBACK_DEF | undefined;
		expect(def?.sharing).toBe('domain');
		expect(def?.properties.map((p) => [p.name, p.sharing])).toEqual([
			['screenshot', 'domain'],
			['doodle_layer', 'domain'],
			['description', 'domain']
		]);
	});
});

describe('#395 — feedback narrative in docs/architecture/mvox-schema-extensions.md', () => {
	const doc = readFileSync(
		join(import.meta.dirname, '..', '..', '..', 'docs', 'architecture', 'mvox-schema-extensions.md'),
		'utf-8'
	);

	it('has a `### `feedback`` section inside the Entity catalog, before Property additions', () => {
		const catalogAt = doc.indexOf('## Entity catalog');
		const sectionAt = doc.indexOf('### `feedback`');
		const additionsAt = doc.indexOf('## Property additions to existing types');
		expect(catalogAt).toBeGreaterThan(-1);
		expect(sectionAt).toBeGreaterThan(catalogAt);
		expect(sectionAt).toBeLessThan(additionsAt);
	});

	it('the section names the three fields, the member parent, the self creator and the commissioning issue', () => {
		const start = doc.indexOf('### `feedback`');
		expect(start).toBeGreaterThan(-1);
		const rest = doc.slice(start + 1);
		const nextHeading = rest.search(/\n##+ /);
		const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
		for (const needle of [
			'`screenshot`',
			'`doodle_layer`',
			'`description`',
			'`member`',
			'self',
			'https://github.com/mvox-dev/mvox-app/issues/395'
		]) {
			expect(section, `feedback section must mention ${needle}`).toContain(needle);
		}
	});
});

// (*MVOX:Tallis*)
