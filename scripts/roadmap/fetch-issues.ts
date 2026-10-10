// The build's only network step: fetches this repo's issues (PRs excluded, paginated) with epics'
// sub-issues, writes the RoadmapIssue[] JSON render.ts reads. Env: GITHUB_TOKEN, GITHUB_REPOSITORY.
// CLI: node --import tsx scripts/roadmap/fetch-issues.ts --out <issues.json> (*MVOX:Palestrina*)
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { kindOf } from './issue-model';
import { elapsedLabel, type RoadmapIssue, type RoadmapLabel } from './render';

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

export interface LabelEvent {
	kind: 'labeled' | 'unlabeled' | 'closed' | 'reopened';
	label?: string;
	at: string;
}

/** When `label` was last added; null when it never was. */
export function labelSince(history: LabelEvent[], label: string): string | null {
	let since: string | null = null;
	for (const e of history) if (e.kind === 'labeled' && e.label === label) since = e.at;
	return since;
}

/** Total time `label` was on, over spans that ended (removed or closed); null when none did. */
export function labelSpanMs(history: LabelEvent[], label: string): number | null {
	let on = false;
	let open = true;
	let start = 0;
	let total = 0;
	let ended = 0;
	const close = (at: string) => {
		total += Date.parse(at) - start;
		ended++;
	};
	for (const e of history) {
		if (e.kind === 'labeled' && e.label === label && !on) {
			on = true;
			if (open) start = Date.parse(e.at);
		} else if (e.kind === 'unlabeled' && e.label === label && on) {
			on = false;
			if (open) close(e.at);
		} else if (e.kind === 'closed' && open) {
			open = false;
			if (on) close(e.at);
		} else if (e.kind === 'reopened' && !open) {
			open = true;
			if (on) start = Date.parse(e.at);
		}
	}
	return ended > 0 ? total : null;
}

const HISTORY_QUERY = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 25, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        timelineItems(first: 100, itemTypes: [LABELED_EVENT, UNLABELED_EVENT, CLOSED_EVENT, REOPENED_EVENT]) {
          pageInfo { hasNextPage }
          nodes {
            __typename
            ... on LabeledEvent { createdAt label { name } }
            ... on UnlabeledEvent { createdAt label { name } }
            ... on ClosedEvent { createdAt }
            ... on ReopenedEvent { createdAt }
          }
        }
      }
    }
  }
}`;

interface TimelineNode {
	__typename: string;
	createdAt: string;
	label?: { name: string };
}

interface HistoryResponse {
	data?: {
		repository?: {
			issues?: {
				pageInfo: { hasNextPage: boolean; endCursor: string | null };
				nodes: { number: number; timelineItems: { pageInfo: { hasNextPage: boolean }; nodes: TimelineNode[] } }[];
			};
		};
	};
}

const KINDS: Record<string, LabelEvent['kind']> = {
	LabeledEvent: 'labeled',
	UnlabeledEvent: 'unlabeled',
	ClosedEvent: 'closed',
	ReopenedEvent: 'reopened'
};

export function toLabelEvents(nodes: TimelineNode[]): LabelEvent[] {
	return nodes
		.filter((n) => KINDS[n.__typename])
		.map((n) => ({ kind: KINDS[n.__typename], label: n.label?.name, at: n.createdAt }));
}

interface RestEvent {
	event?: string;
	created_at?: string;
	label?: { name?: string };
}

async function restHistory(repo: string, token: string, n: number, fetchImpl: typeof fetch): Promise<LabelEvent[]> {
	const events: LabelEvent[] = [];
	let url: string | null = `${API_BASE}/repos/${repo}/issues/${n}/events?per_page=${PER_PAGE}`;
	for (let page = 0; url && page < MAX_PAGES; page++) {
		const res = await githubFetch(url, token, fetchImpl);
		for (const e of (await res.json()) as RestEvent[]) {
			const kind = e.event as LabelEvent['kind'];
			if (Object.values(KINDS).includes(kind) && e.created_at) {
				events.push({ kind, label: e.label?.name, at: e.created_at });
			}
		}
		url = parseNextLink(res.headers.get('link'));
	}
	return events;
}

// Pages of 25: at 60 or more, GitHub silently answers some timelines empty (seen 2026-10-07).
// A labeled issue whose timeline still comes back empty is read again over REST.
export async function fetchHistories(
	repo: string,
	token: string,
	labeled: Set<number>,
	fetchImpl: typeof fetch
): Promise<Map<number, LabelEvent[]>> {
	const [owner, name] = repo.split('/');
	const histories = new Map<number, LabelEvent[]>();
	let after: string | null = null;
	for (let page = 0; page < MAX_PAGES; page++) {
		const res = await fetchImpl(`${API_BASE}/graphql`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ query: HISTORY_QUERY, variables: { owner, name, after } })
		});
		if (!res.ok) throw new Error(`GitHub GraphQL request failed: ${res.status} ${res.statusText}`);
		const body = (await res.json()) as HistoryResponse;
		const issues = body.data?.repository?.issues;
		if (!issues) throw new Error('GitHub GraphQL: no issues in the history response');
		for (const node of issues.nodes) {
			histories.set(
				node.number,
				node.timelineItems.pageInfo.hasNextPage ||
					(node.timelineItems.nodes.length === 0 && labeled.has(node.number))
					? await restHistory(repo, token, node.number, fetchImpl)
					: toLabelEvents(node.timelineItems.nodes)
			);
		}
		if (!issues.pageInfo.hasNextPage) break;
		after = issues.pageInfo.endCursor;
	}
	return histories;
}

/** Fetch the full board: all issues, with sub-issues resolved for every `epic`-labeled issue. */
export async function fetchBoard(
	repo: string,
	token: string,
	fetchImpl: typeof fetch = fetch
): Promise<RoadmapIssue[]> {
	const rawIssues = await fetchAllIssues(repo, token, fetchImpl);
	const issues = rawIssues.map(normalizeIssue);
	const labeled = new Set(issues.filter((i) => i.labels.length > 0).map((i) => i.number));
	const histories = await fetchHistories(repo, token, labeled, fetchImpl);
	for (const issue of issues) {
		const history = histories.get(issue.number) ?? [];
		const label = elapsedLabel(issue);
		if (label) issue.statusSince = labelSince(history, label);
		issue.researchMs = labelSpanMs(history, 'in research');
		if (issue.state === 'closed') {
			issue.buildMs = labelSpanMs(history, 'in process');
			issue.reviewMs = labelSpanMs(history, 'in human review');
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
