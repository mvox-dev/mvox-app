// Reads the forge's issues into the RoadmapIssue[] JSON render.ts reads; a shipyard timer runs it.
// CLI: node --import tsx scripts/roadmap/fetch-issues.ts --out <file> [--strip-motion-labels]
// Env: FORGE_TOKEN (read:issue, or write:issue with the strip), FORGE_API, FORGE_REPO. (*PO:Gama*)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { field } from './issue-model';
import { elapsedLabel, parseFrontmatter, type RoadmapIssue, type RoadmapLabel } from './render';

const DEFAULT_API = 'http://forge/api/v1';
const DEFAULT_REPO = 'mvox/mvox-app';
/** The forge's own page-size ceiling; asking for more still returns 50. */
const PER_PAGE = 50;
/** Hard ceiling so a pagination bug fails loud instead of looping forever. */
const MAX_PAGES = 100;
const ARCHIVE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'roadmap', 'github-archive.json');

/** A closed issue is out of the queue: these come off it (Mihkel, 2026-10-10). */
export const MOTION_LABELS = ['ready', 'in research', 'researched', 'prepped', 'in process', 'in human review'];

interface ForgeLabel {
	id?: number;
	name?: string;
	color?: string;
}

interface ForgeIssue {
	number: number;
	title: string;
	state: string;
	state_reason?: string | null;
	labels: (string | ForgeLabel)[];
	body: string | null;
	pull_request?: unknown;
	closed_at?: string | null;
	updated_at?: string | null;
	html_url: string;
}

/** What GitHub knew about an issue that the forge does not carry. */
export interface ArchiveEntry {
	type?: string;
	stateReason?: 'completed' | 'not_planned';
	subIssues?: number[];
	researchMs?: number;
	buildMs?: number;
	reviewMs?: number;
}

export interface Archive {
	/** Label history on the forge starts here; an issue not updated since has none to read. */
	forgeSince: string;
	issues: Record<string, ArchiveEntry>;
}

export const EMPTY_ARCHIVE: Archive = { forgeSince: '1970-01-01T00:00:00Z', issues: {} };

/** Extract the `rel="next"` URL from a `Link` response header, or null when absent. */
export function parseNextLink(linkHeader: string | null): string | null {
	if (!linkHeader) return null;
	for (const part of linkHeader.split(',')) {
		const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part.trim());
		if (match) return match[1];
	}
	return null;
}

// The body cut to what the page shows, slugline and lead: the GitHub mirror makes the file public.
export function publicBody(body: string | null): string | null {
	const pick = (key: string): string | null => {
		const fromFrontmatter = parseFrontmatter(body)?.[key];
		const value = field(body ?? '', key) ?? fromFrontmatter;
		return typeof value === 'string' && value.length > 0 ? value : null;
	};
	const parts = [
		['Slugline', pick('slugline')],
		['Lead', pick('lead')]
	].flatMap(([heading, value]) => (value ? [`### ${heading}\n\n${value}`] : []));
	return parts.length > 0 ? parts.join('\n\n') : null;
}

/** Normalize one forge REST issue payload into the renderer's `RoadmapIssue` shape. */
export function normalizeIssue(raw: ForgeIssue): RoadmapIssue {
	const state = raw.state === 'closed' ? 'closed' : 'open';
	const stateReason =
		raw.state_reason === 'completed' || raw.state_reason === 'not_planned' ? raw.state_reason : null;
	// Label colour stays as the API reports it, without '#'; render.ts adds the '#'.
	const labels: RoadmapLabel[] = raw.labels
		.map((l) => (typeof l === 'string' ? { name: l, color: null } : { name: l.name ?? '', color: l.color ?? null }))
		.filter((l): l is RoadmapLabel => l.name.length > 0);
	return {
		number: raw.number,
		title: raw.title,
		state,
		stateReason,
		labels,
		body: publicBody(raw.body),
		closedAt: raw.closed_at ?? null,
		// #403: moves on an edit, comment, label or close, not on a reference.
		updatedAt: raw.updated_at ?? null,
		htmlUrl: raw.html_url,
		subIssues: [],
		// #373: the forge has no issue types; the archive supplies GitHub's.
		issueType: null
	};
}

async function forgeFetch(
	url: string,
	token: string,
	fetchImpl: typeof fetch,
	method = 'GET'
): Promise<Response> {
	const res = await fetchImpl(url, {
		method,
		headers: { Authorization: `token ${token}`, Accept: 'application/json' }
	});
	if (!res.ok) {
		throw new Error(`forge API request failed: ${res.status} ${res.statusText} (${method} ${url})`);
	}
	return res;
}

async function fetchPaged<T>(url: string, token: string, fetchImpl: typeof fetch): Promise<T[]> {
	const items: T[] = [];
	let next: string | null = url;
	for (let page = 0; next && page < MAX_PAGES; page++) {
		const res = await forgeFetch(next, token, fetchImpl);
		items.push(...((await res.json()) as T[]));
		next = parseNextLink(res.headers.get('link'));
	}
	if (next) throw new Error(`forge API: more than ${MAX_PAGES} pages (${url})`);
	return items;
}

/** Every open+closed issue on the repo (PRs excluded). */
async function fetchAllIssues(
	api: string,
	repo: string,
	token: string,
	fetchImpl: typeof fetch
): Promise<ForgeIssue[]> {
	const items = await fetchPaged<ForgeIssue>(
		`${api}/repos/${repo}/issues?state=all&type=issues&limit=${PER_PAGE}`,
		token,
		fetchImpl
	);
	return items.filter((item) => item.pull_request == null);
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

interface TimelineEvent {
	type?: string;
	body?: string;
	created_at?: string;
	label?: { name?: string } | null;
}

/** Forge timeline → label events. A `label` event's body is "1" when added, empty when removed. */
export function toLabelEvents(timeline: TimelineEvent[]): LabelEvent[] {
	const events: LabelEvent[] = [];
	for (const e of timeline) {
		if (!e.created_at) continue;
		if (e.type === 'label' && e.label?.name) {
			events.push({ kind: e.body === '1' ? 'labeled' : 'unlabeled', label: e.label.name, at: e.created_at });
		} else if (e.type === 'close') {
			events.push({ kind: 'closed', at: e.created_at });
		} else if (e.type === 'reopen') {
			events.push({ kind: 'reopened', at: e.created_at });
		}
	}
	return events;
}

async function fetchHistory(
	api: string,
	repo: string,
	token: string,
	n: number,
	fetchImpl: typeof fetch
): Promise<LabelEvent[]> {
	const timeline = await fetchPaged<TimelineEvent>(
		`${api}/repos/${repo}/issues/${n}/timeline?limit=${PER_PAGE}`,
		token,
		fetchImpl
	);
	return toLabelEvents(timeline);
}

/** Fetch the full board, with types, sub-issues and pre-move times from the archive. */
export async function fetchBoard(
	repo: string,
	token: string,
	fetchImpl: typeof fetch = fetch,
	archive: Archive = EMPTY_ARCHIVE,
	api: string = DEFAULT_API
): Promise<RoadmapIssue[]> {
	const issues = (await fetchAllIssues(api, repo, token, fetchImpl)).map(normalizeIssue);
	const since = Date.parse(archive.forgeSince);
	for (const issue of issues) {
		const old = archive.issues[String(issue.number)];
		if (old?.type) issue.issueType = old.type;
		if (issue.state === 'closed' && issue.stateReason == null) issue.stateReason = old?.stateReason ?? null;
		// An archived issue untouched since the move has no forge history to read.
		const touched = !old || Date.parse(issue.updatedAt ?? '') >= since;
		const history = touched ? await fetchHistory(api, repo, token, issue.number, fetchImpl) : [];
		const label = elapsedLabel(issue);
		if (label) issue.statusSince = labelSince(history, label);
		issue.researchMs = labelSpanMs(history, 'in research') ?? old?.researchMs ?? null;
		if (issue.state === 'closed') {
			issue.buildMs = labelSpanMs(history, 'in process') ?? old?.buildMs ?? null;
			issue.reviewMs = labelSpanMs(history, 'in human review') ?? old?.reviewMs ?? null;
		}
	}
	const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
	const childNumbers = new Set<number>();
	for (const issue of issues) {
		const subs = archive.issues[String(issue.number)]?.subIssues ?? [];
		// Nest the top-level object, so grandchildren resolve onto the same object whatever the order.
		issue.subIssues = subs.flatMap((n) => byNumber.get(n) ?? []);
		for (const sub of issue.subIssues) childNumbers.add(sub.number);
	}
	// Children are also at top level; drop those, or each renders twice.
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

/** Take the motion labels off every closed issue; returns how many labels came off. */
export async function stripMotionLabels(
	repo: string,
	token: string,
	fetchImpl: typeof fetch = fetch,
	api: string = DEFAULT_API
): Promise<number> {
	const closed = await fetchPaged<ForgeIssue>(
		`${api}/repos/${repo}/issues?state=closed&type=issues&limit=${PER_PAGE}`,
		token,
		fetchImpl
	);
	let removed = 0;
	for (const issue of closed) {
		for (const label of issue.labels) {
			if (typeof label === 'string' || label.id == null || !MOTION_LABELS.includes(label.name ?? '')) continue;
			await forgeFetch(`${api}/repos/${repo}/issues/${issue.number}/labels/${label.id}`, token, fetchImpl, 'DELETE');
			removed++;
		}
	}
	return removed;
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const outIndex = args.indexOf('--out');
	const outPath = outIndex !== -1 ? args[outIndex + 1] : undefined;
	if (!outPath) {
		throw new Error('usage: fetch-issues.ts --out <issues.json> [--strip-motion-labels]');
	}
	const token = process.env.FORGE_TOKEN;
	if (!token) {
		throw new Error('fetch-issues.ts: FORGE_TOKEN is not set');
	}
	const api = process.env.FORGE_API ?? DEFAULT_API;
	const repo = process.env.FORGE_REPO ?? DEFAULT_REPO;

	// Strip first, so the board read below already sees the labels gone.
	if (args.includes('--strip-motion-labels')) {
		const removed = await stripMotionLabels(repo, token, fetch, api);
		console.log(`fetch-issues: took ${removed} motion labels off closed issues`);
	}

	const archive = JSON.parse(await readFile(ARCHIVE_PATH, 'utf-8')) as Archive;
	const issues = await fetchBoard(repo, token, fetch, archive, api);

	await mkdir(dirname(outPath), { recursive: true });
	await writeFile(outPath, `${JSON.stringify(issues, null, 2)}\n`, 'utf-8');
	console.log(`fetch-issues: wrote ${issues.length} issues to ${outPath}`);
}

const isMainModule = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
	main().catch((err: unknown) => {
		console.error(err);
		process.exitCode = 1;
	});
}
