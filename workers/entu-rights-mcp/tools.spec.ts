// #318 RED — the two tools, and ONLY these two (#318 body):
//   rights_rule(id)     — one rule, VERBATIM, + probe-script/result-file paths
//   rights_rules(topic) — matching identifiers for a caller without the id
//
// "Deliberately NOT served: generated per-question answers" — enforced here by
// (a) full-shape key pins on structuredContent (no field a generated answer
// could live in), (b) every served text asserted doc-derived (verbatim rule
// text; context lines that are byte-substrings of a rule's text), and (c) the
// human-readable content channel required to be exactly the JSON serialization
// of structuredContent, so no prose channel exists at all.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildBundle } from './src/generate';
import { parseRightsDoc } from './src/parse';
import { rightsRule, rightsRules, TOOL_DEFINITIONS } from './src/tools';

const DOC_PATH = resolve(
	__dirname,
	'../../docs/architecture/entu-rights-and-visibility-model.md'
);
const doc = readFileSync(DOC_PATH, 'utf-8');
const FAKE_SHA = 'deadbeefcafe0123456789abcdef0123456789ab';
const FAKE_DATE = '2026-09-12T00:00:00Z';

const bundle = () => buildBundle(doc, FAKE_SHA, FAKE_DATE);
const rules = () => parseRightsDoc(doc).rules;

describe('tool definitions: exactly two', () => {
	it('rights_rule and rights_rules, nothing else', () => {
		expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual(['rights_rule', 'rights_rules']);
	});

	it('input schemas: rights_rule requires id, rights_rules requires topic', () => {
		const [rule, topic] = TOOL_DEFINITIONS;
		expect(rule.inputSchema.type).toBe('object');
		expect(rule.inputSchema.required).toEqual(['id']);
		expect(Object.keys(rule.inputSchema.properties)).toEqual(['id']);
		expect(topic.inputSchema.type).toBe('object');
		expect(topic.inputSchema.required).toEqual(['topic']);
		expect(Object.keys(topic.inputSchema.properties)).toEqual(['topic']);
	});
});

describe('rights_rule(id): one rule, verbatim, evidence, stamp', () => {
	it('ER-13 → the full structured shape, nothing extra (toEqual)', () => {
		const er13 = rules().find((r) => r.id === 'ER-13');
		expect(er13).toBeDefined();
		const res = rightsRule(bundle(), { id: 'ER-13' });
		expect(res.isError).toBeFalsy();
		expect(res.structuredContent).toEqual({
			id: 'ER-13',
			text: er13?.text,
			evidence: {
				sourceRefs: ['utils/entity.js:296-327'],
				probeScripts: [],
				resultFiles: []
			},
			sourceCommit: FAKE_SHA,
			sourceCommitDate: FAKE_DATE
		});
	});

	it('ER-3 → verbatim text plus probe-script AND result-file paths (the probe-294 instance)', () => {
		const er3 = rules().find((r) => r.id === 'ER-3');
		const res = rightsRule(bundle(), { id: 'ER-3' });
		expect(res.structuredContent).toEqual({
			id: 'ER-3',
			text: er3?.text,
			evidence: {
				sourceRefs: [],
				probeScripts: [
					'scripts/migrations/probes/probe-294-entu-user-cross-admin-read-2026-09-08.ts'
				],
				resultFiles: [
					'scripts/migrations/seed-results/probe-294-entu-user-cross-admin-read-live-2026-09-08T10-15-15-643Z.json'
				]
			},
			sourceCommit: FAKE_SHA,
			sourceCommitDate: FAKE_DATE
		});
	});

	it('every one of the 23 ids round-trips: served text is the parsed verbatim text, served evidence is the parsed evidence', () => {
		const b = bundle();
		for (const r of rules()) {
			const res = rightsRule(b, { id: r.id });
			expect(res.isError, `${r.id}: unexpected tool error`).toBeFalsy();
			expect(res.structuredContent?.text, `${r.id}: text not verbatim`).toBe(r.text);
			expect(res.structuredContent?.evidence, `${r.id}: evidence drifted`).toEqual(r.evidence);
			expect(res.structuredContent?.sourceCommit, `${r.id}: stamp missing`).toBe(FAKE_SHA);
		}
	});

	it('the content channel is exactly the JSON serialization of structuredContent — no free-prose channel', () => {
		const res = rightsRule(bundle(), { id: 'ER-13' });
		expect(res.content).toHaveLength(1);
		expect(res.content[0].type).toBe('text');
		expect(JSON.parse(res.content[0].text)).toEqual(res.structuredContent);
	});

	it('unknown id → MCP tool-error RESULT (isError: true), not a throw, not an empty success — and it still carries the stamp', () => {
		const b = bundle();
		let res;
		expect(() => {
			res = rightsRule(b, { id: 'ER-999' });
		}).not.toThrow();
		expect(res!.isError).toBe(true);
		expect(res!.content[0].text).toContain('ER-999');
		expect(res!.structuredContent?.sourceCommit).toBe(FAKE_SHA);
		expect(res!.structuredContent?.sourceCommitDate).toBe(FAKE_DATE);
	});
});

describe('rights_rules(topic): case-insensitive lookup over rule text', () => {
	it('matching is case-insensitive: the same result for "read boundary" and "Read BOUNDARY"', () => {
		const b = bundle();
		expect(rightsRules(b, { topic: 'Read BOUNDARY' }).structuredContent?.matches).toEqual(
			rightsRules(b, { topic: 'read boundary' }).structuredContent?.matches
		);
	});

	it('"read boundary" finds ER-10', () => {
		const res = rightsRules(bundle(), { topic: 'read boundary' });
		const matches = res.structuredContent?.matches as { id: string }[];
		expect(matches.map((m) => m.id)).toContain('ER-10');
	});

	it('"private bucket" returns EXACTLY the rules whose text contains it (complete, no misses, no extras)', () => {
		const topic = 'private bucket';
		const expected = rules()
			.filter((r) => r.text.toLowerCase().includes(topic))
			.map((r) => r.id)
			.sort();
		expect(expected, 'sanity: the topic must actually match rules, ER-3 among them').toContain('ER-3');
		const res = rightsRules(bundle(), { topic });
		const matches = res.structuredContent?.matches as { id: string }[];
		expect(matches.map((m) => m.id).sort()).toEqual(expected);
	});

	it('every match carries a short DOC-DERIVED context line: a byte-substring of that rule\'s own text, never generated prose', () => {
		const byId = new Map(rules().map((r) => [r.id, r]));
		const res = rightsRules(bundle(), { topic: 'private bucket' });
		const matches = res.structuredContent?.matches as { id: string; context: string }[];
		expect(matches.length).toBeGreaterThan(0);
		for (const m of matches) {
			expect(Object.keys(m).sort(), `${m.id}: a match is id + context, nothing else`).toEqual([
				'context',
				'id'
			]);
			expect(m.context.length, `${m.id}: empty context`).toBeGreaterThan(0);
			expect(m.context.length, `${m.id}: context is a LINE, not the whole block`).toBeLessThanOrEqual(300);
			expect(
				byId.get(m.id)?.text.includes(m.context),
				`${m.id}: context is not a byte-substring of the rule's text — doc-derived only, no ellipses, no paraphrase`
			).toBe(true);
		}
	});

	it('no match → empty list STILL carrying the stamp (full shape)', () => {
		const res = rightsRules(bundle(), { topic: 'quaternion frobnication' });
		expect(res.isError).toBeFalsy();
		expect(res.structuredContent).toEqual({
			topic: 'quaternion frobnication',
			matches: [],
			sourceCommit: FAKE_SHA,
			sourceCommitDate: FAKE_DATE
		});
	});

	it('structuredContent carries ONLY topic + matches + stamp; content mirrors it as JSON — nowhere for a generated answer to live', () => {
		const res = rightsRules(bundle(), { topic: 'read boundary' });
		expect(Object.keys(res.structuredContent ?? {}).sort()).toEqual([
			'matches',
			'sourceCommit',
			'sourceCommitDate',
			'topic'
		]);
		expect(res.content).toHaveLength(1);
		expect(JSON.parse(res.content[0].text)).toEqual(res.structuredContent);
	});
});
