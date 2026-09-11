// @vitest-environment happy-dom
//
// #323 RED — INTEGRATION: the ACTUAL /links page driving the REAL
// linkData/linkActions modules, mocked only at the entuFetch seam — the
// FAILURE leg the unit specs cannot force. reorderLinks (linkActions.ts) is a
// sequential per-id GET→POST renumber loop that THROWS MID-LOOP on the first
// HTTP failure, leaving every earlier id already renumbered on the server.
// This spec constructs exactly that: three links, a move whose renumber
// succeeds for the first id and 500s on the second, so the server ends
// HALF-APPLIED and only a genuine re-read can tell the user the truth.
//
// Pins (issue #323 done-when 2 + Gama's adjacent-scope ruling):
//   - the thrown wire error surfaces as role="alert" (links_reorder_failed),
//     NOT console.error-and-nothing;
//   - the failure TRIGGERS a fresh list read AFTER the failing POST, and the
//     page renders exactly what the server returns — never the half-applied
//     intent, never a stale pre-write memory;
//   - the loop stopped mid-way (no renumber POST ever hits the third id) —
//     the untouched tail is the reason a re-read is mandatory;
//   - retry stays available: the arrow buttons end enabled;
//   - adjacent: a REAL createLink failure (500 on the create POST) surfaces
//     as role="alert" (links_create_failed) with the draft retained.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy(
		{},
		{
			get: (_target, key) => () => String(key)
		}
	)
}));
vi.mock('$lib/paraglide/messages', () => ({
	m: new Proxy(
		{},
		{
			get: (_target, key) => () => String(key)
		}
	)
}));

const { entuFetchMock } = vi.hoisted(() => ({ entuFetchMock: vi.fn() }));
vi.mock('$lib/entu/request', async (importActual) => ({
	...(await importActual<typeof import('$lib/entu/request')>()),
	entuFetch: entuFetchMock
}));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './links/+page.svelte';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

const DB_ENTITY = 'db-ent-1';
const TYPE_ID = 'type-link-1';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

interface WireCall {
	db: string;
	path: string;
	method: string;
	body: unknown;
}

function wireCalls(): WireCall[] {
	return (entuFetchMock.mock.calls as Array<[string, string, string, RequestInit | undefined]>).map(
		([db, path, , init]) => ({
			db,
			path: String(path),
			method: init?.method ?? 'GET',
			body: init?.body ? JSON.parse(String(init.body)) : undefined
		})
	);
}

interface ServerLink {
	_id: string;
	name: string;
	order: number;
}

/** Mutable server-side truth the list read serves from. */
let serverLinks: ServerLink[];
/** Renumber POSTs that must answer 500 (by entity id). */
let failRenumberFor: Set<string>;
/** When true, the entity-create POST answers 500. */
let failCreate: boolean;

function serveList() {
	return json({
		entities: serverLinks.map((l) => ({
			_id: l._id,
			name: [{ string: l.name }],
			url: [{ string: `https://example.test/${l._id}` }],
			display_order: [{ number: l.order }]
		}))
	});
}

function installWireRouter() {
	entuFetchMock.mockImplementation(
		(_db: string, path: string, _token: string, init?: RequestInit) => {
			const p = String(path);
			const method = init?.method ?? 'GET';
			if (method === 'DELETE') return Promise.resolve(json({ deleted: true }));
			if (method === 'POST') {
				if (/^\/?entity$/.test(p)) {
					if (failCreate) return Promise.resolve(json({ error: 'nope' }, 500));
					return Promise.resolve(json({ _id: 'l-new' }));
				}
				const id = p.match(/entity\/([^/?]+)/)?.[1] ?? '';
				if (failRenumberFor.has(id)) {
					return Promise.resolve(json({ error: 'renumber rejected' }, 500));
				}
				return Promise.resolve(json({}));
			}
			if (p.includes('_type.string=database')) {
				return Promise.resolve(json({ entities: [{ _id: DB_ENTITY }] }));
			}
			if (p.includes('_type.string=entity') && p.includes('name.string=link')) {
				return Promise.resolve(json({ entities: [{ _id: TYPE_ID }] }));
			}
			if (p.includes('_type.string=link')) {
				return Promise.resolve(serveList());
			}
			if (/^\/?entity\/[^/?]+\?props=display_order/.test(p)) {
				const id = p.match(/entity\/([^/?]+)/)?.[1] ?? '';
				return Promise.resolve(json({ entity: { display_order: [{ _id: `pv-${id}` }] } }));
			}
			return Promise.resolve(json({ entities: [], entity: {} }));
		}
	);
}

function setAuthedAdmin() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
	adminStore.set('admin');
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	serverLinks = [
		{ _id: 'l-a', name: 'Alpha', order: 1 },
		{ _id: 'l-b', name: 'Beta', order: 2 },
		{ _id: 'l-c', name: 'Gamma', order: 3 }
	];
	failRenumberFor = new Set();
	failCreate = false;
	resetTypeIdCache();
	installWireRouter();
	setAuthedAdmin();
	consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	consoleErrorSpy.mockRestore();
	cleanup();
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function rowEls(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll('[data-testid="links-row"]'));
}

function rowNames(container: HTMLElement): string[] {
	return rowEls(container).map(
		(r) => r.querySelector('[data-testid="links-row-name"]')?.textContent?.trim() ?? ''
	);
}

async function renderReady() {
	const utils = render(Page);
	await waitFor(() => {
		expect(rowNames(utils.container)).toEqual(['Alpha', 'Beta', 'Gamma']);
	});
	return utils;
}

describe('#323 integration — a MID-LOOP renumber failure on the REAL wire surfaces and re-reads', () => {
	it('move-down on Alpha: l-b renumbers OK, l-a 500s → role=alert links_reorder_failed, the loop stops before l-c, a FRESH list read follows the failing POST, and the screen shows the SERVER order', async () => {
		const { container } = await renderReady();

		// Intent: [Beta, Alpha, Gamma] → renumber order l-b(1), l-a(2), l-c(3).
		// l-b's POST succeeds, l-a's POST 500s — the server is now
		// HALF-APPLIED. The router's list read reflects the server truth we
		// choose it to have settled at; distinct from BOTH the pre-write order
		// (Alpha,Beta,Gamma) and the intent (Beta,Alpha,Gamma), so only a real
		// re-read can produce the rendered result.
		failRenumberFor.add('l-a');
		const postFailureServerOrder: ServerLink[] = [
			{ _id: 'l-b', name: 'Beta', order: 1 },
			{ _id: 'l-c', name: 'Gamma', order: 2 },
			{ _id: 'l-a', name: 'Alpha', order: 3 }
		];
		// Swap the server truth the moment the failing POST answers.
		const baseImpl = entuFetchMock.getMockImplementation()!;
		entuFetchMock.mockImplementation((db: string, path: string, token: string, init?: RequestInit) => {
			const p = String(path);
			if ((init?.method ?? 'GET') === 'POST' && /entity\/l-a/.test(p)) {
				serverLinks = postFailureServerOrder;
			}
			return baseImpl(db, path, token, init);
		});

		await fireEvent.click(rowEls(container)[0].querySelector('[data-testid="links-move-down"]')!);

		// The failure surfaces as a truthful alert — not console.error-and-nothing.
		const alert = await waitFor(() => {
			const el = q(container, 'links-reorder-error');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent).toContain('links_reorder_failed');

		const calls = wireCalls();
		// The loop stopped at the failure: l-b renumbered, l-a attempted, l-c NEVER touched.
		expect(calls.filter((c) => c.method === 'POST' && /entity\/l-b/.test(c.path))).toHaveLength(1);
		expect(calls.filter((c) => c.method === 'POST' && /entity\/l-a/.test(c.path))).toHaveLength(1);
		expect(calls.filter((c) => c.method === 'POST' && /entity\/l-c/.test(c.path))).toHaveLength(0);

		// A FRESH list read fired AFTER the failing POST.
		const failingPostIdx = calls.findIndex(
			(c) => c.method === 'POST' && /entity\/l-a/.test(c.path)
		);
		const listReadIdxs = calls
			.map((c, i) => (c.method === 'GET' && c.path.includes('_type.string=link') ? i : -1))
			.filter((i) => i >= 0);
		expect(failingPostIdx).toBeGreaterThanOrEqual(0);
		expect(
			listReadIdxs.some((i) => i > failingPostIdx),
			'failure must trigger a re-read of the list AFTER the failing renumber POST'
		).toBe(true);

		// The screen matches the SERVER — not the half-applied intent, not the
		// pre-write memory.
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['Beta', 'Gamma', 'Alpha']);
		});

		// Retry stays available: non-boundary arrows end enabled.
		await waitFor(() => {
			expect(
				rowEls(container)[1].querySelector<HTMLButtonElement>('[data-testid="links-move-down"]')!
					.disabled
			).toBe(false);
		});
	});
});

describe('#323 integration adjacent — a REAL createLink failure surfaces as role="alert"', () => {
	it('a 500 on the create POST shows links-write-error (links_create_failed) and the typed draft survives for retry', async () => {
		failCreate = true;
		const { container } = await renderReady();

		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'Uus link' } });
		await fireEvent.input(q(container, 'links-add-url')!, {
			target: { value: 'crede.ee/salvestused' }
		});
		await fireEvent.click(q(container, 'links-add-submit')!);

		const alert = await waitFor(() => {
			const el = q(container, 'links-write-error');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent).toContain('links_create_failed');
		expect((q(container, 'links-add-name') as HTMLInputElement).value).toBe('Uus link');
		expect((q(container, 'links-add-url') as HTMLInputElement).value).toBe('crede.ee/salvestused');
	});
});

// (*MVOX:Tallis* — #323 RED)
