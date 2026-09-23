// @vitest-environment happy-dom
//
// #124 gate #114 F1/F2 — section creation END-TO-END under REAL tap timing, on
// the live wire shape. RE-DRIVEN through the page-level `roster-new-section`
// entry (#470: the picker's inline create form is RETIRED — "drop the new
// section creation" — so the trusted-tap + real-write-layer coverage moves to
// the only creation path left). Integration: actual /roster route, REAL
// sectionData (listSections parses a live-shaped wire payload) and REAL
// sectionActions (createSection hits the stubbed fetch seam, so the WIRE SHAPE
// of the write is asserted, not a mock's call log). Only `loadRoster` and
// global fetch are stubbed.
//
// The trusted-tap half: a real tap's window leg arrives AFTER Svelte's
// microtask flush (a synthetic fireEvent never checkpoints mid-bubble), which
// is exactly the sequencing that once dismissed the picker's create form
// mid-open (#124 F1). The page-level entry swaps a button for a form on tap
// too, so it inherits the same regression class — `trustedClick` reproduces
// the trusted sequencing faithfully.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const { loadRosterMock } = vi.hoisted(() => ({ loadRosterMock: vi.fn() }));
// #269 review F1/F2 — /roster calls the OPT-IN real-names producer.
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
// sectionData and sectionActions are NOT mocked — the REAL read parses the
// live-shaped wire and the REAL write hits the fetch stub below.
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import type { RosterRow } from '$lib/roster/rosterData';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures';

// ── live wire fixture (verbatim shape + real ids, 2026-08-12 spike probe;
//    reparented to the single DATABASE entity per #161) ─────────────────────────

const ORG_EFK = '69c7f8718489bfcb0e81b065'; // the database entity — THE collective
const EFK_SOPRANO = '69c7f8728489bfcb0e81b07b';
const EFK_BASS = '69c7f8768489bfcb0e81b163';
const TAM_TENOR = '69c7f8878489bfcb0e81b506';
const TYPE_SECTION = '69c7ea498489bfcb0e819ea3'; // the `section` type-definition entity
const NEW_SECTION_ID = 'sec-new-live';

function wireSection(id: string, name: string, displayOrder: number, dbEntityId: string, dbName: string) {
	return {
		_id: id,
		_parent: [
			{
				_id: `pv-${id}`,
				reference: dbEntityId,
				property_type: '_parent',
				string: dbName,
				entity_type: 'database'
			}
		],
		display_order: [{ _id: `do-${id}`, number: displayOrder }],
		name: [{ _id: `nm-${id}`, string: name }]
	};
}

function liveSectionsWire(): unknown {
	return {
		entities: [
			wireSection(EFK_SOPRANO, 'Soprano', 1, ORG_EFK, 'Sampledb'),
			wireSection(EFK_BASS, 'Bass', 15, ORG_EFK, 'Sampledb'),
			wireSection(TAM_TENOR, 'I Tenor', 10, ORG_EFK, 'Sampledb')
		],
		count: 3,
		limit: 500,
		skip: 0
	};
}

/** The viewer ('person-p') has her own row — `currentDbEntityId` reads HER org
 *  off it, never a `limit=1` guess. */
function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-efk-mari',
			personId: 'p-mari',
			name: 'Mari Mets',
			email: 'mari@x.com',
			sectionIds: [EFK_SOPRANO],
			dbEntityId: ORG_EFK
		},
		{
			memberId: 'm-viewer',
			personId: 'person-p',
			name: 'Zelda Viewer',
			email: 'zelda@x.com',
			sectionIds: [],
			dbEntityId: ORG_EFK
		}
	];
}

// ── fetch stub: live-shaped reads + recorded writes ─────────────────────────────

const calls: Array<{ url: string; method: string; body: string | null }> = [];

function stubFetch(): void {
	const fetchMock = vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
		const u = String(url);
		const method = init?.method ?? 'GET';
		calls.push({ url: u, method, body: typeof init?.body === 'string' ? init.body : null });
		const json = (payload: unknown, status = 200) =>
			Promise.resolve(
				new Response(JSON.stringify(payload), {
					status,
					headers: { 'Content-Type': 'application/json' }
				})
			);
		// resolveTypeId's type-definition lookup (`name.string=section`).
		if (u.includes('_type.string=entity') && u.includes('name.string=section')) {
			return json({ entities: [{ _id: TYPE_SECTION }], count: 1 });
		}
		// listSections' unscoped section read.
		if (u.includes('_type.string=section')) {
			return json(liveSectionsWire());
		}
		// createSection's entity POST (`POST {base}/{db}/entity`, no id segment).
		if (method === 'POST' && /\/entity$/.test(u.split('?')[0])) {
			return json({ _id: NEW_SECTION_ID });
		}
		return json({ entities: [], count: 0 });
	});
	vi.stubGlobal('fetch', fetchMock);
}

function setAuthedWithOneCollective() {
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
}

beforeEach(() => {
	calls.length = 0;
	resetTypeIdCache(); // the type-id cache is module-scope — never let it leak across cases
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	stubFetch();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadRosterMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderArrangeReady(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'roster-groups')).not.toBeNull();
	});
	// #155/S4 — the page-level create entry lives in Arrange mode.
	await fireEvent.click(q(container, 'roster-view-chip-arrange') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-arrange-list')).not.toBeNull();
	});
	return container;
}

/**
 * Dispatch a click with TRUSTED-EVENT event-loop semantics — the component's
 * own handlers first, then a microtask checkpoint (Svelte's flush), and only
 * then the window-level listeners, carrying the ORIGINAL target (which the
 * flush may have unmounted). This is how a real browser sequences a hardware
 * tap; synthetic dispatch runs the whole path with no checkpoint.
 */
async function trustedClick(el: HTMLElement): Promise<void> {
	const stopAtDocument = (e: Event) => e.stopPropagation();
	document.addEventListener('click', stopAtDocument);
	try {
		await fireEvent.click(el);
	} finally {
		document.removeEventListener('click', stopAtDocument);
	}
	const continued = new MouseEvent('click', { bubbles: false, cancelable: true });
	Object.defineProperty(continued, 'target', { value: el, configurable: true });
	window.dispatchEvent(continued);
	await Promise.resolve();
}

/** Walk to the open page-level form via trusted taps — the live gate's own path. */
async function openCreateForm(container: HTMLElement): Promise<void> {
	await trustedClick(q(container, 'roster-new-section') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-new-section-form')).not.toBeNull();
	});
}

/** Every recorded POST body to the bare `/entity` create endpoint, parsed. */
function createPosts(): unknown[] {
	return calls
		.filter((c) => c.method === 'POST' && /\/entity$/.test(c.url.split('?')[0]))
		.map((c) => JSON.parse(c.body ?? 'null'));
}

// ── F1: creation works END-TO-END on the live shape (type name, submit, appears) ─

describe('/roster #124 F1 — section creation end-to-end: real tap timing, real write layer, live-shaped tree (re-driven through roster-new-section per #470)', () => {
	it('the admin opens the arrange entry, types a name, submits: ONE create POST goes out with the full pinned body — _type as a reference, _parent = HER org (never an org-lookup guess), name, explicit public _sharing', async () => {
		const container = await renderArrangeReady();

		await openCreateForm(container);
		await fireEvent.input(q(container, 'roster-new-section-name') as HTMLElement, {
			target: { value: 'Tenor' }
		});
		await trustedClick(q(container, 'roster-new-section-submit') as HTMLElement);

		await waitFor(() => {
			expect(createPosts()).toHaveLength(1);
		});
		// Full-shape equality — a partial match here is how wire bugs shipped
		// before (#partial-assertions-hide-bugs).
		expect(createPosts()[0]).toEqual([
			{ type: '_type', reference: TYPE_SECTION },
			{ type: '_parent', reference: ORG_EFK },
			{ type: 'name', string: 'Tenor' },
			{ type: '_sharing', string: 'public' },
			{ type: '_inheritrights', boolean: true }
		]);
		// The page knows the org — the data layer must never fall back to the
		// `_type.string=organization&limit=1` guess (umbrella-federation trap).
		expect(calls.some((c) => c.url.includes('_type.string=organization'))).toBe(false);
	});

	it('…and the new section APPEARS: the arrange row renders, titled with the typed name, the success is ANNOUNCED (role=status non-empty), and nothing refetches', async () => {
		const container = await renderArrangeReady();

		await openCreateForm(container);
		await fireEvent.input(q(container, 'roster-new-section-name') as HTMLElement, {
			target: { value: 'Tenor' }
		});
		await trustedClick(q(container, 'roster-new-section-submit') as HTMLElement);

		await waitFor(() => {
			expect(q(container, `arrange-row-${NEW_SECTION_ID}`)).not.toBeNull();
		});
		expect(q(container, `arrange-rename-${NEW_SECTION_ID}`)?.textContent).toContain('Tenor');
		const status = q(container, 'roster-section-create-status');
		expect(status).not.toBeNull();
		expect(status?.getAttribute('role')).toBe('status');
		await waitFor(() => {
			expect(status?.textContent?.trim()).not.toBe('');
		});
		// No refetch — the appearance is local-state insertion (pinned contract).
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
	});
});

// ── F2: SUB-SECTION creation under a parent works on the live shape ─────────────

describe('/roster #124 F2 — sub-section creation under a parent section (re-driven through roster-new-section per #470)', () => {
	it('name + parent "Soprano" submitted through real tap timing: the create POST carries _parent = the SOPRANO SECTION id, and the new arrange row renders at data-depth 1', async () => {
		const container = await renderArrangeReady();

		await openCreateForm(container);
		await fireEvent.input(q(container, 'roster-new-section-name') as HTMLElement, {
			target: { value: 'Soprano II' }
		});
		await fireEvent.change(q(container, 'roster-new-section-parent') as HTMLElement, {
			target: { value: EFK_SOPRANO }
		});
		await trustedClick(q(container, 'roster-new-section-submit') as HTMLElement);

		expect(q(container, 'roster-new-section-error')).toBeNull();
		await waitFor(() => {
			expect(createPosts()).toHaveLength(1);
		});
		expect(createPosts()[0]).toEqual([
			{ type: '_type', reference: TYPE_SECTION },
			{ type: '_parent', reference: EFK_SOPRANO },
			{ type: 'name', string: 'Soprano II' },
			{ type: '_sharing', string: 'public' },
			{ type: '_inheritrights', boolean: true }
		]);

		await waitFor(() => {
			expect(q(container, `arrange-row-${NEW_SECTION_ID}`)).not.toBeNull();
		});
		expect(q(container, `arrange-row-${NEW_SECTION_ID}`)?.getAttribute('data-depth')).toBe('1');
	});
});

// (*MVOX:Tallis* — #124 RED, gate #114 F1/F2: the create path end-to-end under
//  trusted-event timing, real write layer, live shape)
// (*MVOX:Tallis* — #470: re-driven through the page-level roster-new-section
//  entry; the picker create path is retired)
