// The build's only network step: fetches this repo's issues (PRs excluded, paginated) with epics'
// sub-issues, writes the RoadmapIssue[] JSON render.ts reads. Env: GITHUB_TOKEN, GITHUB_REPOSITORY.
// CLI: node --import tsx scripts/roadmap/fetch-issues.ts --out <issues.json> (*MVOX:Palestrina*)
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { kindOf } from './issue-model';
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
	updated_at?: string | null;
	html_url: string;
	/** Native issue type (#373). REST reports an object; pre-type issues carry null. */
	type?: { name?: string | null } | null;
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
	// Label colour stays as GitHub reports it, without '#'; render.ts adds the '#'.
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
		// #403: GitHub moves this on an edit, comment, label or close, not on a reference.
		updatedAt: raw.updated_at ?? null,
		htmlUrl: raw.html_url,
		subIssues: [],
		// #373: only the type's NAME crosses this seam — the REST `type` object
		// (ids, colours, timestamps) is a raw GitHub shape and stays in this file.
		issueType: raw.type?.name ?? null
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

// One parent's direct sub-issues. per_page=100 covers a parent in full (GitHub caps it at 100;
// the default 30 would leave the rest flat at top level).
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

interface GitHubIssueEvent {
	event?: string;
	created_at?: string;
	label?: { name?: string };
}

/** When `in process` was last added, from an issue's events; null when it never was. */
export function inProcessSince(events: GitHubIssueEvent[]): string | null {
	let since: string | null = null;
	for (const e of events) {
		if (e.event === 'labeled' && e.label?.name === 'in process' && e.created_at) since = e.created_at;
	}
	return since;
}

async function fetchInProcessSince(
	repo: string,
	token: string,
	issueNumber: number,
	fetchImpl: typeof fetch
): Promise<string | null> {
	const events: GitHubIssueEvent[] = [];
	let url: string | null = `${API_BASE}/repos/${repo}/issues/${issueNumber}/events?per_page=${PER_PAGE}`;
	for (let page = 0; url && page < MAX_PAGES; page++) {
		const res = await githubFetch(url, token, fetchImpl);
		events.push(...((await res.json()) as GitHubIssueEvent[]));
		url = parseNextLink(res.headers.get('link'));
	}
	return inProcessSince(events);
}

/** Fetch the full board: all issues, with sub-issues resolved for every `epic`-labeled issue. */
export async function fetchBoard(
	repo: string,
	token: string,
	fetchImpl: typeof fetch = fetch
): Promise<RoadmapIssue[]> {
	const rawIssues = await fetchAllIssues(repo, token, fetchImpl);
	const issues = rawIssues.map(normalizeIssue);
	for (const issue of issues) {
		if (issue.state === 'open' && issue.labels.some((l) => l.name === 'in process')) {
			issue.inProcessSince = await fetchInProcessSince(repo, token, issue.number, fetchImpl);
		}
	}
	const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
	const childNumbers = new Set<number>();
	for (const issue of issues) {
		// #373: native type first, the `epic` label only for the pre-type archive.
		if (kindOf(issue.issueType, issue.labels.map((l) => l.name)) === 'epic') {
			const fetched = await fetchSubIssues(repo, token, issue.number, fetchImpl);
			// Nest the top-level object, not the sub_issues copy, so grandchildren resolve
			// onto the same object whatever the loop order.
			issue.subIssues = fetched.map((sub) => byNumber.get(sub.number) ?? sub);
			for (const sub of issue.subIssues) childNumbers.add(sub.number);
		}
	}
	// Sub-issues also came back at top level; drop those, or each renders twice.
	const roots = issues.filter((issue) => !childNumbers.has(issue.number));

	// A parent cycle would drop its whole ring above; anything the roots miss goes back on top.
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
