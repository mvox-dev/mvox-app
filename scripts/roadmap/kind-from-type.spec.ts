// @vitest-environment happy-dom
/**
 * #373 RED — the board reads each issue's KIND from the native GitHub issue
 * type; the kind label is only the fallback for issues that predate types.
 *
 * Since #393 the forms assign only the type, so a new issue carries no kind
 * label at all. The board must therefore:
 *
 *   - render a kind chip saying what the TYPE says, whatever labels the issue
 *     carries (a typed Bug wearing a legacy `task` label chips as `bug`);
 *   - fall back to the kind label only when the issue has no type (the
 *     archive: ~380 pre-type issues, many closed);
 *   - treat a typed Task exactly like a `task`-labeled one in the #340
 *     staleness predicate — pinned here with a TYPED-ONLY fixture;
 *   - leave MOTION untouched: `ready` / `blocked` / `in process` /
 *     `in research` / `prepped` / `needs-po` are labels, stay labels, and
 *     their chips render BYTE-IDENTICAL to the pre-#373 board (Mihkel's
 *     explicit fear is this change eradicating movement display).
 *
 * Kind derivation itself lives in issue-model.ts (#384's model) — render.ts
 * consumes the model, never a raw GitHub shape; fetch-issues.ts is the only
 * file that sees the REST payload's `type` object.
 *
 * Label strings/colours are the REAL ones (gh api repos/mvox-dev/mvox-app/labels,
 * 2026-09-18). Same caveat as active-float.spec.ts: a fixture cannot see a
 * GitHub-side rename.
 *
 * (*PO:Gama*)
 */
import { describe, expect, it } from 'vitest';
import { fetchBoard, normalizeIssue } from './fetch-issues';
import { kindFromLabels, kindFromType, kindOf } from './issue-model';
import { displayLead, displayTitle, renderBoard, type RoadmapIssue, type RoadmapLabel } from './render';

const GENERATED_AT = '2026-09-18T09:00:00.000Z';

/** Live palette (gh api repos/mvox-dev/mvox-app/labels, 2026-09-18). */
const TASK: RoadmapLabel = { name: 'task', color: '1d76db' };
const BUG: RoadmapLabel = { name: 'bug', color: 'd73a4a' };
const EPIC: RoadmapLabel = { name: 'epic', color: '6f42c1' };
const ENHANCEMENT: RoadmapLabel = { name: 'enhancement', color: 'a2eeef' };
const READY: RoadmapLabel = { name: 'ready', color: '0e8a16' };
const BLOCKED: RoadmapLabel = { name: 'blocked', color: 'b60205' };
const IN_PROCESS: RoadmapLabel = { name: 'in process', color: '95ea29' };
const IN_RESEARCH: RoadmapLabel = { name: 'in research', color: 'ecde62' };
const PREPPED: RoadmapLabel = { name: 'prepped', color: 'c5def5' };
const NEEDS_PO: RoadmapLabel = { name: 'needs-po', color: 'd93f0b' };

const ALL_MOTION = [READY, BLOCKED, IN_PROCESS, IN_RESEARCH, PREPPED, NEEDS_PO];

function issue(
	overrides: Partial<RoadmapIssue> & Pick<RoadmapIssue, 'number' | 'title'>
): RoadmapIssue {
	return {
		state: 'open',
		stateReason: null,
		labels: [],
		body: null,
		closedAt: null,
		htmlUrl: `https://example.test/issues/${overrides.number}`,
		subIssues: [],
		issueType: null,
		...overrides
	};
}

function parse(html: string): Document {
	return new DOMParser().parseFromString(html, 'text/html');
}

/** The chip names under one issue's own `.issue-labels` span, in render order. */
function chipNames(doc: Document, number: number): string[] {
	const entry = doc.querySelector(`[data-issue="${number}"]`);
	expect(entry, `no entry for #${number}`).not.toBeNull();
	const labels = (entry as Element).querySelector('.issue-labels');
	return Array.from(labels?.querySelectorAll('.label') ?? []).map(
		(el) => el.textContent?.trim() ?? ''
	);
}

/** A closed issue so the board always has a Tehtud group. */
const CLOSED_DONE = issue({
	number: 200,
	title: 'Done long ago',
	state: 'closed',
	stateReason: 'completed',
	closedAt: '2026-09-01T00:00:00Z',
	labels: [TASK]
});

describe('#373 — the model derives kind: type first, kind label as fallback', () => {
	it('maps each native type to its kind, case-insensitively', () => {
		expect(kindFromType('Task')).toBe('task');
		expect(kindFromType('Bug')).toBe('bug');
		expect(kindFromType('Feature')).toBe('feature');
		expect(kindFromType('Epic')).toBe('epic');
	});

	it('an absent or unknown type derives no kind', () => {
		expect(kindFromType(null)).toBeNull();
		expect(kindFromType(undefined)).toBeNull();
		expect(kindFromType('Chore')).toBeNull();
	});

	it('falls back to the legacy kind labels — `enhancement` is the pre-type spelling of feature', () => {
		expect(kindFromLabels(['task', 'ready'])).toBe('task');
		expect(kindFromLabels(['bug'])).toBe('bug');
		expect(kindFromLabels(['epic'])).toBe('epic');
		expect(kindFromLabels(['enhancement'])).toBe('feature');
		expect(kindFromLabels(['ready', 'wontfix'])).toBeNull();
	});

	it('the type wins over a conflicting kind label', () => {
		expect(kindOf('Bug', ['task', 'ready'])).toBe('bug');
		expect(kindOf(null, ['task', 'ready'])).toBe('task');
		expect(kindOf(null, ['ready'])).toBeNull();
	});
});

describe('#373 — fetch normalizes the REST `type` object; downstream never sees it', () => {
	const rest = {
		number: 400,
		title: 'Typed, unlabeled',
		state: 'open',
		state_reason: null,
		labels: [],
		body: null,
		html_url: 'https://github.com/mvox-dev/mvox-app/issues/400'
	};

	it("carries the type's name through as issueType", () => {
		expect(normalizeIssue({ ...rest, type: { name: 'Task' } }).issueType).toBe('Task');
	});

	it('normalizes a null or missing type to issueType: null — the pre-type archive', () => {
		expect(normalizeIssue({ ...rest, type: null }).issueType).toBeNull();
		expect(normalizeIssue(rest).issueType).toBeNull();
	});
});

describe('#373 — kind chips render from the type, whatever labels the issue carries', () => {
	it('a typed issue with NO labels (the post-#393 new-issue shape) still chips its kind', () => {
		const doc = parse(
			renderBoard(
				[issue({ number: 400, title: 'New task, type only', issueType: 'Task' }), CLOSED_DONE],
				GENERATED_AT
			)
		);
		expect(chipNames(doc, 400)).toEqual(['task']);
	});

	it('the kind chip wears the kind\'s canonical colour, in the chip idiom of every other label', () => {
		const doc = parse(
			renderBoard(
				[issue({ number: 400, title: 'New task, type only', issueType: 'Task' }), CLOSED_DONE],
				GENERATED_AT
			)
		);
		const chip = Array.from(doc.querySelectorAll('[data-issue="400"] .label')).find(
			(el) => el.textContent?.trim() === 'task'
		);
		expect(chip?.getAttribute('style')).toMatch(/background(?:-color)?:\s*#1d76db/i);
	});

	it('the chip says what the TYPE says — a typed Bug wearing a legacy `task` label chips as bug', () => {
		const doc = parse(
			renderBoard(
				[
					issue({ number: 401, title: 'Retyped', issueType: 'Bug', labels: [TASK, READY] }),
					CLOSED_DONE
				],
				GENERATED_AT
			)
		);
		expect(chipNames(doc, 401)).toEqual(['bug', 'ready']);
	});

	it('a typed issue wearing its own matching kind label chips it ONCE, not twice', () => {
		const doc = parse(
			renderBoard(
				[
					issue({ number: 402, title: 'Typed and labeled alike', issueType: 'Task', labels: [TASK, READY] }),
					CLOSED_DONE
				],
				GENERATED_AT
			)
		);
		expect(chipNames(doc, 402)).toEqual(['task', 'ready']);
	});

	it('a pre-type issue renders from its kind label, exactly as before', () => {
		const doc = parse(
			renderBoard(
				[issue({ number: 301, title: 'Archive task', labels: [TASK, READY] }), CLOSED_DONE],
				GENERATED_AT
			)
		);
		expect(chipNames(doc, 301)).toEqual(['task', 'ready']);
	});

	it('all three live states on one board: typed bare, typed with legacy label, closed pre-type', () => {
		const doc = parse(
			renderBoard(
				[
					issue({ number: 400, title: 'New task, type only', issueType: 'Task' }),
					issue({ number: 401, title: 'Typed, legacy label', issueType: 'Epic', labels: [EPIC] }),
					issue({
						number: 210,
						title: 'Closed before types existed',
						state: 'closed',
						stateReason: 'completed',
						closedAt: '2026-07-01T00:00:00Z',
						labels: [TASK, READY]
					})
				],
				GENERATED_AT
			)
		);
		expect(chipNames(doc, 400)).toEqual(['task']);
		expect(chipNames(doc, 401)).toEqual(['epic']);
		// #354 keeps filtering motion off closed issues; the kind label stays.
		expect(chipNames(doc, 210)).toEqual(['task']);
	});
});

describe('#373 — MOTION IS UNTOUCHED: movement chips render byte-identical', () => {
	// The exact chip markup renderLabel emitted BEFORE #373, one literal per
	// motion label (live palette). Hardcoded bytes on purpose: this pin fails
	// if the kind change so much as reorders an attribute in a motion chip.
	const MOTION_CHIP_BYTES = [
		'<span class="label" style="background-color: #0e8a16; color: #000000;">ready</span>',
		'<span class="label" style="background-color: #b60205; color: #ffffff;">blocked</span>',
		'<span class="label" style="background-color: #95ea29; color: #000000;">in process</span>',
		'<span class="label" style="background-color: #ecde62; color: #000000;">in research</span>',
		'<span class="label" style="background-color: #c5def5; color: #000000;">prepped</span>',
		'<span class="label" style="background-color: #d93f0b; color: #000000;">needs-po</span>'
	];

	it('a TYPED issue carrying every motion label renders each motion chip byte-for-byte as before', () => {
		const html = renderBoard(
			[
				issue({ number: 403, title: 'All motion, typed', issueType: 'Task', labels: ALL_MOTION }),
				CLOSED_DONE
			],
			GENERATED_AT
		);
		for (const bytes of MOTION_CHIP_BYTES) {
			expect(html, `motion chip changed: ${bytes}`).toContain(bytes);
		}
	});

	it('a PRE-TYPE issue carrying every motion label renders each motion chip byte-for-byte as before', () => {
		const html = renderBoard(
			[
				issue({ number: 404, title: 'All motion, archive', labels: [TASK, ...ALL_MOTION] }),
				CLOSED_DONE
			],
			GENERATED_AT
		);
		for (const bytes of MOTION_CHIP_BYTES) {
			expect(html, `motion chip changed: ${bytes}`).toContain(bytes);
		}
	});

	it('adding a type to an issue changes NOTHING about its motion chips', () => {
		// Same issue rendered pre-type and typed; the motion chip substrings on
		// the page must be identical strings — the type may add a kind chip and
		// dedupe the kind label, never touch movement.
		const motionChips = (html: string): string[] =>
			[...html.matchAll(/<span class="label"[^>]*>[^<]*<\/span>/g)]
				.map((m) => m[0])
				.filter((chip) => ALL_MOTION.some((l) => chip.includes(`>${l.name}<`)));
		const untyped = renderBoard(
			[issue({ number: 405, title: 'Moving', labels: [TASK, ...ALL_MOTION] }), CLOSED_DONE],
			GENERATED_AT
		);
		const typed = renderBoard(
			[
				issue({ number: 405, title: 'Moving', issueType: 'Task', labels: [TASK, ...ALL_MOTION] }),
				CLOSED_DONE
			],
			GENERATED_AT
		);
		expect(motionChips(untyped)).toHaveLength(ALL_MOTION.length);
		expect(motionChips(typed)).toEqual(motionChips(untyped));
	});
});

describe('#373 — the #340 staleness predicate treats a typed Task like a task-labeled one', () => {
	const WARNING_CLASS = 'staleness-warning';
	const warningEl = (doc: Document) => doc.querySelector(`.${WARNING_CLASS}`);

	it('TYPED-ONLY fixture: an open typed Task carrying only `ready` is named a violator', () => {
		// No `task` label anywhere on it — exactly what #393's forms now file.
		const board = [
			issue({ number: 406, title: 'Groomed, idle, typed', issueType: 'Task', labels: [READY] }),
			CLOSED_DONE
		];
		const doc = parse(renderBoard(board, GENERATED_AT));
		const el = warningEl(doc);
		expect(el, 'a typed Task must fire the staleness check like a task-labeled one').not.toBeNull();
		expect(el?.textContent).toContain('#406');
	});

	it('a typed Task with `ready` + `prepped` satisfies the check — motion still governs it', () => {
		const board = [
			issue({ number: 407, title: 'Groomed and prepped, typed', issueType: 'Task', labels: [READY, PREPPED] }),
			CLOSED_DONE
		];
		expect(warningEl(parse(renderBoard(board, GENERATED_AT)))).toBeNull();
	});

	it('a typed Epic labelled ready never fires — kind scope now reads the type too', () => {
		const board = [
			issue({ number: 408, title: 'Groomed container, typed', issueType: 'Epic', labels: [READY] }),
			CLOSED_DONE
		];
		expect(warningEl(parse(renderBoard(board, GENERATED_AT)))).toBeNull();
	});

	it('the type wins over a stale kind label: a typed Epic wearing `task`+`ready` never fires', () => {
		const board = [
			issue({ number: 409, title: 'Retyped container', issueType: 'Epic', labels: [TASK, READY] }),
			CLOSED_DONE
		];
		expect(warningEl(parse(renderBoard(board, GENERATED_AT)))).toBeNull();
	});
});

describe('#373 — fetchBoard resolves sub-issues for a typed Epic with no labels', () => {
	// The post-#393 shape: a new epic carries type Epic and zero labels. The
	// sub-issue fetch keyed on the `epic` LABEL would leave its children flat.
	interface RestIssue {
		number: number;
		title: string;
		state: string;
		state_reason: null;
		labels: { name: string; color: string }[];
		body: null;
		closed_at: null;
		html_url: string;
		type?: { name: string } | null;
	}
	const rest = (number: number, type: string | null, labels: RoadmapLabel[] = []): RestIssue => ({
		number,
		title: `Issue ${number}`,
		state: 'open',
		state_reason: null,
		labels: labels.map((l) => ({ name: l.name, color: l.color ?? 'cccccc' })),
		body: null,
		closed_at: null,
		html_url: `https://github.com/mvox-dev/mvox-app/issues/${number}`,
		...(type !== null ? { type: { name: type } } : {})
	});
	const jsonResponse = (body: unknown): Response =>
		new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
	const githubStub =
		(list: RestIssue[], subs: Record<number, RestIssue[]>): typeof fetch =>
		(async (input: RequestInfo | URL) => {
			const url = String(input);
			const match = /\/issues\/(\d+)\/sub_issues/.exec(url);
			if (match) return jsonResponse(subs[Number(match[1])] ?? []);
			if (url.includes('/issues?')) return jsonResponse(list);
			throw new Error(`unexpected request: ${url}`);
		}) as unknown as typeof fetch;

	it('nests a typed, unlabeled epic\'s children — and a pre-type epic-labeled one still nests too', async () => {
		const list = [rest(410, 'Epic'), rest(411, 'Task'), rest(289, null, [EPIC]), rest(290, null, [TASK])];
		const subs = { 410: [rest(411, 'Task')], 289: [rest(290, null, [TASK])] };
		const result = await fetchBoard('mvox-dev/mvox-app', 'test-token', githubStub(list, subs));
		expect(result.map((i) => i.number)).toEqual([410, 289]);
		expect(result[0].subIssues?.map((s) => s.number)).toEqual([411]);
		expect(result[1].subIssues?.map((s) => s.number)).toEqual([290]);
	});
});

describe('sluglines and leads read from both body shapes', () => {
	const formBody = '### Slugline\n\nLaulja saab asja tehtud\n\n### Lead\n\nÜks lause.\n\n### What\n\nx\n\n(*PO:Gama*)';
	const fmBody = '---\nslugline: "Vana kuju"\nlead: "Vana lause."\n---\n\nx';
	const mk = (body: string) => issue({ number: 999, title: 'English title', body });

	it('a form-groomed issue shows its Estonian slugline and lead', () => {
		expect(displayTitle(mk(formBody))).toBe('Laulja saab asja tehtud');
		expect(displayLead(mk(formBody))).toBe('Üks lause.');
	});

	it('legacy frontmatter still wins its own shape', () => {
		expect(displayTitle(mk(fmBody))).toBe('Vana kuju');
		expect(displayLead(mk(fmBody))).toBe('Vana lause.');
	});

	it('neither shape → English title, no lead', () => {
		expect(displayTitle(mk('plain body'))).toBe('English title');
		expect(displayLead(mk('plain body'))).toBeNull();
	});
});
