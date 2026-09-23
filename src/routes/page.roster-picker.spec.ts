// @vitest-environment happy-dom
//
// #470 RED — the /roster page's NATIVE SECTION PICKER wiring (integration).
// These tests render the ACTUAL page route component ("partial assertions hide
// bugs": a unit-covered SectionPicker with nothing joining it to the page ships
// an unreachable feature). `groupBySection` runs REAL, and — new this slice —
// so do assignMemberSection/unassignMemberSection: the WIRE is the seam
// (`entuFetch` stubbed), because the contract under test is a wire-ORDER
// contract (a move's POST must resolve before its DELETE is issued), which a
// mocked sectionActions call log cannot pin.
//
// Pinned wiring contract (GREEN must implement):
//   - OWNER GATE (#468 — NOT touched by #470): the controls render on a member
//     row ONLY when `row.ownerIds` contain the reader's person id
//     (`selected?.personId`); `ownerIds: []` fails closed; `!sectionsError`
//     stays. Asserted here by testid PREFIX so the gate pin is agnostic to the
//     control's inner shape.
//   - POSITION (#468 — NOT touched): wrapper `absolute top-1 right-1`, no
//     z-index, written after the card activator inside the same relative <li>.
//   - ASSIGN (blank picker → section): `POST entity/{memberId}` with the single
//     `_parent` reference; optimistic — the row moves and shows the NEW select
//     immediately; that member's controls are FROZEN (disabled) until the write
//     lands; failure takes the membership back AND says so on the section-write
//     banner (today's path only console.errors — the fail-loudly gap).
//   - UNASSIGN (held picker → Määramata): GET `entity/{memberId}?props=_parent`
//     + `DELETE property/{valueId}`; NOT optimistic — done-when 4 (Mihkel: "the
//     controls get freezed while entu syncs. as soon as synced, the unassigned
//     picker goes away"): that member's controls freeze with the chosen picker
//     STILL THERE, and it disappears only once the DELETE lands;
//     SectionMembershipMissing = the server already agrees → removal goes
//     through, NO banner; a real failure leaves the membership exactly where it
//     was (it never left) + banner.
//   - MOVE (held picker → another section): assign S2 FIRST, then unassign S1
//     (Gama). A failed add changes nothing; a failed delete leaves her visibly
//     in BOTH (never in none) — and both failures reach the banner.
//   - The freeze is PER MEMBER: another row stays usable.
//   - A blank picker left at Määramata writes nothing.
//   - No refetch: loadRoster runs exactly once, at load.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
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
// #269 review F1/F2 — /roster calls the OPT-IN real-names producer; the SHARED,
// profile-names-only `loadRoster` belongs to the agenda / event page / admin roles.
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
// The WIRE seam — sectionActions run REAL through this, so the POST/GET/DELETE
// shapes and their ORDER are what the assertions read.
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

// ── fixtures ────────────────────────────────────────────────────────────────────
// Soprano (order 1) ▸ Soprano 1; Alto (order 2). Ada in Soprano, Bea in Alto,
// Pete unassigned, Mia in BOTH roots.

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

// #468 — every default row carries the READER's person id ('person-p') in
// `ownerIds`: under the owner gate the controls only exist on a row the reader
// may actually move.
function fixtureRows(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'], ownerIds: ['person-db-owner', 'person-p'] },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: '', sectionIds: ['sec-alto'], ownerIds: ['person-db-owner', 'person-p'] },
		{ memberId: 'm-pete', personId: 'p-pete', name: 'Pete Wilson', email: 'pete@x.com', sectionIds: [], ownerIds: ['person-db-owner', 'person-p'] },
		{ memberId: 'm-multi', personId: 'p-multi', name: 'Mia Multi', email: 'mia@x.com', sectionIds: ['sec-sop', 'sec-alto'], ownerIds: ['person-db-owner', 'person-p'] }
	];
}

// #468 gate fixtures — one row the reader OWNS, one owned only by somebody
// else, one whose private bucket the read withheld.
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

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

// ── the wire: recorded calls + a per-test-overridable router ────────────────────

interface WireCall {
	db: string;
	path: string;
	token: string;
	method: string;
	body: unknown;
}

const wire: WireCall[] = [];

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

/** The member entities' `_parent` values the unassign GET reads back —
 *  keyed by memberId; value `_id`s are what the DELETEs must target. */
let parentValuesByMember: Record<
	string,
	Array<{ _id: string; reference: string; entity_type: string }>
> = {};

function defaultRouter(call: WireCall): Response | Promise<Response> {
	if (call.method === 'GET' && /^entity\/[^/?]+\?props=_parent$/.test(call.path)) {
		const memberId = call.path.slice('entity/'.length).split('?')[0];
		return json({ entity: { _parent: parentValuesByMember[memberId] ?? [] } });
	}
	if (call.method === 'POST') return json({ _id: 'prop-appended' });
	if (call.method === 'DELETE') return json({ deleted: true });
	return json({ entities: [], count: 0 });
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
	// Sections default COLLAPSED (TU.2/#110 #9) — member rows (and their section
	// controls) only render expanded; this file's concern is the WIRING.
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

/** Every section control this member's row currently offers (selects + [+]). */
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

// ── owner gate (#468 — unchanged by #470; pinned by PREFIX, shape-agnostic) ─────

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

// ── position (#468 — unchanged by #470) ─────────────────────────────────────────

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

// ── assign: blank picker → POST, optimistic + frozen, loud on failure ───────────

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

		// OPTIMISTIC — the write has not resolved, and the row already moved and
		// shows its new per-membership select…
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
		// …FROZEN while Entu syncs (disabled — nothing visual beyond that).
		expect(allFrozen(memberControls(container, 'm-pete'))).toBe(true);

		post.resolve(json({ _id: 'prop-appended' }));
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
		router = (call) => (call.method === 'POST' ? json({}, 403) : defaultRouter(call));
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

// ── unassign: Määramata → GET+DELETE, freeze in between ─────────────────────────

describe('/roster — unassign via Määramata (#470)', () => {
	it('GET entity/{memberId}?props=_parent then DELETE property/{valueId}; the chosen picker STAYS, frozen, while the DELETE is pending and goes away only once it lands (done-when 4); no banner', async () => {
		const del = deferred<Response>();
		router = (call) => (call.method === 'DELETE' ? del.promise : defaultRouter(call));
		const container = await renderReady();

		const held = sel(container, 'm-multi', 'sec-sop');
		expect(held, "Mia's Soprano select").not.toBeNull();
		await fireEvent.change(held as HTMLElement, { target: { value: '' } });

		// Wire: lookup then the targeted delete.
		await waitFor(() => {
			expect(deletes()).toHaveLength(1);
		});
		expect(parentGets().some((c) => c.path === 'entity/m-multi?props=_parent')).toBe(true);
		expect(deletes()[0].path).toBe('property/pv-multi-sop');
		// Mihkel's order: freeze FIRST, disappear after. The chosen picker is still
		// on screen (and still reading Soprano, not a value nothing has written
		// yet), frozen along with every other control on her row.
		const pending = sel(container, 'm-multi', 'sec-sop');
		expect(pending, 'the chosen picker is still there while Entu syncs').not.toBeNull();
		expect(pending!.value).toBe('sec-sop');
		expect(sel(container, 'm-multi', 'sec-alto'), 'the other membership stays visible').not.toBeNull();
		expect(allFrozen(memberControls(container, 'm-multi'))).toBe(true);
		expect(
			q(container, 'section-group-sec-sop')?.querySelector('[data-testid="roster-row-m-multi"]'),
			'she is still in Soprano until the DELETE lands'
		).not.toBeNull();

		del.resolve(json({ deleted: true }));
		// Synced → the unassigned picker goes away, and the freeze lifts.
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
		router = (call) => (call.method === 'DELETE' ? json({}, 403) : defaultRouter(call));
		const container = await renderReady();

		const held = sel(container, 'm-ada', 'sec-sop') as HTMLSelectElement;
		await fireEvent.change(held, { target: { value: '' } });

		await waitFor(() => {
			expect(q(container, 'section-write-error-m-ada')).not.toBeNull();
		});
		// F1 review fix — the COPY, not just the node. The banner used to render
		// `roster_section_assign_failed` ("The section was created, but the member
		// couldn't be added to it."), left over from the retired picker-CREATE
		// flow: on a refused UNASSIGN that tells the user the exact opposite of
		// what she just did, and claims a create that never happened. One neutral
		// key now serves all three writers (the message mock echoes key names).
		expect(q(container, 'section-write-error-m-ada')?.textContent).toContain(
			'roster_section_write_failed'
		);
		expect(q(container, 'section-write-error-m-ada')?.textContent).not.toContain('assign_failed');
		// The SAME element — not a re-mounted replacement: nothing was dropped and
		// put back, so the row never flickered through Unassigned and home again.
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

// ── move: assign FIRST, then unassign (Gama's write order) ──────────────────────

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
		// Nothing of the delete half may exist while the add is unconfirmed —
		// this is the order that can never leave her in NO section.
		expect(parentGets()).toHaveLength(0);
		expect(deletes()).toHaveLength(0);
		expect(sel(container, 'm-ada', 'sec-alto'), 'nothing changed while the add is pending').toBeNull();

		post.resolve(json({ _id: 'prop-appended' }));
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
		router = (call) => (call.method === 'POST' ? json({}, 403) : defaultRouter(call));
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
		router = (call) => (call.method === 'DELETE' ? json({}, 403) : defaultRouter(call));
		const container = await renderReady();

		await fireEvent.change(sel(container, 'm-ada', 'sec-sop') as HTMLElement, {
			target: { value: 'sec-alto' }
		});

		await waitFor(() => {
			expect(q(container, 'section-write-error-m-ada')).not.toBeNull();
		});
		// Visible and fixable: BOTH memberships on screen, not neither.
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

// ── a refused write leaves the control truthful and retryable ───────────────────

describe('/roster — after a refused write the select still shows the membership it represents (#470 F1)', () => {
	it('move FAILURE (POST 403): the select snaps back to Soprano — state and screen agree — and the retry the banner invites goes through', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		router = (call) => (call.method === 'POST' ? json({}, 403) : defaultRouter(call));
		const container = await renderReady();

		const held = sel(container, 'm-ada', 'sec-sop') as HTMLSelectElement;
		await fireEvent.change(held, { target: { value: 'sec-alto' } });

		await waitFor(() => {
			expect(q(container, 'section-write-error-m-ada')).not.toBeNull();
		});
		// The page deliberately patched nothing (she is still in Soprano). The
		// DOM must say the same thing — otherwise the row sits under "Soprano"
		// while its own control reads "Alto".
		expect(held.value, 'the select re-asserts the membership it represents').toBe('sec-sop');
		expect(held.selectedOptions[0]?.textContent?.trim()).toBe('Soprano');
		expect(
			q(container, 'section-group-sec-sop')?.querySelector('[data-testid="roster-row-m-ada"]')
		).not.toBeNull();

		// And because the value really is back on Soprano, choosing Alto again is a
		// genuine change in a real browser (a select whose value is already the
		// target fires no `change` at all — the dead end this pin exists to catch).
		// Here it also has to reach the wire a second time.
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
		router = (call) => (call.method === 'DELETE' ? json({}, 403) : defaultRouter(call));
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

// ── the freeze is per member ────────────────────────────────────────────────────

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

		del.resolve(json({ deleted: true }));
		await waitFor(() => {
			expect(allUsable(memberControls(container, 'm-multi'))).toBe(true);
		});
	});
});


// ── grouped view: one card = one membership (#470 F2 review fix) ───────────────

describe('/roster — a group card shows ITS OWN membership, not every membership the member holds (#470 F2)', () => {
	// `groupBySection` emits one row per membership, so a two-section member gets
	// a card under each of her sections. Handing every card her FULL sectionIds
	// put all her selects on all her cards (4 selects + 2 [+] for Mia), and
	// duplicated the `section-picker-select-<member>-<section>` testids — which
	// `sel()` (a querySelector) then silently read the first of.
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

		// …and so every select testid is document-unique again: `sel()` above reads
		// the one control it names, not whichever copy came first in the DOM.
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
});

// (*MVOX:Tallis* — #470 RED: native per-membership wiring, wire-order move
//  contract, per-member freeze, fail-loudly banner; owner gate + position pins
//  re-derived from #468 shape-agnostically)
// (*MVOX:Palestrina* — #470 review F1/F3: the unassign pin flipped to
//  freeze-then-disappear per done-when 4, and the refused-write suite added —
//  a select that keeps a value nobody wrote is both a lie and a dead end)
// (*MVOX:Palestrina* — #470 review F1/F2: the banner's copy pinned (not just its
//  node) and the grouped-card scope suite added — one card, one membership)
