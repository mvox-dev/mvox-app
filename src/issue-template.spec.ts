// #319 — the issue template carries the rights-citation field, bypass limit beside it.
//
// REPINNED for #384 (d18ded5): the ordinary-task template moved from
// .github/ISSUE_TEMPLATE/task.md (markdown, the shape the #319 body ordered)
// to task.yml, a native issue form — web filings assign type and label
// themselves, and the rights-citation field rides as an optional form field.
// The #319 substance survives the move and this spec now pins it in the new
// home: the field exists, the bypass limit ships BESIDE it in full (§9), and
// nothing claims the field is enforcement. The limit's wording shifts one
// word with the mechanism ("forms bind web-UI creation only" — it is a form
// now, not a markdown template); the vector (`gh issue create --body-file`)
// and the conclusion (a filled field is NOT proof) are unchanged.
//
// The retirement of task.md is itself pinned: two templates named "Task"
// would fork the filing path this form exists to close.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const FORM_PATH = resolve(__dirname, '../.github/ISSUE_TEMPLATE/task.yml');
const RETIRED_MD_PATH = resolve(__dirname, '../.github/ISSUE_TEMPLATE/task.md');

/** Reads the real form; '' when absent so every assertion fails with its own message. */
const form = (): string => (existsSync(FORM_PATH) ? readFileSync(FORM_PATH, 'utf-8') : '');

interface FormField {
	type?: string;
	id?: string;
	attributes?: { label?: string; description?: string };
	validations?: { required?: boolean };
}

/** The parsed form, or null when absent/unparseable. */
function parsed(): { name?: string; description?: string; body?: FormField[] } | null {
	try {
		const doc: unknown = parse(form());
		return doc && typeof doc === 'object' ? (doc as ReturnType<typeof parsed>) : null;
	} catch {
		return null;
	}
}

const rightsField = (): FormField | undefined =>
	parsed()?.body?.find((f) => f.attributes?.label === 'Rights rules relied on');

// ── the bypass limit, VERBATIM as it ships beside the field (§9: limits stay in full) ──
const LIMIT_BLOCK = [
	'  # The #319 bypass limit, beside the field it limits (§9: limits ship in full):',
	'  # forms bind web-UI creation only; `gh issue create --body-file` bypasses them',
	'  # entirely (how every issue on this board is created). A filled field is',
	'  # therefore NOT proof the rule was followed — the claim-time citation rule',
	'  # (po-team issue standard §11) is what covers agent-authored text.'
].join('\n');

// ── 1. the form exists; the markdown template it replaced is gone ───────────

describe('#319/#384: .github/ISSUE_TEMPLATE/task.yml exists as the task issue form', () => {
	it('the form file exists', () => {
		expect(existsSync(FORM_PATH), '.github/ISSUE_TEMPLATE/task.yml does not exist').toBe(true);
	});

	it('task.md stays retired — #384 replaced it; two "Task" templates would fork the filing path', () => {
		expect(
			existsSync(RETIRED_MD_PATH),
			'.github/ISSUE_TEMPLATE/task.md is back — #384 retired it in favour of the task.yml form'
		).toBe(false);
	});

	it('the form carries a top-level `name`', () => {
		expect(parsed()?.name, 'the form has no top-level `name` key').toBeTruthy();
	});

	it('the form carries a top-level `description`', () => {
		expect(parsed()?.description, 'the form has no top-level `description` key').toBeTruthy();
	});
});

// ── 2. the rights-citation field ────────────────────────────────────────────

describe('#319: the form carries the rights-citation field', () => {
	it("a body field is labeled 'Rights rules relied on'", () => {
		expect(
			rightsField(),
			"no form field carries the label 'Rights rules relied on'"
		).toBeDefined();
	});

	it('the field is a textarea — room for one ER-identifier per line', () => {
		expect(rightsField()?.type, 'the rights field is not a textarea').toBe('textarea');
	});

	it('the field description says the field cannot be honestly filled from memory', () => {
		expect(
			rightsField()?.attributes?.description ?? '',
			"the field description lost its 'cannot be honestly filled from memory' clause"
		).toContain('cannot be honestly filled from memory');
	});
});

// ── 3. the bypass limit, beside the field, in full ──────────────────────────

describe('#319: the bypass limit ships beside the field, in the form itself', () => {
	// The three load-bearing substrings first, as independent assertions —
	// a paraphrase that drops one clause names which clause it dropped.
	it("states 'forms bind web-UI creation only' (exact casing)", () => {
		expect(
			form().includes('forms bind web-UI creation only'),
			"the bypass limit's scope clause is missing: 'forms bind web-UI creation only'"
		).toBe(true);
	});

	it("names the bypass vector: 'gh issue create'", () => {
		expect(
			form().includes('gh issue create'),
			"the bypass limit does not name 'gh issue create' — the vector every issue on this board is created through"
		).toBe(true);
	});

	it("states a filled field is 'NOT proof' (exact casing) the rule was followed", () => {
		expect(
			form().includes('NOT proof'),
			"the bypass limit's conclusion is missing: a filled field is 'NOT proof' the rule was followed"
		).toBe(true);
	});

	it('carries the whole limit block VERBATIM — the limit ships in full, not distilled (§9)', () => {
		expect(
			form().includes(LIMIT_BLOCK),
			'the limit block does not appear verbatim — the limit must sit beside the field in full, byte-for-byte including line breaks'
		).toBe(true);
	});

	it('the limit sits directly above the rights-rules field entry — beside the field, not in a header', () => {
		const at = form().indexOf(LIMIT_BLOCK);
		const fieldAt = form().indexOf('id: rights-rules');
		expect(at, 'limit block missing').toBeGreaterThan(-1);
		expect(fieldAt, 'rights-rules field missing').toBeGreaterThan(-1);
		const between = form().slice(at + LIMIT_BLOCK.length, fieldAt);
		expect(
			between,
			'the limit block is not adjacent to the rights-rules field'
		).toMatch(/^\s*- type: textarea\s*$/m);
		expect(between.length, 'the limit block drifted away from the field').toBeLessThan(40);
	});
});

// ── 4. negative: nothing claims the rights field is enforcement/validation ──

describe('#319: nothing claims the rights field is enforcement or validation', () => {
	// The issue's third done-when: "nothing claims it is enforcement." Forms DO
	// validate `required` on OTHER fields (slugline, lead, what, done-when — the
	// #384 model), so the negative is scoped to the rights field: it stays
	// optional (a forced field would be filled with noise, the false-proof
	// reading the limit forbids) and its own text claims no enforcement.
	it('the rights field carries no `validations` — it stays optional', () => {
		expect(
			rightsField()?.validations,
			'the rights field grew a `validations` block — a required rights field is filled with noise and read as proof'
		).toBeUndefined();
	});

	it("the rights field's label and description contain no 'enforc*' or 'validat*' claim", () => {
		const text = `${rightsField()?.attributes?.label ?? ''} ${rightsField()?.attributes?.description ?? ''}`;
		const hit = text.match(/enforc\w*|validat\w*/i);
		expect(
			hit?.[0] ?? null,
			`the rights field says "${hit?.[0]}" — the field enforces nothing; the bypass limit exists precisely because nobody may read it as enforcement`
		).toBeNull();
	});
});
