// Part viewer fence (#427): the viewer tree reads bytes and writes only #353's label index.
// A text scan is the right tool: it pins calls no file in the tree may make, and fails on no files.
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

// Write-capable identifiers: byte-store writes, the Entu write path, the storage globals.
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

// Hand-drawing canvas calls; pdf.js gets the one sanctioned context. Bare fill/stroke/rect are
// left out: Array.fill and getBoundingClientRect would match.
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

describe('#427 review round 3 — the ONE sanctioned write: #353\'s label index, named on the fence', () => {
	// The write sweep cannot see this call (its .put lives in labelStore), so it is named here:
	// recordPartLabel only names stored bytes for /downloads; other LabelStore methods stay out.
	const LABEL_STORE_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"]\$lib\/files\/labelStore['"]/g;
	const OTHER_LABEL_METHODS = /\.(putLabel|labelsFor|remove|clear)\s*\(/;

	it("recordPartLabel is the only symbol the tree imports from the label store, and the only label-store call it makes", () => {
		const imported: Array<{ file: string; names: string[] }> = [];
		for (const { file, source } of viewerFiles()) {
			for (const match of source.matchAll(LABEL_STORE_IMPORT)) {
				const names = match[1]
					.split(',')
					.map((n) => n.trim().replace(/^type\s+/, ''))
					.filter(Boolean);
				imported.push({ file, names });
			}
		}
		for (const { file, names } of imported) {
			expect(
				names,
				`${file}: the viewer may write #353's label index and nothing else — not the byte store, not a marking`
			).toEqual(['recordPartLabel']);
		}
	});

	it('it appears in EXACTLY one file — the route where the bytes land, nowhere else in the tree', () => {
		const users = viewerFiles()
			.filter(({ source }) => /recordPartLabel/.test(source))
			.map(({ file }) => file);
		expect(users, 'the label write belongs to the one file that knows bytes landed').toEqual([
			'src/routes/part/[fileId]/+page.svelte'
		]);
	});

	it('no OTHER LabelStore method (putLabel/labelsFor/remove/clear) appears anywhere in the tree', () => {
		for (const { file, source } of viewerFiles()) {
			const hit = source.match(OTHER_LABEL_METHODS);
			expect(
				hit,
				`${file} calls ${hit?.[0] ?? ''} — the viewer records a name when bytes land and never edits or clears the index`
			).toBeNull();
		}
	});
});

// (*MVOX:Tallis* — #427 RED)
