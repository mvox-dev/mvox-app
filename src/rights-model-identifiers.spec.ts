// #317 — stable rule identifiers in the rights model document, made enforceable.
//
// RED for the #317 TDD chain. This spec parses the REAL document
// (docs/architecture/entu-rights-and-visibility-model.md) and mechanically
// enforces the identifier contract from #317's body plus BOTH Gama comments
// (2026-09-10 15:11Z amendment: qualifications-get-own-identifiers + three new
// claims; 15:27Z: distil-never-extend + the `_parent` fence). It fails today
// because no identifiers exist, and it guards every future edit of the doc.
//
// Scanning the real file follows the typography-scale.spec / ios-form-zoom.spec
// precedent (mechanical checks over real repo files, spec at src root).
//
// ── THE GRAMMAR THIS SPEC DEFINES (the GREEN implementer writes to this) ──
//
// Identifier scheme: `ER-<n>` where <n> is a positive integer with no leading
// zeros. Opaque, creation-order, NON-POSITIONAL — the sequence number carries
// no meaning about where the rule sits in the document, and this spec never
// asserts that any ER id lives in any §-section. §N stays navigation only.
// The scheme deliberately avoids §-prefixes (reserved for positional
// navigation) and square-bracket forms (reserved for the [P]/[F]/[PE]/[LIVE]
// provenance tags) — research-316 finding 6.
//
// An IDENTIFIED RULE BLOCK is a markdown blockquote (contiguous lines starting
// with `>`) whose FIRST line begins with the bold identifier:
//
//   > **ER-4** — one-sentence rule text, quotable whole.
//   > Evidence: `aggregate.js:269-275`.
//   > Qualifications: ER-7.
//
// - The whole blockquote is the rule. It must be short enough to quote whole
//   (caps below) — IDs attach to individual rules, never to whole §-sections.
// - A SUPERSEDED rule keeps its identifier forever: the word `superseded` on
//   the definition's FIRST line marks it (e.g. `> **ER-2** (superseded by
//   ER-9, 2026-10-01) — …`). Keep the first line of active rules free of that
//   word. No superseded rule need exist today — the format check is parse-level.
// - A CROSS-REFERENCE is any bare `ER-<n>` token; every token in the document
//   must resolve to a defined rule. Base and qualification name each other:
//   the qualification cites its base rule by ID, and the base carries a
//   `Qualifications:` line naming every rule that bounds it — so quoting the
//   base whole shows that it is bounded. Write cross-reference lines as bare IDs — never restate
//   the referenced rule's text (restating would trip the exactly-one content
//   probes below, by design: that is the doc's own no-restatement discipline).
// - Every rule block carries an evidence line: an `entu-api` `file:line`
//   citation, a probe artifact path under scripts/migrations/, or an explicit
//   `[unverified]` mark. A distilled sentence with no evidence line is
//   indistinguishable from an invented one (Gama, 15:27Z).
//
// Content coverage is asserted by ID-presence + distinctive substrings, NEVER
// by position. Each probe set must match EXACTLY ONE rule block — a second
// block matching the same probes means a rule got restated instead of cited.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DOC_PATH = resolve(__dirname, '../docs/architecture/entu-rights-and-visibility-model.md');

// ── tests-local parser (deliberately NOT a src/ module — #318 builds its own view later) ──

interface RuleBlock {
	/** The identifier, e.g. "ER-4" (well-formedness asserted separately). */
	id: string;
	/** True when the definition's first line carries the `superseded` marker. */
	superseded: boolean;
	/** Full blockquote text, `>` markers stripped, lines joined with \n. */
	text: string;
	/** Number of lines in the blockquote. */
	lineCount: number;
	/** 1-indexed line the block starts on (for failure messages only — never asserted). */
	startLine: number;
}

const DEFINITION_FIRST_LINE = /^>\s*\*\*(ER-[0-9A-Za-z]*)\*\*/;
const WELL_FORMED_ID = /^ER-[1-9]\d*$/;
const ID_TOKEN = /\bER-[0-9A-Za-z]+\b/g;

function parseRuleBlocks(doc: string): RuleBlock[] {
	const lines = doc.split('\n');
	const blocks: RuleBlock[] = [];
	let i = 0;
	while (i < lines.length) {
		if (!lines[i].startsWith('>')) {
			i += 1;
			continue;
		}
		const start = i;
		while (i < lines.length && lines[i].startsWith('>')) i += 1;
		const raw = lines.slice(start, i);
		const m = raw[0].match(DEFINITION_FIRST_LINE);
		if (!m) continue; // ordinary blockquote (header note, discipline note, …)
		blocks.push({
			id: m[1],
			superseded: /superseded/i.test(raw[0]),
			text: raw.map((l) => l.replace(/^>\s?/, '')).join('\n'),
			lineCount: raw.length,
			startLine: start + 1
		});
	}
	return blocks;
}

const doc = readFileSync(DOC_PATH, 'utf-8');
const blocks = parseRuleBlocks(doc);

/** Exactly-one content lookup. Every probe must match; position is never used. */
function blockMatching(label: string, probes: RegExp[]): RuleBlock {
	const hits = blocks.filter((b) => probes.every((p) => p.test(b.text)));
	expect(
		hits.length,
		`expected exactly one identified rule block for "${label}" (probes: ${probes.map(String).join(', ')}); ` +
			`found ${hits.length}${hits.length ? ` at doc lines ${hits.map((b) => b.startLine).join(', ')}` : ''}. ` +
			`Zero means the rule has no identified block yet; more than one means a rule got restated instead of cross-referenced by ID.`
	).toBe(1);
	return hits[0];
}

// ── 1. format + uniqueness ──────────────────────────────────────────────────

describe('identifier scheme (ER-<n>): format and uniqueness', () => {
	it('at least one identified rule block exists', () => {
		expect(
			blocks.length,
			'no identified rule blocks found — the doc has no stable identifiers yet (#317 RED)'
		).toBeGreaterThan(0);
	});

	it('every defined identifier is well-formed ER-<n> (positive integer, no leading zeros)', () => {
		for (const b of blocks) {
			expect(b.id, `malformed identifier at doc line ${b.startLine}`).toMatch(WELL_FORMED_ID);
		}
	});

	it('no identifier anchors two rules — definition ids are unique (superseded ids stay taken)', () => {
		const ids = blocks.map((b) => b.id);
		expect(new Set(ids).size, `duplicate rule ids: ${ids.join(', ')}`).toBe(ids.length);
	});

	it('every ER token anywhere in the doc is well-formed and resolves to a defined rule', () => {
		const defined = new Set(blocks.map((b) => b.id));
		for (const token of doc.match(ID_TOKEN) ?? []) {
			expect(token, 'malformed ER token in doc body').toMatch(WELL_FORMED_ID);
			expect(defined.has(token), `dangling reference: ${token} resolves to no defined rule`).toBe(
				true
			);
		}
	});

	it('identifiers are never §-prefixed and never square-bracketed (no confusion with §-navigation or [P]/[F]/[PE]/[LIVE] tags)', () => {
		expect(doc).not.toMatch(/§\s*ER-/);
		expect(doc).not.toMatch(/\[ER-[^\]]*\]/);
	});
});

// ── 2/3. coverage — the full amended inventory, found by content, never by position ──

// Each entry: [label, probes]. Probes are matched against rule-block text only.
const INVENTORY: [string, RegExp[]][] = [
	['a. three visibility gates, narrowest wins', [/narrowest wins/i, /gate/i, /prop-def|property definition/i]],
	['b. one direct rights-tier per (reference, entity); new direct grant replaces', [/at most one active direct/i, /rights-tier/i, /replac|retir/i]],
	['c. propagation non-extension (own rule, qualification of b)', [/propagat/i, /child/i, /never|does not|not\b/i]],
	['d. direct and inherited are separate additive layers', [/additive/i, /inherited/i, /single-tier|single tier/i]],
	['e. _sharing vs _inheritrights are different axes', [/_sharing/, /_inheritrights/, /ax[ei]s/i]],
	['f. CREATE auto-grants caller _owner as one direct doc, all four tiers', [/auto-grant/i, /_owner/, /four tiers/i]],
	['g. replacement is bidirectional — grant-lower-after-create silently demotes the creator', [/demot/i, /creator|creating caller/i, /non-monotonic|both directions/i]],
	['h. _viewer-alone suffices for full private-bucket read', [/_viewer/, /alone/i, /private bucket/i]],
	['i. tier-admitted vs grant-admitted readers get different answers', [/tier-admitted/i, /grant-admitted/i]],
	['j. create copies the parent _sharing unless the POST sets it explicitly', [/_sharing/, /parent/i, /cop(y|ies|ied)/i, /omit|explicit/i]],
	['k. _viewer:<entity-id> is accepted but inert', [/inert/i, /accepted/i]],
	['l. the database boundary is a read boundary', [/read boundary/i, /database|\bdb\b/i]],
	['m. changing _sharing requires _owner', [/_sharing/, /_owner/, /chang/i]],
	['n. a systemUser caller bypasses the _owner requirement on the write path (own rule, qualification of m)', [/systemUser/, /bypass/i, /write path/i]]
];

describe('coverage: every rule in the amended inventory has its own identified block', () => {
	it.each(INVENTORY)('%s', (label, probes) => {
		const b = blockMatching(label, probes);
		expect(b.id).toMatch(WELL_FORMED_ID);
	});

	it('the three-gates rule (a) scopes which reader the AND formula holds for', () => {
		// The unqualified form — "reaches a non-owner reader only if all three gates
		// allow it" — is false for a grant-admitted reader (rule i), and it is the
		// natural citation for "three gates". Quoting (a) whole must not assert it.
		const b = blockMatching('a. three visibility gates, narrowest wins', INVENTORY[0][1]);
		expect(
			b.text,
			`rule ${b.id} states the three-gate AND without naming the reader it holds for — the unscoped form is the dangerous one`
		).toMatch(/tier-admitted/i);
	});

	it('only the three-gates rule (a) enumerates the exposure gates — every other block cites it by ID', () => {
		// The regression this guards: a second block that restates (a)'s formula
		// drops a gate in the restatement. That is exactly what shipped on
		// 2026-09-10 — the entity TYPE cap vanished from a two-gate paraphrase —
		// and it is the anti-pattern this file's header forbids ("write
		// cross-reference lines as bare IDs — never restate the referenced rule's
		// text"). Case-sensitive `AND` so ordinary prose "and" does not trip it.
		const gates = blockMatching('a. three visibility gates, narrowest wins', INVENTORY[0][1]);
		const ENUMERATES_GATES = /(?:prop-def|property[- ]definition)[^\n]*_sharing[^\n]*(?:intersect|∩|AND)/;
		for (const b of blocks) {
			if (b.id === gates.id) continue;
			expect(
				ENUMERATES_GATES.test(b.text),
				`rule ${b.id} (doc line ${b.startLine}) enumerates the exposure gates itself instead of citing ${gates.id} by ID — a restatement is where a gate gets dropped; state the conjunction as ${gates.id}'s and let the reader quote ${gates.id}`
			).toBe(false);
		}
	});

	it('the fourteen inventory rules are fourteen DISTINCT identifiers (qualifications are separately citable, never folded in)', () => {
		const ids = INVENTORY.map(([label, probes]) => blockMatching(label, probes).id);
		expect(new Set(ids).size, `inventory rules share identifiers: ${ids.join(', ')}`).toBe(
			INVENTORY.length
		);
	});
});

// ── 3n. the _parent asymmetry — fenced, not required (Gama 15:27Z) ──────────

describe('_parent asymmetry: scoped-if-present (distil-never-extend fence)', () => {
	it('any rule block mentioning _parent gating carries its full scope: the property, #304, the probe date, and the probe evidence', () => {
		// The spec accepts EITHER a scoped entry OR its absence. What must not
		// ship is a clean general rule resting on one narrow probe.
		const parentBlocks = blocks.filter((b) => /_parent/.test(b.text));
		for (const b of parentBlocks) {
			expect(b.text, `_parent rule at doc line ${b.startLine} missing the issue marker`).toMatch(
				/#304/
			);
			expect(b.text, `_parent rule at doc line ${b.startLine} missing the probe date`).toMatch(
				/2026-09-10/
			);
			expect(
				b.text,
				`_parent rule at doc line ${b.startLine} missing probe evidence (probe-304-parent-rights-gate)`
			).toMatch(/probe-304-parent-rights-gate/);
		}
	});

	it('any rule block mentioning _parent gating disclaims general reach in words, not only by citation', () => {
		// The citation markers above are furniture; the fence itself rests on the
		// block SAYING it is not general Entu behaviour. Strip that sentence and
		// the assertions above still pass, leaving exactly what the 2026-09-10
		// 15:27Z ruling forbids: a clean general rule on one narrow probe.
		const parentBlocks = blocks.filter((b) => /_parent/.test(b.text));
		for (const b of parentBlocks) {
			expect(
				b.text,
				`_parent rule at doc line ${b.startLine} states no not-general disclaimer — a one-probe finding must say in words that it is not established as general Entu behaviour`
			).toMatch(/not established as general|not proven as a general|one probe, one property/i);
		}
	});

	it('any rule block mentioning _parent gating names the db and entity type it was probed on', () => {
		const parentBlocks = blocks.filter((b) => /_parent/.test(b.text));
		for (const b of parentBlocks) {
			expect(
				b.text,
				`_parent rule at doc line ${b.startLine} does not name the probed db (polyphony) — an unscoped finding reads as platform-wide`
			).toMatch(/polyphony/i);
			expect(
				b.text,
				`_parent rule at doc line ${b.startLine} does not name the probed entity type (event)`
			).toMatch(/\bevent\b/i);
		}
	});
});

// ── 4. quotable-whole: bounded, length-capped blocks ────────────────────────

describe('quotable-whole: a rule too long to quote gets paraphrased', () => {
	const MAX_LINES = 12;
	const MAX_CHARS = 1200;

	it(`every identified rule block is at most ${MAX_LINES} lines and ${MAX_CHARS} characters`, () => {
		for (const b of blocks) {
			expect(
				b.lineCount,
				`rule ${b.id} (doc line ${b.startLine}) is ${b.lineCount} lines — split it; IDs attach to individual rules, not sections`
			).toBeLessThanOrEqual(MAX_LINES);
			expect(
				b.text.length,
				`rule ${b.id} (doc line ${b.startLine}) is ${b.text.length} chars — too long to quote whole`
			).toBeLessThanOrEqual(MAX_CHARS);
		}
	});
});

// ── 5. cross-reference format: qualifications cite their base rule by ID ────

describe('cross-references: base rules and their qualifications name each other by ID', () => {
	// Both directions are asserted. Upward (qualification → base) alone leaves the
	// dangerous half invisible: a reader quoting the BASE whole — the whole point of
	// the identifier scheme — would get no signal that a qualification bounds it.
	const PAIRS = [
		{
			base: 'b (base replace rule)',
			baseProbes: INVENTORY[1][1],
			qual: 'c (propagation non-extension)',
			qualProbes: INVENTORY[2][1]
		},
		{
			base: 'b (base replace rule)',
			baseProbes: INVENTORY[1][1],
			qual: 'g (bidirectional demotion)',
			qualProbes: INVENTORY[6][1]
		},
		{
			base: 'a (three visibility gates)',
			baseProbes: INVENTORY[0][1],
			qual: 'i (tier-admitted vs grant-admitted readers)',
			qualProbes: INVENTORY[8][1]
		},
		{
			base: 'f (create auto-grant)',
			baseProbes: INVENTORY[5][1],
			qual: 'g (bidirectional demotion)',
			qualProbes: INVENTORY[6][1]
		},
		{
			base: 'm (changing _sharing requires _owner)',
			baseProbes: INVENTORY[12][1],
			qual: 'n (systemUser write-path bypass)',
			qualProbes: INVENTORY[13][1]
		}
	];

	it.each(PAIRS)('$qual cites its base rule $base by ID', ({ base, baseProbes, qual, qualProbes }) => {
		const b = blockMatching(base, baseProbes);
		const q = blockMatching(qual, qualProbes);
		expect(
			q.text.includes(b.id),
			`rule ${q.id} must cross-reference ${b.id} by ID (bare token), so citing the base without the qualification is visible`
		).toBe(true);
	});

	it.each(PAIRS)('$base names the qualification $qual that bounds it by ID', ({ base, baseProbes, qual, qualProbes }) => {
		const b = blockMatching(base, baseProbes);
		const q = blockMatching(qual, qualProbes);
		// The structural `Qualifications:` line, not merely a mention somewhere in
		// the prose: prose gets rewritten, and the doc's own scheme paragraph makes
		// this line the base rule's contract.
		const qualLine = b.text.split('\n').find((l) => /^\s*Qualifications:/i.test(l));
		expect(
			qualLine,
			`base rule ${b.id} carries no \`Qualifications:\` line — quoting ${b.id} whole must show that ${q.id} bounds it`
		).toBeDefined();
		expect(
			(qualLine ?? '').includes(q.id),
			`base rule ${b.id}'s \`Qualifications:\` line does not list ${q.id}`
		).toBe(true);
	});
});

// ── 6. provenance: no identified rule without an evidence marker ────────────

describe('provenance: every identified rule block carries an evidence line', () => {
	// file:line citation (entu-api source read), probe artifact path, or an
	// explicit unverified mark — a distilled sentence with no evidence line is
	// indistinguishable from an invented one.
	const FILE_LINE = /[\w./-]+\.(?:js|ts|md|json):\d+(?:-\d+)?/;
	const PROBE_PATH = /scripts\/migrations\/(?:probes|seed-results)\/[\w.-]+/;
	const UNVERIFIED = /\[unverified\]/i;

	it('each block matches file:line, a probe path, or [unverified]', () => {
		for (const b of blocks) {
			const ok = FILE_LINE.test(b.text) || PROBE_PATH.test(b.text) || UNVERIFIED.test(b.text);
			expect(
				ok,
				`rule ${b.id} (doc line ${b.startLine}) has no evidence marker — cite \`file:line\`, a probe artifact path, or mark [unverified]`
			).toBe(true);
		}
	});
});

// ── 7. superseded convention: parse-level, no superseded rule need exist ────

describe('superseded convention: a superseded rule keeps its identifier', () => {
	const FIXTURE = [
		'> **ER-1** — an active rule. Evidence: `aggregate.js:86`.',
		'',
		'> **ER-2** (superseded by ER-1, 2026-10-01) — an old rule, id retained. Evidence: `entity.js:115-121`.',
		''
	].join('\n');

	it('the parser recognises the superseded marker and the rule keeps its identifier', () => {
		const parsed = parseRuleBlocks(FIXTURE);
		expect(parsed.map((b) => b.id)).toEqual(['ER-1', 'ER-2']);
		expect(parsed[0].superseded).toBe(false);
		expect(parsed[1].superseded).toBe(true);
	});

	it('in the real doc, superseded rules (if any) still occupy their identifier for uniqueness', () => {
		// Uniqueness above already includes superseded ids; here we only assert
		// the marker parses on the real doc without exploding the block set.
		const superseded = blocks.filter((b) => b.superseded);
		for (const b of superseded) {
			expect(b.id).toMatch(WELL_FORMED_ID);
		}
	});
});

// ── 8. working-notes instruction ────────────────────────────────────────────

describe('working-notes instruction: notes carry identifiers, never restatements', () => {
	it('the instruction lives inside an identified rule block, so #319 can cite it by ID', () => {
		// Prose anywhere in the file is not enough: the forcing layer that will
		// enforce this rule has to name it, and the scheme paragraph promises that
		// "every citable rule below carries a stable identifier". An unidentified
		// normative sentence would be the one rule in this document that cannot be
		// cited — precisely the failure it exists to prevent.
		const block = blocks.find(
			(b) =>
				/notes|scratchpads?/i.test(b.text) && /identifiers?/i.test(b.text) && /restat/i.test(b.text)
		);
		expect(
			block,
			'the notes/scratchpads + identifiers + no-restatement instruction is not inside an identified `ER-<n>` rule block — the instruction that failed on 2026-09-10 must itself be citable'
		).toBeDefined();
	});
});

// ── 9. privacy: the personal name at §7.3 provenance is removed ─────────────

describe('privacy: PO ruling on #318 (2026-09-10 15:27:43Z)', () => {
	it("the doc contains no occurrence of the personal name (replaced by 'the crede editor-grant disappearance investigation')", () => {
		expect(doc).not.toContain('Joosep');
		expect(doc).not.toContain('Loidap');
	});
});
