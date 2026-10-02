// @vitest-environment happy-dom
// The /roster page's native section picker, on the real page.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy(
		{},
		{
			get:
				(_target, key) =>
				(params?: Record<string, unknown>) =>
					params && Object.keys(params).length > 0
						? `${String(key)} ${JSON.stringify(params)}`
						: String(key)
		}
	)
}));

const { loadRosterMock, listSectionsMock, entuFetchMock } = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	entuFetchMock: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
vi.mock('$lib/entu/request', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/entu/request')>();
	return { ...actual, entuFetch: entuFetchMock };
});
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import type { SectionNode } from '$lib/sections/sectionData';
import type { RosterRow } from '$lib/roster/rosterData';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin, type AdminState } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures';

function fixtureTree(): SectionNode[] {
	const sop1: SectionNode = {
		id: 'sec-sop1',
		name: 'Soprano 1',
		displayOrder: 1,
		parentId: 'sec-sop',
		depth: 1,
		children: []
	};
	return [
		{ id: 'sec-sop', name: 'Soprano', displayOrder: 1, parentId: null, depth: 0, children: [sop1] },
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, depth: 0, children: [] }
	];
}

function fixtureRows(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'], ownerIds: ['person-db-owner', 'person-p'] },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: '', sectionIds: ['sec-alto'], ownerIds: ['person-db-owner', 'person-p'] },
		{ memberId: 'm-pete', personId: 'p-pete', name: 'Pete Wilson', email: 'pete@x.com', sectionIds: [], ownerIds: ['person-db-owner', 'person-p'] },
		{ memberId: 'm-multi', personId: 'p-multi', name: 'Mia Multi', email: 'mia@x.com', sectionIds: ['sec-sop', 'sec-alto'], ownerIds: ['person-db-owner', 'person-p'] }
	];
}

function gateRows(): RosterRow[] {
	return [
		{ memberId: 'm-owned', personId: 'p-owned', name: 'Otto Owned', email: 'otto@x.com', sectionIds: ['sec-sop'], ownerIds: ['person-db-owner', 'person-p'] },
		{ memberId: 'm-foreign', personId: 'p-foreign', name: 'Fanny Foreign', email: 'fanny@x.com', sectionIds: ['sec-alto'], ownerIds: ['person-db-owner'] },
		{ memberId: 'm-withheld', personId: 'p-withheld', name: 'Willa Withheld', email: 'willa@x.com', sectionIds: [], ownerIds: [] }
	];
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

interface WireCall {
	db: string;
	path: string;
	token: string;
	method: string;
	body: unknown;
}

const wire: WireCall[] = [];

const JSON_HEADERS = { 'Content-Type': 'application/json' };

let parentValuesByMember: Record<
	string,
	Array<{ _id: string; reference: string; entity_type: string }>
> = {};

function defaultRouter(call: WireCall): Response | Promise<Response> {
	if (call.method === 'GET' && /^entity\/[^/?]+\?props=_parent$/.test(call.path)) {
		const memberId = call.path.slice('entity/'.length).split('?')[0];
		return json({ entity: { _parent: parentValuesByMember[memberId] ?? [] } }, 200, JSON_HEADERS);
	}
	if (call.method === 'POST') return json({ _id: 'prop-appended' }, 200, JSON_HEADERS);
	if (call.method === 'DELETE') return json({ deleted: true }, 200, JSON_HEADERS);
	return json({ entities: [], count: 0 }, 200, JSON_HEADERS);
}

let router: (call: WireCall) => Response | Promise<Response>;

const posts = () => wire.filter((c) => c.method === 'POST');
const deletes = () => wire.filter((c) => c.method === 'DELETE');
const parentGets = () =>
	wire.filter((c) => c.method === 'GET' && c.path.includes('props=_parent'));

beforeEach(() => {
	wire.length = 0;
	router = defaultRouter;
	parentValuesByMember = {
		'm-ada': [
			{ _id: 'pv-ada-org', reference: 'org-1', entity_type: 'database' },
			{ _id: 'pv-ada-sop', reference: 'sec-sop', entity_type: 'section' }
		],
		'm-bea': [
			{ _id: 'pv-bea-org', reference: 'org-1', entity_type: 'database' },
			{ _id: 'pv-bea-alto', reference: 'sec-alto', entity_type: 'section' }
		],
		'm-multi': [
			{ _id: 'pv-multi-org', reference: 'org-1', entity_type: 'database' },
			{ _id: 'pv-multi-sop', reference: 'sec-sop', entity_type: 'section' },
			{ _id: 'pv-multi-alto', reference: 'sec-alto', entity_type: 'section' }
		]
	};
	entuFetchMock.mockImplementation(
		(db: string, path: string, token: string, opts: RequestInit = {}) => {
			const call: WireCall = {
				db,
				path,
				token,
				method: opts.method ?? 'GET',
				body: typeof opts.body === 'string' ? JSON.parse(opts.body) : null
			};
			wire.push(call);
			return Promise.resolve(router(call));
		}
	);
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue(fixtureTree());
});

afterEach(() => {
	cleanup();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	entuFetchMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetAdmin();
});

async function renderReady(admin: AdminState = 'admin') {
	setAuthedWithOneCollective();
	adminStore.set(admin);
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="roster-groups"]')).not.toBeNull();
	});
	const toggleAll = container.querySelector(
		'[data-testid="roster-view-chip-expanded"]'
	) as HTMLElement | null;
	if (toggleAll) {
		await fireEvent.click(toggleAll);
		await waitFor(() => {
			expect(container.querySelector('[data-testid^="roster-row-"]')).not.toBeNull();
		});
	}
	return container;
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function sel(
	container: HTMLElement,
	memberId: string,
	sectionId: string
): HTMLSelectElement | null {
	return q(container, `section-picker-select-${memberId}-${sectionId}`) as HTMLSelectElement | null;
}

function addBtn(container: HTMLElement, memberId: string): HTMLButtonElement | null {
	return q(container, `section-picker-add-${memberId}`) as HTMLButtonElement | null;
}

function memberControls(container: HTMLElement, memberId: string): Array<HTMLSelectElement | HTMLButtonElement> {
	return Array.from(
		container.querySelectorAll<HTMLSelectElement | HTMLButtonElement>(
			`[data-testid^="section-picker-select-${memberId}-"], [data-testid="section-picker-add-${memberId}"]`
		)
	);
}

function allFrozen(els: Array<HTMLSelectElement | HTMLButtonElement>): boolean {
	return els.length > 0 && els.every((el) => el.disabled);
}

function allUsable(els: Array<HTMLSelectElement | HTMLButtonElement>): boolean {
	return els.length > 0 && els.every((el) => !el.disabled);
}

async function openBlank(container: HTMLElement, memberId: string): Promise<HTMLSelectElement> {
	const add = addBtn(container, memberId);
	expect(add, `the [+] for ${memberId}`).not.toBeNull();
	await fireEvent.click(add as HTMLElement);
	await waitFor(() => {
		expect(sel(container, memberId, 'blank')).not.toBeNull();
	});
	return sel(container, memberId, 'blank') as HTMLSelectElement;
}

describe('/roster — section-control owner gate (#468, integration: actual page route)', () => {
	function controlsIn(row: HTMLElement | null): number {
		return row ? row.querySelectorAll('[data-testid^="section-picker-"]').length : 0;
	}

	it("a row whose ownerIds carry the reader's person id renders section controls INSIDE that row — even with adminStore 'not-admin' (the grant decides, not the role)", async () => {
		loadRosterMock.mockResolvedValue(toListRead(gateRows()));
		const container = await renderReady('not-admin');
		const row = q(container, 'roster-row-m-owned');
		expect(row, 'owned row renders').not.toBeNull();
		expect(controlsIn(row), 'controls inside the owned row').toBeGreaterThan(0);
		expect(controlsIn(q(container, 'roster-row-m-foreign'))).toBe(0);
		expect(controlsIn(q(container, 'roster-row-m-withheld'))).toBe(0);
	});

	it("a row WITHOUT the reader in ownerIds renders NO section control even with adminStore 'admin'", async () => {
		loadRosterMock.mockResolvedValue(toListRead(gateRows()));
		const container = await renderReady('admin');
		expect(controlsIn(q(container, 'roster-row-m-foreign'))).toBe(0);
		expect(controlsIn(q(container, 'roster-row-m-owned'))).toBeGreaterThan(0);
	});

	it('ownerIds: [] (withheld private bucket) → NO control, fail closed', async () => {
		loadRosterMock.mockResolvedValue(toListRead(gateRows()));
		const container = await renderReady('admin');
		expect(controlsIn(q(container, 'roster-row-m-withheld'))).toBe(0);
	});

	it('sectionsError still hides the controls even for a reader who holds _owner on the row', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		listSectionsMock.mockRejectedValue(new Error('sections boom'));
		loadRosterMock.mockResolvedValue(toListRead(gateRows()));
		setAuthedWithOneCollective();
		adminStore.set('not-admin');
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-flat-list"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid^="section-picker-"]')).toBeNull();
		consoleSpy.mockRestore();
	});
});

describe('/roster — control position (#468): upper right on the card, lifted by tree order alone', () => {
	function pickerWrapper(container: HTMLElement, memberId: string): HTMLElement {
		const li = q(container, `roster-row-${memberId}`) as HTMLElement;
		expect(li, `row li ${memberId}`).not.toBeNull();
		const control = li.querySelector('[data-testid^="section-picker-"]') as HTMLElement;
		expect(control, `section control in ${memberId}`).not.toBeNull();
		let wrapper: HTMLElement = control;
		while (wrapper.parentElement && wrapper.parentElement !== li) wrapper = wrapper.parentElement;
		expect(wrapper.parentElement, 'wrapper is a direct child of the row <li>').toBe(li);
		return wrapper;
	}

	it('the wrapper is `absolute top-1 right-1` with NO z- class, and FOLLOWS the roster-row-card activator in tree order inside the same (already-relative) <li>', async () => {
		const container = await renderReady('admin');
		const li = q(container, 'roster-row-m-ada') as HTMLElement;
		const wrapper = pickerWrapper(container, 'm-ada');
		const classes = wrapper.className.split(/\s+/);
		expect(classes).toContain('absolute');
		expect(classes).toContain('top-1');
		expect(classes).toContain('right-1');
		expect(classes.some((c) => c.startsWith('z-'))).toBe(false);
		expect(li.className.split(/\s+/)).toContain('relative');
		const card = q(container, 'roster-row-card-m-ada') as HTMLElement;
		expect(card, 'collapsed card activator').not.toBeNull();
		expect(
			card.compareDocumentPosition(wrapper) & Node.DOCUMENT_POSITION_FOLLOWING,
			'the lifted wrapper must FOLLOW the activator in tree order'
		).toBeTruthy();
		expect(li.contains(card)).toBe(true);
		expect(li.contains(wrapper)).toBe(true);
	});

	it('a row WITHOUT the controls still shows the section name in rowInfo (flat view) — nothing else on the card moves', async () => {
		loadRosterMock.mockResolvedValue(toListRead(gateRows()));
		const container = await renderReady('admin');
		await fireEvent.click(q(container, 'roster-sort-toggle') as HTMLElement);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-flat-list"]')).not.toBeNull();
		});
		const li = q(container, 'roster-row-m-foreign') as HTMLElement;
		expect(li).not.toBeNull();
		const section = li.querySelector('[data-testid="roster-row-section"]');
		expect(section, 'section name text stays in rowInfo').not.toBeNull();
		expect(section?.textContent).toContain('Alto');
		expect(li.querySelector('[data-testid^="section-picker-"]')).toBeNull();
	});
});

describe('/roster — assign via the blank picker (#470)', () => {
	it('choosing a section POSTs entity/{memberId} with the single _parent reference; the row moves and shows the NEW select IMMEDIATELY (write pending, that member frozen); on success it stays, unfreezes, and loadRoster is NOT refetched', async () => {
		const post = deferred<Response>();
		router = (call) => (call.method === 'POST' ? post.promise : defaultRouter(call));
		const container = await renderReady();

		const blank = await openBlank(container, 'm-pete');
		await fireEvent.change(blank, { target: { value: 'sec-alto' } });

		expect(posts()).toHaveLength(1);
		expect(posts()[0]).toMatchObject({ db: 'sampledb', path: 'entity/m-pete', token: 'jwt-abc' });
		expect(posts()[0].body).toEqual([{ type: '_parent', reference: 'sec-alto' }]);

		await waitFor(() => {
			expect(sel(container, 'm-pete', 'sec-alto')).not.toBeNull();
		});
		expect(
			q(container, 'section-group-sec-alto')?.querySelector('[data-testid="roster-row-m-pete"]')
		).not.toBeNull();
		expect(
			q(container, 'section-group-unassigned')?.querySelector('[data-testid="roster-row-m-pete"]') ??
				null
		).toBeNull();
		expect(allFrozen(memberControls(container, 'm-pete'))).toBe(true);

		post.resolve(json({ _id: 'prop-appended' }, 200, JSON_HEADERS));
		await waitFor(() => {
			expect(allUsable(memberControls(container, 'm-pete'))).toBe(true);
		});
		expect(
			q(container, 'section-group-sec-alto')?.querySelector('[data-testid="roster-row-m-pete"]')
		).not.toBeNull();
		expect(q(container, 'section-write-error-m-pete')).toBeNull();
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
	});

	it('a blank picker left at Määramata writes NOTHING — no POST, no DELETE, no unassign lookup, no select invented', async () => {
		const container = await renderReady();
		const blank = await openBlank(container, 'm-pete');

		await fireEvent.change(blank, { target: { value: '' } });

		expect(posts()).toHaveLength(0);
		expect(deletes()).toHaveLength(0);
		expect(parentGets()).toHaveLength(0);
		expect(
			container.querySelectorAll('[data-testid^="section-picker-select-m-pete-"]:not([data-testid$="-blank"])')
		).toHaveLength(0);
	});

	it('assign FAILURE (403) → the optimistic membership is taken back (row returns to Unassigned, the new select goes) AND the section-write banner shows — never console-only', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		router = (call) => (call.method === 'POST' ? json({}, 403, JSON_HEADERS) : defaultRouter(call));
		const container = await renderReady();

		const blank = await openBlank(container, 'm-pete');
		await fireEvent.change(blank, { target: { value: 'sec-alto' } });

		const banner = await waitFor(() => {
			const el = q(container, 'section-write-error-m-pete');
			expect(el, 'the failure must be SAID').not.toBeNull();
			return el as HTMLElement;
		});
		expect(banner.getAttribute('role')).toBe('alert');
		await waitFor(() => {
			expect(sel(container, 'm-pete', 'sec-alto')).toBeNull();
		});
		expect(
			q(container, 'section-group-unassigned')?.querySelector('[data-testid="roster-row-m-pete"]')
		).not.toBeNull();
		expect(
			q(container, 'section-group-sec-alto')?.querySelector('[data-testid="roster-row-m-pete"]') ??
				null
		).toBeNull();
		consoleSpy.mockRestore();
	});
});

describe('/roster — unassign via Määramata (#470)', () => {
	it('GET entity/{memberId}?props=_parent then DELETE property/{valueId}; the chosen picker STAYS, frozen, while the DELETE is pending and goes away only once it lands (done-when 4); no banner', async () => {
		const del = deferred<Response>();
		router = (call) => (call.method === 'DELETE' ? del.promise : defaultRouter(call));
		const container = await renderReady();

		const held = sel(container, 'm-multi', 'sec-sop');
		expect(held, "Mia's Soprano select").not.toBeNull();
		await fireEvent.change(held as HTMLElement, { target: { value: '' } });

		await waitFor(() => {
			expect(deletes()).toHaveLength(1);
		});
		expect(parentGets().some((c) => c.path === 'entity/m-multi?props=_parent')).toBe(true);
		expect(deletes()[0].path).toBe('property/pv-multi-sop');
		const pending = sel(container, 'm-multi', 'sec-sop');
		expect(pending, 'the chosen picker is still there while Entu syncs').not.toBeNull();
		expect(pending!.value).toBe('sec-sop');
		expect(sel(container, 'm-multi', 'sec-alto'), 'the other membership stays visible').not.toBeNull();
		expect(allFrozen(memberControls(container, 'm-multi'))).toBe(true);
		expect(
			q(container, 'section-group-sec-sop')?.querySelector('[data-testid="roster-row-m-multi"]'),
			'she is still in Soprano until the DELETE lands'
		).not.toBeNull();

		del.resolve(json({ deleted: true }, 200, JSON_HEADERS));
		await waitFor(() => {
			expect(sel(container, 'm-multi', 'sec-sop')).toBeNull();
		});
		await waitFor(() => {
			expect(allUsable(memberControls(container, 'm-multi'))).toBe(true);
		});
		expect(
			q(container, 'section-group-sec-sop')?.querySelector('[data-testid="roster-row-m-multi"]') ??
				null
		).toBeNull();
		expect(q(container, 'section-write-error-m-multi')).toBeNull();
	});

	it('membership ALREADY GONE server-side (no matching _parent value) → the removal STICKS, no DELETE fires, NO banner — server and UI already agree', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		parentValuesByMember['m-ada'] = [
			{ _id: 'pv-ada-org', reference: 'org-1', entity_type: 'database' }
		];
		const container = await renderReady();

		await fireEvent.change(sel(container, 'm-ada', 'sec-sop') as HTMLElement, {
			target: { value: '' }
		});

		await waitFor(() => {
			expect(sel(container, 'm-ada', 'sec-sop')).toBeNull();
		});
		await waitFor(() => {
			expect(
				q(container, 'section-group-unassigned')?.querySelector('[data-testid="roster-row-m-ada"]')
			).not.toBeNull();
		});
		await waitFor(() => {
			expect(allUsable(memberControls(container, 'm-ada'))).toBe(true);
		});
		expect(deletes()).toHaveLength(0);
		expect(q(container, 'section-write-error-m-ada')).toBeNull();
		consoleSpy.mockRestore();
	});

	it('a REAL unassign failure (DELETE 403) → the membership NEVER LEFT: the same select is still there, still reading its section, the row never flicked out of its group + the banner shows', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		router = (call) => (call.method === 'DELETE' ? json({}, 403, JSON_HEADERS) : defaultRouter(call));
		const container = await renderReady();

		const held = sel(container, 'm-ada', 'sec-sop') as HTMLSelectElement;
		await fireEvent.change(held, { target: { value: '' } });

		await waitFor(() => {
			expect(q(container, 'section-write-error-m-ada')).not.toBeNull();
		});
		expect(q(container, 'section-write-error-m-ada')?.textContent).toContain(
			'roster_section_write_failed'
		);
		expect(q(container, 'section-write-error-m-ada')?.textContent).not.toContain('assign_failed');
		expect(sel(container, 'm-ada', 'sec-sop'), 'the very same select').toBe(held);
		expect(held.value, 'and it still reads the section she is still in').toBe('sec-sop');
		expect(
			q(container, 'section-group-sec-sop')?.querySelector('[data-testid="roster-row-m-ada"]')
		).not.toBeNull();
		expect(
			q(container, 'section-group-unassigned')?.querySelector(
				'[data-testid="roster-row-m-ada"]'
			) ?? null
		).toBeNull();
		consoleSpy.mockRestore();
	});
});

describe('/roster — move S1→S2 (#470): the POST resolves BEFORE the DELETE is issued', () => {
	it('holding the POST holds the whole move: no lookup, no DELETE, row unchanged; resolving it releases GET+DELETE in order; final state = only the new membership', async () => {
		const post = deferred<Response>();
		router = (call) => (call.method === 'POST' ? post.promise : defaultRouter(call));
		const container = await renderReady();

		await fireEvent.change(sel(container, 'm-ada', 'sec-sop') as HTMLElement, {
			target: { value: 'sec-alto' }
		});

		await waitFor(() => {
			expect(posts()).toHaveLength(1);
		});
		expect(posts()[0].path).toBe('entity/m-ada');
		expect(posts()[0].body).toEqual([{ type: '_parent', reference: 'sec-alto' }]);
		expect(parentGets()).toHaveLength(0);
		expect(deletes()).toHaveLength(0);
		expect(sel(container, 'm-ada', 'sec-alto'), 'nothing changed while the add is pending').toBeNull();

		post.resolve(json({ _id: 'prop-appended' }, 200, JSON_HEADERS));
		await waitFor(() => {
			expect(deletes()).toHaveLength(1);
		});
		expect(deletes()[0].path).toBe('property/pv-ada-sop');
		const postIdx = wire.findIndex((c) => c.method === 'POST');
		const getIdx = wire.findIndex(
			(c) => c.method === 'GET' && c.path === 'entity/m-ada?props=_parent'
		);
		const delIdx = wire.findIndex((c) => c.method === 'DELETE');
		expect(postIdx).toBeGreaterThanOrEqual(0);
		expect(getIdx).toBeGreaterThan(postIdx);
		expect(delIdx).toBeGreaterThan(getIdx);

		await waitFor(() => {
			expect(sel(container, 'm-ada', 'sec-alto')).not.toBeNull();
		});
		await waitFor(() => {
			expect(sel(container, 'm-ada', 'sec-sop')).toBeNull();
		});
		expect(
			q(container, 'section-group-sec-alto')?.querySelector('[data-testid="roster-row-m-ada"]')
		).not.toBeNull();
		expect(
			q(container, 'section-group-sec-sop')?.querySelector('[data-testid="roster-row-m-ada"]') ??
				null
		).toBeNull();
		expect(q(container, 'section-write-error-m-ada')).toBeNull();
	});

	it('move with a FAILED add (POST 403) → NOTHING changed: no lookup, no DELETE, she stays exactly where she was — and the banner says so', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		router = (call) => (call.method === 'POST' ? json({}, 403, JSON_HEADERS) : defaultRouter(call));
		const container = await renderReady();

		await fireEvent.change(sel(container, 'm-ada', 'sec-sop') as HTMLElement, {
			target: { value: 'sec-alto' }
		});

		await waitFor(() => {
			expect(q(container, 'section-write-error-m-ada')).not.toBeNull();
		});
		expect(parentGets()).toHaveLength(0);
		expect(deletes()).toHaveLength(0);
		expect(sel(container, 'm-ada', 'sec-sop')).not.toBeNull();
		expect(sel(container, 'm-ada', 'sec-alto')).toBeNull();
		expect(
			q(container, 'section-group-sec-sop')?.querySelector('[data-testid="roster-row-m-ada"]')
		).not.toBeNull();
		expect(
			q(container, 'section-group-sec-alto')?.querySelector('[data-testid="roster-row-m-ada"]') ??
				null
		).toBeNull();
		consoleSpy.mockRestore();
	});

	it('move with a FAILED delete → she stays visibly in BOTH sections (never in none) + the banner shows', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		router = (call) => (call.method === 'DELETE' ? json({}, 403, JSON_HEADERS) : defaultRouter(call));
		const container = await renderReady();

		await fireEvent.change(sel(container, 'm-ada', 'sec-sop') as HTMLElement, {
			target: { value: 'sec-alto' }
		});

		await waitFor(() => {
			expect(q(container, 'section-write-error-m-ada')).not.toBeNull();
		});
		expect(sel(container, 'm-ada', 'sec-sop')).not.toBeNull();
		expect(sel(container, 'm-ada', 'sec-alto')).not.toBeNull();
		expect(
			q(container, 'section-group-sec-sop')?.querySelector('[data-testid="roster-row-m-ada"]')
		).not.toBeNull();
		expect(
			q(container, 'section-group-sec-alto')?.querySelector('[data-testid="roster-row-m-ada"]')
		).not.toBeNull();
		consoleSpy.mockRestore();
	});
});

describe('/roster — after a refused write the select still shows the membership it represents (#470 F1)', () => {
	it('move FAILURE (POST 403): the select snaps back to Soprano — state and screen agree — and the retry the banner invites goes through', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		router = (call) => (call.method === 'POST' ? json({}, 403, JSON_HEADERS) : defaultRouter(call));
		const container = await renderReady();

		const held = sel(container, 'm-ada', 'sec-sop') as HTMLSelectElement;
		await fireEvent.change(held, { target: { value: 'sec-alto' } });

		await waitFor(() => {
			expect(q(container, 'section-write-error-m-ada')).not.toBeNull();
		});
		expect(held.value, 'the select re-asserts the membership it represents').toBe('sec-sop');
		expect(held.selectedOptions[0]?.textContent?.trim()).toBe('Soprano');
		expect(
			q(container, 'section-group-sec-sop')?.querySelector('[data-testid="roster-row-m-ada"]')
		).not.toBeNull();

		expect(posts()).toHaveLength(1);
		await fireEvent.change(held, { target: { value: 'sec-alto' } });
		await waitFor(() => {
			expect(posts()).toHaveLength(2);
		});
		expect(posts()[1].body).toEqual([{ type: '_parent', reference: 'sec-alto' }]);
		consoleSpy.mockRestore();
	});

	it('move with a FAILED delete: she is in BOTH sections, and BOTH selects read their own section (the old one is not left pointing at the new)', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		router = (call) => (call.method === 'DELETE' ? json({}, 403, JSON_HEADERS) : defaultRouter(call));
		const container = await renderReady();

		await fireEvent.change(sel(container, 'm-ada', 'sec-sop') as HTMLElement, {
			target: { value: 'sec-alto' }
		});

		await waitFor(() => {
			expect(q(container, 'section-write-error-m-ada')).not.toBeNull();
		});
		await waitFor(() => {
			expect(sel(container, 'm-ada', 'sec-alto')).not.toBeNull();
		});
		expect(sel(container, 'm-ada', 'sec-sop')!.value).toBe('sec-sop');
		expect(sel(container, 'm-ada', 'sec-alto')!.value).toBe('sec-alto');
		consoleSpy.mockRestore();
	});
});

describe('/roster — the freeze is scoped to the syncing member alone (#470)', () => {
	it("while one member's DELETE is pending, ANOTHER member's controls stay enabled", async () => {
		const del = deferred<Response>();
		router = (call) => (call.method === 'DELETE' ? del.promise : defaultRouter(call));
		const container = await renderReady();

		await fireEvent.change(sel(container, 'm-multi', 'sec-sop') as HTMLElement, {
			target: { value: '' }
		});
		await waitFor(() => {
			expect(deletes()).toHaveLength(1);
		});
		expect(allFrozen(memberControls(container, 'm-multi')), "Mia's controls freeze").toBe(true);
		expect(allUsable(memberControls(container, 'm-ada')), "Ada's controls stay usable").toBe(true);
		expect(allUsable(memberControls(container, 'm-bea')), "Bea's controls stay usable").toBe(true);

		del.resolve(json({ deleted: true }, 200, JSON_HEADERS));
		await waitFor(() => {
			expect(allUsable(memberControls(container, 'm-multi'))).toBe(true);
		});
	});
});

describe('/roster — a group card shows ITS OWN membership, not every membership the member holds (#470 F2)', () => {
	function cardIn(container: HTMLElement, groupId: string, memberId: string): HTMLElement {
		const group = q(container, `section-group-${groupId}`);
		expect(group, `group ${groupId}`).not.toBeNull();
		const row = (group as HTMLElement).querySelector(
			`[data-testid="roster-row-${memberId}"]`
		) as HTMLElement | null;
		expect(row, `${memberId}'s card in ${groupId}`).not.toBeNull();
		return row as HTMLElement;
	}

	function selectIdsIn(card: HTMLElement): string[] {
		return Array.from(
			card.querySelectorAll<HTMLElement>('[data-testid^="section-picker-select-"]')
		).map((el) => el.getAttribute('data-testid') ?? '');
	}

	it("Mia's Soprano card carries her Soprano select and the [+] — nothing of her Alto membership; her Alto card is the mirror image", async () => {
		const container = await renderReady();

		const sopCard = cardIn(container, 'sec-sop', 'm-multi');
		expect(selectIdsIn(sopCard)).toEqual(['section-picker-select-m-multi-sec-sop']);
		expect(
			sopCard.querySelectorAll('[data-testid="section-picker-add-m-multi"]').length,
			'the [+] adds a membership, so it rides on every card'
		).toBe(1);

		const altoCard = cardIn(container, 'sec-alto', 'm-multi');
		expect(selectIdsIn(altoCard)).toEqual(['section-picker-select-m-multi-sec-alto']);
		expect(altoCard.querySelectorAll('[data-testid="section-picker-add-m-multi"]').length).toBe(1);

		for (const testid of [
			'section-picker-select-m-multi-sec-sop',
			'section-picker-select-m-multi-sec-alto'
		]) {
			expect(container.querySelectorAll(`[data-testid="${testid}"]`).length, testid).toBe(1);
		}
	});

	it('the FLAT list is the unscoped view: ONE card for Mia carrying BOTH her memberships plus the [+]', async () => {
		const container = await renderReady();
		await fireEvent.click(q(container, 'roster-sort-toggle') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'roster-flat-list')).not.toBeNull();
		});

		const rows = Array.from(
			container.querySelectorAll<HTMLElement>('[data-testid="roster-row-m-multi"]')
		);
		expect(rows.length, 'one card only, off the section grouping').toBe(1);
		expect(selectIdsIn(rows[0]).sort()).toEqual([
			'section-picker-select-m-multi-sec-alto',
			'section-picker-select-m-multi-sec-sop'
		]);
		expect(rows[0].querySelectorAll('[data-testid="section-picker-add-m-multi"]').length).toBe(1);
	});

	it('an unassign fired from the Soprano card takes only THAT membership: her Alto card (and its select) stay exactly where they were', async () => {
		const container = await renderReady();
		const fromSop = cardIn(container, 'sec-sop', 'm-multi').querySelector(
			'[data-testid="section-picker-select-m-multi-sec-sop"]'
		) as HTMLSelectElement;

		await fireEvent.change(fromSop, { target: { value: '' } });

		await waitFor(() => {
			expect(
				q(container, 'section-group-sec-sop')?.querySelector(
					'[data-testid="roster-row-m-multi"]'
				) ?? null
			).toBeNull();
		});
		const altoCard = cardIn(container, 'sec-alto', 'm-multi');
		expect(selectIdsIn(altoCard)).toEqual(['section-picker-select-m-multi-sec-alto']);
		expect(q(container, 'section-write-error-m-multi')).toBeNull();
	});

	function optionValues(select: HTMLSelectElement): string[] {
		return Array.from(select.querySelectorAll('option')).map((o) => o.value);
	}

	it("Mia's Soprano card offers Soprano and the free Soprano 1 only — her Alto membership is excluded even though this card never draws it", async () => {
		const container = await renderReady();

		const sopSelect = cardIn(container, 'sec-sop', 'm-multi').querySelector(
			'[data-testid="section-picker-select-m-multi-sec-sop"]'
		) as HTMLSelectElement;
		expect(optionValues(sopSelect)).toEqual(['', 'sec-sop', 'sec-sop1']);

		const altoSelect = cardIn(container, 'sec-alto', 'm-multi').querySelector(
			'[data-testid="section-picker-select-m-multi-sec-alto"]'
		) as HTMLSelectElement;
		expect(optionValues(altoSelect)).toEqual(['', 'sec-sop1', 'sec-alto']);

		expect(optionValues(sel(container, 'm-ada', 'sec-sop') as HTMLSelectElement)).toEqual([
			'',
			'sec-sop',
			'sec-sop1',
			'sec-alto'
		]);
	});

	it('the [+] on a group card offers only the section she is in NEITHER of — and no control anywhere can re-pick a section she already holds', async () => {
		const container = await renderReady();

		const sopCard = cardIn(container, 'sec-sop', 'm-multi');
		await fireEvent.click(
			sopCard.querySelector('[data-testid="section-picker-add-m-multi"]') as HTMLElement
		);
		const blank = await waitFor(() => {
			const el = sopCard.querySelector(
				'[data-testid="section-picker-select-m-multi-blank"]'
			) as HTMLSelectElement | null;
			expect(el, 'the [+] opened a blank picker on this card').not.toBeNull();
			return el as HTMLSelectElement;
		});
		expect(optionValues(blank)).toEqual(['', 'sec-sop1']);

		const held = ['sec-sop', 'sec-alto'];
		const offendingOptions = Array.from(
			container.querySelectorAll<HTMLSelectElement>(
				'[data-testid^="section-picker-select-m-multi-"]'
			)
		).flatMap((select) =>
			optionValues(select)
				.filter((value) => held.includes(value) && value !== select.value)
				.map((value) => `${select.getAttribute('data-testid')} → ${value}`)
		);
		expect(offendingOptions).toEqual([]);
		expect(
			container.querySelectorAll('[data-testid^="section-picker-select-m-multi-"]').length,
			'two held selects + the open blank one — the sweep above saw all three'
		).toBe(3);
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Palestrina*)
// (*MVOX:Josquin*)
