// #427 RED — NOTHING DRAWN, NOTHING STORED: the structural fence.
//
// The issue is explicit: "No ink, no layers, no storage decision. Nothing is
// drawn and nothing is saved. That is deliberate." The viewer settles page
// turns and the concert rule BEFORE the layer schema is cut (epic #333), and
// this slice must not prejudge the markings question. So the fence is
// mechanical, in the page-shell.spec.ts / #335 grep-fence tradition: the
// viewer MODULE TREE — src/routes/part/** plus any src/lib/parts/** it adds
// — may READ (openFileBytes' read-through is the sanctioned data path; its
// own cache write on an online miss is #334's landed behaviour, outside this
// tree) but may not carry a single write-capable or drawing-capable
// identifier of its own.
//
// FAIL-CLOSED ON VACUUM (the negative-from-the-instrument rule): a fence
// that scans zero files proves nothing, so the first pin is that the route
// exists and the walk found it. In RED that is exactly the failing case.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const VIEWER_ROOTS = ['src/routes/part', 'src/lib/parts'];
const ROUTE_FILE = resolve(process.cwd(), 'src/routes/part/[fileId]/+page.svelte');

interface ViewerFile {
	file: string;
	source: string;
}

/** Every non-spec .ts/.svelte source in the viewer tree. */
function viewerFiles(): ViewerFile[] {
	const out: ViewerFile[] = [];
	for (const rel of VIEWER_ROOTS) {
		const root = resolve(process.cwd(), rel);
		if (!existsSync(root)) continue;
		for (const d of readdirSync(root, { recursive: true, withFileTypes: true })) {
			if (!d.isFile()) continue;
			if (!/\.(ts|svelte)$/.test(d.name) || /\.spec\.ts$/.test(d.name)) continue;
			const file = join(d.parentPath, d.name);
			out.push({
				file: relative(process.cwd(), file).split(sep).join('/'),
				source: readFileSync(file, 'utf-8')
			});
		}
	}
	return out;
}

// Write-capable identifiers, by family. `.put(`/`.evict(` are the byte
// store's write half (reads are get/heldFileIds); entuFetch + mutating
// methods are the Entu write path; the three storage globals are the
// "no storage decision" line itself.
const WRITE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
	[/\.put\s*\(/, 'byte-store put()'],
	[/\.evict\s*\(/, 'byte-store evict()'],
	[/clearPartition/, 'byte-store clearPartition'],
	[/setProtectedKeys/, 'byte-store retention write'],
	[/entuFetch/, 'Entu wire call'],
	[/method\s*:\s*['"`](POST|PUT|DELETE|PATCH)/, 'mutating HTTP method'],
	[/['"`]POST['"`]/, 'POST literal'],
	[/localStorage/, 'localStorage'],
	[/sessionStorage/, 'sessionStorage'],
	[/indexedDB/, 'direct indexedDB access']
];

// Hand-drawing canvas APIs. pdf.js renders INTO a 2d context the wrapper
// hands it — that is the one sanctioned getContext call — but no code in
// this tree draws strokes of its own. (Bare `fill(`/`stroke(`/`rect(` are
// left out on purpose: Array.fill and getBoundingClientRect would
// false-positive; the named calls below are unambiguous.)
const DRAW_PATTERN =
	/\b(fillRect|strokeRect|beginPath|closePath|lineTo|moveTo|quadraticCurveTo|bezierCurveTo|drawImage|putImageData|createImageData|fillText|strokeText|setLineDash)\s*\(/;

describe('#427 — the viewer tree exists and the fence scans it (fail-closed, never a vacuum)', () => {
	it('the fullscreen part route is a real file the walk finds', () => {
		expect(existsSync(ROUTE_FILE), 'src/routes/part/[fileId]/+page.svelte must exist').toBe(true);
		expect(viewerFiles().length).toBeGreaterThan(0);
	});
});

describe('#427 — nothing stored: no write-capable identifier anywhere in the viewer tree', () => {
	it('every viewer source is free of store/Entu/webstorage writes', () => {
		for (const { file, source } of viewerFiles()) {
			for (const [pattern, label] of WRITE_PATTERNS) {
				expect(pattern.test(source), `${file} carries a ${label} (${pattern})`).toBe(false);
			}
		}
	});
});

describe('#427 — nothing drawn: canvas stays pdf.js-owned', () => {
	it('no hand-drawing canvas call anywhere in the viewer tree', () => {
		for (const { file, source } of viewerFiles()) {
			const hit = source.match(DRAW_PATTERN);
			expect(hit, `${file} draws by hand: ${hit?.[0] ?? ''}`).toBeNull();
		}
	});

	it('getContext appears in AT MOST one file — the renderer wrapper under src/lib/parts/ — never in the route itself', () => {
		const users = viewerFiles().filter(({ source }) => /getContext\s*\(/.test(source));
		expect(
			users.length,
			`getContext users: ${users.map((u) => u.file).join(', ')}`
		).toBeLessThanOrEqual(1);
		for (const { file } of users) {
			expect(
				file.startsWith('src/lib/parts/'),
				`${file}: the 2d context belongs to the renderer wrapper, so #333's later ink overlay composes on top without reopening the route`
			).toBe(true);
		}
	});
});

describe('#427 — no locale key prejudges the markings question', () => {
	const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
	// Segment match, not substring: 'links_*' and 'profile_link_*' contain
	// the letters i-n-k and are fine; a key SEGMENT named ink/draw/layer is
	// the thing this slice must not introduce.
	const FORBIDDEN = new Set(['ink', 'inks', 'draw', 'draws', 'drawn', 'drawing', 'layer', 'layers']);

	it('no message key in any locale carries an ink/draw/layer segment', () => {
		for (const locale of LOCALES) {
			const keys = Object.keys(
				JSON.parse(
					readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
				) as Record<string, unknown>
			);
			const offenders = keys.filter((k) => k.split('_').some((seg) => FORBIDDEN.has(seg)));
			expect(offenders, locale).toEqual([]);
		}
	});
});

// (*MVOX:Tallis* — #427 RED)
