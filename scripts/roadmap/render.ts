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
	/** The issue's own GitHub page. Carried verbatim from the API's `html_url` — never assembled. */
	htmlUrl: string;
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
 * The frontmatter `lead` (Estonian, one short line) when present and a
 * non-empty string; null otherwise — ADDITIONAL to displayTitle, never a
 * replacement. Same type-guard shape as displayTitle's slugline check.
 */
export function displayLead(issue: RoadmapIssue): string | null {
	const frontmatter = parseFrontmatter(issue.body);
	const lead = frontmatter?.lead;
	return typeof lead === 'string' && lead.length > 0 ? lead : null;
}

/**
 * Content of the build stamp file. Carries the build identity — the same
 * generated-at value the page displays (one stamp, not two).
 */
export function buildStamp(generatedAt: string): string {
	return generatedAt;
}

/**
 * Format an ISO instant as the human-facing generated-at time: Estonian
 * convention, `Europe/Tallinn`, to the minute, with a zone marker (#308).
 *
 * No `Intl.DateTimeFormat` preset produces the target punctuation — `dateStyle`
 * / `timeStyle` presets insert a comma before the time and a two-digit year
 * (verified live: `01.07.26, 15:00`, not `01.07.2026 15:00`). So this builds
 * the string from `formatToParts` instead of trusting any preset: pull
 * day/month/year and hour/minute/zone-name parts out and join them with the
 * exact literal punctuation the issue's example uses (single space, not a
 * comma) — `10.09.2026 06:33 GMT +3`.
 *
 * `hourCycle: 'h23'` (not `hour12: false`) is deliberate — Node's ICU can
 * resolve `hour12: false` to `hourCycle: 'h24'`, which renders midnight as
 * `24:00` instead of `00:00`; `h23` pins the 00–23 range explicitly.
 *
 * The IANA zone name `Europe/Tallinn` is the whole point: this is an offset
 * conversion by zone rule, not a fixed number, so the same code renders
 * `GMT +3` (EEST) in summer and `GMT +2` (EET) in winter with zero changes —
 * `timeZoneName: 'shortOffset'` computes that offset from the zone and the
 * instant, never hardcoded. The literal space inside `GMT +3` / `GMT +2` is
 * Intl's own output for this zone/locale, kept as-is rather than stripped.
 */
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

// #310: this match is against the exact label strings the mvox team uses on
// GitHub — 'in process', 'prepped', and 'in research' (#315) — not an id or a
// stable enum. Rename any of the three in the repo's label settings and this
// silently stops floating anything; nothing here will fail or warn, the
// board just quietly goes back to plain number order. There is deliberately
// no test pinning these strings (see active-float.spec.ts) because a
// fixture-based test cannot see a GitHub-side rename either — it would stay
// green through the same failure it exists to catch. Catching the rename
// itself would mean the build reading the repo's live label set, which was
// judged not worth the extra API call for an ordering nicety (Gama, #310
// comment). The warning has already come true once: `prepped` was renamed
// from `researched` two minutes after it was created, before it ever reached
// this code (#315). The next rename will not announce itself either.
const ACTIVE_TIER_LABELS = ['in process', 'prepped', 'in research'] as const;

/**
 * An open issue's activity tier: 0 when it carries `in process` (which wins
 * over the other two even in combination), 1 when it carries `prepped`
 * without `in process`, 2 when it carries `in research` alone, 3 otherwise.
 * Lower sorts first. Never consulted for closed issues.
 */
function activityTier(issue: RoadmapIssue): number {
	// #340's never-fail fixture smuggles `labels: null` past the type at the
	// renderBoard boundary — `?? []` keeps this a plain lookup, not a crash.
	const names = (issue.labels ?? []).map((label) => label?.name);
	const rank = ACTIVE_TIER_LABELS.findIndex((label) => names.includes(label));
	return rank === -1 ? ACTIVE_TIER_LABELS.length : rank;
}

/**
 * All OPEN issues in the tree, top-level and nested (subIssues), as one flat
 * list, each issue exactly once. fetchBoard reparents open sub-issues under
 * their epic, so an idle groomed task nested under a container (#338's own
 * shape) would otherwise be invisible to a check that only looked at the top
 * level.
 *
 * `seen` is the same identity guard renderIssue's `rendered` set is, for the
 * same two reasons: fetchBoard shares ONE object per issue number across
 * parents, so a child reported under two epics would otherwise be listed
 * twice (and named twice in the warning line); and a parent cycle
 * (289 → 290 → 289, the shape fetch-issues.ts explicitly defends against)
 * would otherwise recurse until the stack died — at which point
 * stalenessViolators' catch would swallow the RangeError and the check would
 * go silent on exactly the malformed board where a violator matters.
 *
 * Also defensive against a missing/malformed `subIssues` or `state` — #340's
 * never-fail contract needs this to degrade, not throw.
 */
function flattenOpenIssues(
	issues: RoadmapIssue[],
	seen: Set<number> = new Set<number>()
): RoadmapIssue[] {
	const result: RoadmapIssue[] = [];
	for (const issue of issues ?? []) {
		// Identity is the issue number; an entry arriving without one (malformed
		// input smuggled past the type) is not deduplicated because it cannot be
		// identified — it still gets walked rather than dropped.
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

/** #340: either label switches the whole staleness check off — see stalenessViolators. */
const STALENESS_SUPPRESSOR_LABELS = ['in research', 'blocks research'] as const;
/** #340: any of these on a ready task satisfies the check — it is not a violator. */
const STALENESS_SATISFIER_LABELS = ['in process', 'prepped', 'blocked'] as const;

/** Same label-name matching idiom as activityTier, one label at a time. */
function hasLabel(issue: RoadmapIssue, name: string): boolean {
	return (issue?.labels ?? []).some((label) => label?.name === name);
}

/**
 * #340 — the staleness predicate: issue numbers of open, `task`+`ready`
 * issues that carry none of `in process` / `prepped` / `blocked`, evaluated
 * only when no open issue anywhere carries `in research` or `blocks
 * research` (either suppresses the whole check — Mihkel's ruling that a
 * build merely running is not itself an excuse; only an explicit `blocks
 * research` is). Scoped to `task` so an open epic's own `ready` (its
 * children are the dispatchable work, #316's shape) never fires.
 *
 * Wrapped in a local try/catch mirroring parseFrontmatter's precedent: a bug
 * here must default to no warning, never crash into main()'s exitCode=1 path
 * — that would freeze the deployed page, the exact inversion #340 exists to
 * prevent. The page always deploys.
 */
function stalenessViolators(issues: RoadmapIssue[]): number[] {
	try {
		const open = flattenOpenIssues(issues);
		const suppressed = open.some((issue) =>
			STALENESS_SUPPRESSOR_LABELS.some((label) => hasLabel(issue, label))
		);
		if (suppressed) return [];
		return open
			.filter((issue) => hasLabel(issue, 'task') && hasLabel(issue, 'ready'))
			.filter((issue) => !STALENESS_SATISFIER_LABELS.some((label) => hasLabel(issue, label)))
			.map((issue) => issue.number);
	} catch {
		// A crash here must never reach main()'s exitCode=1 path — default to
		// no warning, same posture as parseFrontmatter's local catch.
		return [];
	}
}

/**
 * The warning line itself: the Estonian sentence plus one `#N` link per
 * violator, in the page's own link idiom (an `.issue-link` anchor to the
 * issue's real `htmlUrl`, carried verbatim like renderIssue's own link).
 * Empty string when there are no violators — renderBoard then omits the
 * element entirely rather than rendering an empty shell.
 */
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

/**
 * Open issues first — tiered by activity label (#310: in process, then in
 * research, then the rest), issue number ascending within each tier — then
 * closed (most recently finished first, missing closedAt sorts last; labels
 * play no part here, so a stale activity label left on a closed issue can
 * never reorder it). One function for both the top-level board and every
 * nested sub-issue walk (renderIssue calls this same function on its own
 * children) — there is no second ordering path to keep in sync.
 */
function boardOrder(issues: RoadmapIssue[]): RoadmapIssue[] {
	const open = issues
		.filter((i) => i.state === 'open')
		.sort((a, b) => activityTier(a) - activityTier(b) || a.number - b.number);
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
	const name = escapeHtml(label?.name ?? '');
	if (!label?.color || !NO_COLOR_HEX_RE.test(label.color)) {
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
	const lead = displayLead(issue);
	const stateReasonAttr =
		issue.stateReason != null ? ` data-state-reason="${escapeHtml(issue.stateReason)}"` : '';
	const leadHtml = lead != null ? `<span class="issue-lead">${escapeHtml(lead)}</span>` : '';
	// #340's never-fail fixture smuggles `labels: null` and a name-less label
	// object past the type — `?? []` and renderLabel's own guard keep this a
	// plain render, not a crash.
	const labelsHtml = (issue.labels ?? []).map(renderLabel).join(' ');
	const subIssues = issue.subIssues ?? [];
	const childrenHtml = boardOrder(subIssues)
		.map((sub) => renderIssue(sub, rendered))
		.filter((html) => html.length > 0)
		.map((html) => `<li>${html}</li>`)
		.join('');
	const subIssuesHtml = childrenHtml ? `<ul class="sub-issues">${childrenHtml}</ul>` : '';
	return (
		`<article class="issue" data-issue="${issue.number}" data-state="${issue.state}"${stateReasonAttr}>` +
		`<a class="issue-link" href="${escapeHtml(issue.htmlUrl)}">` +
		`<span class="issue-number">#${issue.number}</span>` +
		`<span class="issue-title">${escapeHtml(title)}</span>` +
		`</a>` +
		leadHtml +
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
	const violators = stalenessViolators(issues);
	const warningHtml = renderStalenessWarning(issues, violators);
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
	.issue-link { text-decoration: underline; color: inherit; }
	.issue-number { color: #666; margin-right: 0.5rem; }
	.issue-title { font-weight: 600; }
	.issue-lead { display: block; margin-top: 0.25rem; color: #444; }
	.issue-labels { display: block; margin-top: 0.25rem; }
	.label { display: inline-block; font-size: 0.75rem; background: #eee; border: 1px solid rgba(0, 0, 0, 0.15); border-radius: 0.75rem; padding: 0.1rem 0.5rem; margin-right: 0.25rem; }
	.board-group h2 { font-size: 1rem; color: #666; margin: 1.5rem 0 0.5rem; }
	.sub-issues { list-style: none; margin: 0.5rem 0 0; padding-left: 1.5rem; }
	.staleness-warning { background: #fff3cd; border: 1px solid #f0ad4e; border-radius: 0.5rem; padding: 0.75rem 1rem; margin: 1rem 0; color: #7a5900; font-size: 0.95rem; }
	.staleness-warning .issue-link { color: inherit; font-weight: 600; }
</style>
</head>
<body>
<header>
	<h1>mvox roadmap</h1>
	<p class="meta">Generated at <time datetime="${escapeHtml(generatedAt)}">${escapeHtml(formatGeneratedAt(generatedAt))}</time></p>
	<a href="https://mvox.eu">mvox</a>
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
