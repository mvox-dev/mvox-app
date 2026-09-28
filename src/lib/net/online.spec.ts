// @vitest-environment happy-dom
//
// #434 slice 6/6 RED — the ONE online/offline signal.
//
// CONTRACT (GREEN creates src/lib/net/online.ts):
//   export const online: Readable<boolean>
//     • reads `navigator.onLine` when its first subscriber arrives (a readable
//       start function — not a value frozen at import time);
//     • follows the window's `online` / `offline` events while subscribed;
//     • is the only place in src/ that reads navigator.onLine or listens to
//       those events — every write control consumes THIS store.
// Nothing is queued: the store is a signal only. It gates writes; it never
// gates reads (readCache serves on a rejected fetch, not on this flag).
import { afterEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { goOffline, goOnline, resetOnLine } from '$lib/testing/networkSignal';
import { online } from './online';

afterEach(() => {
	resetOnLine();
});

describe('online — the network signal store (#434 slice 6)', () => {
	it('reads navigator.onLine on subscribe: true when the browser says online', async () => {
		await goOnline();
		expect(get(online)).toBe(true);
	});

	it('reads navigator.onLine on subscribe: false when the browser already says offline', async () => {
		await goOffline();
		expect(get(online)).toBe(false);
	});

	it('follows the offline and online events while subscribed', async () => {
		await goOnline();
		const seen: boolean[] = [];
		const unsubscribe = online.subscribe((v) => seen.push(v));
		await goOffline();
		await goOnline();
		unsubscribe();
		expect(seen).toEqual([true, false, true]);
	});

	it('an unsubscribed store does not keep listening (no leak into the next subscriber)', async () => {
		await goOnline();
		const unsubscribe = online.subscribe(() => {});
		unsubscribe();
		await goOffline();
		// A fresh subscriber reads the current property, not a stale value.
		expect(get(online)).toBe(false);
	});
});

describe('online — the one reader of navigator.onLine', () => {
	function walk(dir: string): string[] {
		const out: string[] = [];
		for (const name of readdirSync(dir)) {
			const p = join(dir, name);
			if (statSync(p).isDirectory()) out.push(...walk(p));
			else if (/\.(ts|svelte)$/.test(name) && !/\.spec\.ts$/.test(name)) out.push(p);
		}
		return out;
	}

	it('no other src/ module reads navigator.onLine or listens for online/offline events', () => {
		const root = resolve(process.cwd(), 'src');
		const allowed = new Set([
			resolve(root, 'lib/net/online.ts'),
			resolve(root, 'lib/testing/networkSignal.ts')
		]);
		const offenders = walk(root)
			.filter((p) => !allowed.has(p))
			.filter((p) => {
				const src = readFileSync(p, 'utf-8');
				return (
					/navigator\.onLine/.test(src) ||
					/addEventListener\(\s*['"](online|offline)['"]/.test(src) ||
					/svelte:window[^>]*on(online|offline)=/.test(src)
				);
			});
		expect(offenders).toEqual([]);
	});
});

// (*MVOX:Tallis* — #434 slice 6 RED)
