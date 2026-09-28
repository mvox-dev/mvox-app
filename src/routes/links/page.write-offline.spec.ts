// @vitest-environment happy-dom
//
// #434 slice 6/6 review F1 — /links writes are gated while offline, on the REAL
// page (harness: page.links-wire.spec.ts — the wire is mocked at the entuFetch
// seam, so a write that slips through is visible as a non-GET call).
//
// THE FINDING: slice 6 gated the three offline-READ routes and stopped. /links
// carried createLink / updateLink / deleteLink / reorderLinks fully enabled
// offline with no reason text, and no fence covered it.
//
// CONTRACT — an admin on a loaded list, the signal ($lib/net/online) offline:
//   • links-add-submit, links-edit, links-remove, links-move-up/down and
//     links-edit-save are disabled;
//   • ONE visible sentence [data-testid="links-write-unavailable"] =
//     m.write_unavailable_no_signal();
//   • the SWEEP: operating every still-enabled control puts no non-GET on the
//     wire (so a control nobody listed fails here, not in production);
//   • a typed draft is KEPT — nothing is queued, nothing is discarded;
//   • back online: enabled again, the sentence gone, an add writes.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));
vi.mock('$lib/paraglide/messages', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const { entuFetchMock } = vi.hoisted(() => ({ entuFetchMock: vi.fn() }));
vi.mock('$lib/entu/request', async (importActual) => ({
	...(await importActual<typeof import('$lib/entu/request')>()),
	entuFetch: entuFetchMock
}));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
const pageStub = vi.hoisted(() => ({ url: new URL('https://dev.mvox.eu/links') }));
vi.mock('$app/state', () => ({ page: pageStub }));

import Page from './+page.svelte';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import {
	goOffline,
	goOnline,
	resetOnLine,
	settle,
	isWriteDisabled,
	expectVisibleReason,
	exerciseEveryEnabledControl
} from '$lib/testing/networkSignal';

const DB_ENTITY = 'db-ent-1';
const TYPE_ID = 'type-link-1';
const REASON = '[write_unavailable_no_signal]';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

function nonGetWireCalls(): string[] {
	return (entuFetchMock.mock.calls as Array<[string, string, string, RequestInit | undefined]>)
		.filter(([, , , init]) => (init?.method ?? 'GET').toUpperCase() !== 'GET')
		.map(([, path, , init]) => `${init?.method} ${String(path)}`);
}

function installWireRouter() {
	entuFetchMock.mockImplementation(
		(_db: string, path: string, _token: string, init?: RequestInit) => {
			const p = String(path);
			const method = init?.method ?? 'GET';
			if (method === 'DELETE') return Promise.resolve(json({ deleted: true }));
			if (method === 'POST') {
				if (/^\/?entity$/.test(p)) return Promise.resolve(json({ _id: 'l-new' }));
				return Promise.resolve(json({}));
			}
			if (p.includes('_type.string=database')) {
				return Promise.resolve(json({ entities: [{ _id: DB_ENTITY }] }));
			}
			if (p.includes('_type.string=entity') && p.includes('name.string=link')) {
				return Promise.resolve(json({ entities: [{ _id: TYPE_ID }] }));
			}
			if (p.includes('_type.string=link')) {
				return Promise.resolve(
					json({
						entities: [
							{
								_id: 'l-rec',
								name: [{ string: 'Salvestused' }],
								url: [{ string: 'https://f.io/GCkGMr5J' }],
								description: [{ string: 'Crede recordings' }],
								display_order: [{ number: 1 }]
							},
							{
								_id: 'l-scores',
								name: [{ string: 'Scores' }],
								url: [{ string: 'example.com/x' }],
								display_order: [{ number: 2 }]
							}
						]
					})
				);
			}
			if (/^\/?entity\/[^/?]+\?props=display_order/.test(p)) {
				const id = p.match(/entity\/([^/?]+)/)?.[1] ?? '';
				return Promise.resolve(json({ entity: { display_order: [{ _id: `pv-${id}` }] } }));
			}
			return Promise.resolve(json({ entities: [], entity: {} }));
		}
	);
}

beforeEach(() => {
	resetTypeIdCache();
	installWireRouter();
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
	adminStore.set('admin');
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetAdmin();
	resetOnLine();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function rowEls(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll('[data-testid="links-row"]'));
}

async function renderReadyOnline() {
	await goOnline();
	const utils = render(Page);
	await waitFor(() => {
		expect(rowEls(utils.container)).toHaveLength(2);
		expect(q(utils.container, 'links-add-submit')).not.toBeNull();
	});
	return utils;
}

/** The admin write controls that exist on a loaded list with no editor open. */
function writeControls(container: HTMLElement): HTMLElement[] {
	return [
		q(container, 'links-add-submit') as HTMLElement,
		...Array.from(container.querySelectorAll<HTMLElement>('[data-testid="links-edit"]')),
		...Array.from(container.querySelectorAll<HTMLElement>('[data-testid="links-remove"]')),
		...Array.from(container.querySelectorAll<HTMLElement>('[data-testid="links-move-up"]')),
		...Array.from(container.querySelectorAll<HTMLElement>('[data-testid="links-move-down"]'))
	];
}

describe('/links — writes while offline (#434 slice 6 review F1)', () => {
	it('offline: every write control is disabled and the reason is visible once', async () => {
		const { container } = await renderReadyOnline();
		expect(writeControls(container).length).toBeGreaterThanOrEqual(7);
		await goOffline();

		await waitFor(() => {
			for (const c of writeControls(container)) {
				expect(isWriteDisabled(c), c.dataset.testid).toBe(true);
			}
		});
		expectVisibleReason(container, 'links-write-unavailable', REASON);
		expect(container.querySelectorAll('[data-testid="links-write-unavailable"]')).toHaveLength(1);
	});

	it('offline: a filled add form writes nothing and KEEPS the typed draft', async () => {
		const { container } = await renderReadyOnline();
		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'Uus link' } });
		await fireEvent.input(q(container, 'links-add-url')!, { target: { value: 'crede.ee/x' } });
		await goOffline();
		entuFetchMock.mockClear();

		await fireEvent.click(q(container, 'links-add-submit')!);
		await fireEvent.submit(q(container, 'links-add-form')!);
		await settle();

		expect(nonGetWireCalls()).toEqual([]);
		expect((q(container, 'links-add-name') as HTMLInputElement).value).toBe('Uus link');
		expect((q(container, 'links-add-url') as HTMLInputElement).value).toBe('crede.ee/x');
	});

	it('offline: an edit form open when the signal drops cannot save, and keeps its draft', async () => {
		const { container } = await renderReadyOnline();
		await fireEvent.click(container.querySelectorAll('[data-testid="links-edit"]')[0]);
		const nameInput = await waitFor(() => {
			const el = q(container, 'links-edit-name') as HTMLInputElement | null;
			expect(el).not.toBeNull();
			return el as HTMLInputElement;
		});
		await fireEvent.input(nameInput, { target: { value: 'Renamed' } });
		await goOffline();
		entuFetchMock.mockClear();

		expect(isWriteDisabled(q(container, 'links-edit-save')!)).toBe(true);
		await fireEvent.click(q(container, 'links-edit-save')!);
		await settle();

		expect(nonGetWireCalls()).toEqual([]);
		expect((q(container, 'links-edit-name') as HTMLInputElement).value).toBe('Renamed');
	});

	// The sweep: every enabled control, re-queried after each interaction, so a
	// write control nobody remembered to list fails HERE.
	it('offline: operating every enabled control puts no non-GET on the wire', async () => {
		const { container } = await renderReadyOnline();
		await goOffline();
		await settle();
		entuFetchMock.mockClear();

		const touched = await exerciseEveryEnabledControl(container);

		// Not a vacuous pass — the sweep really did reach live controls (the three
		// add-form text boxes, the edit-cancel, the read retry).
		expect(touched.length).toBeGreaterThan(2);
		expect(nonGetWireCalls()).toEqual([]);
	});

	it('back online: the controls enable again, the sentence goes, and an add writes', async () => {
		const { container } = await renderReadyOnline();
		await goOffline();
		await goOnline();

		await waitFor(() => {
			expect(isWriteDisabled(q(container, 'links-add-submit')!)).toBe(false);
		});
		expect(q(container, 'links-write-unavailable')).toBeNull();

		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'Uus link' } });
		await fireEvent.input(q(container, 'links-add-url')!, { target: { value: 'crede.ee/x' } });
		await fireEvent.click(q(container, 'links-add-submit')!);

		await waitFor(() => expect(nonGetWireCalls().length).toBeGreaterThan(0));
	});
});

// (*MVOX:Josquin* — #434 slice 6 review F1)
