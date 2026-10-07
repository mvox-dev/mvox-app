import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { field, isKindLabel, kindFromType, kindOf, type IssueKind } from './issue-model';
import { labelTextColor } from './label-color';

export interface RoadmapLabel {
	name: string;
	color: string | null;
}

export interface RoadmapIssue {
	number: number;
	title: string;
	state: 'open' | 'closed';

	stateReason: 'completed' | 'not_planned' | null;
	labels: RoadmapLabel[];
	body: string | null;

	closedAt: string | null;

	updatedAt?: string | null;

	// When the card's elapsed label (see elapsedLabel) was last put on; the card shows the time since.
	statusSince?: string | null;

	// Time `in research` was on, and on a closed card time `in process` was on, summed over spans.
	researchMs?: number | null;
	buildMs?: number | null;

	htmlUrl: string;

	subIssues?: RoadmapIssue[];

	issueType?: string | null;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function parseFrontmatter(body: string | null | undefined): Record<string, unknown> | null {
	if (!body) return null;
	const match = FRONTMATTER_RE.exec(body);
	if (!match) return null;
	try {
		const parsed: unknown = parseYaml(match[1]);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return null;
	} catch {

		return null;
	}
}

export function displayTitle(issue: RoadmapIssue): string {

	const slugline = field(issue.body ?? '', 'slugline') ?? parseFrontmatterField(issue, 'slugline');
	return slugline ?? issue.title;
}

function parseFrontmatterField(issue: RoadmapIssue, key: string): string | null {
	const value = parseFrontmatter(issue.body)?.[key];
	return typeof value === 'string' && value.length > 0 ? value : null;
}

export function displayLead(issue: RoadmapIssue): string | null {
	return field(issue.body ?? '', 'lead') ?? parseFrontmatterField(issue, 'lead');
}

export function buildStamp(generatedAt: string): string {
	return generatedAt;
}

export function formatGeneratedAt(generatedAt: string): string {
	const parts = new Intl.DateTimeFormat('et-EE', {
		timeZone: 'Europe/Tallinn',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
		timeZoneName: 'shortOffset'
	}).formatToParts(new Date(generatedAt));
	const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	return `${part('day')}.${part('month')}.${part('year')} ${part('hour')}:${part('minute')} ${part('timeZoneName')}`;
}

const HTML_ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;'
};

function escapeHtml(value: string): string {
	return value.replace(/[&<>]/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

function closedAtRank(issue: RoadmapIssue): number {
	if (!issue.closedAt) return -Infinity;
	const parsed = Date.parse(issue.closedAt);
	return Number.isNaN(parsed) ? -Infinity : parsed;
}

const ACTIVE_TIER_LABELS = ['in process', 'prepped', 'researched', 'in research'] as const;

export const MOTION_LABELS = [
	'ready',
	'in process',
	'prepped',
	'researched',
	'in research',
	'blocked'
] as const;

export function isMotionLabel(name: string): boolean {
	return (MOTION_LABELS as readonly string[]).includes(name);
}

function activityTier(issue: RoadmapIssue): number {

	const names = (issue.labels ?? []).map((label) => label?.name);
	const rank = ACTIVE_TIER_LABELS.findIndex((label) => names.includes(label));
	return rank === -1 ? ACTIVE_TIER_LABELS.length : rank;
}

function flattenOpenIssues(
	issues: RoadmapIssue[],
	seen: Set<number> = new Set<number>()
): RoadmapIssue[] {
	const result: RoadmapIssue[] = [];
	for (const issue of issues ?? []) {

		const number: number | undefined = issue?.number;
		if (typeof number === 'number') {
			if (seen.has(number)) continue;
			seen.add(number);
		}
		if (issue?.state === 'open') result.push(issue);
		const subIssues = issue?.subIssues ?? [];
		if (subIssues.length > 0) result.push(...flattenOpenIssues(subIssues, seen));
	}
	return result;
}

const STALENESS_SUPPRESSOR_LABELS = ['in research', 'blocks research'] as const;

const STALENESS_SATISFIER_LABELS = ['in process', 'prepped', 'researched', 'blocked'] as const;

function hasLabel(issue: RoadmapIssue, name: string): boolean {
	return (issue?.labels ?? []).some((label) => label?.name === name);
}

function issueKind(issue: RoadmapIssue): IssueKind | null {
	return kindOf(
		issue?.issueType,
		(issue?.labels ?? []).map((label) => label?.name ?? '')
	);
}

function stalenessViolators(issues: RoadmapIssue[]): number[] {
	try {
		const open = flattenOpenIssues(issues);
		const suppressed = open.some((issue) =>
			STALENESS_SUPPRESSOR_LABELS.some((label) => hasLabel(issue, label))
		);
		if (suppressed) return [];

		return open
			.filter((issue) => issueKind(issue) === 'task' && hasLabel(issue, 'ready'))
			.filter((issue) => !STALENESS_SATISFIER_LABELS.some((label) => hasLabel(issue, label)))
			.map((issue) => issue.number);
	} catch {

		return [];
	}
}

function renderStalenessWarning(issues: RoadmapIssue[], violators: number[]): string {
	if (violators.length === 0) return '';
	const open = flattenOpenIssues(issues);
	const links = violators
		.map((number) => {
			const found = open.find((issue) => issue.number === number);
			const href = found ? escapeHtml(found.htmlUrl) : '#';
			return `<a class="issue-link" href="${href}">#${number}</a>`;
		})
		.join(', ');
	return `<p class="staleness-warning">Valmis tööd seisavad ja keegi ei uuri: ${links}</p>`;
}

function boardOrder(issues: RoadmapIssue[]): RoadmapIssue[] {
	const open = issues
		.filter((i) => i.state === 'open')
		.sort((a, b) => activityTier(a) - activityTier(b) || a.number - b.number);
	const closed = issues.filter((i) => i.state === 'closed').sort((a, b) => closedAtRank(b) - closedAtRank(a));
	return [...open, ...closed];
}

const NO_COLOR_HEX_RE = /^[0-9a-fA-F]{6}$/;

const KIND_CHIP_COLORS: Record<IssueKind, string> = {
	task: '1d76db',
	bug: 'd73a4a',
	feature: 'a2eeef',
	epic: '6f42c1'
};

function renderLabel(label: RoadmapLabel): string {
	const name = escapeHtml(label?.name ?? '');
	if (!label?.color || !NO_COLOR_HEX_RE.test(label.color)) {
		return `<span class="label">${name}</span>`;
	}
	const background = `#${label.color}`;
	const text = labelTextColor(label.color);
	return `<span class="label" style="background-color: ${background}; color: ${text};">${name}</span>`;
}

export function renderUpdatedAt(updatedAt: string | null | undefined): string {
	if (!updatedAt) return '';
	const parsed = Date.parse(updatedAt);
	if (Number.isNaN(parsed)) return '';
	const iso = new Date(parsed).toISOString();
	return `<time class="issue-updated" datetime="${iso}">${escapeHtml(formatGeneratedAt(iso))}</time>`;
}

export function formatElapsed(ms: number): string {
	const minutes = Math.max(0, Math.floor(ms / 60000));
	const days = Math.floor(minutes / 1440);
	const hours = Math.floor((minutes % 1440) / 60);
	const mins = minutes % 60;
	if (days > 0) return days + ' p ' + hours + ' h';
	if (hours > 0) return hours + ' h ' + mins + ' min';
	return mins + ' min';
}

// A running stopwatch: "2:15:07", and "2 p 04:15:07" past a day. The page's script embeds this
// function's own source, so it keeps to plain JavaScript.
export function formatClock(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const days = Math.floor(total / 86400);
	const h = Math.floor((total % 86400) / 3600);
	const m = Math.floor((total % 3600) / 60);
	const sec = total % 60;
	const two = (n: number) => (n < 10 ? '0' : '') + n;
	const clock = two(m) + ':' + two(sec);
	return days > 0 ? days + ' p ' + two(h) + ':' + clock : h + ':' + clock;
}

export const ELAPSED_LABELS = ['in process', 'in research'] as const;

/** The label an open card counts its elapsed time from, the first of ELAPSED_LABELS it wears. */
export function elapsedLabel(issue: Pick<RoadmapIssue, 'state' | 'labels'>): string | null {
	if (issue.state !== 'open') return null;
	const names = (issue.labels ?? []).map((l) => l?.name);
	return ELAPSED_LABELS.find((label) => names.includes(label)) ?? null;
}

function statusSinceIso(issue: RoadmapIssue): string | null {
	if (!elapsedLabel(issue)) return null;
	const parsed = Date.parse(issue.statusSince ?? '');
	return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export function renderElapsed(label: string, sinceIso: string, generatedAt: string): string {
	const text = formatClock(Date.parse(generatedAt) - Date.parse(sinceIso));
	const title = `${label} since ${formatGeneratedAt(sinceIso)}`;
	return (
		`<time class="issue-updated issue-elapsed" datetime="${sinceIso}" ` +
		`title="${escapeHtml(title)}">${escapeHtml(text)}</time>`
	);
}

export function renderSpans(issue: RoadmapIssue): string {
	const parts: string[] = [];
	if (issue.researchMs != null) parts.push(`researched in ${formatElapsed(issue.researchMs)}`);
	if (issue.state === 'closed' && issue.buildMs != null) parts.push(`built in ${formatElapsed(issue.buildMs)}`);
	return parts.length > 0 ? `<span class="issue-spans">${escapeHtml(parts.join(' · '))}</span>` : '';
}

// #690: every sub-issue closed, at every depth.
function allFinished(issues: RoadmapIssue[], seen: Set<number> = new Set<number>()): boolean {
	return issues.every((sub) => {
		if (seen.has(sub.number)) return true;
		seen.add(sub.number);
		return sub.state === 'closed' && allFinished(sub.subIssues ?? [], seen);
	});
}

function finishedSummary(count: number): string {
	return count === 1 ? '1 tehtud alamülesanne' : `${count} tehtud alamülesannet`;
}

// #692: an active epic's list is open by default and folds on a click.
function activeSummary(issues: RoadmapIssue[]): string {
	const open = issues.filter((sub) => !allFinished([sub])).length;
	const total = issues.length === 1 ? '1 alamülesanne' : `${issues.length} alamülesannet`;
	return `${total}, ${open} pooleli`;
}

function renderIssue(issue: RoadmapIssue, rendered: Set<number>, generatedAt: string): string {
	if (rendered.has(issue.number)) return '';
	rendered.add(issue.number);
	const title = displayTitle(issue);
	const lead = displayLead(issue);
	const stateReasonAttr =
		issue.stateReason != null ? ` data-state-reason="${escapeHtml(issue.stateReason)}"` : '';
	const leadHtml = lead != null ? `<span class="issue-lead">${escapeHtml(lead)}</span>` : '';

	const visibleLabels =
		issue.state === 'open'
			? (issue.labels ?? [])
			: (issue.labels ?? []).filter((label) => !isMotionLabel(label?.name ?? ''));

	const typedKind = kindFromType(issue.issueType);
	const kindChipHtml = typedKind ? renderLabel({ name: typedKind, color: KIND_CHIP_COLORS[typedKind] }) : '';
	const chipLabels = typedKind
		? visibleLabels.filter((label) => !isKindLabel(label?.name ?? ''))
		: visibleLabels;
	const labelsHtml = [kindChipHtml, ...chipLabels.map(renderLabel)]
		.filter((html) => html.length > 0)
		.join(' ');
	const sinceIso = statusSinceIso(issue);
	const subIssues = issue.subIssues ?? [];
	const childrenHtml = boardOrder(subIssues)
		.map((sub) => renderIssue(sub, rendered, generatedAt))
		.filter((html) => html.length > 0)
		.map((html) => `<li>${html}</li>`)
		.join('');
	const listHtml = childrenHtml ? `<ul class="sub-issues">${childrenHtml}</ul>` : '';
	const finished = allFinished(subIssues);
	const subIssuesHtml = !listHtml
		? ''
		: finished
			? `<details class="sub-issues-fold"><summary>${finishedSummary(subIssues.length)}</summary>${listHtml}</details>`
			: `<details class="sub-issues-fold" open><summary>${activeSummary(subIssues)}</summary>${listHtml}</details>`;
	return (
		`<article class="issue" data-issue="${issue.number}" data-state="${issue.state}"${stateReasonAttr}>` +
		(sinceIso ? renderElapsed(elapsedLabel(issue) ?? '', sinceIso, generatedAt) : renderUpdatedAt(issue.updatedAt)) +
		`<a class="issue-link" href="${escapeHtml(issue.htmlUrl)}">` +
		`<span class="issue-number">#${issue.number}</span>` +
		`<span class="issue-title">${escapeHtml(title)}</span>` +
		`</a>` +
		leadHtml +
		`<span class="issue-labels">${labelsHtml}</span>` +
		renderSpans(issue) +
		subIssuesHtml +
		`</article>`
	);
}

const REFRESH_SCRIPT = (stamp: string) => `(function () {
	var CURRENT = ${JSON.stringify(stamp)};
	var SCROLL_KEY = 'mvox-roadmap-scroll-y';
	function poll() {
		fetch('stamp.txt?t=' + Date.now(), { cache: 'no-store' })
			.then(function (res) { return res.text(); })
			.then(function (text) {
				var next = text.trim();
				if (next && next !== CURRENT) {
					sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
					location.reload();
				}
			})
			.catch(function () {
				// A failed poll changes nothing — the current page stays, try again next tick.
			});
	}
	window.addEventListener('load', function () {
		var saved = sessionStorage.getItem(SCROLL_KEY);
		if (saved !== null) {
			sessionStorage.removeItem(SCROLL_KEY);
			window.scrollTo(0, parseInt(saved, 10));
		}
	});
	var formatClock = ${formatClock.toString()};
	function showElapsed() {
		if (typeof document === 'undefined') return;
		var now = Date.now();
		var els = document.querySelectorAll('time.issue-elapsed');
		for (var i = 0; i < els.length; i++) {
			var since = Date.parse(els[i].getAttribute('datetime'));
			if (!isNaN(since)) els[i].textContent = formatClock(now - since);
		}
	}
	showElapsed();
	setInterval(showElapsed, 1000);
	setInterval(poll, 60000);
})();`;

export function renderBoard(issues: RoadmapIssue[], generatedAt: string): string {
	const stamp = buildStamp(generatedAt);
	const rendered = new Set<number>();

	const ordered = boardOrder(issues);
	const openHtml = ordered
		.filter((issue) => issue.state === 'open')
		.map((issue) => renderIssue(issue, rendered, generatedAt))
		.filter((html) => html.length > 0)
		.join('\n');
	const closedHtml = ordered
		.filter((issue) => issue.state === 'closed')
		.map((issue) => renderIssue(issue, rendered, generatedAt))
		.filter((html) => html.length > 0)
		.join('\n');
	const violators = stalenessViolators(issues);
	const warningHtml = renderStalenessWarning(issues, violators);

	const groupsHtml = [
		openHtml.length > 0 ? `<section class="board-group"><h2>Pooleli</h2>\n${openHtml}\n</section>` : '',
		closedHtml.length > 0 ? `<section class="board-group"><h2>Tehtud</h2>\n${closedHtml}\n</section>` : ''
	]
		.filter((html) => html.length > 0)
		.join('\n');
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mvox roadmap</title>
<style>
	body { font-family: system-ui, sans-serif; max-width: 60rem; margin: 0 auto; padding: 1.5rem; }
	.masthead { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; background: #fff; padding: 0.5rem 0; border-bottom: 1px solid #ddd; }
	.masthead h1 { font-size: 1.25rem; margin: 0; }
	.app-link { font-style: italic; color: inherit; }
	.masthead-sep, .masthead time { color: #666; }
	.issue { display: flow-root; border: 1px solid #ccc; border-radius: 0.5rem; padding: 0.75rem; margin: 0.5rem 0; }
	.issue-updated { float: right; font-size: 0.75rem; color: #666; margin-left: 0.75rem; }
	.issue[data-state="closed"] { opacity: 0.6; }
	.issue-link { text-decoration: underline; color: inherit; }
	.issue-number { color: #666; margin-right: 0.5rem; }
	.issue-title { font-weight: 600; }
	.issue-lead { display: block; margin-top: 0.25rem; color: #444; }
	.issue-labels { display: block; margin-top: 0.25rem; }
	.issue-spans { display: block; margin-top: 0.25rem; font-size: 0.75rem; color: #666; }
	.label { display: inline-block; font-size: 0.75rem; background: #eee; border: 1px solid rgba(0, 0, 0, 0.15); border-radius: 0.75rem; padding: 0.1rem 0.5rem; margin-right: 0.25rem; }
	.board-group h2 { font-size: 1rem; color: #666; margin: 1.5rem 0 0.5rem; }
	.sub-issues { list-style: none; margin: 0.5rem 0 0; padding-left: 1.5rem; }
	.sub-issues-fold summary { cursor: pointer; margin-top: 0.5rem; color: #666; font-size: 0.9rem; }
	.staleness-warning { background: #fff3cd; border: 1px solid #f0ad4e; border-radius: 0.5rem; padding: 0.75rem 1rem; margin: 1rem 0; color: #7a5900; font-size: 0.95rem; }
	.staleness-warning .issue-link { color: inherit; font-weight: 600; }
</style>
</head>
<body>
<header class="masthead">
	<h1><a class="app-link" href="https://mvox.eu">mvox</a> roadmap</h1>
	<span class="masthead-sep" aria-hidden="true">|</span>
	<time datetime="${escapeHtml(generatedAt)}">${escapeHtml(formatGeneratedAt(generatedAt))}</time>
</header>
${warningHtml}
<main>
${groupsHtml}
</main>
<script>
${REFRESH_SCRIPT(stamp)}
</script>
</body>
</html>
`;
}

const CNAME = 'docs.mvox.eu';

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const inputIndex = args.indexOf('--input');
	const outIndex = args.indexOf('--out');
	if (inputIndex === -1 || outIndex === -1 || !args[inputIndex + 1] || !args[outIndex + 1]) {
		throw new Error('usage: render.ts --input <issues.json> --out <dir>');
	}
	const inputPath = args[inputIndex + 1];
	const outDir = args[outIndex + 1];

	const raw = await readFile(inputPath, 'utf-8');
	const issues = JSON.parse(raw) as RoadmapIssue[];
	const generatedAt = new Date().toISOString();

	const html = renderBoard(issues, generatedAt);
	const stamp = buildStamp(generatedAt);

	const roadmapDir = join(outDir, 'roadmap');
	await mkdir(roadmapDir, { recursive: true });
	await writeFile(join(roadmapDir, 'index.html'), html, 'utf-8');
	await writeFile(join(roadmapDir, 'stamp.txt'), stamp, 'utf-8');
	await writeFile(join(outDir, 'CNAME'), `${CNAME}\n`, 'utf-8');
}

const isMainModule = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
	main().catch((err: unknown) => {
		console.error(err);
		process.exitCode = 1;
	});
}
