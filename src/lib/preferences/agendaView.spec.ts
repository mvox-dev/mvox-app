// @vitest-environment happy-dom
//
// #247 RED — the agenda view-mode preference store (Ruled 2026-09-06, item 9:
// the day list stays the DEFAULT; the Nimekiri|Kuu choice "persists on the
// device the same way the time-format preference does" — the #207 idiom).
//
// CONTRACT (GREEN must implement — src/lib/preferences/agendaView.ts, a
// transplant of the timeFormat.ts shape, NOT a hand-rolled variant):
//
//   export type AgendaView = 'list' | 'month';
//   export const AGENDA_VIEW_KEY = 'mvox.agenda_view';   // mvox.<name> convention
//   export function readStoredAgendaView(): AgendaView;  // sanitizing read of
//                                                        // localStorage NOW:
//                                                        // absent/invalid → 'list'
//   export const agendaViewStore: Writable<AgendaView>;  // init from readStoredAgendaView()
//   export function setAgendaView(v: AgendaView): void;  // store.set + persist
//
//   SSR-safe: the module guards `typeof localStorage !== 'undefined'` — import,
//   read and setAgendaView must not throw where localStorage is absent, and
//   the store then defaults to 'list'. A raw `localStorage.getItem(...)` read
//   trusted verbatim is exactly the trap this spec exists to close.
//
// Every init-behaviour test goes through a FRESH module instance
// (vi.resetModules + dynamic import) — module-level init runs once per import.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

type AgendaViewModule = typeof import('./agendaView');

async function freshModule(): Promise<AgendaViewModule> {
	vi.resetModules();
	return await import('./agendaView');
}

// `vi.unstubAllGlobals()` FIRST in afterEach — the SSR-safety tests stub
// `localStorage` away, so an unguarded `localStorage.clear()` ahead of the
// unstub would throw and leave the stub in place to poison every later test.
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

describe('#247 — agenda view preference: defaults (ruling 9 — day list is the default)', () => {
	it("uses the pinned localStorage key 'mvox.agenda_view'", async () => {
		const mod = await freshModule();
		expect(mod.AGENDA_VIEW_KEY).toBe('mvox.agenda_view');
	});

	it("defaults to 'list' with EMPTY localStorage — the day list is the default, month is the opt-in", async () => {
		const mod = await freshModule();
		expect(mod.readStoredAgendaView()).toBe('list');
		expect(get(mod.agendaViewStore)).toBe('list');
	});

	it("sanitizes an INVALID stored value to 'list' — never trusts localStorage verbatim", async () => {
		for (const junk of ['grid', 'MONTH', 'kuu', 'calendar', '']) {
			localStorage.setItem('mvox.agenda_view', junk);
			const mod = await freshModule();
			expect(mod.readStoredAgendaView(), `stored ${JSON.stringify(junk)}`).toBe('list');
			expect(get(mod.agendaViewStore), `stored ${JSON.stringify(junk)}`).toBe('list');
		}
	});

	it("a stored 'month' initializes the store to 'month' — the persisted choice survives a reload", async () => {
		localStorage.setItem('mvox.agenda_view', 'month');
		const mod = await freshModule();
		expect(mod.readStoredAgendaView()).toBe('month');
		expect(get(mod.agendaViewStore)).toBe('month');
	});
});

describe('#247 — agenda view preference: round trip (the #207 setTimeFormat shape)', () => {
	it("setAgendaView('month') persists to localStorage AND updates the store synchronously", async () => {
		const mod = await freshModule();
		mod.setAgendaView('month');
		expect(localStorage.getItem('mvox.agenda_view')).toBe('month');
		expect(get(mod.agendaViewStore)).toBe('month');
	});

	it("setAgendaView('list') round-trips back — the toggle is two-state, both writes persist", async () => {
		localStorage.setItem('mvox.agenda_view', 'month');
		const mod = await freshModule();
		mod.setAgendaView('list');
		expect(localStorage.getItem('mvox.agenda_view')).toBe('list');
		expect(get(mod.agendaViewStore)).toBe('list');
	});
});

describe('#247 — agenda view preference: SSR safety (no localStorage global)', () => {
	it("import + read default to 'list' and nothing throws when localStorage is absent", async () => {
		vi.stubGlobal('localStorage', undefined);
		const mod = await freshModule();
		expect(mod.readStoredAgendaView()).toBe('list');
		expect(get(mod.agendaViewStore)).toBe('list');
	});

	it('setAgendaView still updates the store (and does not throw) without localStorage', async () => {
		vi.stubGlobal('localStorage', undefined);
		const mod = await freshModule();
		expect(() => mod.setAgendaView('month')).not.toThrow();
		expect(get(mod.agendaViewStore)).toBe('month');
	});
});

// (*MVOX:Tallis* — #247 RED)
