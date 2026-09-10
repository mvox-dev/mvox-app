/**
 * #305 — Roadmap board fetch step.
 *
 * Pulls this repo's issues (open + closed) from the GitHub REST API using
 * the Action's own `GITHUB_TOKEN`, resolves native sub-issues for every
 * issue carrying the `epic` label, and writes the result as the
 * `RoadmapIssue[]` JSON that scripts/roadmap/render.ts consumes.
 *
 * Deliberately separate from render.ts: this file talks to the network and
 * is the only part of the build that does; render.ts stays a pure function
 * of the JSON this script produces (see render.ts's own doc comment), so
 * the renderer's tests never need a live token or a mocked network.
 *
 * 302 issues live on this board today (2026-09-10) — well past one REST
 * page (max 100/page) — so this PAGINATES via the `Link: rel="next"`
 * response header rather than assuming one response covers the board.
 * The plain `/issues` endpoint also mixes in pull requests, so entries
 * carrying a `pull_request` field are filtered out (verified live 2026-09-10;
 * see teams/mvox-dev/memory/research/research-305.json, key "api-shape").
 *
 * CLI:
 *   node --import tsx scripts/roadmap/fetch-issues.ts --out <issues.json>
 * Env:
 *   GITHUB_TOKEN       — required; the Action's own token, read-only usage here.
 *   GITHUB_REPOSITORY  — "owner/repo"; set automatically inside a GitHub Action.
 *
 * (*MVOX:Palestrina*)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RoadmapIssue, RoadmapLabel } from './render';

const API_BASE = 'https://api.github.com';
const DEFAULT_REPO = 'mvox-dev/mvox-app';
const PER_PAGE = 100;
/** Hard ceiling so a pagination bug fails loud instead of looping forever. */
const MAX_PAGES = 50;

interface GitHubLabel {
	name?: string;
	color?: string;
}

interface GitHubIssue {
	number: number;
	title: string;
	state: string;
	state_reason?: string | null;
	labels: (string | GitHubLabel)[];
	body: string | null;
	pull_request?: unknown;
	closed_at?: string | null;
}

/** Extract the `rel="next"` URL from a GitHub `Link` response header, or null when absent. */
export function parseNextLink(linkHeader: string | null): string | null {
	if (!linkHeader) return null;
	for (const part of linkHeader.split(',')) {
		const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part.trim());
		if (match) return match[1];
	}
	return null;
}

/** Normalize one GitHub REST issue payload into the renderer's `RoadmapIssue` shape. */
export function normalizeIssue(raw: GitHubIssue): RoadmapIssue {
	const state = raw.state === 'closed' ? 'closed' : 'open';
	const stateReason =
		raw.state_reason === 'completed' || raw.state_reason === 'not_planned' ? raw.state_reason : null;
	// GitHub reports label colour as hex WITHOUT the leading '#'; kept exactly
	// as reported here, '#' is prepended at render time only (label-color.ts /
	// render.ts's renderLabel).
	const labels: RoadmapLabel[] = raw.labels
		.map((l) => (typeof l === 'string' ? { name: l, color: null } : { name: l.name ?? '', color: l.color ?? null }))
		.filter((l): l is RoadmapLabel => l.name.length > 0);
	return {
		number: raw.number,
		title: raw.title,
		state,
		stateReason,
		labels,
		body: raw.body,
		closedAt: raw.closed_at ?? null,
		subIssues: []
	};
}

async function githubFetch(url: string, token: string, fetchImpl: typeof fetch): Promise<Response> {
	const res = await fetchImpl(url, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28'
		}
	});
	if (!res.ok) {
		throw new Error(`GitHub API request failed: ${res.status} ${res.statusText} (${url})`);
	}
	return res;
}

/** Every open+closed issue on the repo (PRs excluded), following Link-header pagination. */
async function fetchAllIssues(repo: string, token: string, fetchImpl: typeof fetch): Promise<GitHubIssue[]> {
	const issues: GitHubIssue[] = [];
	let url: string | null = `${API_BASE}/repos/${repo}/issues?state=all&per_page=${PER_PAGE}`;
	for (let page = 0; url && page < MAX_PAGES; page++) {
		const res = await githubFetch(url, token, fetchImpl);
		const body = (await res.json()) as GitHubIssue[];
		for (const item of body) {
			if (!('pull_request' in item) || item.pull_request == null) issues.push(item);
		}
		url = parseNextLink(res.headers.get('link'));
	}
	return issues;
}

/**
 * The direct sub-issues of one issue number.
 *
 * `per_page=100` because GitHub caps a parent at 100 sub-issues, which is also
 * this endpoint's maximum page size — one request therefore always covers a
 * parent in full, and there is no `Link` header worth following. The endpoint's
 * own default is 30, which would nest the first 30 children of a larger epic
 * and quietly leave the rest to render flat at top level.
 *
 * Depth is not this function's concern: it returns one parent's direct children
 * and fetchBoard assembles however many levels the board's epics form (GitHub
 * allows up to eight).
 */
async function fetchSubIssues(
	repo: string,
	token: string,
	issueNumber: number,
	fetchImpl: typeof fetch
): Promise<RoadmapIssue[]> {
	const res = await githubFetch(
		`${API_BASE}/repos/${repo}/issues/${issueNumber}/sub_issues?per_page=${PER_PAGE}`,
		token,
		fetchImpl
	);
	const body = (await res.json()) as GitHubIssue[];
	return body.map(normalizeIssue);
}

/** Fetch the full board: all issues, with sub-issues resolved for every `epic`-labeled issue. */
export async function fetchBoard(
	repo: string,
	token: string,
	fetchImpl: typeof fetch = fetch
): Promise<RoadmapIssue[]> {
	const rawIssues = await fetchAllIssues(repo, token, fetchImpl);
	const issues = rawIssues.map(normalizeIssue);
	const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
	const childNumbers = new Set<number>();
	for (const issue of issues) {
		if (issue.labels.some((l) => l.name === 'epic')) {
			const fetched = await fetchSubIssues(repo, token, issue.number, fetchImpl);
			// Nest the object from the top-level list, not the sub_issues copy of it.
			// The copy is a distinct object whose own subIssues stay empty forever, so
			// nesting it would strand every grandchild: a nested epic's children are
			// resolved onto its top-level object, which the copy never sees. Sharing
			// one object per number makes the depth independent of loop order.
			issue.subIssues = fetched.map((sub) => byNumber.get(sub.number) ?? sub);
			for (const sub of issue.subIssues) childNumbers.add(sub.number);
		}
	}
	// Sub-issues are ordinary repo issues, so the list above already returned each
	// one at top level too. Drop those entries: the renderer walks both the top
	// level and the nested subIssues, so leaving them in renders every sub-issue
	// twice. A nested epic is unaffected — it keeps its children because it IS the
	// same object, and only loses its top-level position.
	const roots = issues.filter((issue) => !childNumbers.has(issue.number));

	// De-parenting is only safe for a child something still reaches. If the API
	// ever reports a parent cycle (289 under 290 under 289), every member is some
	// other member's child, so the filter above would drop the whole ring off the
	// board without a word. Walk what the roots reach and put anything stranded
	// back at top level: the page keeps every issue it fetched, whatever shape the
	// sub-issue graph turns out to have.
	const reachable = new Set<number>();
	const stack = [...roots];
	for (let node = stack.pop(); node != null; node = stack.pop()) {
		if (reachable.has(node.number)) continue;
		reachable.add(node.number);
		stack.push(...(node.subIssues ?? []));
	}
	return [...roots, ...issues.filter((issue) => !reachable.has(issue.number))];
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const outIndex = args.indexOf('--out');
	const outPath = outIndex !== -1 ? args[outIndex + 1] : undefined;
	if (!outPath) {
		throw new Error('usage: fetch-issues.ts --out <issues.json>');
	}
	const token = process.env.GITHUB_TOKEN;
	if (!token) {
		throw new Error('fetch-issues.ts: GITHUB_TOKEN is not set — the Action must pass its own token');
	}
	const repo = process.env.GITHUB_REPOSITORY ?? DEFAULT_REPO;

	const issues = await fetchBoard(repo, token);

	await mkdir(dirname(outPath), { recursive: true });
	await writeFile(outPath, JSON.stringify(issues, null, 2), 'utf-8');
	console.log(`fetch-issues: wrote ${issues.length} issues to ${outPath}`);
}

const isMainModule = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
	main().catch((err: unknown) => {
		console.error(err);
		process.exitCode = 1;
	});
}
