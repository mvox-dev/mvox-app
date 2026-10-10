// The page's script as the real build writes it (tsx, not vitest's transform) runs in a bare
// browser context: no helper the build might inline may leak into it. (*PO:Gama*)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const specDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(specDir, '..', '..');

describe('the deployed page script', () => {
	let outDir: string;

	beforeAll(() => {
		outDir = mkdtempSync(join(tmpdir(), 'roadmap-script-'));
		const input = join(specDir, 'fixtures', 'live-shaped.json');
		execFileSync(
			process.execPath,
			['--import', 'tsx', 'scripts/roadmap/render.ts', '--input', input, '--out', outDir],
			{ cwd: repoRoot, stdio: 'pipe', timeout: 60_000 }
		);
	}, 90_000);

	afterAll(() => {
		if (outDir) rmSync(outDir, { recursive: true, force: true });
	});

	it('runs in a bare browser context and ticks an elapsed clock', () => {
		const html = readFileSync(join(outDir, 'roadmap', 'index.html'), 'utf-8');
		const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
		const clock = { textContent: '', getAttribute: () => '2026-10-10T08:00:00.000Z' };
		const timers: (() => void)[] = [];
		const context = createContext({
			Date: class extends Date {
				static now() {
					return Date.parse('2026-10-10T10:15:07.000Z');
				}
			},
			Math,
			isNaN,
			parseInt,
			String,
			document: { querySelectorAll: () => [clock] },
			window: { addEventListener: () => {}, scrollY: 0, scrollTo: () => {} },
			sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
			location: { reload: () => {} },
			fetch: () => Promise.resolve({ text: () => '' }),
			setInterval: (fn: () => void) => timers.push(fn)
		});
		expect(() => runInContext(script, context)).not.toThrow();
		expect(clock.textContent).toBe('2:15:07');
		expect(timers.length).toBe(2);
	});
});
