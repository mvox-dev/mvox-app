// Guard spec for docs/architecture/entu-rights-and-visibility-model.md: parses the real doc.

// A rule block is a `>` blockquote whose first line opens `**ER-<n>**`. Ids are opaque and
// creation-order; probes find rules by content, never by position, and must match exactly one.

// Byte pins below move only behind a PO-ruled doc edit; a pin proves no drift since that edit.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DOC_PATH = resolve(__dirname, '../docs/architecture/entu-rights-and-visibility-model.md');

interface RuleBlock {
	id: string;
	superseded: boolean;
	text: string;
	lineCount: number;
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

// Corrected/edited blocks, byte-exact: the per-block pins in the fence describe use them.
const CORRECTED_ER9 = [
	'**ER-9** — Since entity CREATE grants the creating caller `_owner` as one direct document (ER-5), a later explicit grant of any other direct tier to that same caller on that same entity replaces it (ER-6) and silently demotes the creator from owner — the replace happens with no error and no notice.',
	'Evidence: `https://github.com/mvox-dev/mvox-app/blob/037ab3bbae3644a09fe863a4e7ad123eaeffb3f2/scripts/migrations/probes/probe-entu-rights-supersession-cases-2026-09-09.ts`; results `scripts/migrations/seed-results/probe-entu-rights-supersession-cases-live-2026-09-09T17-04-41-123Z.json`.',
	'Corrected 2026-09-11: ranking wording removed; the claim is unchanged.'
].join('\n');

// ER-12's Evidence line keeps its §7.3 mentions: they locate, they do not cite.
const ER12_EVIDENCE_LINE_322 =
	'Evidence: `aggregate.js:86,94,113-121,269-275` (the `_sharing` axis); `aggregate.js:166-183` (the `_inheritrights` cascade, §7.3) — `entu-api` source-read 2026-09-10. Clarifying distinction over ER-18, ER-19, ER-20, ER-21 and §7.3; adds no new claim.';
const CORRECTED_ER12 = [
	'**ER-12** — `_sharing` and `_inheritrights` govern different axes: `_sharing` decides which bucket (`private`/`domain`/`public`) a property\'s value is written into; `_inheritrights` decides whether a parent\'s rights cascade onto a child (ER-7). Conflating the two axes answers "who can see this?" wrongly in either direction. This rule makes no claim about when either axis is evaluated — it distinguishes what each one decides.',
	ER12_EVIDENCE_LINE_322,
	'Stands on: ER-7, ER-18, ER-20, ER-1.'
].join('\n');

const EDITED_ER3 = [
	'**ER-3** — A `_viewer`-alone grant already suffices for full private bucket read: property-tier `_sharing` (ER-1) does not filter on top of entity-level rights admission — entity rights decide the bucket, and the whole private bucket is exposed once any grant admits the caller to it.',
	'Evidence: `https://github.com/mvox-dev/mvox-app/blob/037ab3bbae3644a09fe863a4e7ad123eaeffb3f2/scripts/migrations/probes/probe-294-entu-user-cross-admin-read-2026-09-08.ts`; results `scripts/migrations/seed-results/probe-294-entu-user-cross-admin-read-live-2026-09-08T10-15-15-643Z.json`.',
	'Stands on: ER-18, ER-20.'
].join('\n');

const EDITED_ER10 = [
	'**ER-10** — The database boundary is a read boundary: "One Entu install per collective → `domain` = in-collective visibility" holds, enforced by code, not by data state. A user authenticated against install X cannot read `domain` entities in install Y unless they genuinely have a `person` entity in Y.',
	'Evidence: `middleware/auth.js:21,31-33,46-48`; `routes/auth/index.get.js:132,141-190,254`. Distills §4.'
].join('\n');

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

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

const SECTION1_FOUNDATIONS: [string, RegExp[]][] = [
	['o. §1 foundation: aggregateEntity materializes the three property buckets on the stored document', [/aggregateEntity/, /three property (?:objects|buckets)/i, /private/, /access[`\s]*array/i]],
	['p. §1 foundation: buckets are write-time snapshots — a read returns whatever was last written', [/snapshots? taken at write time/i, /not computed at read time/i]]
];
const SECTION2_FOUNDATIONS: [string, RegExp[]][] = [
	['q. §2 foundation: a read returns exactly one bucket, first match wins; no bucket admitted → 403', [/exactly one bucket/i, /first match wins/i, /403/]],
	['r. §2 foundation: the tier-priority order — explicit grant, then domain, then public', [/explicit grant/i, /\bdomain\b/, /\bpublic\b/, /priorit|precedence|outrank/i]]
];
const SWEEP_320: [string, RegExp[]][] = [
	['s. sweep: the rightTypes enumeration — the seven rights-type properties as one citable rule', [/_noaccess/, /_inheritrights/, /_expander/, /rightTypes|rights-type/i]],
	['t. sweep: rights-tier arrays are write-time products of the same aggregateEntity pass as the buckets', [/aggregateEntity/, /rights-tier|aggregated rights/i, /write[- ]time/i]]
];

const INVENTORY: [string, RegExp[]][] = [
	['a. three visibility gates, narrowest wins', [/narrowest wins/i, /gate/i, /prop-def|property definition/i]],
	['b. one direct rights-tier per (reference, entity); new direct grant replaces', [/at most one active direct/i, /rights-tier/i, /replac|retir/i]],
	['c. propagation non-extension (own rule, qualification of b)', [/propagat/i, /child/i, /never|does not|not\b/i]],
	['d. direct and inherited are separate additive layers', [/additive/i, /inherited/i, /single-tier|single tier/i]],
	['e. _sharing vs _inheritrights are different axes', [/_sharing/, /_inheritrights/, /ax[ei]s/i]],
	['f. CREATE auto-grants caller _owner as one direct doc, all four tiers', [/auto-grant/i, /_owner/, /four tiers/i]],
	['g. a later grant to the creator silently demotes them from owner', [/demot/i, /creator|creating caller/i, /no error and no notice/i]],
	['h. _viewer-alone suffices for full private-bucket read', [/_viewer/, /alone/i, /private bucket/i]],
	['i. tier-admitted vs grant-admitted readers get different answers', [/tier-admitted/i, /grant-admitted/i]],
	['j. create copies the parent _sharing unless the POST sets it explicitly', [/_sharing/, /parent/i, /cop(y|ies|ied)/i, /omit|explicit/i]],
	['k. _viewer:<entity-id> is accepted but inert', [/inert/i, /accepted/i]],
	['l. the database boundary is a read boundary', [/read boundary/i, /database|\bdb\b/i]],
	['m. changing _sharing requires _owner', [/_sharing/, /_owner/, /chang/i]],
	['n. a systemUser caller bypasses the _owner requirement on the write path (own rule, qualification of m)', [/systemUser/, /bypass/i, /write path/i]],
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
		// The unscoped form is false for a grant-admitted reader (rule i).
		const b = blockMatching('a. three visibility gates, narrowest wins', INVENTORY[0][1]);
		expect(
			b.text,
			`rule ${b.id} states the three-gate AND without naming the reader it holds for — the unscoped form is the dangerous one`
		).toMatch(/tier-admitted/i);
	});

	it('only the three-gates rule (a) enumerates the exposure gates — every other block cites it by ID', () => {
		// A block restating (a)'s formula is where a gate gets dropped; others cite (a) by ID.
		// Case-sensitive `AND` so ordinary prose "and" does not trip it.
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

describe('_parent asymmetry: scoped-if-present (distil-never-extend fence)', () => {
	it('any rule block mentioning _parent gating carries its full scope: the property, #304, the probe date, and the probe evidence', () => {
		// Either a scoped entry or none: never a general rule on one narrow probe.
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

describe('cross-references: base rules and their qualifications name each other by ID', () => {
	// Both directions: quoting a base whole must show what bounds it.
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

describe('provenance: every identified rule block carries an evidence line', () => {
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
		// Uniqueness above already counts superseded ids; this only checks the marker parses.
		const superseded = blocks.filter((b) => b.superseded);
		for (const b of superseded) {
			expect(b.id).toMatch(WELL_FORMED_ID);
		}
	});
});

describe('working-notes instruction: notes carry identifiers, never restatements', () => {
	it('the instruction lives inside an identified rule block, so #319 can cite it by ID', () => {
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

describe('privacy: PO ruling on #318 (2026-09-10 15:27:43Z)', () => {
	it("the doc contains no occurrence of the personal name (replaced by 'the crede editor-grant disappearance investigation')", () => {
		expect(doc).not.toContain('Joosep');
		expect(doc).not.toContain('Loidap');
	});
});

describe('#320 numbering fence: next-free numbers, never low ones (Gama 20:26Z)', () => {
	// Renumbering, ER-0 or ER-1a silently repoints every citation already written.

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
		// A hole is reported, but the fix is a superseded stub that keeps its number, never
		// renumbering. RESERVED lists numbers held out on purpose.
		const RESERVED: Record<number, string> = {
			24: 'retired 2026-09-18, never minting',
			25: 'retired 2026-09-18, never minting'
		};
		const ns = blocks.map((b) => Number(b.id.slice(3))).sort((a, b) => a - b);
		expect(new Set(ns).size, 'duplicate id numbers').toBe(ns.length);
		const missing: number[] = [];
		for (let n = 1; n < ns[ns.length - 1]; n += 1) {
			if (!ns.includes(n) && !(n in RESERVED)) missing.push(n);
		}
		expect(
			missing.map((n) => `ER-${n}`),
			`these ids resolve to no block. #317 retires a rule by SUPERSEDING it: keep the block, mark its first line \`(superseded by ER-<m>, <date>)\`, and it keeps its number forever — restore a superseded stub for each id listed. Do NOT renumber the surviving rules to close the hole, and do not reuse a freed number: either one silently repoints every citation already written, with no error and no broken link. If a listed id is instead RESERVED on an issue and awaiting its slice, add it to RESERVED above with that issue — never close the hole by minting its number for other content.`
		).toEqual([]);

		// A reserved id that resolves to a block is either its rule landing or a squatter.
		expect(
			Object.keys(RESERVED)
				.map(Number)
				.filter((n) => ns.includes(n))
				.map((n) => `ER-${n}`),
			'a RESERVED id now resolves to a real block. If it is the RESERVED rule itself landing, drop the entry so the sweep guards that number like any other. If it is DIFFERENT content wearing a reserved number, that is a squatter and the entry is not the thing to change: the number belongs to the issue named beside it, and closing the hole by minting it for other content silently repoints every citation already written against the reservation.'
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

describe('#320 foundation citations: `Stands on:` lines (one-way by design)', () => {
	// Stands on: is one-way (dependent → foundation); foundations never name dependents,
	// unlike Qualifications, which both sides name.

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
		// A `>` line after a blank line falls out of the block.
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
		['a. three visibility gates, narrowest wins', INVENTORY[0][1]],
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
		// One citable rule or none: the mechanic must not be restated across blocks.
		const hits = blocks.filter((b) => /userStr/.test(b.text) && !/read boundary/i.test(b.text));
		expect(
			hits.length,
			`the caller-identity/grant-matching mechanic is restated across ${hits.length} blocks (${hits.map((b) => b.id).join(', ')}) — one citable rule or none`
		).toBeLessThanOrEqual(1);
	});
});

describe('#320: no rule cites the foundation sections positionally once they carry ids', () => {
	// A §-range reads sections as an ordered span, so it repoints when one is inserted.
	// Single-section mentions (`Distills §3`, ER-12's evidence §7.3) are navigation: not scanned.
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

describe('#320 fence: §1/§2 prose and unmandated blocks stay byte-identical', () => {
	// Two layers: the sentence list names which claim moved; the checksum below holds the rest.
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

	const FOUNDATION_PROSE_SHA256 = '113c032718275033757750e07ca10b58a7b592bfb025fce30c76190fc9ed1d4f';

	// §1 heading to §3 heading, minus ER definition blocks only: any other blockquote is prose.
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
		// Probes prove the checksum still sees prose the sentence list does not cover.

		const reworded = doc.replace('**Why `private` is robust:**', '**Why `private` is sturdy:**');
		expect(
			reworded,
			"the 'Why `private` is robust' paragraph was renamed or moved — retarget this probe at prose the sentence list still does not cover"
		).not.toBe(doc);
		expect(
			foundationProseSha(reworded),
			'rewording an unpinned §1/§2 paragraph did not move the checksum — the slice bounds or the ER-block exemption are discarding prose the fence is supposed to hold'
		).not.toBe(FOUNDATION_PROSE_SHA256);

		const smuggled = doc.replace(
			'**Why `private` is robust:**',
			'> Note: buckets are actually computed at read time.\n\n**Why `private` is robust:**'
		);
		expect(
			foundationProseSha(smuggled),
			'a non-ER blockquote added inside §1→§3 did not move the checksum — the exemption is matching blockquotes wholesale instead of ER definition blocks only, which lets unsanctioned prose in as a plain note'
		).not.toBe(FOUNDATION_PROSE_SHA256);
	});

	// Blocks pinned byte-exact (sha256 of parsed block text). Edited blocks pin to the
	// constants at the top; repin from post-edit bytes only behind a PO-ruled edit.
	const UNTOUCHED_SHA256: Record<string, string> = {
		'ER-2': '01cecca21a2ac74eedd7e04a0c3ff94a14f55c8d2d3ef5951016d769c4edf9dc',
		'ER-3': sha256(EDITED_ER3),
		'ER-4': 'd8de9757c674fbeb12c169fab48867e05e53967e76d54062e0aced194842af0e',
		'ER-5': 'cd5f1bb4f7d08323098ee51debd2fd4a64eb663e7d0963e319fdcc3d2527495b',
		'ER-6': '2bf3605651139a64247c6075ac24fa5db264564d57204e9a23e9cf40a9ab9907',
		'ER-8': 'e19bdf071712336fdab1c577447bb1099c9023e74873398778bae0f9c5a2d9b4',
		'ER-9': sha256(CORRECTED_ER9),
		'ER-10': sha256(EDITED_ER10),
		'ER-11': 'b2ee2bb1fdd1e2ef1527f81795d5b44450af6916f1b8b148b5485641846de4af',
		'ER-12': sha256(CORRECTED_ER12),
		'ER-13': 'd89a7815e35b6feb7de8492949bc0398af471fefb8543cd54ce9c9fb207dabcb',
		'ER-14': '1a861e6093591c71e985783eb614215347f5804f8f8897edaff33a19147fe4e0',
		'ER-15': '00b855448d2750eed3be8df26576c9aadd4106f315930fe77c3cd11367fe67eb',
		'ER-16': '874ee3f28195c10f2da3ff44fe32e8c8e4da8298f8829e79df21a12bda5af12f',
		'ER-17': 'de114fc7b40b8bf254dbda34ab19bda2162433fc91a86b15e86b54d6e6f1be0e',
		'ER-18': '575f4c3aa26a49c4de82eb29aed0e26faf0b07f27536fc25b26d8c260a38471c',
		'ER-19': 'c17def0a84e575602e99333d997170604d7d455cf1f607b416f957da285ce634',
		'ER-20': '107340afe6b83a9525fcea23d0c6bb4ad096f85720a7d2cf92d79fbb21f2b8d8',
		'ER-21': '3023f8f8249a0aad8a675f16263ed2dbf55a8d75aa5b3c3ca4352e738000dbac',
		'ER-22': 'bfa254e4a9153d17cd759662389fd0d35c5cb5f0a26d57678d275e58bfefe442',
		'ER-23': 'f9cfa166ac4752880b1cb58119c28f1d92f77de070a62f9d69d483dfddd2be40',
		'ER-26': '5c642639a96063848b01820bb88e3638715739736a65ac4e74914670f1b0f1d5',
		'ER-27': 'd098b5e306890e28ccd087397d33fc1a172189a9feb05fc7b8213e0c5297e145'
	};

	it('every pinned block matches its sanctioned bytes (pre-#320 state; #322-corrected state for ER-9/ER-12)', () => {
		for (const [id, hash] of Object.entries(UNTOUCHED_SHA256)) {
			const b = blocks.find((x) => x.id === id);
			expect(b, `${id} disappeared from the doc`).toBeDefined();
			expect(
				sha256(b?.text ?? ''),
				`${id} (doc line ${b?.startLine}) does not match its pin — sanctioned edits: #320 (ER-1/ER-3 Stands on: lines, ER-7 token conversion), #322 (ER-9 direction-free restatement + dated correction note, ER-12 '(§7.3)'→'(ER-7)') and #330 (ER-3 '(§3)'→'(ER-1)', ER-10 '(§4)' moved to a Distills line, ER-12 Stands on: gains ER-7); the edited blocks must match the CORRECTED/EDITED constants — see sections 15 and the #330 section for the readable diffs`
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

describe('citation hygiene: the forms a rule block may NOT use to cite', () => {

	it('no rule block cites this document by line number (a self-citation repoints on any insertion above it)', () => {
		// Cite the rule's identifier instead: a doc line number repoints on any insertion.
		for (const b of blocks) {
			expect(
				/doc\s+line\s+\d+/i.test(b.text),
				`rule ${b.id} (doc line ${b.startLine}) cites this document positionally ("doc line N") — cite the identified rule that states the fact, or an entu-api file:line`
			).toBe(false);
		}
	});

	it('no ER token is cited as a dash-range with another ER token — ranges presume the contiguous ordering the scheme denies', () => {
		// Ids are opaque, and a range hides its interior ids from the resolver.
		const RANGE = /ER-\d+\s*[–—-]\s*ER-\d+/;
		const m = doc.match(RANGE);
		expect(
			m?.[0] ?? null,
			'identifiers are cited as a numeric range — enumerate them (ER-18, ER-19, …); the numbers are opaque and carry no contiguity'
		).toBeNull();
	});

	it('the rights-type-set rule states the seven names and makes no claim about what the document as a whole evidences', () => {
		// Its source evidences the set only, not a claim about the rest of the doc.
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

describe('#322: ER-9 restated direction-free — the ranking framing goes, the demotion claim stays', () => {
	// A correction, not a supersession: the demotion claim survives, so ER-9 keeps its id.

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
		// 'demote' is not listed: the silent demotion is the claim and stays.
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
		expect(t).toContain('https://github.com/mvox-dev/mvox-app/blob/037ab3bbae3644a09fe863a4e7ad123eaeffb3f2/scripts/migrations/probes/probe-entu-rights-supersession-cases-2026-09-09.ts');
		expect(t).toContain(
			'scripts/migrations/seed-results/probe-entu-rights-supersession-cases-live-2026-09-09T17-04-41-123Z.json'
		);
	});

	it('ER-9 carries a one-line dated correction note INSIDE the blockquote run', () => {
		// Correction must leave a trace, inside the `>` run so every quote of the block carries it.
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

	it('nothing else in ER-12 moves — sentences and evidence line unchanged (Stands on: gains ER-7 under #330, asserted below)', () => {
		const t = er12()?.text ?? '';
		for (const s of [
			'govern different axes',
			'decides which bucket',
			'Conflating the two axes answers "who can see this?" wrongly in either direction',
			'it distinguishes what each one decides',
			'Evidence: `aggregate.js:86,94,113-121,269-275` (the `_sharing` axis)',
			'(the `_inheritrights` cascade, §7.3) — `entu-api` source-read 2026-09-10',
			'Clarifying distinction over ER-18, ER-19, ER-20, ER-21 and §7.3; adds no new claim.',
			'Stands on: ER-7, ER-18, ER-20, ER-1.'
		]) {
			expect(t.includes(s), `ER-12 changed beyond the sanctioned edits — missing: "${s}"`).toBe(true);
		}
	});

	it('ER-12 matches its corrected bytes exactly (same pin as section 13, with a readable diff)', () => {
		expect(er12()?.text).toBe(CORRECTED_ER12);
	});
});

describe("#330 edit 1: ER-3's rule sentence cites ER-1, not §3", () => {
	// '(§3)' carried the reference by itself, so it was a citation and converts to ER-1.
	const er3 = () => blocks.find((b) => b.id === 'ER-3');
	const ruleSentence = () => (er3()?.text ?? '').split('\n')[0];

	it("ER-3's rule sentence contains '(ER-1)' where '(§3)' stood", () => {
		expect(
			ruleSentence().includes('(ER-1)'),
			"ER-3 still carries no '(ER-1)' — the prop-def tier is one of ER-1's gates, and the citation must ride the identifier, not the section number"
		).toBe(true);
	});

	it("ER-3's rule sentence contains no '§'", () => {
		expect(
			ruleSentence().includes('§'),
			"ER-3's rule sentence still contains a '§' — its '(§3)' was a CITATION (no ER id present to carry the reference), and #330 converts it; this is a per-edit check, NOT a blanket no-§-in-ER-blocks rule"
		).toBe(false);
	});

	it('ER-3 matches its edited bytes exactly (same pin as section 13, with a readable diff)', () => {
		expect(er3()?.text).toBe(EDITED_ER3);
	});
});

describe("#330 edit 2: ER-10's own provenance moves onto its Evidence line as `Distills §4.`", () => {
	const er10 = () => blocks.find((b) => b.id === 'ER-10');

	it("ER-10's rule sentence contains no '§'", () => {
		expect(
			(er10()?.text ?? '').split('\n')[0].includes('§'),
			"ER-10's rule sentence still contains a '§' — '(§4)' is provenance and moves to the Evidence line's Distills form; per-edit check, not a blanket rule"
		).toBe(false);
	});

	it("ER-10's Evidence line ends with the `Distills §4.` provenance form", () => {
		expect(
			(er10()?.text ?? '').split('\n')[1] ?? '',
			"ER-10's Evidence line does not end with 'Distills §4.' — dropping '(§4)' without the Distills line would LOSE the provenance instead of relocating it"
		).toMatch(/ Distills §4\.$/);
	});

	it('ER-10 matches its edited bytes exactly (same pin as section 13, with a readable diff)', () => {
		expect(er10()?.text).toBe(EDITED_ER10);
	});
});

describe("#330 edit 3: ER-12's `Stands on:` mirror gains ER-7 — not a § edit", () => {
	const er12 = () => blocks.find((b) => b.id === 'ER-12');

	it("ER-12's Stands on: line names ER-7", () => {
		const line = (er12()?.text ?? '').split('\n').find((l) => /^\s*Stands on:/i.test(l)) ?? '';
		const tokens: string[] = line.match(ID_TOKEN) ?? [];
		expect(
			tokens.includes('ER-7'),
			"ER-12's Stands on: line omits ER-7 — the rule sentence already cites ER-7 for the `_inheritrights` cascade, so ER-12 demonstrably stands on it; a rule that cannot be stated without another identified rule names it on the structural line (the one-way mirror). The reverse direction is deliberately NOT added: ER-7 never names ER-12 back (section 14's one-way guard)"
		).toBe(true);
	});

	it("ER-12's Evidence line is byte-identical to the #322 pin — both §7.3 mentions stay", () => {
		// Byte-equality, so converting either §7.3 fails with a readable diff.
		const evidence = (er12()?.text ?? '').split('\n').find((l) => l.startsWith('Evidence:'));
		expect(evidence).toBe(ER12_EVIDENCE_LINE_322);
	});
});

describe('#330 fence: provenance lines survive, and 10 `Distills §` lines is the sanctioned state', () => {
	// Counted as raw doc lines containing the literal 'Distills §': 9 originals + ER-10's.
	const ORIGINAL_DISTILLS_LINES = [
		'> Evidence: `aggregate.js:312-320`. Distills §1; adds no new claim.',
		'> Evidence: `aggregate.js:312-320` (the write that produces the snapshot). Distills §1; adds no new claim.',
		'> Evidence: `aggregate.js:166-183` (parent grants fetched during the write), `aggregate.js:185-209` (the tier arrays assembled onto the stored document) — `entu-api` source-read 2026-09-11. Distills §1\'s write-time fact as it extends to rights-tier arrays; adds no new claim.',
		'> Evidence: `entity.js:569-612,573-586` (bucket selection); `routes/[db]/entity/[_id]/index.get.js:97-102` (403 on no match). Distills §2; adds no new claim.',
		'> Evidence: `entity.js:573-586` (the if/else branch order; quote ER-20 for the branches themselves). Distills §2; adds no new claim.',
		'> Evidence: `aggregate.js:86,94,113-121` (gates 1–2); `aggregate.js:269-275` (gate 3); synthesized in `teams/mvox-dev/memory/perotin.md:1263-1272` (2026-08-08: "a visibility scope is only complete when it names all three"); the omitted-gate re-widening this caused is `scripts/migrations/lib/widen-member-refs-2026-08-07.ts`. Distills §3; adds no new claim.',
		'> Evidence: `entity.js:21-29` (the literal); `entity.js:113` and `routes/[db]/property/[_id]/index.delete.js:105,140` (the membership tests, its only consumers). Distills §5; adds no new claim.',
		'> Evidence: `entity.js:138,141-153` (write path accepts any existing-entity reference); `rights.js:84-94` (reference pushed verbatim into `access`). Distills §6.',
		"> Evidence: `aggregate.js:113-121,269-275` (the gates ER-1 enumerates); ER-3 above (§7.1's operative sentence). Distills §7.1 + §3."
	];

	it('all 9 pre-existing `Distills §n` lines are present verbatim (holds BEFORE the #330 edits and must hold after)', () => {
		const docLines = doc.split('\n');
		for (const l of ORIGINAL_DISTILLS_LINES) {
			expect(
				docLines.includes(l),
				`pre-existing provenance line missing or edited: "${l.slice(0, 70)}…" — #330's mandate touches no Distills line that existed before it`
			).toBe(true);
		}
	});

	it("the `Distills §` lines are EXACTLY the 9 originals plus ER-10's new Evidence line", () => {
		const actual = doc.split('\n').filter((l) => l.includes('Distills §'));
		const wanted = [...ORIGINAL_DISTILLS_LINES, `> ${EDITED_ER10.split('\n')[1]}`];
		expect(
			[...actual].sort(),
			'the set of Distills lines differs from the sanctioned 10 (9 pre-existing + the one ER-10 line #330 creates) — an 11th is scope creep, a 9th post-edit means the relocation was dropped'
		).toEqual([...wanted].sort());
	});

});

describe('#322/#330: outside the sanctioned blocks, the document is byte-identical', () => {
	// Holds everything outside the excluded blocks (§3–§7 prose, headers, code fences).
	// Repin from post-edit bytes behind a PO-ruled edit: drop the listed blocks, sha256.
	const DOC_MINUS_TARGETS_SHA256 = '9105883b938441a2746a537f743e4817689f14b8d19b1f2e9fe2a287d6798db9';

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

	it('the ER-3, ER-9, ER-10, ER-12, ER-26 and ER-27 blocks all exist (the exclusion below must actually exclude something)', () => {
		for (const id of ['ER-3', 'ER-9', 'ER-10', 'ER-12', 'ER-26', 'ER-27']) {
			expect(blocks.some((b) => b.id === id), `${id} disappeared from the doc`).toBe(true);
		}
	});

	it('the doc minus the ER-3/ER-9/ER-10/ER-12/ER-26/ER-27 blockquote runs hashes to its post-#372 state', () => {
		expect(
			sha256(docExcludingBlocks(['ER-3', 'ER-9', 'ER-10', 'ER-12', 'ER-26', 'ER-27'])),
			"#322's mandate was ER-9/ER-12, #330's is ER-3/ER-10/ER-12, #369's is ER-26 plus its §7.5 home, #372's is ER-27 plus its §7.6 home and #411's is one prose sentence inside the \"What this changes\" SUPERSEDED marker, nothing else — no renumbering, no other §-prose edit, no other block touched. Repin only behind a PO ruling that widens the mandate: take the doc at the sanctioned state, drop the six blockquote runs, sha256 the remainder"
		).toBe(DOC_MINUS_TARGETS_SHA256);
	});
});
