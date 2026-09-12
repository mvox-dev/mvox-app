// #318 RED — entu-rights-mcp parser: extracts the identified rule blocks from
// the REAL rights model doc, VERBATIM.
//
// Contract source: #318 body ("It is a VIEW, never a second home" — rules are
// read from the repo document; `rights_rule` serves one rule verbatim plus its
// probe-script and result-file paths) + the settled design on the issue
// (verbatim enforced as a byte-substring of the raw doc).
//
// The grammar is the one src/rights-model-identifiers.spec.ts (the guard spec)
// already enforces on the doc — this parser is a second CONSUMER of that
// grammar, never a second definition of the doc's content. The guard spec is
// NOT modified by this slice (byte-pinned in fences.spec.ts).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseRightsDoc } from './src/parse';

const DOC_PATH = resolve(
	__dirname,
	'../../docs/architecture/entu-rights-and-visibility-model.md'
);
const doc = readFileSync(DOC_PATH, 'utf-8');

const ALL_IDS = Array.from({ length: 23 }, (_, i) => `ER-${i + 1}`);

describe('parseRightsDoc on the real doc: all 23 rules, ids exact', () => {
	it('extracts exactly the 23 identified rules, ids ER-1..ER-23 (as a set — document order and identifier order are allowed to disagree)', () => {
		const { rules } = parseRightsDoc(doc);
		expect(rules.length, 'rule count').toBe(23);
		expect([...rules.map((r) => r.id)].sort(), 'id set').toEqual([...ALL_IDS].sort());
	});

	it('parses the real doc with zero rejects', () => {
		expect(parseRightsDoc(doc).rejects).toEqual([]);
	});

	it('no rule in the real doc is marked superseded or unverified except ER-15/ER-16 ([unverified] governance conventions)', () => {
		const { rules } = parseRightsDoc(doc);
		expect(rules.filter((r) => r.superseded).map((r) => r.id)).toEqual([]);
		expect(
			rules
				.filter((r) => r.unverified)
				.map((r) => r.id)
				.sort()
		).toEqual(['ER-15', 'ER-16']);
	});
});

describe('verbatim: every extracted rule is a byte-substring of the raw doc', () => {
	it('every rule.raw appears byte-for-byte in the document', () => {
		const { rules } = parseRightsDoc(doc);
		for (const r of rules) {
			expect(
				doc.includes(r.raw),
				`${r.id}: raw block is not a byte-substring of the doc — the view drifted from its source, which is the exact failure #318 exists to prevent`
			).toBe(true);
			expect(r.raw.length, `${r.id}: empty raw`).toBeGreaterThan(0);
		}
	});

	it('rule.raw is the full contiguous blockquote run: every line starts with ">" and the first line opens with the bold identifier', () => {
		const { rules } = parseRightsDoc(doc);
		for (const r of rules) {
			const lines = r.raw.split('\n');
			expect(lines.every((l) => l.startsWith('>')), `${r.id}: non-blockquote line inside raw`).toBe(true);
			expect(lines[0], `${r.id}: first raw line does not open with the identifier`).toMatch(
				new RegExp(`^>\\s*\\*\\*${r.id}\\*\\*`)
			);
		}
	});

	it('rule.text is raw with the ">" markers stripped (guard-spec convention: /^>\\s?/ per line, joined with \\n) — no normalization, no paraphrase', () => {
		const { rules } = parseRightsDoc(doc);
		for (const r of rules) {
			const expected = r.raw
				.split('\n')
				.map((l) => l.replace(/^>\s?/, ''))
				.join('\n');
			expect(r.text, `${r.id}: text is not the marker-stripped raw`).toBe(expected);
		}
	});

	it('spot-check ER-13 verbatim: the create-time _sharing copy rule, full first sentence intact', () => {
		const { rules } = parseRightsDoc(doc);
		const er13 = rules.find((r) => r.id === 'ER-13');
		expect(er13).toBeDefined();
		expect(er13?.text).toContain(
			"**ER-13** — Entity CREATE copies a parent's `_sharing` onto a new child when the payload omits `_sharing`; a child created under a `domain` parent that does not set its own `_sharing` explicitly therefore silently becomes `domain`, not `private` by default."
		);
	});
});

describe('evidence-line parse: file:line refs, probe scripts, result files', () => {
	const rulesById = () => {
		const { rules } = parseRightsDoc(doc);
		return new Map(rules.map((r) => [r.id, r]));
	};

	it('ER-13: exactly one source ref, no probe artifacts', () => {
		expect(rulesById().get('ER-13')?.evidence).toEqual({
			sourceRefs: ['utils/entity.js:296-327'],
			probeScripts: [],
			resultFiles: []
		});
	});

	it('ER-10: both entu-api auth-chain refs, multi-range tokens kept whole', () => {
		const ev = rulesById().get('ER-10')?.evidence;
		expect(ev?.sourceRefs).toContain('middleware/auth.js:21,31-33,46-48');
		expect(ev?.sourceRefs).toContain('routes/auth/index.get.js:132,141-190,254');
		expect(ev?.probeScripts).toEqual([]);
		expect(ev?.resultFiles).toEqual([]);
	});

	it('ER-3 (the probe-294 known instance): probe script + live result file, full paths', () => {
		expect(rulesById().get('ER-3')?.evidence).toEqual({
			sourceRefs: [],
			probeScripts: ['scripts/migrations/probes/probe-294-entu-user-cross-admin-read-2026-09-08.ts'],
			resultFiles: [
				'scripts/migrations/seed-results/probe-294-entu-user-cross-admin-read-live-2026-09-08T10-15-15-643Z.json'
			]
		});
	});

	it('ER-6: two probe scripts and two result files, all four paths', () => {
		const ev = rulesById().get('ER-6')?.evidence;
		expect(ev?.probeScripts).toEqual([
			'scripts/migrations/probes/probe-crede-editor-disappear-repro-2026-09-09.ts',
			'scripts/migrations/probes/probe-entu-rights-supersession-cases-2026-09-09.ts'
		]);
		expect(ev?.resultFiles).toEqual([
			'scripts/migrations/seed-results/probe-crede-editor-disappear-repro-live-2026-09-09T16-56-49-211Z.json',
			'scripts/migrations/seed-results/probe-entu-rights-supersession-cases-live-2026-09-09T17-04-41-123Z.json'
		]);
	});

	it('ER-14 (the fenced _parent probe): probe-304 script + result file', () => {
		const ev = rulesById().get('ER-14')?.evidence;
		expect(ev?.probeScripts).toEqual([
			'scripts/migrations/probes/probe-304-parent-rights-gate-2026-09-10.ts'
		]);
		expect(ev?.resultFiles).toEqual([
			'scripts/migrations/seed-results/probe-304-parent-rights-gate-live-2026-09-10T05-11-52-413Z.json'
		]);
	});

	it('ER-1: source refs include both gate citations and the perotin.md synthesis ref', () => {
		const ev = rulesById().get('ER-1')?.evidence;
		expect(ev?.sourceRefs).toContain('aggregate.js:86,94,113-121');
		expect(ev?.sourceRefs).toContain('aggregate.js:269-275');
		expect(ev?.sourceRefs).toContain('teams/mvox-dev/memory/perotin.md:1263-1272');
	});

	it('every rule carries evidence or the explicit [unverified] mark — never neither', () => {
		const { rules } = parseRightsDoc(doc);
		for (const r of rules) {
			const hasEvidence =
				r.evidence.sourceRefs.length + r.evidence.probeScripts.length + r.evidence.resultFiles.length >
				0;
			expect(
				hasEvidence || r.unverified,
				`${r.id}: no evidence refs and no [unverified] mark — an unevidenced rule must not be servable as verified`
			).toBe(true);
		}
	});
});

describe('grammar edges (fixtures)', () => {
	it('a superseded rule keeps its identifier and parses with superseded: true (guard-spec fixture)', () => {
		const fixture = [
			'> **ER-1** — an active rule. Evidence: `aggregate.js:86`.',
			'',
			'> **ER-2** (superseded by ER-1, 2026-10-01) — an old rule, id retained. Evidence: `entity.js:115-121`.',
			''
		].join('\n');
		const { rules, rejects } = parseRightsDoc(fixture);
		expect(rejects).toEqual([]);
		expect(rules.map((r) => r.id)).toEqual(['ER-1', 'ER-2']);
		expect(rules[0].superseded).toBe(false);
		expect(rules[1].superseded).toBe(true);
	});

	it('ordinary blockquotes (no ER identifier on the first line) are skipped silently — not rules, not rejects', () => {
		const fixture = [
			'> a header note blockquote, like the PORTED banner.',
			'',
			'> **ER-1** — a rule. Evidence: `aggregate.js:86`.',
			''
		].join('\n');
		const { rules, rejects } = parseRightsDoc(fixture);
		expect(rules.map((r) => r.id)).toEqual(['ER-1']);
		expect(rejects).toEqual([]);
	});

	it('malformed ER identifiers (ER-0, letter suffix) are REJECTS with the start line — never silently dropped, never served', () => {
		const fixture = [
			'# fixture',
			'',
			'> **ER-1** — good. Evidence: `aggregate.js:86`.',
			'',
			'> **ER-0** — malformed: zero is never minted.',
			'> Evidence: `entity.js:1`.',
			'',
			'> **ER-2a** — malformed: letter suffixes are forbidden.',
			'> [unverified] mark.',
			''
		].join('\n');
		const { rules, rejects } = parseRightsDoc(fixture);
		expect(rules.map((r) => r.id)).toEqual(['ER-1']);
		expect(rejects.map((r) => r.line)).toEqual([5, 8]);
		expect(rejects[0].reason).toMatch(/ER-0/);
		expect(rejects[1].reason).toMatch(/ER-2a/);
	});
});
