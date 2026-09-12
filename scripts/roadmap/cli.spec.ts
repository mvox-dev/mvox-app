/**
 * #305 RED — integration: the renderer is wired as the actual build
 * entrypoint the GitHub Action invokes, not just a bag of exports.
 *
 * Runs the real CLI over the live-shaped fixture and asserts the complete
 * deployable site lands on disk:
 *   <out>/roadmap/index.html — the board page (docs.mvox.eu/roadmap)
 *   <out>/roadmap/stamp.txt  — the self-refresh stamp, same value the page shows
 *   <out>/CNAME              — docs.mvox.eu
 *
 * (*MVOX:Tallis*)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// join over dirname, not `new URL(…)`: importing happy-dom below replaces the
// global URL class with one whose instances fileURLToPath rejects ("The URL
// must be of scheme file"). Same idiom, same reason, as staleness-warning.spec.ts.
const specDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(specDir, '..', '..');
const fixturePath = join(specDir, 'fixtures', 'live-shaped.json');

/**
 * Parse the built page. This spec stays in the `node` environment (the rest of
 * it is pure filesystem/child-process work), so the DOM is instantiated from a
 * local happy-dom Window rather than via `// @vitest-environment happy-dom`.
 */
function parse(html: string) {
	const window = new Window();
	const parser = new window.DOMParser();
	return parser.parseFromString(html, 'text/html');
}

describe('roadmap build CLI (integration)', () => {
	let outDir: string;

	beforeAll(() => {
		outDir = mkdtempSync(join(tmpdir(), 'roadmap-305-'));
		execFileSync(
			process.execPath,
			['--import', 'tsx', 'scripts/roadmap/render.ts', '--input', fixturePath, '--out', outDir],
			{ cwd: repoRoot, stdio: 'pipe', timeout: 60_000 }
		);
	}, 90_000);

	afterAll(() => {
		if (outDir) rmSync(outDir, { recursive: true, force: true });
	});

	it('writes the board page at roadmap/index.html as a complete document with the fixture issues', () => {
		const pagePath = join(outDir, 'roadmap', 'index.html');
		expect(existsSync(pagePath), `missing ${pagePath}`).toBe(true);
		const html = readFileSync(pagePath, 'utf-8');
		expect(html.toLowerCase().trimStart().startsWith('<!doctype html')).toBe(true);
		expect(html).toContain("[TASK] Roadmap board on mvox.eu, read live from this board's issues");
		expect(html).toContain('[EPIC] Library lending 1.0');
		expect(html).toContain('data-issue="305"');
	});

	it('writes the stamp file the page polls, carrying the same value the page displays', () => {
		const stampPath = join(outDir, 'roadmap', 'stamp.txt');
		expect(existsSync(stampPath), `missing ${stampPath}`).toBe(true);
		const stamp = readFileSync(stampPath, 'utf-8').trim();
		expect(stamp.length).toBeGreaterThan(0);
		const html = readFileSync(join(outDir, 'roadmap', 'index.html'), 'utf-8');
		expect(html).toContain(stamp);
		expect(html).toContain('stamp.txt');
	});

	it('#308: the deployed <time> shows Tallinn local time in its text while datetime and stamp.txt stay ISO', () => {
		// Wiring check on the file the Action actually deploys. The CLI reads
		// the real clock, so the exact string is pinned by generated-at.spec.ts;
		// here the SHAPE proves main() formats generatedAt for display without
		// touching the machine identity: datetime attr === stamp.txt content,
		// text is dd.MM.yyyy HH:mm + "GMT +N" (single space, no comma, no
		// seconds, no milliseconds), and the two renderings differ.
		const html = readFileSync(join(outDir, 'roadmap', 'index.html'), 'utf-8');
		const stamp = readFileSync(join(outDir, 'roadmap', 'stamp.txt'), 'utf-8').trim();
		const match = /<time datetime="([^"]+)">([^<]+)<\/time>/.exec(html);
		expect(match, 'no <time datetime="…">…</time> element on the deployed page').not.toBeNull();
		const [, datetime, text] = match as RegExpExecArray;
		expect(datetime).toBe(stamp);
		expect(datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		expect(text).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2} GMT [+-]\d{1,2}$/);
		expect(text).not.toBe(datetime);
	});

	it('ships the CNAME file for docs.mvox.eu', () => {
		const cnamePath = join(outDir, 'CNAME');
		expect(existsSync(cnamePath), `missing ${cnamePath}`).toBe(true);
		expect(readFileSync(cnamePath, 'utf-8').trim()).toBe('docs.mvox.eu');
	});

	it('#309: cards on the deployed page link to their issue via the fixture htmlUrl', () => {
		// Wiring check: the htmlUrl must reach the file the Action actually
		// deploys, not just renderBoard's return value in a unit test.
		const html = readFileSync(join(outDir, 'roadmap', 'index.html'), 'utf-8');
		expect(html).toContain('href="https://github.com/mvox-dev/mvox-app/issues/305"');
		expect(html).toContain('href="https://github.com/mvox-dev/mvox-app/issues/289"');
	});

	it('#309: the fixture lead (#301) renders on the deployed page', () => {
		const html = readFileSync(join(outDir, 'roadmap', 'index.html'), 'utf-8');
		expect(html).toContain('Näitab iga eksemplari laenutuse seisu otse noodi lehel.');
	});

	it('#309: the deployed header links back to the app at mvox.eu — plain, same tab, labelled mvox', () => {
		const html = readFileSync(join(outDir, 'roadmap', 'index.html'), 'utf-8');
		const match = /<a\b[^>]*href="https:\/\/mvox\.eu"[^>]*>\s*mvox\s*<\/a>/.exec(html);
		expect(match, 'no <a href="https://mvox.eu">mvox</a> on the deployed page').not.toBeNull();
		expect(match?.[0]).not.toContain('target=');
	});

	it('#340: the staleness warning is ABSENT from the deployed page — the fixture suppresses the check', () => {
		// Computed from fixtures/live-shaped.json: open issues are #305 (task,
		// ready, in process), #289 (epic), #301 (task, ready), #298 (task,
		// in research), #262 (bug). #298 carries `in research`, which switches
		// the whole predicate off — so even #301 (ready without in process /
		// prepped / blocked, a violator on a quiet board) must NOT be warned
		// about. If the fixture's labels ever change, recompute this expectation.
		//
		// Absence is asserted on the DOM and on the visible sentence, NOT by
		// forbidding the string 'staleness-warning' page-wide: the stylesheet
		// names that class unconditionally, exactly as it does `.issue-lead`.
		const html = readFileSync(join(outDir, 'roadmap', 'index.html'), 'utf-8');
		expect(parse(html).querySelector('.staleness-warning')).toBeNull();
		expect(html).not.toContain('Valmis tööd seisavad ja keegi ei uuri');
	});

	it('#307: the built page carries coloured chips and the Pooleli/Tehtud divider', () => {
		// Wiring check: the colours/divider must reach the file the Action
		// actually deploys, not just renderBoard's return value in a unit test.
		const html = readFileSync(join(outDir, 'roadmap', 'index.html'), 'utf-8');
		expect(html).toMatch(/background(?:-color)?:\s*#0e8a16/i); // the fixture's `ready` chip colour
		const pooleli = html.indexOf('Pooleli');
		const tehtud = html.indexOf('Tehtud');
		expect(pooleli, 'Pooleli heading missing from the deployed page').toBeGreaterThan(-1);
		expect(tehtud, 'Tehtud heading missing from the deployed page').toBeGreaterThan(pooleli);
	});
});
