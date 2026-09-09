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

	it('ships the CNAME file for docs.mvox.eu', () => {
		const cnamePath = join(outDir, 'CNAME');
		expect(existsSync(cnamePath), `missing ${cnamePath}`).toBe(true);
		expect(readFileSync(cnamePath, 'utf-8').trim()).toBe('docs.mvox.eu');
	});
});
