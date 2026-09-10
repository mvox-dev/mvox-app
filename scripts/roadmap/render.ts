/**
 * #305 — Roadmap board renderer.
 *
 * Pure core of the roadmap build: issues JSON in → complete static HTML out.
 * The GitHub Action is thin plumbing around this module (scripts/roadmap/fetch-issues.ts
 * does the GitHub reads; this file only ever sees the normalized shape below).
 * Contract pinned by scripts/roadmap/render.spec.ts and scripts/roadmap/cli.spec.ts.
 *
 * YAML lib: `yaml` (eemeli/yaml), not `js-yaml` — it ships its own TypeScript
 * types (no separate @types/js-yaml devDependency) and has zero runtime
 * dependencies, where `js-yaml` pulls in `argparse` for its bundled CLI even
 * when only the library API is used. Confirmed via `pnpm info js-yaml
 * dependencies` (`{ argparse: '^2.0.1' }`) vs `pnpm info yaml dependencies`
 * (empty) on 2026-09-10.
 *
 * CLI contract (what the Action invokes, and what cli.spec.ts spawns):
 *   node --import tsx scripts/roadmap/render.ts --input <issues.json> --out <dir>
 * writes:
 *   <dir>/roadmap/index.html   — the board page (full document)
 *   <dir>/roadmap/stamp.txt    — build stamp; same value the page shows as generated-at
 *   <dir>/CNAME                — "docs.mvox.eu"
 *
 * (*MVOX:Palestrina*)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { labelTextColor } from './label-color';

/** One label as GitHub reports it: name plus its colour (hex, no leading '#'), or null when absent. */
export interface RoadmapLabel {
	name: string;
	color: string | null;
}

/** Normalized issue shape the Action feeds the renderer (GitHub API → this). */
export interface RoadmapIssue {
	number: number;
	title: string;
	state: 'open' | 'closed';
	/** GitHub state_reason for closed issues; null for open. */
	stateReason: 'completed' | 'not_planned' | null;
	labels: RoadmapLabel[];
	body: string | null;
	/** ISO date-time the issue was (most recently) closed; null while open or never recorded. */
	closedAt: string | null;
	/** Native GitHub sub-issues, already resolved by the fetch step. Empty = flat. */
	subIssues?: RoadmapIssue[];
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Parse a YAML frontmatter block at the very head of an issue body
 * (`---\n…\n---`). Returns the parsed mapping, or null when the block is
 * absent, malformed, or not a mapping — never throws.
 */
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
		// Malformed YAML is treated as absent frontmatter, never a crash.
		return null;
	}
}

/**
 * The title the board displays for an issue: the frontmatter `slugline`
 * (Estonian) when present and a non-empty string; the English title otherwise.
 */
export function displayTitle(issue: RoadmapIssue): string {
	const frontmatter = parseFrontmatter(issue.body);
	const slugline = frontmatter?.slugline;
	if (typeof slugline === 'string' && slugline.length > 0) return slugline;
	return issue.title;
}

/**
 * Content of the build stamp file. Carries the build identity — the same
 * generated-at value the page displays (one stamp, not two).
 */
export function buildStamp(generatedAt: string): string {
	return generatedAt;
}

// Untrusted content (titles, sluglines, labels) is only ever placed inside
// element text content below, never inside an attribute value — so escaping
// &, < and > is sufficient to stop markup injection. Quotes are left alone
// deliberately: entity-encoding them would corrupt a plain apostrophe in an
// issue title when read back as text (e.g. "this board's issues").
const HTML_ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;'
};

function escapeHtml(value: string): string {
	return value.replace(/[&<>]/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/**
 * A closed issue's sort key: its closedAt as epoch millis, or -Infinity when
 * absent/unparseable — sorting descending on this key puts "no closedAt"
 * last, never first, per #307's explicit fallback.
 */
function closedAtRank(issue: RoadmapIssue): number {
	if (!issue.closedAt) return -Infinity;
	const parsed = Date.parse(issue.closedAt);
	return Number.isNaN(parsed) ? -Infinity : parsed;
}

/**
 * Open issues first (current work, by issue number ascending), then closed
 * (most recently finished first, missing closedAt sorts last). One function
 * for both the top-level board and every nested sub-issue walk (renderIssue
 * calls this same function on its own children) — there is no second
 * ordering path to keep in sync.
 */
function boardOrder(issues: RoadmapIssue[]): RoadmapIssue[] {
	const open = issues.filter((i) => i.state === 'open').sort((a, b) => a.number - b.number);
	const closed = issues.filter((i) => i.state === 'closed').sort((a, b) => closedAtRank(b) - closedAtRank(a));
	return [...open, ...closed];
}

const NO_COLOR_HEX_RE = /^[0-9a-fA-F]{6}$/;

/**
 * One label chip. Background is the label's own colour (GitHub sends hex
 * without the leading '#', prefixed here); text colour is derived from that
 * colour's relative luminance (label-color.ts), not fixed, so both a very
 * dark (`blocked` #b60205) and a near-white (`wontfix` #ffffff) chip stay
 * readable. A label with no colour, or one that isn't valid 6-digit hex,
 * falls back to the plain `.label` class — today's neutral grey chip. The
 * hairline border lives on the `.label` class itself so every chip gets it,
 * including the fallback and the near-white worst case.
 */
function renderLabel(label: RoadmapLabel): string {
	const name = escapeHtml(label.name);
	if (!label.color || !NO_COLOR_HEX_RE.test(label.color)) {
		return `<span class="label">${name}</span>`;
	}
	const background = `#${label.color}`;
	const text = labelTextColor(label.color);
	return `<span class="label" style="background-color: ${background}; color: ${text};">${name}</span>`;
}

/**
 * Render one issue and its sub-issue subtree.
 *
 * `rendered` carries the issue numbers already placed on the page; an issue
 * already there renders as the empty string. That is what keeps the walk
 * finite: fetch-issues.ts nests the SAME object an issue occupies at top level
 * (that shared identity is what makes two-level nesting work), so a parent link
 * pointing back up its own chain would otherwise recurse until the build died.
 * It also holds the one-entry-per-issue contract here in the renderer rather
 * than resting on the fetch step alone — a child reported under two epics lands
 * under the first and is skipped under the second instead of appearing twice.
 */
function renderIssue(issue: RoadmapIssue, rendered: Set<number>): string {
	if (rendered.has(issue.number)) return '';
	rendered.add(issue.number);
	const title = displayTitle(issue);
	const stateReasonAttr =
		issue.stateReason != null ? ` data-state-reason="${escapeHtml(issue.stateReason)}"` : '';
	const labelsHtml = issue.labels.map(renderLabel).join(' ');
	const subIssues = issue.subIssues ?? [];
	const childrenHtml = boardOrder(subIssues)
		.map((sub) => renderIssue(sub, rendered))
		.filter((html) => html.length > 0)
		.map((html) => `<li>${html}</li>`)
		.join('');
	const subIssuesHtml = childrenHtml ? `<ul class="sub-issues">${childrenHtml}</ul>` : '';
	return (
		`<article class="issue" data-issue="${issue.number}" data-state="${issue.state}"${stateReasonAttr}>` +
		`<span class="issue-number">#${issue.number}</span>` +
		`<span class="issue-title">${escapeHtml(title)}</span>` +
		`<span class="issue-labels">${labelsHtml}</span>` +
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
	setInterval(poll, 60000);
})();`;

/**
 * Render the whole board as one complete, self-contained static HTML document.
 * Pure: same inputs → identical output (the clock is injected, never read).
 */
export function renderBoard(issues: RoadmapIssue[], generatedAt: string): string {
	const stamp = buildStamp(generatedAt);
	const rendered = new Set<number>();
	// boardOrder is the single ordering function — the same call the nested
	// sub-issue walk in renderIssue uses on its own children — so splitting
	// its output by state here to place the divider is not a second sort,
	// just where the one ordered list happens to change state.
	const ordered = boardOrder(issues);
	const openHtml = ordered
		.filter((issue) => issue.state === 'open')
		.map((issue) => renderIssue(issue, rendered))
		.filter((html) => html.length > 0)
		.join('\n');
	const closedHtml = ordered
		.filter((issue) => issue.state === 'closed')
		.map((issue) => renderIssue(issue, rendered))
		.filter((html) => html.length > 0)
		.join('\n');
	// "Pooleli" / "Tehtud" are hardcoded Estonian literals by design: this
	// page is a standalone node CLI build step, outside the SvelteKit app and
	// its Paraglide i18n entirely (see this file's own doc comment) — do not
	// route these through Paraglide, there is nothing here for it to plug
	// into. Top-level only: renderIssue's own recursive walk over subIssues
	// never calls this, so a closed child inside an open epic never spawns a
	// heading of its own. An empty group (nothing open, or nothing closed)
	// omits its heading rather than showing a caption over no entries.
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
	.issue { display: block; border: 1px solid #ccc; border-radius: 0.5rem; padding: 0.75rem; margin: 0.5rem 0; }
	.issue[data-state="closed"] { opacity: 0.6; }
	.issue-number { color: #666; margin-right: 0.5rem; }
	.issue-title { font-weight: 600; }
	.issue-labels { display: block; margin-top: 0.25rem; }
	.label { display: inline-block; font-size: 0.75rem; background: #eee; border: 1px solid rgba(0, 0, 0, 0.15); border-radius: 0.75rem; padding: 0.1rem 0.5rem; margin-right: 0.25rem; }
	.board-group h2 { font-size: 1rem; color: #666; margin: 1.5rem 0 0.5rem; }
	.sub-issues { list-style: none; margin: 0.5rem 0 0; padding-left: 1.5rem; }
</style>
</head>
<body>
<header>
	<h1>mvox roadmap</h1>
	<p class="meta">Generated at <time datetime="${escapeHtml(generatedAt)}">${escapeHtml(generatedAt)}</time></p>
</header>
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
