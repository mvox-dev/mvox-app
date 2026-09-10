// @vitest-environment happy-dom
//
// #256 RED — INTEGRATION: the ACTUAL /links page driving the REAL data
// modules (linkData + linkActions), mocked only at the entuFetch seam.
//
// This is the pin that forces the wiring: a page whose unit specs pass
// against mocked modules could still ship without ever importing them. Here
// the REAL listLinks/createLink/reorderLinks run, and the assertions are on
// the WIRE calls (full-shape toEqual, per the partial-assertions lesson):
//
//   - the list read scopes to the DATABASE entity and the page renders the
//     module's SORTED order (server order deliberately shuffled);
//   - add → ONE create POST whose body is EXACTLY _type-as-REFERENCE
//     (resolveTypeId, never a string), _parent = the database entity,
//     name/url verbatim, display_order appended, EXPLICIT _sharing 'domain'
//     + _inheritrights true (#256 pin 5);
//   - move-down → the atomic-overwrite renumber wire, exactly
//     reorderSections' shape: per link GET ?props=display_order → ONE POST
//     pairing the old value id with the 1-based position; ZERO DELETEs on
//     clean data (#256 pin 2).
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

/** Two links live on the server, display_order 1 and 2 — served SHUFFLED
 *  (order 2 first) so only a real sort can produce the rendered order. */
function installWireRouter() {
	entuFetchMock.mockImplementation((_db: string, path: string, _token: string, init?: RequestInit) => {
		const p = String(path);
		const method = init?.method ?? 'GET';
		if (method === 'DELETE') return Promise.resolve(json({ deleted: true }));
		if (method === 'POST') {
			// entity create (POST 'entity') answers an _id; property-overwrite
			// POSTs (entity/{id}) answer {}.
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
						// Shuffled: display_order 2 arrives first.
						{
							_id: 'l-scores',
							name: [{ string: 'Scores' }],
							url: [{ string: 'example.com/x' }],
							display_order: [{ number: 2 }]
						},
						{
							_id: 'l-rec',
							name: [{ string: 'Salvestused' }],
							url: [{ string: 'https://f.io/GCkGMr5J' }],
							description: [{ string: 'Crede recordings' }],
							display_order: [{ number: 1 }]
						}
					]
				})
			);
		}
		if (/^\/?entity\/[^/?]+\?props=display_order/.test(p)) {
			const id = p.match(/entity\/([^/?]+)/)?.[1] ?? '';
			return Promise.resolve(json({ entity: { display_order: [{ _id: `pv-${id}` }] } }));
		}
		// Anything else (e.g. a rights read) answers an empty shape.
		return Promise.resolve(json({ entities: [], entity: {} }));
	});
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

beforeEach(() => {
	resetTypeIdCache();
	installWireRouter();
	setAuthedAdmin();
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
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function rowEls(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll('[data-testid="links-row"]'));
}

async function renderReady() {
	const utils = render(Page);
	await waitFor(() => {
		expect(rowEls(utils.container)).toHaveLength(2);
	});
	return utils;
}

describe('#256 integration — the page drives the REAL read module', () => {
	it('scopes the list to the database entity on the wire and renders the SORTED order despite shuffled server order — urls verbatim in the DOM', async () => {
		const { container } = await renderReady();

		const listCall = wireCalls().find((c) => c.path.includes('_type.string=link'));
		expect(listCall).toBeDefined();
		expect(listCall!.db).toBe('polyphony');
		expect(listCall!.path).toContain(`_parent.reference=${DB_ENTITY}`);

		const names = rowEls(container).map(
			(r) => r.querySelector('[data-testid="links-row-name"]')?.textContent?.trim()
		);
		expect(names).toEqual(['Salvestused', 'Scores']);
		const hrefs = rowEls(container).map((r) =>
			r.querySelector('[data-testid="links-row-url"]')?.getAttribute('href')
		);
		expect(hrefs).toEqual(['https://f.io/GCkGMr5J', 'example.com/x']);
	});
});

describe('#256 integration — add drives the REAL createLink wire (pin 5)', () => {
	it('one create POST: _type as REFERENCE, _parent = database entity, url VERBATIM, display_order appended, EXPLICIT _sharing domain + _inheritrights', async () => {
		const { container } = await renderReady();
		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'Uus link' } });
		await fireEvent.input(q(container, 'links-add-url')!, {
			target: { value: 'crede.ee/salvestused' }
		});
		await fireEvent.click(q(container, 'links-add-submit')!);

		await waitFor(() => {
			expect(
				wireCalls().some((c) => c.method === 'POST' && /^\/?entity$/.test(c.path))
			).toBe(true);
		});

		// The type was resolved by NAME to an id (reference-not-string wire).
		expect(
			wireCalls().some(
				(c) => c.path.includes('_type.string=entity') && c.path.includes('name.string=link')
			)
		).toBe(true);

		const create = wireCalls().find((c) => c.method === 'POST' && /^\/?entity$/.test(c.path))!;
		expect(create.db).toBe('polyphony');
		// FULL-shape toEqual: two links exist (orders 1,2) → the new one is 3.
		expect(create.body).toEqual([
			{ type: '_type', reference: TYPE_ID },
			{ type: '_parent', reference: DB_ENTITY },
			{ type: 'name', string: 'Uus link' },
			{ type: 'url', string: 'crede.ee/salvestused' },
			{ type: 'display_order', number: 3 },
			{ type: '_sharing', string: 'domain' },
			{ type: '_inheritrights', boolean: true }
		]);
	});
});

describe('#256 integration — move-down drives the REAL reorderLinks renumber wire (pin 2)', () => {
	it('per link: GET ?props=display_order then ONE atomic POST pairing the old value id with the 1-based position; ZERO property DELETEs', async () => {
		const { container } = await renderReady();
		await fireEvent.click(rowEls(container)[0].querySelector('[data-testid="links-move-down"]')!);

		await waitFor(() => {
			expect(
				wireCalls().filter((c) => c.method === 'POST' && /entity\/l-/.test(c.path))
			).toHaveLength(2);
		});

		const calls = wireCalls();
		const posts = calls.filter((c) => c.method === 'POST' && /entity\/l-/.test(c.path));
		const bodyFor = (id: string) => posts.find((c) => c.path.includes(`entity/${id}`))?.body;
		// New order after moving 'Salvestused' (l-rec) down: [l-scores, l-rec].
		expect(bodyFor('l-scores')).toEqual([{ _id: 'pv-l-scores', type: 'display_order', number: 1 }]);
		expect(bodyFor('l-rec')).toEqual([{ _id: 'pv-l-rec', type: 'display_order', number: 2 }]);
		// Clean data → the overwrite IS the replace; nothing is DELETEd.
		expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
		// Each POST was preceded by its own GET of the old value id.
		for (const id of ['l-scores', 'l-rec']) {
			const getIdx = calls.findIndex(
				(c) =>
					c.method === 'GET' &&
					c.path.includes(`entity/${id}`) &&
					c.path.includes('props=display_order')
			);
			const postIdx = calls.findIndex(
				(c) => c.method === 'POST' && c.path.includes(`entity/${id}`)
			);
			expect(getIdx, id).toBeGreaterThanOrEqual(0);
			expect(postIdx, id).toBeGreaterThan(getIdx);
		}
	});
});

// (*MVOX:Tallis* — #256 RED)
