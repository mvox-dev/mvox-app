// @vitest-environment happy-dom
/**
 * #305 — the fetch → render seam.
 *
 * render.spec.ts pins the renderer against hand-built input; fetch-issues.spec.ts
 * pins the pure fetch-step helpers. Neither sees the shape fetchBoard actually
 * PRODUCES, and that gap hid two real defects in a row: sub-issues rendered
 * twice (they are ordinary repo issues, so `/issues?state=all` returns them at
 * top level as well as under their epic), and then, once de-parented, a
 * two-level chain silently lost its grandchild. Live today every epic has zero
 * sub-issues, so neither showed on the page — these specs drive the real
 * fetchBoard so they cannot hide again.
 *
 * The network seam is the house `fetchImpl` parameter (see
 * src/lib/testing/networkGuard.setup.ts): the stub below is passed in
 * explicitly, so the global fetch guard is never touched.
 *
 * (*MVOX:Byrd*)
 */
import { describe, expect, it } from 'vitest';
import { fetchBoard } from './fetch-issues';
import { renderBoard } from './render';

const GENERATED_AT = '2026-09-10T12:34:56Z';
const REPO = 'mvox-dev/mvox-app';

/** A GitHub REST issue payload, in the shape `/issues?state=all` really returns. */
interface RawIssue {
	number: number;
	title: string;
	state: string;
	state_reason: string | null;
	labels: { name: string; color: string }[];
	body: null;
	closed_at: string | null;
	html_url: string;
}

/** Live palette values (gh api repos/mvox-dev/mvox-app/labels, 2026-09-10). */
const PALETTE: Record<string, string> = {
	epic: '6f42c1',
	task: '1d76db',
	ready: '0e8a16',
	bug: 'd73a4a',
	blocked: 'b60205',
	wontfix: 'ffffff'
};

function raw(number: number, labels: string[], overrides: Partial<RawIssue> = {}): RawIssue {
	return {
		number,
		title: `Issue ${number}`,
		state: 'open',
		state_reason: null,
		labels: labels.map((name) => ({ name, color: PALETTE[name] ?? 'cccccc' })),
		body: null,
		closed_at: null,
		html_url: `https://github.com/mvox-dev/mvox-app/issues/${number}`,
		...overrides
	};
}

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

/**
 * Stands in for the GitHub REST API: `list` is the repo's issues (which always
 * includes every sub-issue, since sub-issues are ordinary issues), and `subs`
 * maps an epic's number to the children its sub_issues endpoint reports. No
 * `Link` header — one page, so pagination stops after it.
 */
function githubStub(list: RawIssue[], subs: Record<number, RawIssue[]> = {}): typeof fetch {
	return (async (input: RequestInfo | URL) => {
		const url = String(input);
		const match = /\/issues\/(\d+)\/sub_issues/.exec(url);
		if (match) return jsonResponse(subs[Number(match[1])] ?? []);
		if (url.includes('/issues?')) return jsonResponse(list);
		throw new Error(`unexpected request: ${url}`);
	}) as unknown as typeof fetch;
}

function parse(html: string): Document {
	return new DOMParser().parseFromString(html, 'text/html');
}

function board(list: RawIssue[], subs: Record<number, RawIssue[]> = {}) {
	return fetchBoard(REPO, 'test-token', githubStub(list, subs));
}

describe('fetchBoard → renderBoard — one level', () => {
	const list = [raw(289, ['epic']), raw(290, ['task']), raw(305, ['task'])];
	const subs = { 289: [raw(290, ['task'])] };

	it('de-parents resolved sub-issues from the top level', async () => {
		const result = await board(list, subs);
		expect(result.map((i) => i.number)).toEqual([289, 305]);
		expect(result[0].subIssues?.map((s) => s.number)).toEqual([290]);
	});

	it('renders each issue exactly once — nested under its epic, not also flat', async () => {
		const doc = parse(renderBoard(await board(list, subs), GENERATED_AT));
		expect(doc.querySelectorAll('[data-issue="290"]')).toHaveLength(1);
		expect(doc.querySelector('[data-issue="289"] [data-issue="290"]')).not.toBeNull();
	});

	it('leaves issues with no epic parent at the top level', async () => {
		const doc = parse(renderBoard(await board(list, subs), GENERATED_AT));
		const el = doc.querySelector('[data-issue="305"]');
		expect(el).not.toBeNull();
		expect(el?.closest('[data-issue="289"]')).toBeNull();
	});
});

describe('fetchBoard → renderBoard — two levels', () => {
	// epic 289 → epic 290 → task 291. De-parenting must not strand 291: the
	// nested 290 has to be the same object whose children were resolved.
	const list = [raw(289, ['epic']), raw(290, ['epic']), raw(291, ['task']), raw(305, ['task'])];
	const subs = { 289: [raw(290, ['epic'])], 290: [raw(291, ['task'])] };

	it('keeps a nested epic\'s own children reachable', async () => {
		const result = await board(list, subs);
		expect(result.map((i) => i.number)).toEqual([289, 305]);
		expect(result[0].subIssues?.[0].subIssues?.map((s) => s.number)).toEqual([291]);
	});

	it('renders the grandchild exactly once, nested two deep', async () => {
		const doc = parse(renderBoard(await board(list, subs), GENERATED_AT));
		expect(doc.querySelectorAll('[data-issue="291"]')).toHaveLength(1);
		expect(
			doc.querySelector('[data-issue="289"] [data-issue="290"] [data-issue="291"]')
		).not.toBeNull();
	});

	it('renders every issue on the page — nothing silently dropped', async () => {
		const html = renderBoard(await board(list, subs), GENERATED_AT);
		const ids = [...html.matchAll(/data-issue="(\d+)"/g)].map((m) => Number(m[1]));
		expect([...ids].sort((a, b) => a - b)).toEqual([289, 290, 291, 305]);
	});
});

describe('fetchBoard — request shape', () => {
	it('asks for a parent\'s whole 100-sub-issue ceiling in one page', async () => {
		// GitHub caps a parent at 100 sub-issues and this endpoint's page size at
		// 100, so one page always covers a parent. The endpoint's own default is
		// 30: without per_page a 35-child epic would nest 30 and strand the rest.
		const urls: string[] = [];
		const inner = githubStub([raw(289, ['epic']), raw(290, ['task'])], { 289: [raw(290, ['task'])] });
		const recording = (async (input: RequestInfo | URL, init?: RequestInit) => {
			urls.push(String(input));
			return inner(input, init);
		}) as unknown as typeof fetch;

		await fetchBoard(REPO, 'test-token', recording);

		const subUrl = urls.find((u) => u.includes('/sub_issues')) ?? '';
		expect(subUrl, 'no sub_issues request was made').not.toBe('');
		expect(new URL(subUrl).searchParams.get('per_page')).toBe('100');
	});
});

describe('fetchBoard → renderBoard — #307 colours and ordering ride the real pipeline', () => {
	// Integration on purpose: unit specs can pass with the feature unwired.
	// These drive the REST payload shape through the real fetchBoard into
	// renderBoard, so label colours / closed_at must survive normalization.
	it('carries label colours from the REST payload into the rendered chips', async () => {
		const html = renderBoard(await board([raw(305, ['task']), raw(262, ['blocked'])]), GENERATED_AT);
		const doc = parse(html);
		const chip = (issueNumber: number, name: string): string => {
			const el = Array.from(
				doc.querySelectorAll(`[data-issue="${issueNumber}"] .label`)
			).find((c) => c.textContent?.trim() === name);
			expect(el, `no .label chip "${name}" under #${issueNumber}`).toBeDefined();
			return el?.getAttribute('style') ?? '';
		};
		expect(chip(305, 'task')).toMatch(/background(?:-color)?:\s*#1d76db/i);
		const blocked = chip(262, 'blocked');
		expect(blocked).toMatch(/background(?:-color)?:\s*#b60205/i);
		expect(blocked).toMatch(/(?<![\w-])color:\s*#(?:ffffff|fff)(?![0-9a-fA-F])/i);
	});

	it('orders open by number and closed by closed_at through the real fetch step, divided by Pooleli/Tehtud', async () => {
		// API order deliberately wrong on both sides of the line.
		const list = [
			raw(305, ['task']),
			raw(262, ['bug']),
			raw(210, ['task', 'wontfix'], {
				state: 'closed',
				state_reason: 'not_planned',
				closed_at: '2026-07-01T00:00:00Z'
			}),
			raw(304, ['task'], { state: 'closed', state_reason: 'completed', closed_at: '2026-09-08T00:00:00Z' })
		];
		const html = renderBoard(await board(list), GENERATED_AT);
		const pos = (needle: string): number => {
			const i = html.indexOf(needle);
			expect(i, `${needle} missing from the page`).toBeGreaterThan(-1);
			return i;
		};
		expect(pos('Pooleli')).toBeLessThan(pos('data-issue="262"'));
		expect(pos('data-issue="262"')).toBeLessThan(pos('data-issue="305"'));
		expect(pos('data-issue="305"')).toBeLessThan(pos('Tehtud'));
		expect(pos('Tehtud')).toBeLessThan(pos('data-issue="304"'));
		expect(pos('data-issue="304"')).toBeLessThan(pos('data-issue="210"'));
	});
});

describe('fetchBoard → renderBoard — #309 card links ride the real pipeline', () => {
	// Integration on purpose: a unit spec can go green with html_url normalized
	// but never fetched, or fetched but never rendered. This drives the REST
	// payload's html_url through the real fetchBoard into renderBoard and reads
	// it back off the page — top level and nested alike.
	it('carries html_url from the REST payload onto the rendered card links, nested children included', async () => {
		const html = renderBoard(
			await board([raw(289, ['epic']), raw(290, ['task']), raw(305, ['task'])], {
				289: [raw(290, ['task'])]
			}),
			GENERATED_AT
		);
		const doc = parse(html);
		expect(
			doc.querySelector('[data-issue="305"] a[href="https://github.com/mvox-dev/mvox-app/issues/305"]'),
			'top-level card carries no link to its issue'
		).not.toBeNull();
		expect(
			doc.querySelector('[data-issue="289"] a[href="https://github.com/mvox-dev/mvox-app/issues/289"]'),
			'epic card carries no link of its own'
		).not.toBeNull();
		expect(
			doc.querySelector(
				'[data-issue="289"] [data-issue="290"] a[href="https://github.com/mvox-dev/mvox-app/issues/290"]'
			),
			'nested child card carries no link of its own'
		).not.toBeNull();
	});
});

describe('fetchBoard → renderBoard — graphs that are not trees', () => {
	it('renders a child reported under two epics once, not once per parent', async () => {
		// GitHub allows one parent per sub-issue; the code does not assume it.
		const result = await board([raw(289, ['epic']), raw(292, ['epic']), raw(290, ['task'])], {
			289: [raw(290, ['task'])],
			292: [raw(290, ['task'])]
		});
		const doc = parse(renderBoard(result, GENERATED_AT));
		expect(doc.querySelectorAll('[data-issue="290"]')).toHaveLength(1);
		expect(doc.querySelectorAll('[data-issue="292"]')).toHaveLength(1);
	});

	it('terminates on a parent cycle instead of hanging the build', async () => {
		// 289 and 290 each claim the other as a sub-issue. Shared objects make this
		// an infinite walk without the renderer's guard; the build must not hang.
		const result = await board([raw(289, ['epic']), raw(290, ['epic']), raw(305, ['task'])], {
			289: [raw(290, ['epic'])],
			290: [raw(289, ['epic'])]
		});
		const html = renderBoard(result, GENERATED_AT);
		const ids = [...html.matchAll(/data-issue="(\d+)"/g)].map((m) => Number(m[1]));
		expect([...ids].sort((a, b) => a - b)).toEqual([289, 290, 305]);
	});
});
