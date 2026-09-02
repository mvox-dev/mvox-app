// @vitest-environment happy-dom
//
// #207 RED — the time-format preference store (PO standing rule 5's second
// half: 24h is the DEFAULT, AM/PM is available only via a profile preference).
//
// CONTRACT (GREEN must implement — src/lib/preferences/timeFormat.ts, the
// house localStorage-store pattern of src/lib/collectives/store.ts:20-22):
//
//   export type TimeFormat = '24h' | 'ampm';
//   export const TIME_FORMAT_KEY = 'mvox.time_format';   // mvox.<name> convention
//   export function readStoredTimeFormat(): TimeFormat;  // sanitizing read of
//                                                        // localStorage NOW:
//                                                        // absent/invalid → '24h'
//   export const timeFormatStore: Writable<TimeFormat>;  // init from readStoredTimeFormat()
//   export function setTimeFormat(v: TimeFormat): void;  // store.set + persist
//
//   SSR-safe: the module guards `typeof localStorage !== 'undefined'` — import
//   and setTimeFormat must not throw where localStorage is absent, and the
//   store then defaults to '24h'. Gama ruling 2026-09-02: localStorage
//   confirmed, per-device, no schema change. Values are '24h' | 'ampm' (the
//   ruling's shorthand "12h" names the MODE; the stored token is 'ampm').
//
// Every init-behaviour test goes through a FRESH module instance
// (vi.resetModules + dynamic import) — module-level init runs once per import.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

type TimeFormatModule = typeof import('./timeFormat');

async function freshModule(): Promise<TimeFormatModule> {
	vi.resetModules();
	return await import('./timeFormat');
}

// `vi.unstubAllGlobals()` FIRST in afterEach — the SSR-safety tests below stub
// `localStorage` away with `vi.stubGlobal('localStorage', undefined)`, so a
// `localStorage.clear()` ahead of the unstub throws and (because a throwing
// afterEach never reaches the unstub) leaves the stub in place to poison every
// later test. Both hooks also guard the clear, so neither can throw.
function clearStorage(): void {
	if (typeof localStorage !== 'undefined') localStorage.clear();
}

beforeEach(() => {
	clearStorage();
});

afterEach(() => {
	vi.unstubAllGlobals();
	clearStorage();
});

describe('timeFormat preference — defaults (#207 rule 5)', () => {
	it("uses the pinned localStorage key 'mvox.time_format'", async () => {
		const mod = await freshModule();
		expect(mod.TIME_FORMAT_KEY).toBe('mvox.time_format');
	});

	it("defaults to '24h' with EMPTY localStorage — 24h is the rule, AM/PM the opt-in", async () => {
		const mod = await freshModule();
		expect(mod.readStoredTimeFormat()).toBe('24h');
		expect(get(mod.timeFormatStore)).toBe('24h');
	});

	it("sanitizes an INVALID stored value to '24h' — never trusts localStorage verbatim", async () => {
		for (const junk of ['12h', 'AMPM', 'garbage', '']) {
			localStorage.setItem('mvox.time_format', junk);
			const mod = await freshModule();
			expect(mod.readStoredTimeFormat(), `stored ${JSON.stringify(junk)}`).toBe('24h');
			expect(get(mod.timeFormatStore), `stored ${JSON.stringify(junk)}`).toBe('24h');
		}
	});
});

describe('timeFormat preference — round trip (#207 rule 5)', () => {
	it("setTimeFormat('ampm') persists to localStorage AND updates the store", async () => {
		const mod = await freshModule();
		mod.setTimeFormat('ampm');
		expect(localStorage.getItem('mvox.time_format')).toBe('ampm');
		expect(get(mod.timeFormatStore)).toBe('ampm');
	});

	it('a persisted preference survives a fresh module load (the round trip)', async () => {
		const first = await freshModule();
		first.setTimeFormat('ampm');

		const second = await freshModule();
		expect(second.readStoredTimeFormat()).toBe('ampm');
		expect(get(second.timeFormatStore)).toBe('ampm');

		second.setTimeFormat('24h');
		expect(localStorage.getItem('mvox.time_format')).toBe('24h');
		const third = await freshModule();
		expect(get(third.timeFormatStore)).toBe('24h');
	});
});

describe('timeFormat preference — SSR safety (#207)', () => {
	it("module import without localStorage does not throw and defaults to '24h'", async () => {
		vi.stubGlobal('localStorage', undefined);
		const mod = await freshModule();
		expect(get(mod.timeFormatStore)).toBe('24h');
		expect(mod.readStoredTimeFormat()).toBe('24h');
	});

	it('setTimeFormat without localStorage does not throw (store still updates in memory)', async () => {
		vi.stubGlobal('localStorage', undefined);
		const mod = await freshModule();
		expect(() => mod.setTimeFormat('ampm')).not.toThrow();
		expect(get(mod.timeFormatStore)).toBe('ampm');
	});
});
