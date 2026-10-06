// @vitest-environment happy-dom
// The agenda view preference: Detailne by default, a sanitized per-device read, SSR-safe (#247).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

type AgendaViewModule = typeof import('./agendaView');

async function freshModule(): Promise<AgendaViewModule> {
	vi.resetModules();
	return await import('./agendaView');
}

// Unstub before clearing: the SSR tests stub localStorage away.
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
