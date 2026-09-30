// @vitest-environment happy-dom
// The one online/offline signal: it gates writes, never reads, and nothing is queued.
import { afterEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findSourceFiles } from '$lib/testing/soleLiteralGuard';
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
	it('no other src/ module reads navigator.onLine or listens for online/offline events', () => {
		const root = resolve(process.cwd(), 'src');
		const allowed = new Set([
			resolve(root, 'lib/net/online.ts'),
			resolve(root, 'lib/testing/networkSignal.ts')
		]);
		const offenders = findSourceFiles(root, ['.ts', '.svelte'], { excludeSpecs: true })
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

// (*MVOX:Tallis*)
