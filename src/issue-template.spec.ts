// #319 — the issue template carries the rights-citation field, bypass limit beside it.
//
// RED for the #319 TDD chain (repo-half only: the claim-time citation rule
// itself shipped as §11 of the po-team issue standard, 2026-09-15 — see the
// #319 body, "Already done, elsewhere"). This spec mechanically checks the
// REAL template file (.github/ISSUE_TEMPLATE/task.md) and is its drift-pin,
// the same role the runbook/rights-model pins play for their documents.
// Scanning a real repo file follows the rights-model-identifiers.spec /
// typography-scale.spec precedent (mechanical checks over real repo files,
// spec at src root).
//
// The contract, from the #319 body (current over comments — Gama 20:56):
// 1. `.github/ISSUE_TEMPLATE/task.md` exists as a MARKDOWN template (.md with
//    YAML frontmatter carrying `name` and `about`) — deliberately NOT an
//    issue-form .yml: forms validate nothing beyond `required` anyway, and the
//    field block is an HTML-comment-annotated markdown section.
// 2. The body carries the literal heading `## Rights rules relied on`.
// 3. The bypass limit ships BESIDE the field, in the template itself, in full
//    (§9: limits stay in full) — the field block is pinned VERBATIM from the
//    issue body, plus the three load-bearing substrings named by the slice
//    brief as independent assertions so a partial paraphrase names which
//    clause it dropped.
// 4. Negative: nothing in the template claims the field is enforcement or
//    validation. GitHub issue templates bind web-UI creation only; `gh issue
//    create --body-file` bypasses them entirely (how every issue on this
//    board is created), so a filled field is NOT proof the rule was followed
//    — nobody may later read it as one.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TEMPLATE_PATH = resolve(__dirname, '../.github/ISSUE_TEMPLATE/task.md');

/** Reads the real template; '' when absent so every assertion fails with its own message (RED reads clean). */
const template = (): string => (existsSync(TEMPLATE_PATH) ? readFileSync(TEMPLATE_PATH, 'utf-8') : '');

/** Frontmatter body between the opening `---` (byte 0) and the closing `---`, or null. */
function frontmatter(text: string): string | null {
	const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
	return m ? m[1] : null;
}

// ── the field block, VERBATIM from the #319 issue body (§9: limits stay in full) ──
// GREEN copies these bytes into the template. The heading and the HTML-comment
// annotation are one unit: the limit ships beside the field, not in a doc.
const FIELD_BLOCK = [
	'## Rights rules relied on',
	'<!-- ER-identifiers of every rule this change rests on. Query the rights doc',
	'     (or the rights tool when live) — this field cannot be honestly filled',
	'     from memory. LIMIT: templates bind web-UI creation only; `gh issue create',
	'     --body-file` bypasses them entirely (how every issue on this board is',
	'     created). A filled field is therefore NOT proof the rule was followed —',
	'     the claim-time citation rule above is what covers agent-authored text. -->'
].join('\n');

// ── 1. the file exists, as a markdown template with YAML frontmatter ────────

describe('#319: .github/ISSUE_TEMPLATE/task.md exists as a markdown template', () => {
	it('the template file exists (this repo had no .github/ISSUE_TEMPLATE directory at all — #319 creates the infrastructure)', () => {
		expect(
			existsSync(TEMPLATE_PATH),
			'.github/ISSUE_TEMPLATE/task.md does not exist — #319 RED'
		).toBe(true);
	});

	it('the file opens with a YAML frontmatter block (--- fence at byte 0, closed)', () => {
		expect(
			frontmatter(template()),
			'no YAML frontmatter block — a markdown issue template needs `---`-fenced frontmatter or GitHub ignores it'
		).not.toBeNull();
	});

	it('the frontmatter carries a `name:` key', () => {
		expect(frontmatter(template()) ?? '', 'frontmatter has no `name:` key').toMatch(/^name:\s*\S/m);
	});

	it('the frontmatter carries an `about:` key', () => {
		expect(frontmatter(template()) ?? '', 'frontmatter has no `about:` key').toMatch(/^about:\s*\S/m);
	});
});

// ── 2. the rights-citation field heading, literal ───────────────────────────

describe('#319: the template body carries the rights-citation field', () => {
	it("contains the literal heading '## Rights rules relied on'", () => {
		expect(
			template().includes('## Rights rules relied on'),
			"the template does not contain the literal heading '## Rights rules relied on'"
		).toBe(true);
	});

	it('the heading sits in the body, after the frontmatter, not inside it', () => {
		const fm = frontmatter(template());
		expect(
			(fm ?? '').includes('Rights rules relied on'),
			'the field heading is inside the YAML frontmatter — it belongs in the template body'
		).toBe(false);
	});
});

// ── 3. the bypass limit, beside the field, in full ──────────────────────────

describe('#319: the bypass limit ships beside the field, in the template itself', () => {
	// The three load-bearing substrings first, as independent assertions —
	// a paraphrase that drops one clause names which clause it dropped.
	it("states 'templates bind web-UI creation only' (exact casing)", () => {
		expect(
			template().includes('templates bind web-UI creation only'),
			"the bypass limit's scope clause is missing: 'templates bind web-UI creation only'"
		).toBe(true);
	});

	it("names the bypass vector: 'gh issue create'", () => {
		expect(
			template().includes('gh issue create'),
			"the bypass limit does not name 'gh issue create' — the vector every issue on this board is created through"
		).toBe(true);
	});

	it("states a filled field is 'NOT proof' (exact casing) the rule was followed", () => {
		expect(
			template().includes('NOT proof'),
			"the bypass limit's conclusion is missing: a filled field is 'NOT proof' the rule was followed"
		).toBe(true);
	});

	it('carries the whole field block VERBATIM from the #319 issue body — the limit ships in full, not distilled (§9)', () => {
		expect(
			template().includes(FIELD_BLOCK),
			'the field block (heading + full HTML-comment annotation) does not appear verbatim — the limit must sit beside the field in the exact words the issue specified, byte-for-byte including line breaks and indentation'
		).toBe(true);
	});
});

// ── 4. negative: nothing claims the field is enforcement/validation ─────────

describe('#319: nothing in the template claims the field is enforcement or validation', () => {
	// The issue's third done-when: "nothing claims it is enforcement." The only
	// validation GitHub offers is `required` on issue FORMS, which this .md
	// template is not; any enforcement/validation language here would be a
	// false claim someone later reads as proof.
	it("contains no 'enforc*' claim (enforce/enforced/enforcement/enforces)", () => {
		const hit = template().match(/enforc\w*/i);
		expect(
			hit?.[0] ?? null,
			`the template says "${hit?.[0]}" — templates enforce nothing; the bypass limit exists precisely because nobody may read this field as enforcement`
		).toBeNull();
	});

	it("contains no 'validat*' claim (validate/validated/validation/validates)", () => {
		const hit = template().match(/validat\w*/i);
		expect(
			hit?.[0] ?? null,
			`the template says "${hit?.[0]}" — no validation exists for markdown templates (forms validate nothing beyond \`required\` either); claiming it would be the false-proof reading the limit forbids`
		).toBeNull();
	});

	it("contains no 'required' claim — nothing about this field is required by any mechanism", () => {
		const hit = template().match(/\brequired\b/i);
		expect(
			hit?.[0] ?? null,
			'the template says "required" — no mechanism requires anything in a markdown template; the word reads as enforcement'
		).toBeNull();
	});
});
