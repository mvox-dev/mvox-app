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
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const fixturePath = fileURLToPath(new URL('./fixtures/live-shaped.json', import.meta.url));

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
