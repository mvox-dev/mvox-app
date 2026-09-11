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
//
// ── #320 EXTENSION (RED) — the foundation layer gets identifiers ──
//
// #320 (body + Gama 2026-09-10 20:26Z + 2026-09-11 00:18Z) adds to THIS file
// (it is the doc's one mechanical guard; a second spec would fragment it):
// - §1/§2's four foundation rules get identified blocks (INVENTORY o–r), plus
//   two sweep finds (s–t). Next free id is ER-18; the numbering fence below
//   forbids ER-0 / letter suffixes / renumbering — foundations take the NEXT
//   free numbers. Document order and identifier order are allowed to disagree.
// - A new structural line type `Stands on: ER-<n>, …` — declared in the scheme
//   paragraph, used by ER-1/ER-3 (which today presuppose §1/§2 silently) and
//   by ER-7 (which today cites them POSITIONALLY as `(§1–§2)` — the worked
//   example the sweep exists to find, Gama 00:18Z).
// - Not-in-scope fence: §1/§2 prose stays byte-identical; blocks with no #320
//   mandate stay byte-identical (sha256 pins).
//
// ── #322 EXTENSION (RED) — two corrections, identifiers kept ──
//
// #322 (body + Gama's release comment, 2026-09-11) corrects two blocks and
// nothing else. ER-9 is restated DIRECTION-FREE: its "lower/higher" wording
// presupposed a tier power-ranking the document's evidence never establishes
// (ER-22 declines it), so the ranking framing goes while the silent-demotion
// claim stays — Gama's corrected-vs-superseded test: a pre-edit citation of
// ER-9 for the demotion remains sound, a citation of it for ranked tiers was
// never supported. Same rule, identifier KEPT, and a one-line dated correction
// note marks the edit inside the block (the scheme marks supersession only;
// correction must not be the unmarked cheaper path). ER-12's positional
// '(§7.3)' becomes ER-7 — a citation swap inside one block. Section 15 states
// the contract; the section-13 pin map is updated to the corrected ER-9/ER-12
// bytes and grows ER-18..ER-23 (adopted from Bentham's post-#320 residual,
// earmarked for #318 — same one-line close, taken here).
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
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

// ── #322 corrected blocks, authored byte-exact (PO ruling on #316, 2026-09-11 doorbell) ──
//
// RED authors the corrected bytes so the section-13 pin map can pin them at
// RED time — the fence holds THROUGH the sanctioned edit instead of being
// loosened for it. GREEN's whole job on these two blocks is to make the doc
// match. Section 15 states the same contract as readable per-clause
// assertions, so a failure names the ruling it violates, not just a hash.
//
// ER-9: the ranking framing goes ("both directions", "non-monotonic",
// "lower"/"higher"), the claim stays; ER-6 gives the whole replacement
// mechanism, so the restated rule cites it rather than re-deriving it. The
// evidence paths stay; the quoted probe sentence goes with the ranking wording
// it carries. The dated correction note is the block's last line, inside the
// contiguous `>` run.
const CORRECTED_ER9 = [
	'**ER-9** — Since entity CREATE grants the creating caller `_owner` as one direct document (ER-5), a later explicit grant of any other direct tier to that same caller on that same entity replaces it (ER-6) and silently demotes the creator from owner — the replace happens with no error and no notice.',
	'Evidence: `scripts/migrations/probes/probe-entu-rights-supersession-cases-2026-09-09.ts`; results `scripts/migrations/seed-results/probe-entu-rights-supersession-cases-live-2026-09-09T17-04-41-123Z.json`.',
	'Corrected 2026-09-11: ranking wording removed; the claim is unchanged.'
].join('\n');

// ER-12: one token swaps — the rule sentence's positional '(§7.3)' becomes
// '(ER-7)'. Nothing else moves: the evidence line's own '§7.3' mentions are
// navigation notes and stay.
const CORRECTED_ER12 = [
	'**ER-12** — `_sharing` and `_inheritrights` govern different axes: `_sharing` decides which bucket (`private`/`domain`/`public`) a property\'s value is written into; `_inheritrights` decides whether a parent\'s rights cascade onto a child (ER-7). Conflating the two axes answers "who can see this?" wrongly in either direction. This rule makes no claim about when either axis is evaluated — it distinguishes what each one decides.',
	'Evidence: `aggregate.js:86,94,113-121,269-275` (the `_sharing` axis); `aggregate.js:166-183` (the `_inheritrights` cascade, §7.3) — `entu-api` source-read 2026-09-10. Clarifying distinction over ER-18, ER-19, ER-20, ER-21 and §7.3; adds no new claim.',
	'Stands on: ER-18, ER-20, ER-1.'
].join('\n');

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

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

// #320: the foundation layer. Four separable rules (research-320 findings 1a-1d):
// §1 holds two — bucket structure, write-time snapshot semantics — and §2 holds
// two — exactly-one-bucket selection, and the tier-priority order itself (no
// existing ER states the order; ER-4 contrasts formulas without naming it).
// Probes name CONTENT, never ids and never position; GREEN picks the ids
// (next-free — the numbering fence below). Distil-never-extend applies: every
// block's claim must already be stated and evidenced in §1/§2's own prose.
const SECTION1_FOUNDATIONS: [string, RegExp[]][] = [
	['o. §1 foundation: aggregateEntity materializes the three property buckets on the stored document', [/aggregateEntity/, /three property (?:objects|buckets)/i, /private/, /access[`\s]*array/i]],
	['p. §1 foundation: buckets are write-time snapshots — a read returns whatever was last written', [/snapshots? taken at write time/i, /not computed at read time/i]]
];
const SECTION2_FOUNDATIONS: [string, RegExp[]][] = [
	['q. §2 foundation: a read returns exactly one bucket, first match wins; no bucket admitted → 403', [/exactly one bucket/i, /first match wins/i, /403/]],
	['r. §2 foundation: the tier-priority order — explicit grant, then domain, then public', [/explicit grant/i, /\bdomain\b/, /\bpublic\b/, /priorit|precedence|outrank/i]]
];
// #320 sweep additions (the issue's mechanical test — "if a rule cannot be
// stated without relying on something, that something is a rule"):
// s. the rightTypes enumeration (presupposed by ER-5/6/7/9/11/17; the evidenced
//    array sits in §5 prose, entity.js:21-29, outside any citable block);
// t. rights-tier arrays, like buckets, are write-time products of the same
//    aggregateEntity pass (presupposed by ER-6/7/9; doc §1 line + ER-7's
//    aggregate.js:166-183/185-209 evidence).
// NOTE for GREEN: each probe set must match EXACTLY ONE block — keep t's
// wording clear of p's distinctive "snapshots taken at write time" phrase, and
// keep o's block free of the word "rights-tier".
const SWEEP_320: [string, RegExp[]][] = [
	['s. sweep: the rightTypes enumeration — the seven rights-type properties as one citable rule', [/_noaccess/, /_inheritrights/, /_expander/, /rightTypes|rights-type/i]],
	['t. sweep: rights-tier arrays are write-time products of the same aggregateEntity pass as the buckets', [/aggregateEntity/, /rights-tier|aggregated rights/i, /write[- ]time/i]]
];

// Each entry: [label, probes]. Probes are matched against rule-block text only.
const INVENTORY: [string, RegExp[]][] = [
	['a. three visibility gates, narrowest wins', [/narrowest wins/i, /gate/i, /prop-def|property definition/i]],
	['b. one direct rights-tier per (reference, entity); new direct grant replaces', [/at most one active direct/i, /rights-tier/i, /replac|retir/i]],
	['c. propagation non-extension (own rule, qualification of b)', [/propagat/i, /child/i, /never|does not|not\b/i]],
	['d. direct and inherited are separate additive layers', [/additive/i, /inherited/i, /single-tier|single tier/i]],
	['e. _sharing vs _inheritrights are different axes', [/_sharing/, /_inheritrights/, /ax[ei]s/i]],
	['f. CREATE auto-grants caller _owner as one direct doc, all four tiers', [/auto-grant/i, /_owner/, /four tiers/i]],
	// #322: this probe set used to pin the OLD ranking wording (`non-monotonic|
	// both directions`) — exactly what the correction removes. Repinned on the
	// claim itself, which survives the restatement (issue body: "extend only if
	// an assertion pins the old wording").
	['g. a later grant to the creator silently demotes them from owner', [/demot/i, /creator|creating caller/i, /no error and no notice/i]],
	['h. _viewer-alone suffices for full private-bucket read', [/_viewer/, /alone/i, /private bucket/i]],
	['i. tier-admitted vs grant-admitted readers get different answers', [/tier-admitted/i, /grant-admitted/i]],
	['j. create copies the parent _sharing unless the POST sets it explicitly', [/_sharing/, /parent/i, /cop(y|ies|ied)/i, /omit|explicit/i]],
	['k. _viewer:<entity-id> is accepted but inert', [/inert/i, /accepted/i]],
	['l. the database boundary is a read boundary', [/read boundary/i, /database|\bdb\b/i]],
	['m. changing _sharing requires _owner', [/_sharing/, /_owner/, /chang/i]],
	['n. a systemUser caller bypasses the _owner requirement on the write path (own rule, qualification of m)', [/systemUser/, /bypass/i, /write path/i]],
	// #320 — appended AFTER the original fourteen so PAIRS' indexes stay stable.
	...SECTION1_FOUNDATIONS,
	...SECTION2_FOUNDATIONS,
	...SWEEP_320
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

	it('every inventory rule has its own DISTINCT identifier (qualifications and foundations are separately citable, never folded in)', () => {
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
			qual: 'g (silent demotion of the creator)',
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
			qual: 'g (silent demotion of the creator)',
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

// ── 10. #320 numbering fence: foundations take the NEXT free numbers ────────

describe('#320 numbering fence: next-free numbers, never low ones (Gama 20:26Z)', () => {
	// The instinct runs the other way — a foundation numbered after seventeen
	// findings reads as a filing error. Renumbering, ER-0, or ER-1a silently
	// repoints every citation already written, with no error and no broken
	// link. Document order and identifier order are allowed to disagree.

	it('no ER-0 and no letter-suffixed id (ER-1a shape) anywhere in the doc', () => {
		expect(doc, 'ER-0 minted — identifiers are creation-order, never slotted in front').not.toMatch(/\bER-0\b/);
		expect(doc, 'letter-suffixed id (ER-<n><letter>) minted — identifiers are creation-order, never slotted in front').not.toMatch(/\bER-\d+[A-Za-z]/);
	});

	it('ER-1 through ER-17 all still resolve to defined rules (no renumbering)', () => {
		const defined = new Set(blocks.map((b) => b.id));
		for (let n = 1; n <= 17; n += 1) {
			expect(defined.has(`ER-${n}`), `ER-${n} no longer resolves — renumbering silently repoints every citation already written`).toBe(true);
		}
	});

	it('every id number resolves or is retained as a superseded block — a retired id is never renumbered away', () => {
		// This assertion USED to read `last === length`: the doc may never have a
		// hole in its id sequence. That is not #317's rule — #317 says ids are
		// opaque, creation-order, never reused and never renumbered, which says
		// nothing about gaps. The two only coincide while nothing leaves the doc,
		// and the moment a rule did leave, the cheapest way to green an equality
		// is to renumber the survivors — the exact silent-repointing failure the
		// scheme exists to prevent, applied by its own guard.
		//
		// So the check stays (a hole is still worth reporting) but the remedy is
		// named, and it is the one #317 already prescribes: a rule is retired by
		// SUPERSEDING it — the block stays, marked `(superseded by ER-<m>,
		// <date>)`, holding its number forever. Never by renumbering.
		const ns = blocks.map((b) => Number(b.id.slice(3))).sort((a, b) => a - b);
		expect(new Set(ns).size, 'duplicate id numbers').toBe(ns.length);
		// Sweeping from 1 rather than from ns[0] also covers a missing ER-1, so no
		// separate lowest-is-ER-1 assertion is needed — and it reports that case
		// with the remedy spelled out instead of a bare "lowest id is not ER-1".
		const missing: number[] = [];
		for (let n = 1; n < ns[ns.length - 1]; n += 1) {
			if (!ns.includes(n)) missing.push(n);
		}
		expect(
			missing.map((n) => `ER-${n}`),
			`these ids resolve to no block. #317 retires a rule by SUPERSEDING it: keep the block, mark its first line \`(superseded by ER-<m>, <date>)\`, and it keeps its number forever — restore a superseded stub for each id listed. Do NOT renumber the surviving rules to close the hole, and do not reuse a freed number: either one silently repoints every citation already written, with no error and no broken link.`
		).toEqual([]);
	});

	it('every foundation and sweep rule is numbered AFTER the seventeen existing rules', () => {
		for (const [label, probes] of [...SECTION1_FOUNDATIONS, ...SECTION2_FOUNDATIONS, ...SWEEP_320]) {
			const b = blockMatching(label, probes);
			expect(
				Number(b.id.slice(3)),
				`${b.id} ("${label}") is slotted in front of the existing sequence — foundations take the NEXT free numbers (ER-18 onward)`
			).toBeGreaterThanOrEqual(18);
		}
	});
});

// ── 11. #320 foundation citations: the `Stands on:` line ────────────────────

describe('#320 foundation citations: `Stands on:` lines (one-way by design)', () => {
	// The scheme paragraph defines only `Qualifications:` — BOUNDING semantics,
	// the wrong relation here (a foundation does not bound the rules above it).
	// #320 adds a second structural line type: `> Stands on: ER-<n>, …`.
	//
	// DELIBERATE ASYMMETRY with the Qualifications pairs check: the relation is
	// ONE-WAY, dependent → foundation. A base rule must warn that it is bounded
	// (quoting it whole without the qualification states a falsehood), so
	// Qualifications is bidirectional. A foundation is NOT falsified by being
	// quoted without its dependents, and a dependents list would force an edit
	// of the foundation block on every new citation. So: no PAIRS entries for
	// Stands on — foundations never name their dependents.

	const standsOnLines = (b: RuleBlock) =>
		b.text.split('\n').filter((l) => /^\s*Stands on:/i.test(l));

	it('the scheme paragraph declares the Stands on: line type (additive sentence — Qualifications keeps its bounding semantics)', () => {
		const scheme = doc.split('\n').find((l) => l.includes('Identifier scheme'));
		expect(scheme, 'scheme paragraph ("Identifier scheme") not found').toBeDefined();
		expect(
			scheme ?? '',
			'the scheme paragraph does not declare the `Stands on:` structural line — an undeclared line type is a folded-in convention, exactly what the scheme forbids'
		).toMatch(/Stands on:/);
	});

	it('every `> Stands on:` line sits INSIDE an identified rule block (after a blank line it becomes an orphan, id-less blockquote the parser skips)', () => {
		// Parser fact (research-320 blast 2b): contiguous `>` lines are absorbed
		// into the block; a `>` line after a blank line silently falls out.
		const lines = doc.split('\n');
		const ranges = blocks.map((b) => [b.startLine, b.startLine + b.lineCount - 1]);
		lines.forEach((line, idx) => {
			if (!/^>\s*Stands on:/i.test(line)) return;
			const n = idx + 1;
			expect(
				ranges.some(([a, z]) => n >= a && n <= z),
				`Stands on: line at doc line ${n} is not inside any identified rule block — a blank line orphaned it`
			).toBe(true);
		});
	});

	it('every id on a Stands on: line resolves to a defined rule', () => {
		const defined = new Set(blocks.map((b) => b.id));
		for (const b of blocks) {
			for (const l of standsOnLines(b)) {
				const tokens = l.match(ID_TOKEN) ?? [];
				expect(tokens.length, `rule ${b.id}'s Stands on: line names no rule ids`).toBeGreaterThan(0);
				for (const t of tokens) {
					expect(defined.has(t), `rule ${b.id} stands on ${t}, which resolves to no defined rule`).toBe(true);
				}
			}
		}
	});

	const DEPENDENTS: [string, RegExp[]][] = [
		// ER-1: "tier-admitted" needs §2's bucket selection; three-gate AND needs §1's buckets.
		['a. three visibility gates, narrowest wins', INVENTORY[0][1]],
		// ER-3: "entity rights decide the bucket" needs §1's buckets and §2's grant branch.
		['h. _viewer-alone suffices for full private-bucket read', INVENTORY[7][1]]
	];

	it.each(DEPENDENTS)('%s carries a Stands on: line citing at least one §1 foundation and one §2 foundation by ID', (label, probes) => {
		const s1Ids = SECTION1_FOUNDATIONS.map(([l, p]) => blockMatching(l, p).id);
		const s2Ids = SECTION2_FOUNDATIONS.map(([l, p]) => blockMatching(l, p).id);
		const b = blockMatching(label, probes);
		const line = standsOnLines(b)[0];
		expect(line, `rule ${b.id} ("${label}") carries no Stands on: line — it presupposes the foundation silently (#320's core gap)`).toBeDefined();
		const tokens = line?.match(ID_TOKEN) ?? [];
		expect(
			tokens.some((t) => s1Ids.includes(t)),
			`rule ${b.id}'s Stands on: line (${line}) cites no §1 foundation id (${s1Ids.join(', ')})`
		).toBe(true);
		expect(
			tokens.some((t) => s2Ids.includes(t)),
			`rule ${b.id}'s Stands on: line (${line}) cites no §2 foundation id (${s2Ids.join(', ')})`
		).toBe(true);
	});

	it('caller-identity/grant-matching is stated by at most ONE block (present-or-absent — the soft gap, research-320 sweep)', () => {
		// The general userStr-in-access mechanic is only PARTIALLY covered
		// (ER-10 narrows it to the db boundary). The spec does not hard-require
		// a new rule here: GREEN applies the issue's mechanical test and
		// reports. What must not happen is the mechanic restated across
		// several blocks instead of cited.
		const hits = blocks.filter((b) => /userStr/.test(b.text) && !/read boundary/i.test(b.text));
		expect(
			hits.length,
			`the caller-identity/grant-matching mechanic is restated across ${hits.length} blocks (${hits.map((b) => b.id).join(', ')}) — one citable rule or none`
		).toBeLessThanOrEqual(1);
	});
});

// ── 12. #320 positional-citation conversion (Gama 00:18Z) ───────────────────

describe('#320: no rule cites the foundation sections positionally once they carry ids', () => {
	// Sections are POSITIONS: inserting a section above §1/§2 silently repoints
	// a `(§1–§2)` citation with no error and no broken link. ER-7 and ER-12 both
	// did exactly this — the worked examples the sweep exists to find.
	//
	// The guard scans §-RANGES, not the literal '§1–§2' token it was first
	// written for. A per-token guard is what let ER-12's rule sentence keep
	// '(§1–§3)' while its own Evidence line had already been converted to
	// identifiers: the same block citing the same two sections both ways, and
	// nothing failed. A §-range can only be read by treating section numbers as
	// an ordered span, so every range in a rule block is a positional citation
	// of content that now has identifiers to land on.
	//
	// Deliberately NOT scanned: single-section mentions — ER-1's 'Distills §3',
	// ER-3's 'property-tier `_sharing` (§3)', ER-10's '(§4)', ER-12's
	// evidence-line '§7.3' mentions (its rule-sentence '(§7.3)' converts to
	// ER-7 under #322 — see section 15; the evidence mentions stay).
	// Those are navigation/provenance notes ("the prose this distills lives
	// there"), which the scheme paragraph keeps as a legitimate use of §N, and
	// several sit in blocks pinned byte-exact below. Converting them is a
	// separate decision, not this guard's business.
	const POSITIONAL_SECTION_RANGE = /§\s*\d+(?:\.\d+)*\s*[–—-]\s*§?\s*\d+(?:\.\d+)*/;

	it("ER-7 (additive layers) no longer contains the positional token '(§1–§2)'", () => {
		const b = blockMatching('d. direct and inherited are separate additive layers', INVENTORY[3][1]);
		expect(
			POSITIONAL_SECTION_RANGE.test(b.text),
			`rule ${b.id} still cites the foundation positionally as §1–§2 — convert to the foundation identifiers in the same commit that mints them`
		).toBe(false);
	});

	it('ER-7 cites the applicable foundation identifiers instead (Stands on: line or bare in-text ids — same mechanism as ER-1/ER-3)', () => {
		const b = blockMatching('d. direct and inherited are separate additive layers', INVENTORY[3][1]);
		const foundationIds = [...SECTION1_FOUNDATIONS, ...SECTION2_FOUNDATIONS, ...SWEEP_320].map(
			([l, p]) => blockMatching(l, p).id
		);
		const tokens = b.text.match(ID_TOKEN) ?? [];
		expect(
			tokens.some((t) => foundationIds.includes(t)),
			`rule ${b.id} cites no foundation identifier (${foundationIds.join(', ')}) — the (§1–§2) reference already existed, it just had no identifier to land on`
		).toBe(true);
	});

	it('no identified rule block cites a span of sections as a §-range', () => {
		for (const b of blocks) {
			expect(
				b.text.match(POSITIONAL_SECTION_RANGE)?.[0] ?? null,
				`rule ${b.id} (doc line ${b.startLine}) cites a span of sections positionally — name the identified rules the span distils (each section §1–§7 now has them); a §-range repoints silently the moment a section is inserted, and sections stay navigation only`
			).toBeNull();
		}
	});

	it('ER-12 (the two axes) cites the foundation identifiers, not a §-range, for the `_sharing` axis', () => {
		// The half-conversion this guards: ER-12's Evidence line was converted to
		// identifiers while its operative sentence kept '(§1–§3)'. The rule text is
		// the half a reader quotes, so it is the half that matters most.
		const b = blockMatching('e. _sharing vs _inheritrights are different axes', INVENTORY[4][1]);
		const foundationIds = [...SECTION1_FOUNDATIONS, ...SECTION2_FOUNDATIONS].map(([l, p]) =>
			blockMatching(l, p).id
		);
		const tokens = b.text.match(ID_TOKEN) ?? [];
		expect(
			tokens.some((t) => foundationIds.includes(t)),
			`rule ${b.id} cites no §1/§2 foundation identifier (${foundationIds.join(', ')}) — its '_sharing decides which bucket' sentence stands on them`
		).toBe(true);
		const standsOn = b.text.split('\n').find((l) => /^\s*Stands on:/i.test(l));
		expect(
			standsOn,
			`rule ${b.id} carries no Stands on: line — it leans on the bucket foundation, and the dependency belongs on the structural line, not only in the evidence prose`
		).toBeDefined();
	});
});

// ── 13. #320 not-in-scope fence: what this slice must NOT change ────────────

describe('#320 fence: §1/§2 prose and unmandated blocks stay byte-identical', () => {
	// The issue's own fence: "Not in scope: changing what §1 and §2 say. They
	// are correct and evidenced; this gives them addresses."
	//
	// Two checks guard it, split by what each pins: this list pins the nine
	// sentences below as EXACT verbatim text (matched anywhere in the doc, so it
	// catches an edit to any one of them and names it in the failure message),
	// and the checksum further down pins everything ELSE in the §1→§3 slice —
	// both headings, the rest of §2's code block, the 'Why `private` is robust'
	// paragraph — minus the ER blockquotes this slice is sanctioned to add.
	const OPERATIVE_SENTENCES = [
		'Every entity write runs `aggregateEntity` (`utils/aggregate.js`), which materializes three property objects on the stored document:',
		'- `propertiesToEntity` seeds `private` / `domain` / `public` as empty objects plus an `access` array (`aggregate.js:312-320`).',
		'- All actual property values always populate `private`. `domain` and `public` are selectively populated copies (§3).',
		'The buckets are **snapshots taken at write time**, not computed at read time. This is the single most important structural fact: a read returns whatever was last written into these objects.',
		'`cleanupEntity` (`utils/entity.js:569-612`) selects one bucket by reader tier (`entity.js:573-586`):',
		'if (entu.userStr && entity.access?.map(x => x.toString())?.includes(entu.userStr)) {',
		"} else if (entu.userStr && entity.access?.includes('domain')) {",
		'First match wins. The route handler turns the `undefined` return into `403 "No accessible properties"` (`routes/[db]/entity/[_id]/index.get.js:97-102`).',
		"There is no string coincidence that could make `'private'` satisfy a `'domain'`/`'public'` check."
	];

	it('the operative §1/§2 sentences are present verbatim', () => {
		for (const s of OPERATIVE_SENTENCES) {
			expect(doc.includes(s), `operative §1/§2 sentence missing or edited: "${s.slice(0, 70)}…"`).toBe(true);
		}
	});

	// The checksum half of that split, and the reason the list alone was not
	// enough: everything the nine sentences do not name could be rewritten with
	// the list still green. The §1–§2 prose, with #320's own ER blockquotes
	// removed, must hash to what MAIN's prose hashes to.
	//
	// The pin is computed from `git show main:<doc>` put through the SAME
	// normalization, so it certifies the prose equals the pre-#320 prose — not
	// merely that this branch agrees with itself. A failure here says only that
	// something in the slice moved; the list above is what names which claim,
	// which is why both stay.
	const FOUNDATION_PROSE_SHA256 = '113c032718275033757750e07ca10b58a7b592bfb025fce30c76190fc9ed1d4f';

	// §1's heading through the line before §3's, minus the blockquote blocks this
	// slice is sanctioned to add and the blank-line runs their removal leaves
	// behind. The exemption is ER DEFINITION blocks specifically — a block whose
	// first line matches DEFINITION_FIRST_LINE. Any other blockquote is prose the
	// fence holds: exempting `>` wholesale would let a claim be smuggled into
	// §1/§2 as a plain note (`> Note: buckets are computed at read time.`) with
	// both guard layers green.
	const foundationProse = (text: string): string => {
		const lines = text.split('\n');
		const start = lines.findIndex((l) => l.startsWith('## 1. Three property buckets'));
		const end = lines.findIndex((l) => l.startsWith('## 3. Per-property sharing'));
		if (start < 0 || end <= start) {
			throw new Error(
				`cannot bound the foundation prose (§1 heading at ${start}, §3 heading at ${end}) — a renamed section heading blinds this fence`
			);
		}
		const slice = lines.slice(start, end);
		const kept: string[] = [];
		for (let i = 0; i < slice.length; ) {
			if (!slice[i].startsWith('>')) {
				kept.push(slice[i]);
				i += 1;
				continue;
			}
			const from = i;
			while (i < slice.length && slice[i].startsWith('>')) i += 1;
			if (!DEFINITION_FIRST_LINE.test(slice[from])) kept.push(...slice.slice(from, i));
		}
		return kept.filter((l, i) => l.trim() !== '' || (kept[i - 1] ?? 'x').trim() !== '').join('\n');
	};

	const foundationProseSha = (text: string): string =>
		createHash('sha256').update(foundationProse(text), 'utf8').digest('hex');

	it('the whole §1/§2 prose is byte-identical to main, ER definition blocks aside', () => {
		expect(
			foundationProseSha(doc),
			"§1/§2 prose was edited — the issue's fence is \"Not in scope: changing what §1 and §2 say\", so this slice may only ADD ER definition blocks there. Repin only behind a PO ruling that changes the prose: git show main:docs/architecture/entu-rights-and-visibility-model.md, slice §1 heading→§3 heading, drop ER definition blocks, collapse blank runs, sha256"
		).toBe(FOUNDATION_PROSE_SHA256);
	});

	it('that checksum is sensitive to §1/§2 prose the sentence list leaves unpinned', () => {
		// Without these, a fence that silently stopped covering prose — bounds that
		// slipped, an exemption that ate real lines — would read as green.

		// Reword probe: 'robust' sits in no OPERATIVE_SENTENCES entry, so the hash
		// is the only layer that can see this edit.
		const reworded = doc.replace('**Why `private` is robust:**', '**Why `private` is sturdy:**');
		expect(
			reworded,
			"the 'Why `private` is robust' paragraph was renamed or moved — retarget this probe at prose the sentence list still does not cover"
		).not.toBe(doc);
		expect(
			foundationProseSha(reworded),
			'rewording an unpinned §1/§2 paragraph did not move the checksum — the slice bounds or the ER-block exemption are discarding prose the fence is supposed to hold'
		).not.toBe(FOUNDATION_PROSE_SHA256);

		// Insert probe: only ER DEFINITION blocks are exempt. A plain blockquote is
		// an unsanctioned addition to §1/§2 — and a way to smuggle in a claim that
		// contradicts the section — so it must move the hash as well.
		const smuggled = doc.replace(
			'**Why `private` is robust:**',
			'> Note: buckets are actually computed at read time.\n\n**Why `private` is robust:**'
		);
		expect(
			foundationProseSha(smuggled),
			'a non-ER blockquote added inside §1→§3 did not move the checksum — the exemption is matching blockquotes wholesale instead of ER definition blocks only, which lets unsanctioned prose in as a plain note'
		).not.toBe(FOUNDATION_PROSE_SHA256);
	});

	// Every block with no LIVE mandate, pinned byte-exact (sha256 of parsed
	// block text). #320 excluded the blocks it changed (ER-1/ER-3 gained a
	// Stands on: line, ER-7/ER-12 converted the §1–§2 positional token); ER-16
	// is pinned: research-320 finding 6 confirmed its wording is generic and
	// needs no edit.
	//
	// #322 maintenance (the sanctioned edit): ER-9's pre-#320 hash and ER-12's
	// missing entry are replaced by pins of the CORRECTED blocks, computed from
	// the constants at the top of this file — section 15 asserts the same bytes
	// with a readable diff. And ER-18..ER-23 join the set: #320 landed, so the
	// foundation blocks are no longer a live deliverable — pinning them closes
	// the append-inside-an-ER-block-run path with no new machinery (adopted
	// from Bentham's post-#320 residual, earmarked for #318; taken here as the
	// same one-line close, earlier).
	const UNTOUCHED_SHA256: Record<string, string> = {
		'ER-2': '01cecca21a2ac74eedd7e04a0c3ff94a14f55c8d2d3ef5951016d769c4edf9dc',
		'ER-4': 'd8de9757c674fbeb12c169fab48867e05e53967e76d54062e0aced194842af0e',
		'ER-5': '0bb58d543f78e49bb144ebbbf3574b6fa61db94be1df1396180ccc3b314fbdeb',
		'ER-6': 'da1263a637b9d80e3826cca351c9576f797152c6c8c22edcfbdc1276a2a777ab',
		'ER-8': '7b0b4c356bd6df7eb4419e563f17a47c16168ce8a0cd848110a76916a2bb6fdf',
		'ER-9': sha256(CORRECTED_ER9),
		'ER-10': '28adf40b8bff7d80874167ac8321a5614f05ae60f97a2b4c60df11d3d7670645',
		'ER-11': 'b2ee2bb1fdd1e2ef1527f81795d5b44450af6916f1b8b148b5485641846de4af',
		'ER-12': sha256(CORRECTED_ER12),
		'ER-13': '348e4b0811f6e66d5024874c32bb202c6a8cc1cff0af4718a65af2363a3e2dd5',
		'ER-14': '665ec0affb05b5f0aeb3ead0069606c4ee7bc2b2c63af389bc89e9a6fdde4b37',
		'ER-15': '00b855448d2750eed3be8df26576c9aadd4106f315930fe77c3cd11367fe67eb',
		'ER-16': '874ee3f28195c10f2da3ff44fe32e8c8e4da8298f8829e79df21a12bda5af12f',
		'ER-17': 'de114fc7b40b8bf254dbda34ab19bda2162433fc91a86b15e86b54d6e6f1be0e',
		'ER-18': '575f4c3aa26a49c4de82eb29aed0e26faf0b07f27536fc25b26d8c260a38471c',
		'ER-19': 'c17def0a84e575602e99333d997170604d7d455cf1f607b416f957da285ce634',
		'ER-20': '107340afe6b83a9525fcea23d0c6bb4ad096f85720a7d2cf92d79fbb21f2b8d8',
		'ER-21': '3023f8f8249a0aad8a675f16263ed2dbf55a8d75aa5b3c3ca4352e738000dbac',
		'ER-22': 'bfa254e4a9153d17cd759662389fd0d35c5cb5f0a26d57678d275e58bfefe442',
		'ER-23': 'f9cfa166ac4752880b1cb58119c28f1d92f77de070a62f9d69d483dfddd2be40'
	};

	it('every pinned block matches its sanctioned bytes (pre-#320 state; #322-corrected state for ER-9/ER-12)', () => {
		for (const [id, hash] of Object.entries(UNTOUCHED_SHA256)) {
			const b = blocks.find((x) => x.id === id);
			expect(b, `${id} disappeared from the doc`).toBeDefined();
			expect(
				sha256(b?.text ?? ''),
				`${id} (doc line ${b?.startLine}) does not match its pin — sanctioned edits: #320 (ER-1/ER-3 Stands on: lines, ER-7 token conversion) and #322 (ER-9 direction-free restatement + dated correction note, ER-12 '(§7.3)'→'(ER-7)'; those two must match the CORRECTED constants, see section 15 for the readable diff)`
			).toBe(hash);
		}
	});

	it('ER-1 keeps its original sentences — the Stands on: line is ADDED, nothing rewritten', () => {
		const b = blockMatching('a. three visibility gates, narrowest wins', INVENTORY[0][1]);
		for (const s of [
			'Bucket exposure is a three-gate AND, narrowest wins',
			'A reader admitted by an explicit grant is not bounded by these gates at all',
			'Distills §3; adds no new claim.',
			'Qualifications: ER-4.'
		]) {
			expect(b.text.includes(s), `ER-1 original text edited — missing: "${s}"`).toBe(true);
		}
	});

	it('ER-3 keeps its original sentences — the Stands on: line is ADDED, nothing rewritten', () => {
		const b = blockMatching('h. _viewer-alone suffices for full private-bucket read', INVENTORY[7][1]);
		for (const s of [
			'grant already suffices for full private bucket read',
			'entity rights decide the bucket, and the whole private bucket is exposed once any grant admits the caller to it',
			'probe-294-entu-user-cross-admin-read-2026-09-08.ts'
		]) {
			expect(b.text.includes(s), `ER-3 original text edited — missing: "${s}"`).toBe(true);
		}
	});

	it('ER-7 keeps its rule content — only the positional citation converts', () => {
		const b = blockMatching('d. direct and inherited are separate additive layers', INVENTORY[3][1]);
		expect(b.text).toContain('Direct and inherited rights are separate, additive layers');
		expect(b.text).toContain('Only the direct layer is single-tier-per-reference (ER-6)');
	});

	it('ER-12 keeps its rule content — only its §1–§2 token converts', () => {
		const b = blockMatching('e. _sharing vs _inheritrights are different axes', INVENTORY[4][1]);
		expect(b.text).toContain('govern different axes');
		expect(b.text).toContain('it distinguishes what each one decides');
	});
});

// ── 14. #320 review findings: citation hygiene the earlier guards missed ─────

describe('citation hygiene: the forms a rule block may NOT use to cite', () => {
	// All four landed green before these assertions existed, which is why they
	// exist. Each is a class of citation the identifier scheme was built to
	// retire, and each is checkable mechanically.

	it('no rule block cites this document by line number (a self-citation repoints on any insertion above it)', () => {
		// Worse than the `(§1–§2)` token the scheme already forbids: a section
		// token at least survives edits inside the section. It is also not one of
		// the three sanctioned evidence forms (entu-api file:line, probe artifact
		// path, [unverified]). Cite the rule's identifier instead.
		for (const b of blocks) {
			expect(
				/doc\s+line\s+\d+/i.test(b.text),
				`rule ${b.id} (doc line ${b.startLine}) cites this document positionally ("doc line N") — cite the identified rule that states the fact, or an entu-api file:line`
			).toBe(false);
		}
	});

	it('no ER token is cited as a dash-range with another ER token — ranges presume the contiguous ordering the scheme denies', () => {
		// `ER-18–ER-21` can only be read by treating the numbers as an ordered
		// sequence; the scheme declares them opaque and creation-order. It also
		// hides the interior ids from the resolver above (ID_TOKEN sees only the
		// endpoints), so a dangling middle reference would never be caught.
		const RANGE = /ER-\d+\s*[–—-]\s*ER-\d+/;
		const m = doc.match(RANGE);
		expect(
			m?.[0] ?? null,
			'identifiers are cited as a numeric range — enumerate them (ER-18, ER-19, …); the numbers are opaque and carry no contiguity'
		).toBeNull();
	});

	it('the rights-type-set rule states the seven names and makes no claim about what the document as a whole evidences', () => {
		// Its source (entity.js:21-29) evidences the set. It cannot evidence a
		// meta-claim about the rest of this document — and the one it asserted
		// ("no ordering among the tiers") is denied by ER-5 and by the tier fold
		// at aggregate.js:185-209, leaving two identified rules in contradiction.
		const b = blockMatching(SWEEP_320[0][0], SWEEP_320[0][1]);
		for (const name of [
			'_noaccess',
			'_viewer',
			'_expander',
			'_editor',
			'_owner',
			'_sharing',
			'_inheritrights'
		]) {
			expect(b.text.includes(name), `rule ${b.id} does not name ${name}`).toBe(true);
		}
		expect(
			/the doc evidences no|no ordering among|not a power-ranking/i.test(b.text),
			`rule ${b.id} asserts what the document as a whole does or does not evidence — its source evidences the set only; a tier-ordering claim needs its own rule and its own evidence`
		).toBe(false);
	});

	it('a foundation named on a `Stands on:` line never names its dependent back (the relation is one-way)', () => {
		// The scheme paragraph: "additive and one-way: a foundation names no
		// dependents in return". A foundation that cannot be quoted without its
		// dependent is not a foundation. Mirror of the Qualifications pair check,
		// in the inverse direction.
		const dependentsOf = new Map<string, string[]>();
		for (const b of blocks) {
			for (const l of b.text.split('\n').filter((x) => /^\s*Stands on:/i.test(x))) {
				for (const t of l.match(ID_TOKEN) ?? []) {
					dependentsOf.set(t, [...(dependentsOf.get(t) ?? []), b.id]);
				}
			}
		}
		for (const [foundationId, dependents] of dependentsOf) {
			const f = blocks.find((b) => b.id === foundationId);
			expect(f, `${foundationId} is stood on but resolves to no block`).toBeDefined();
			const tokens = new Set(f?.text.match(ID_TOKEN) ?? []);
			for (const d of dependents) {
				expect(
					tokens.has(d),
					`foundation ${foundationId} names its dependent ${d} — the dependency is one-way, and a foundation stated through its dependent cannot be quoted whole on its own`
				).toBe(false);
			}
		}
	});
});

// ── 15. #322: two corrections, identifiers kept (PO ruling on #316, 2026-09-11) ──

describe('#322: ER-9 restated direction-free — the ranking framing goes, the demotion claim stays', () => {
	// The ruling verbatim: "restate ER-9 direction-free — ER-6 gives the whole
	// replacement mechanism; a tier-ranking rule minted to save the old sentence
	// would extend evidence." Gama's corrected-vs-superseded test (#322 release
	// comment): a pre-edit citation of ER-9 for "a later grant can silently
	// demote the creator from owner" remains sound; a citation of it for "grant
	// tiers are ranked" was never supported — the document never established
	// that ranking, and ER-22 declines it outright. No sound citation breaks,
	// so it is the same rule, and the identifier is KEPT.

	const er9 = () => blocks.find((b) => b.id === 'ER-9');

	it('ER-9 still resolves and is NOT marked superseded — this is a correction, not a supersession', () => {
		const b = er9();
		expect(b, 'ER-9 disappeared — a correction keeps the identifier; nothing here is retracted').toBeDefined();
		expect(
			b?.superseded,
			'ER-9 reads as superseded — supersession is for a believed-and-cited claim becoming WRONG; here the claim survives verbatim, so the identifier stays active (stop and raise on #322 if this seems to be a supersession after all)'
		).toBe(false);
	});

	it('ER-9 contains no ranking or direction language', () => {
		const b = er9();
		// 'demote' is deliberately NOT in this list: the silent demotion of the
		// creator IS the claim, and it survives. What goes is the comparative
		// tier-ranking framing ('lower'/'higher', 'non-monotonic', 'both
		// directions', 'the reverse') that presupposes a rank the document's
		// evidence never establishes.
		const RANKING = [/\blower\b/i, /\bhigher\b/i, /monotonic/i, /\bdirections?\b/i, /\breverse\b/i];
		for (const p of RANKING) {
			expect(
				b?.text ?? '',
				`ER-9 still carries ranking/direction wording (${p}) — restate direction-free: ER-6 gives the whole replacement mechanism, and a tier-ranking rule minted to save the old sentence would extend evidence`
			).not.toMatch(p);
		}
	});

	it('ER-9 keeps the silent-demotion claim and its cross-references (ER-5, ER-6)', () => {
		const t = er9()?.text ?? '';
		expect(t, 'the silent demotion of the creator is the claim — it must survive the restatement').toMatch(/silently demot/i);
		expect(t, "the no-error-no-notice consequence is part of the claim and stays").toContain('no error and no notice');
		expect(t.includes('ER-5'), 'ER-9 no longer cites ER-5 (the create auto-grant it qualifies)').toBe(true);
		expect(t.includes('ER-6'), 'ER-9 no longer cites ER-6 (the replacement mechanism it rides on)').toBe(true);
	});

	it('ER-9 keeps its probe evidence paths intact', () => {
		const t = er9()?.text ?? '';
		expect(t).toContain('scripts/migrations/probes/probe-entu-rights-supersession-cases-2026-09-09.ts');
		expect(t).toContain(
			'scripts/migrations/seed-results/probe-entu-rights-supersession-cases-live-2026-09-09T17-04-41-123Z.json'
		);
	});

	it('ER-9 carries a one-line dated correction note INSIDE the blockquote run', () => {
		// The scheme marks supersession and says nothing about correction, which
		// leaves correction as the unmarked — and therefore cheaper — path
		// everything would drift toward. In this document of all documents a
		// rule's text must not change with no trace (Gama, #322): a reader who
		// remembers the old sentence must see the ranking went deliberately.
		// Inside the contiguous `>` run is the parser boundary that matters — a
		// note after a blank line falls out of the block and out of every quote
		// of it (the section-11 orphan fact).
		const b = er9();
		const noteLines = (b?.text ?? '')
			.split('\n')
			.filter((l) => /correct/i.test(l) && /\b2026-09-11\b/.test(l));
		expect(
			noteLines.length,
			'ER-9 carries no dated correction note (one line, inside the block, naming 2026-09-11) — without it the ranking wording vanishes with no trace, making correction the unmarked cheaper sibling of supersession'
		).toBe(1);
		expect(noteLines[0], 'the note must say WHAT was removed: the ranking wording').toMatch(/ranking/i);
		expect(
			noteLines[0],
			'the note must state the claim is unchanged — that is exactly what distinguishes a correction from a supersession'
		).toMatch(/claim is unchanged/i);
	});

	it('ER-9 matches its corrected bytes exactly (same pin as section 13, with a readable diff)', () => {
		expect(er9()?.text).toBe(CORRECTED_ER9);
	});
});

describe("#322: ER-12's positional citation becomes ER-7 — a citation swap inside one block", () => {
	const er12 = () => blocks.find((b) => b.id === 'ER-12');

	it("ER-12's rule sentence no longer contains the positional token '(§7.3)'", () => {
		expect(
			(er12()?.text ?? '').includes('(§7.3)'),
			"ER-12 still cites the `_inheritrights` cascade positionally as '(§7.3)' — §-numbers are navigation, and the content now has an identifier (ER-7) to land on; a positional citation repoints silently the moment a section is inserted"
		).toBe(false);
	});

	it('ER-12 cites ER-7 in place of the section number', () => {
		expect(
			(er12()?.text ?? '').includes('cascade onto a child (ER-7)'),
			"ER-12's rule sentence must cite ER-7 where '(§7.3)' stood — the swap is in place, nothing else in the sentence moves"
		).toBe(true);
	});

	it('nothing else in ER-12 moves — sentences, evidence line, and Stands on: line unchanged', () => {
		const t = er12()?.text ?? '';
		for (const s of [
			'govern different axes',
			'decides which bucket',
			'Conflating the two axes answers "who can see this?" wrongly in either direction',
			'it distinguishes what each one decides',
			'Evidence: `aggregate.js:86,94,113-121,269-275` (the `_sharing` axis)',
			// the evidence line's own §7.3 mentions are navigation notes and STAY —
			// only the rule sentence's citation converts (the half a reader quotes):
			'(the `_inheritrights` cascade, §7.3) — `entu-api` source-read 2026-09-10',
			'Clarifying distinction over ER-18, ER-19, ER-20, ER-21 and §7.3; adds no new claim.',
			'Stands on: ER-18, ER-20, ER-1.'
		]) {
			expect(t.includes(s), `ER-12 changed beyond the citation swap — missing: "${s}"`).toBe(true);
		}
	});

	it('ER-12 matches its corrected bytes exactly (same pin as section 13, with a readable diff)', () => {
		expect(er12()?.text).toBe(CORRECTED_ER12);
	});
});

describe('#322: outside the two corrected blocks, the document is byte-identical', () => {
	// Complements the existing fences: section 13's pins hold the other ER
	// blocks and the §1/§2 checksum holds the foundation prose — this holds
	// EVERYTHING else (§3–§7 prose, headers, code fences, trailers), so the
	// two-block mandate cannot quietly widen. #317's method rules restated as
	// one hash: distil-never-extend, no renumbering, §-prose untouched.
	const DOC_MINUS_TARGETS_SHA256 = '5a0f2d4bb019c53fd9c1cbc393922870c4f34fb8305e12b629cb838bca44f2da';

	const docExcludingBlocks = (ids: string[]): string => {
		const drop = new Set<number>();
		for (const b of blocks) {
			if (!ids.includes(b.id)) continue;
			for (let n = b.startLine; n < b.startLine + b.lineCount; n += 1) drop.add(n);
		}
		return doc
			.split('\n')
			.filter((_, i) => !drop.has(i + 1))
			.join('\n');
	};

	it('the ER-9 and ER-12 blocks both exist (the exclusion below must actually exclude something)', () => {
		expect(blocks.some((b) => b.id === 'ER-9')).toBe(true);
		expect(blocks.some((b) => b.id === 'ER-12')).toBe(true);
	});

	it('the doc minus the ER-9 and ER-12 blockquote runs hashes to its pre-#322 state', () => {
		expect(
			sha256(docExcludingBlocks(['ER-9', 'ER-12'])),
			"#322's mandate is two blocks and nothing else — no renumbering, no §-prose edit, no other block touched. Repin only behind a PO ruling that widens the mandate: git show main:docs/architecture/entu-rights-and-visibility-model.md, drop the ER-9/ER-12 blockquote runs, sha256 the remainder"
		).toBe(DOC_MINUS_TARGETS_SHA256);
	});
});
