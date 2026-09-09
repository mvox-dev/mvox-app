// @vitest-environment happy-dom
//
// #91 TR.3 — the WIRING half of repertoire/programme management, and the whole
// reason this file exists: the write layer (repertoireActions) and the renderer
// (RepertoireElement) were each unit-covered while NOTHING joined them to the
// page. `manageRights` never left its 'not-editor' default, so every control
// was unreachable in the running app with 1047 green tests — the exact shape of
// the "partial assertions hide bugs" lesson.
//
// These specs therefore mock only the AGENDA (the event list is not what is
// under test) and stub the network at `fetch`. Everything between a tap and the
// wire — rights resolution, the picker derivations, the write queue, the Entu
// request shapes — runs for real.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get: (_target, key) => () => `[${String(key)}]`
	})
}));

const { loadFullAgendaMock, discoverMock, gotoMock } = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
// $env/dynamic/public is unavailable outside a SvelteKit request context under
// happy-dom; stubbing the base url keeps every real module in play.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
// Supplementary page data, irrelevant here — mocked to keep the fetch router
// focused on the repertoire traffic under test.
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: vi.fn().mockResolvedValue('member-1'),
	listMyRsvps: vi.fn().mockResolvedValue([]),
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
// #288 — resolves (empty): opening the season-create form warms the roster
// cache through this seam; a bare vi.fn()'s undefined broke `.then` on it.
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn(async () => []) }));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn(),
	listMyAttendance: vi.fn().mockResolvedValue([]),
	listAllRsvpsForEvent: vi.fn(),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
}));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

const upcoming = [
	{
		id: 'ev-1',
		name: 'Rehearsal',
		startDatetime: future,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: []
	}
];

function setAuthedWithOneCollective() {
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
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

interface WorldOptions {
	/** Does person-p hold `_editor` on the season? */
	seasonEditor?: boolean;
	/** Does person-p hold `_editor` on ev-1? */
	eventEditor?: boolean;
	/** program_items under ev-1 — empty means the season-repertoire fallback. */
	programItems?: Array<Record<string, unknown>>;
	/** repertoire_items under season-1. */
	repertoireItems?: Array<Record<string, unknown>>;
}

const RI_ACTIVE = {
	_id: 'ri-1',
	name: [{ string: 'Spem in alium' }],
	work: [{ reference: 'work-1' }],
	edition: [{ reference: 'ed-1' }],
	status: [{ string: 'active' }]
};
const RI_RETIRED = {
	_id: 'ri-2',
	name: [{ string: 'Old warhorse' }],
	work: [{ reference: 'work-2' }],
	status: [{ string: 'retired' }]
};

/**
 * The Entu stand-in. Routed by url + method so an assertion can say exactly
 * which wire call a tap produced — the point of this file.
 */
function installWorld(options: WorldOptions = {}) {
	const {
		seasonEditor = true,
		eventEditor = false,
		programItems = [],
		repertoireItems = [RI_ACTIVE, RI_RETIRED]
	} = options;

	// #91 review F1 — rights arrive WITH THE AGENDA now: listSeasons/listEvents
	// ask for `_owner,_editor` (private bucket → absent for a non-grantee, which
	// IS the 'not-editor' signal), so the page derives them with zero extra
	// round-trips. The fetch router below therefore has NO rights route left: a
	// regression back to per-entity probing surfaces as an unrouted 404 here, and
	// as a failure of the "issues NO per-entity rights probe" spec.
	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
		upcoming: [{ ...upcoming[0], editors: eventEditor ? ['person-p'] : [] }],
		recent: [],
		seasonId: 'season-1',
		seasonConductors: [],
		seasonOwners: [],
		seasonEditors: seasonEditor ? ['person-p'] : []
	}));

	const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';

		if (method === 'DELETE') return json({ deleted: true });
		if (method === 'POST') return json({ _id: 'new-1' });

		// Pre-write value-id lookups (GET → POST → DELETE replace semantics).
		if (url.includes('?props=status')) return json({ entity: { status: [{ _id: 'val-status' }] } });
		if (url.includes('?props=edition')) return json({ entity: { edition: [] } });
		if (url.includes('?props=ordinal')) {
			// #264 — the atomic overwrite now reads this `_id` back INTO the write
			// (not just as a DELETE target), so it must be the clean entity id, not
			// the tail of the URL WITH its query string glued on.
			const itemId = url.split('/').pop()?.split('?')[0];
			return json({ entity: { ordinal: [{ _id: `val-${itemId}` }] } });
		}
		if (url.includes('_type.string=entity')) return json({ entities: [{ _id: 'type-1' }] });
		if (url.includes('_type.string=work')) {
			return json({
				entities: [
					{ _id: 'work-1', name: [{ string: 'Spem in alium' }] },
					{ _id: 'work-2', name: [{ string: 'Old warhorse' }] },
					{ _id: 'work-3', name: [{ string: 'Nunc dimittis' }] }
				]
			});
		}
		if (url.includes('_type.string=edition')) {
			return json({
				entities: [
					{
						_id: 'ed-1',
						name: [{ string: '40-part original' }],
						_parent: [{ reference: 'work-1', entity_type: 'work' }]
					},
					{
						_id: 'ed-2',
						name: [{ string: 'Bärenreiter' }],
						_parent: [{ reference: 'work-1', entity_type: 'work' }]
					}
				]
			});
		}
		if (url.includes('_type.string=copy')) return json({ entities: [] });
		if (url.includes('_type.string=program_item')) return json({ entities: programItems });
		if (url.includes('_type.string=repertoire_item')) return json({ entities: repertoireItems });

		return json({ error: `unrouted: ${url}` }, 404);
	});

	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

/** Open the row's Works disclosure and hand back the container. */
async function renderAndExpand() {
	const rendered = render(Page);
	await vi.waitFor(() => {
		expect(rendered.container.querySelector('[data-testid="works-line"]')).not.toBeNull();
	});
	await fireEvent.click(rendered.container.querySelector('[data-testid="works-line"]')!);
	return rendered;
}

/**
 * The status a named work row RENDERS (`data-status` on the <li>).
 *
 * Deliberately not the <select>'s `value`: `fireEvent.change(select, { target:
 * { value } })` writes that value onto the DOM node itself before dispatching,
 * and the component's `value={row.status ?? 'active'}` expression is unchanged
 * when the optimistic patch never happens — so Svelte patches nothing, the
 * test-written value survives, and the assertion passes whether the feature
 * works or not. `data-status` is only ever written by the render (#111 review).
 */
function rowStatus(container: HTMLElement, workName: string): string | null {
	const li = Array.from(container.querySelectorAll('[data-testid="work-row"]')).find(
		(el) => el.querySelector('[data-testid="work-name"]')?.textContent?.trim() === workName
	);
	return li?.getAttribute('data-status') ?? null;
}

/** The <li> rendering the named work, for scoping a status-button click to it. */
function rowEl(container: HTMLElement, workName: string): HTMLElement {
	const li = Array.from(container.querySelectorAll('[data-testid="work-row"]')).find(
		(el) => el.querySelector('[data-testid="work-name"]')?.textContent?.trim() === workName
	);
	if (!li) throw new Error(`no work-row for ${workName}`);
	return li as HTMLElement;
}

function postsTo(fetchMock: ReturnType<typeof installWorld>, fragment: string) {
	return fetchMock.mock.calls.filter(
		([url, init]) =>
			String(url).includes(fragment) && (init as RequestInit | undefined)?.method === 'POST'
	);
}

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
		upcoming,
		recent: [],
		seasonId: 'season-1',
		seasonConductors: [], seasonOwners: [], seasonEditors: []
	}));
	resetTypeIdCache();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadFullAgendaMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('+page — repertoire management wiring (#91 TR.3)', () => {
	it('a season editor SEES the management controls on the agenda row', async () => {
		installWorld({ seasonEditor: true });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-status-active"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="work-manage-add-work"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="work-manage-remove"]')).not.toBeNull();
	});

	it('a NON-editor sees the works read-only — no management controls anywhere', async () => {
		installWorld({ seasonEditor: false, eventEditor: false });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-row"]').length).toBeGreaterThan(0);
		});
		expect(container.querySelector('[data-testid="work-manage-row"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-manage-add-work"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-manage-add-programme"]')).toBeNull();
	});

	it('an editor reads the UNFILTERED repertoire, so a retired work is on screen and re-activatable', async () => {
		const fetchMock = installWorld({ seasonEditor: true });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-manage-row"]').length).toBe(2);
		});
		const retiredRow = rowEl(container, 'Old warhorse');
		expect(
			retiredRow.querySelector('[data-testid="work-status-retired"]')!.getAttribute('aria-pressed')
		).toBe('true');

		await fireEvent.click(retiredRow.querySelector('[data-testid="work-status-active"]')!);
		await vi.waitFor(() => {
			expect(postsTo(fetchMock, 'entity/ri-2').length).toBe(1);
		});
		expect(JSON.parse(String(postsTo(fetchMock, 'entity/ri-2')[0][1]!.body))).toEqual([
			{ _id: 'val-status', type: 'status', string: 'active' }
		]);
	});

	it('changing a status writes it through: value-id lookup, ONE atomic overwrite-POST carrying the old id (#264) — no DELETE round-trip', async () => {
		const fetchMock = installWorld({ seasonEditor: true });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-status-active"]')).not.toBeNull();
		});
		await fireEvent.click(rowEl(container, 'Spem in alium').querySelector('[data-testid="work-status-learning"]')!);

		await vi.waitFor(() => {
			expect(postsTo(fetchMock, 'entity/ri-1').length).toBe(1);
		});
		const urls = fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${String(url)}`);
		expect(urls).toContain('GET https://api.entu-test.invalid/polyphony/entity/ri-1?props=status');
		// #264 — the atomic overwrite replaces the old value IN the POST (its
		// `_id` rides the entry); no separate DELETE remains on this path.
		expect(urls).not.toContain('DELETE https://api.entu-test.invalid/polyphony/property/val-status');
		expect(JSON.parse(String(postsTo(fetchMock, 'entity/ri-1')[0][1]!.body))).toEqual([
			{ _id: 'val-status', type: 'status', string: 'learning' }
		]);
	});

	it('the status change lands OPTIMISTICALLY — the picker updates on tap, before any refetch', async () => {
		installWorld({ seasonEditor: true, repertoireItems: [RI_ACTIVE] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		// Asserted through `rowStatus` (the rendered `data-status`), never a
		// button's aria-pressed — see the helper's note.
		await vi.waitFor(() => {
			expect(rowStatus(container, 'Spem in alium')).toBe('active');
		});
		await fireEvent.click(container.querySelector('[data-testid="work-status-learning"]')!);
		expect(rowStatus(container, 'Spem in alium')).toBe('learning');
	});

	it('adding a work creates a repertoire_item under the SEASON, with NO explicit _sharing (#133: inherited from the domain-tier season parent)', async () => {
		const fetchMock = installWorld({ seasonEditor: true });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			const select = container.querySelector(
				'[data-testid="work-manage-add-work-select"]'
			) as HTMLSelectElement;
			// work-1 / work-2 are already in the repertoire; only work-3 is pickable.
			expect(select?.querySelectorAll('option').length).toBe(2);
		});
		await fireEvent.change(container.querySelector('[data-testid="work-manage-add-work-select"]')!, {
			target: { value: 'work-3' }
		});
		await fireEvent.click(container.querySelector('[data-testid="work-manage-add-work-button"]')!);

		await vi.waitFor(() => {
			expect(postsTo(fetchMock, '/entity').filter(([url]) => String(url).endsWith('/entity')).length).toBe(1);
		});
		const create = postsTo(fetchMock, '/entity').find(([url]) => String(url).endsWith('/entity'))!;
		expect(JSON.parse(String(create[1]!.body))).toEqual([
			{ type: '_type', reference: 'type-1' },
			{ type: '_parent', reference: 'season-1' },
			{ type: 'work', reference: 'work-3' },
			{ type: 'status', string: 'active' }
		]);
	});

	// #91 review F1 — the fanout. `listEvents` reads up to 500 events, and the
	// old shape fired one rights GET per event PLUS one for the season, on every
	// page load, for every member.
	it('issues NO per-entity rights probe — rights ride on the agenda read', async () => {
		const fetchMock = installWorld({ seasonEditor: true });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-status-active"]')).not.toBeNull();
		});
		const rightsProbes = fetchMock.mock.calls.filter(([url]) =>
			String(url).includes('props=_owner,_editor')
		);
		expect(rightsProbes).toEqual([]);
	});

	// #91 review F3 — a status/pin/ordinal/delete tap already holds the
	// authoritative value; refetching costs the whole four-collection join plus
	// one program_item read per agenda event.
	it('an in-place write does NOT trigger a full agenda-works refetch', async () => {
		const fetchMock = installWorld({ seasonEditor: true, repertoireItems: [RI_ACTIVE] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-status-active"]')).not.toBeNull();
		});
		const worksReadsBefore = fetchMock.mock.calls.filter(([url]) =>
			String(url).includes('_type.string=work')
		).length;

		await fireEvent.click(container.querySelector('[data-testid="work-status-learning"]')!);
		await vi.waitFor(() => {
			expect(postsTo(fetchMock, 'entity/ri-1').length).toBe(1);
		});

		expect(
			fetchMock.mock.calls.filter(([url]) => String(url).includes('_type.string=work')).length
		).toBe(worksReadsBefore);
	});

	// #264 (PO ruling, branch (i)) — the status write is now an ATOMIC
	// overwrite-POST: the old value's `_id` rides the SAME call that writes the
	// new one, so a failed POST cannot leave the status property EMPTY (the old
	// value was never touched) — superseding the #91 review F5 POST-before-
	// DELETE choreography, which had a separate DELETE step to order.
	it('the status write is ONE atomic overwrite-POST carrying the old value id — no DELETE round-trip remains', async () => {
		const fetchMock = installWorld({ seasonEditor: true, repertoireItems: [RI_ACTIVE] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-status-active"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="work-status-learning"]')!);
		await vi.waitFor(() => {
			expect(postsTo(fetchMock, 'entity/ri-1').length).toBe(1);
		});
		const calls = fetchMock.mock.calls.map(
			([url, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${String(url)}`
		);
		expect(calls).not.toContain('DELETE https://api.entu-test.invalid/polyphony/property/val-status');
		expect(JSON.parse(String(postsTo(fetchMock, 'entity/ri-1')[0][1]!.body))).toEqual([
			{ _id: 'val-status', type: 'status', string: 'learning' }
		]);
	});

	// #91 review F2 — the refetch a CREATE triggers must not roll back a write
	// that is still in flight. Same defect class the #77 review caught for
	// attendance, and the same fix: the server value goes UNDER the optimistic
	// one for every pending key.
	it('a settling create does NOT clobber a still-in-flight status change', async () => {
		let releaseStatusPost: (() => void) | undefined;
		const statusPostLanded = new Promise<void>((resolve) => {
			releaseStatusPost = resolve;
		});
		const base = installWorld({ seasonEditor: true, repertoireItems: [RI_ACTIVE] });
		// Re-route: ri-1's status POST hangs; everything else behaves as before, so
		// the create settles first and refetches a repertoire that still says
		// 'active'.
		const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			if ((init?.method ?? 'GET') === 'POST' && url.endsWith('/entity/ri-1')) {
				await statusPostLanded;
			}
			return base(input, init);
		});
		vi.stubGlobal('fetch', fetchMock);
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-manage-add-work-select"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="work-status-learning"]')!);
		expect(rowStatus(container, 'Spem in alium')).toBe('learning');

		// Now a create settles and refetches the (stale) repertoire.
		await fireEvent.change(container.querySelector('[data-testid="work-manage-add-work-select"]')!, {
			target: { value: 'work-3' }
		});
		await fireEvent.click(container.querySelector('[data-testid="work-manage-add-work-button"]')!);
		await vi.waitFor(() => {
			expect(
				fetchMock.mock.calls.filter(
					([url, init]) =>
						String(url).endsWith('/entity') && (init as RequestInit | undefined)?.method === 'POST'
				).length
			).toBe(1);
		});
		await vi.waitFor(() => {
			expect(
				fetchMock.mock.calls.filter(([url]) => String(url).includes('_type.string=repertoire_item'))
					.length
			).toBeGreaterThan(1);
		});

		// The in-flight status is still on screen — not snapped back to 'active'.
		expect(rowStatus(container, 'Spem in alium')).toBe('learning');
		releaseStatusPost!();
	});

	// #91 review F3 side-effect — with the blanket refetch gone, the "Add work"
	// exclusion set has to move with the row a Remove deletes.
	it('a removed work becomes pickable again without waiting for a page reload', async () => {
		installWorld({ seasonEditor: true, repertoireItems: [RI_ACTIVE] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		const optionCount = () =>
			container.querySelector('[data-testid="work-manage-add-work-select"]')?.querySelectorAll('option')
				.length ?? 0;

		// work-1 is in the repertoire → placeholder + work-2 + work-3.
		await vi.waitFor(() => {
			expect(optionCount()).toBe(3);
		});
		await fireEvent.click(container.querySelector('[data-testid="work-manage-remove"]')!);
		await vi.waitFor(() => {
			expect(optionCount()).toBe(4);
		});
	});

	it('Remove on a repertoire row DELETEs the repertoire_item entity', async () => {
		const fetchMock = installWorld({ seasonEditor: true, repertoireItems: [RI_ACTIVE] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-manage-remove"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="work-manage-remove"]')!);

		await vi.waitFor(() => {
			const deletes = fetchMock.mock.calls.filter(
				([, init]) => (init as RequestInit | undefined)?.method === 'DELETE'
			);
			expect(deletes.map(([url]) => String(url))).toContain(
				'https://api.entu-test.invalid/polyphony/entity/ri-1'
			);
		});
	});
});

// The programme half: an event WITH program_items renders its own list, and the
// controls on it must only ever hand up program_item ids.
describe('+page — programme management wiring (#91 TR.3)', () => {
	const programItems = [
		{ _id: 'pi-a', name: [{ string: 'First' }], edition: [{ reference: 'ed-1' }], ordinal: [{ number: 0 }] },
		{ _id: 'pi-b', name: [{ string: 'Second' }], edition: [{ reference: 'ed-2' }], ordinal: [{ number: 1 }] }
	];

	it('MOVE UP writes BOTH sides of the swap — the displaced neighbour is renumbered too', async () => {
		const fetchMock = installWorld({ seasonEditor: false, eventEditor: true, programItems });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-manage-move-up"]').length).toBe(2);
		});
		const ups = container.querySelectorAll('[data-testid="work-manage-move-up"]');
		await fireEvent.click(ups[1]); // move 'Second' above 'First'

		await vi.waitFor(() => {
			expect(postsTo(fetchMock, 'entity/pi-b').length).toBe(1);
			expect(postsTo(fetchMock, 'entity/pi-a').length).toBe(1);
		});
		expect(JSON.parse(String(postsTo(fetchMock, 'entity/pi-b')[0][1]!.body))).toEqual([
			{ _id: 'val-pi-b', type: 'ordinal', number: 0 }
		]);
		expect(JSON.parse(String(postsTo(fetchMock, 'entity/pi-a')[0][1]!.body))).toEqual([
			{ _id: 'val-pi-a', type: 'ordinal', number: 1 }
		]);
	});

	// #91 review F4 — a move is a RENUMBER: the plan can rewrite any row's
	// ordinal, so the pending guard has to cover the whole programme. With a
	// per-row key, moving B and then immediately C issued a SECOND concurrent
	// ordinal write to a row the first move was already writing.
	it('a reorder disables EVERY row in the programme, and a second move while it runs is a no-op', async () => {
		// THREE items, because that is what exposes the bug: moving B renumbers
		// only {A, B}, so with a per-row key C stayed enabled — and tapping C
		// planned a SECOND concurrent write to A while A's first write was still
		// in flight.
		const threeItems = [
			...programItems,
			{
				_id: 'pi-c',
				name: [{ string: 'Third' }],
				edition: [{ reference: 'ed-1' }],
				ordinal: [{ number: 2 }]
			}
		];
		const fetchMock = installWorld({
			seasonEditor: false,
			eventEditor: true,
			programItems: threeItems
		});
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-manage-move-up"]').length).toBe(3);
		});
		// Move 'Second' up — the plan touches pi-b and pi-a only.
		await fireEvent.click(container.querySelectorAll('[data-testid="work-manage-move-up"]')[1]);

		// EVERY row in the programme disables, including the one the plan did not
		// name: the renumber's blast radius is the whole programme.
		const ups = [...container.querySelectorAll('[data-testid="work-manage-move-up"]')];
		expect(ups.every((btn) => (btn as HTMLButtonElement).disabled)).toBe(true);

		// And a second move against the same programme is swallowed by the queue:
		// still exactly one ordinal write per item.
		await fireEvent.click(ups[2]);
		await vi.waitFor(() => {
			expect(postsTo(fetchMock, 'entity/pi-b').length).toBe(1);
		});
		// #107 — entuFetch now inspects every response's status (401 recovery),
		// which adds a promise hop between the fetch call and its resolution; the
		// pi-a write can therefore still be in flight the instant pi-b's is
		// observed. Same wait, not a weaker assertion — the write always happens
		// (it's part of the FIRST move's sequential plan), this just stops
		// asserting on it a tick early.
		await vi.waitFor(() => {
			expect(postsTo(fetchMock, 'entity/pi-a').length).toBe(1);
		});
		expect(postsTo(fetchMock, 'entity/pi-c').length).toBe(0);
	});

	it('Remove on a programme row deletes the PROGRAM_ITEM — never the season repertoire entry', async () => {
		const fetchMock = installWorld({ seasonEditor: false, eventEditor: true, programItems });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-manage-remove"]').length).toBe(2);
		});
		await fireEvent.click(container.querySelectorAll('[data-testid="work-manage-remove"]')[0]);

		await vi.waitFor(() => {
			const deletes = fetchMock.mock.calls
				.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')
				.map(([url]) => String(url));
			expect(deletes).toContain('https://api.entu-test.invalid/polyphony/entity/pi-a');
		});
		const deletes = fetchMock.mock.calls
			.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')
			.map(([url]) => String(url));
		expect(deletes.some((url) => url.includes('/entity/ri-'))).toBe(false);
	});

	it('an EVENT editor on an event with NO programme yet can still start one — the first program_item is creatable', async () => {
		const fetchMock = installWorld({ seasonEditor: false, eventEditor: true, programItems: [] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-manage-add-programme"]')).not.toBeNull();
		});
		await fireEvent.change(
			container.querySelector('[data-testid="work-manage-add-programme-select"]')!,
			{ target: { value: 'ed-1' } }
		);
		await fireEvent.click(
			container.querySelector('[data-testid="work-manage-add-programme-button"]')!
		);

		await vi.waitFor(() => {
			expect(postsTo(fetchMock, '/entity').filter(([url]) => String(url).endsWith('/entity')).length).toBe(1);
		});
		const create = postsTo(fetchMock, '/entity').find(([url]) => String(url).endsWith('/entity'))!;
		expect(JSON.parse(String(create[1]!.body))).toEqual([
			{ type: '_type', reference: 'type-1' },
			{ type: '_parent', reference: 'ev-1' },
			{ type: 'edition', reference: 'ed-1' },
			{ type: 'ordinal', number: 0 },
			{ type: '_sharing', string: 'domain' }
		]);
	});

	it('an event-only editor gets NO repertoire row controls on the fallback rows (their ids are repertoire_item ids)', async () => {
		installWorld({ seasonEditor: false, eventEditor: true, programItems: [] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-manage-add-programme"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="work-manage-row"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-manage-remove"]')).toBeNull();
	});
});

// ── #204 — work pickers show composer (agenda page route) ────────────────────
//
// RED contract: every work-picker label on the AGENDA page carries the
// composer as "Name - Composer" (issue #204, "Silmavalgus - P. Uusberg"):
//   • the "Add work" select's options, and
//   • the "Add to programme" edition-picker's work half
//     ("Work - Composer — Edition").
// A work with no composer keeps its bare name — no dangling " - ".
//
// installWorld's fixtures stay untouched; this wrapper re-routes ONLY the
// work/edition GETs so composers exist on the wire, and delegates the rest.
type WireWork = { _id: string; name?: Array<{ string: string }>; composer?: Array<{ string: string }> };

const DEFAULT_COMPOSER_WORKS: WireWork[] = [
	{
		_id: 'work-1',
		name: [{ string: 'Spem in alium' }],
		composer: [{ string: 'Thomas Tallis' }]
	},
	// work-2 deliberately has NO composer — the no-dangling case.
	{ _id: 'work-2', name: [{ string: 'Old warhorse' }] },
	{
		_id: 'work-3',
		name: [{ string: 'Nunc dimittis' }],
		composer: [{ string: 'Rachmaninoff' }]
	}
];

function installComposerWorld(options: WorldOptions = {}, works: WireWork[] = DEFAULT_COMPOSER_WORKS) {
	const base = installWorld(options);
	const wrapped = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (method === 'GET' && url.includes('_type.string=work')) {
			return json({ entities: works });
		}
		if (method === 'GET' && url.includes('_type.string=edition')) {
			return json({
				entities: [
					{
						_id: 'ed-1',
						name: [{ string: '40-part original' }],
						_parent: [{ reference: 'work-1', entity_type: 'work' }]
					},
					{
						_id: 'ed-3',
						name: [{ string: 'Eulenburg' }],
						_parent: [{ reference: 'work-2', entity_type: 'work' }]
					}
				]
			});
		}
		return base(input, init);
	});
	vi.stubGlobal('fetch', wrapped);
	return wrapped;
}

describe('#204 — agenda page work pickers show composer', () => {
	it('the "Add work" select labels its options "Name - Composer"', async () => {
		installComposerWorld({ seasonEditor: true });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-manage-add-work-select"]')).not.toBeNull();
		});
		const select = container.querySelector(
			'[data-testid="work-manage-add-work-select"]'
		) as HTMLSelectElement;
		// work-1/work-2 are already in the repertoire; work-3 is the pickable one.
		await vi.waitFor(() => {
			expect(select.querySelectorAll('option').length).toBe(2);
		});
		const labels = [...select.querySelectorAll('option')].map((o) => (o.textContent ?? '').trim());
		expect(labels).toEqual(['[repertoire_add_work_label]', 'Nunc dimittis - Rachmaninoff']);
	});

	it('the "Add to programme" edition picker labels read "Work - Composer — Edition"; a composerless work keeps its bare name', async () => {
		installComposerWorld({ seasonEditor: false, eventEditor: true, programItems: [] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-programme-select"]')
			).not.toBeNull();
		});
		const select = container.querySelector(
			'[data-testid="work-manage-add-programme-select"]'
		) as HTMLSelectElement;
		await vi.waitFor(() => {
			expect(select.querySelectorAll('option').length).toBe(3);
		});
		const labels = [...select.querySelectorAll('option')].map((o) => (o.textContent ?? '').trim());
		expect(labels).toEqual([
			'[repertoire_add_programme_label]',
			'Spem in alium - Thomas Tallis — 40-part original',
			// work-2 has no composer: bare name, NO dangling " - " before the "—".
			'Old warhorse — Eulenburg'
		]);
	});

	it('an edition whose work has NO name on the wire falls back to the bare edition label — no leading " — "', async () => {
		// Entu's `mandatory` is a UI hint only, so a nameless work entity is
		// reachable; listWorks maps the missing name to ''. The work IS found in
		// the map, so guarding on `work !== undefined` would emit " — Eulenburg".
		installComposerWorld({ seasonEditor: false, eventEditor: true, programItems: [] }, [
			{
				_id: 'work-1',
				name: [{ string: 'Spem in alium' }],
				composer: [{ string: 'Thomas Tallis' }]
			},
			// work-2: no name property at all, and a whitespace-only composer.
			{ _id: 'work-2', composer: [{ string: '   ' }] }
		]);
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-programme-select"]')
			).not.toBeNull();
		});
		const select = container.querySelector(
			'[data-testid="work-manage-add-programme-select"]'
		) as HTMLSelectElement;
		await vi.waitFor(() => {
			expect(select.querySelectorAll('option').length).toBe(3);
		});
		const labels = [...select.querySelectorAll('option')].map((o) => (o.textContent ?? '').trim());
		expect(labels).toEqual([
			'[repertoire_add_programme_label]',
			'Spem in alium - Thomas Tallis — 40-part original',
			'Eulenburg'
		]);
	});
});

// ── #272 — programme control: conditional select + link, on the PAGE ─────────
//
// RED contract (Mihkel's four-part ruling, parts 3+4, exercised through the
// real agenda page so the wiring — rights, picker derivation, write queue —
// runs for real, not just the component in isolation):
//   • the "Add to programme" button is ABSENT until an edition is selected
//     (today it renders disabled), and absent AGAIN after a successful add
//     (the handler's existing selection reset now also hides it);
//   • with NOTHING pickable the <select> does not render at all — while the
//     work-manage-add-programme wrapper block stays (the first-program_item
//     scar: the block must keep rendering on the season-repertoire fallback).

/** installWorld, with the edition read returning NOTHING pickable. */
function installEditionlessWorld(options: WorldOptions = {}) {
	const base = installWorld(options);
	const wrapped = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (method === 'GET' && url.includes('_type.string=edition')) {
			return json({ entities: [] });
		}
		return base(input, init);
	});
	vi.stubGlobal('fetch', wrapped);
	return wrapped;
}

describe('#272 — agenda page: programme select + add link are conditionally shown', () => {
	it('the "Add to programme" button is ABSENT until an edition is selected, appears on selection, and is gone again after the add', async () => {
		const fetchMock = installWorld({ seasonEditor: false, eventEditor: true, programItems: [] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-programme-select"]')
			).not.toBeNull();
		});
		// Part 3 — hidden, not disabled: no edition selected → no button in the DOM.
		expect(
			container.querySelector('[data-testid="work-manage-add-programme-button"]'),
			'nothing selected → the button must be absent (the old shape was disabled-but-present)'
		).toBeNull();

		await fireEvent.change(
			container.querySelector('[data-testid="work-manage-add-programme-select"]')!,
			{ target: { value: 'ed-1' } }
		);
		const button = container.querySelector(
			'[data-testid="work-manage-add-programme-button"]'
		) as HTMLButtonElement | null;
		expect(button, 'edition selected → the button appears').not.toBeNull();

		await fireEvent.click(button!);
		// The write itself is unchanged — the create still goes out…
		await vi.waitFor(() => {
			expect(
				postsTo(fetchMock, '/entity').filter(([url]) => String(url).endsWith('/entity')).length
			).toBe(1);
		});
		// …and the handler's selection reset now hides the button again.
		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-programme-button"]'),
				'post-add: selection reset → button hidden again'
			).toBeNull();
		});
	});

	it('an EVENT editor with NO programme yet and NOTHING pickable still gets the wrapper — select absent, button absent, the fallback works render un-crashed', async () => {
		// Sibling of "…can still start one" above: same rights shape, same
		// season-repertoire fallback (the block deliberately not gated on
		// context — the scar comment in RepertoireElement.svelte), but the
		// edition read yields nothing to pick. Part 4's gate lands on the INNER
		// select only; the wrapper stays.
		installEditionlessWorld({ seasonEditor: false, eventEditor: true, programItems: [] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-manage-add-programme"]')).not.toBeNull();
		});
		expect(
			container.querySelector('[data-testid="work-manage-add-programme-select"]'),
			'empty pickable list → a placeholder-only dropdown must not render'
		).toBeNull();
		expect(container.querySelector('[data-testid="work-manage-add-programme-button"]')).toBeNull();
		// The surface around it is intact: the fallback rows are on screen.
		expect(container.querySelectorAll('[data-testid="work-row"]').length).toBeGreaterThan(0);
	});
});

// ── #288 item 1 — the programme control survives its own load window ─────────
//
// The control renders `{#if pickableEditions.length > 0}`, and the caller
// derives that list from `libraryWorks`/`libraryEditions`, which
// `resetManagement()` blanks SYNCHRONOUSLY on every `loadForSelected()` —
// including every same-collective refresh (season create, event create, series
// bulk, convert resume, agenda retry). The refill is asynchronous, so a control
// the admin saw a moment ago disappears and returns, which reads as a fault.
//
// PO ruling: key visibility off "no options once loading has COMPLETED", not
// "no options right now". Mihkel's #272 rule is preserved — a chooser with
// nothing to choose is still not shown — but *still loading* is not *empty*,
// and today the caller cannot tell them apart. First render is unaffected.
//
// Existing specs touching this control's presence/absence, and why each
// survives this contract (reasoned per the #288 brief):
//   • RepertoireElement.programme-control.spec.ts — hands `pickableEditions`
//     to the COMPONENT directly (empty→hidden / non-empty→shown); no page
//     async in play, so a caller-level load-state fix leaves them true.
//   • RepertoireElement.spec.ts / .ux.spec.ts — non-empty fixtures, rights
//     gating and classes; orthogonal to load-state.
//   • this file's own `vi.waitFor(select appears)` specs — FIRST render:
//     hidden until the picker fetch lands, which the PO ruling keeps ("first
//     render is unaffected"); waitFor tolerates the load window either way.
//   • installEditionlessWorld specs — loaded-and-EMPTY: select stays absent.
//     That is the "resolved by actual emptiness" half of the ruling, already
//     pinned above; the first-render guard below pins its while-loading twin.
//   • page.repertoire-a11y.spec.ts / event/[id]/page.spec.ts — non-empty
//     fixtures on other surfaces; #288 as filed scopes to the agenda page.
//
// The reload driver is a real same-collective trigger (season create success →
// `loadForSelected()`), through the real page. The picker reads are HELD open:
// `loadWorksAndManagement` dispatches `loadManagePickers` (listWorks +
// listAllEditions) FIRST, then `loadWorksByEventId` (which fetches the same
// two types again for the row join) — so the gate holds only the FIRST
// work-GET and FIRST edition-GET after arming, letting the rows land while the
// pickers stay in flight. That coupling to dispatch order is deliberate and
// checked non-vacuously (the held count is asserted before anything else).
//
// #288 review F1 — the ROW read is holdable INDEPENDENTLY, because the picker
// reads are only ONE of the two async sources the visibility decision reads.
// The other is `worksByEventId`, blanked by the same synchronous reset and
// refilled by `loadWorksByEventId` — a separate settle. `listAllCopies`
// (`_type.string=copy`) is issued by that read and by nothing else on this
// page, so holding it holds the row load alone, letting the pickers settle
// FIRST. That is the ordering the reload world's picker hold cannot produce
// (releasing the pickers there lets the rows land first), and it is the one the
// real page most likely takes: 3 picker GETs against 4+ row GETs including the
// per-event program_item fanout.

type HeldRead = { kind: 'work' | 'edition'; url: string; resolve: (r: Response) => void };

function installReloadWorld(options: WorldOptions = {}) {
	const base = installWorld(options);
	const held: HeldRead[] = [];
	const heldRows: Array<{ url: string; resolve: (r: Response) => void }> = [];
	let armed = false;
	let heldWork = false;
	let heldEdition = false;
	let armedRows = false;
	let heldRow = false;
	const wrapped = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		// Season create resolves the collective identity first — unrouted in the
		// base world (nothing else needed it).
		if (method === 'GET' && url.includes('_type.string=database')) {
			return json({ entities: [{ _id: 'db-entity-1' }] });
		}
		if (armedRows && method === 'GET' && url.includes('_type.string=copy') && !heldRow) {
			heldRow = true;
			return new Promise<Response>((resolve) => heldRows.push({ url, resolve }));
		}
		if (armed && method === 'GET') {
			if (url.includes('_type.string=work') && !heldWork) {
				heldWork = true;
				return new Promise<Response>((resolve) => held.push({ kind: 'work', url, resolve }));
			}
			if (url.includes('_type.string=edition') && !heldEdition) {
				heldEdition = true;
				return new Promise<Response>((resolve) => held.push({ kind: 'edition', url, resolve }));
			}
		}
		return base(input, init);
	});
	vi.stubGlobal('fetch', wrapped);
	return {
		fetchMock: wrapped,
		/** From now on, hold the NEXT picker read pair (listWorks + listAllEditions). */
		armPickerHold() {
			armed = true;
			heldWork = false;
			heldEdition = false;
		},
		/** From now on, hold the NEXT row read (`loadWorksByEventId`'s
		 *  `listAllCopies`), so `worksByEventId` stays blank while the pickers
		 *  settle. */
		armRowHold() {
			armedRows = true;
			heldRow = false;
		},
		/** How many picker reads are currently held open. */
		heldCount: () => held.length,
		/** How many row reads are currently held open. */
		rowHeldCount: () => heldRows.length,
		/** Resolve the held picker reads — with the base world's entities, or
		 *  with NO editions when the reload should complete to genuine emptiness. */
		async releasePickerReads({ editionsEmpty = false } = {}) {
			armed = false;
			const toRelease = held.splice(0, held.length);
			for (const read of toRelease) {
				if (editionsEmpty && read.kind === 'edition') {
					read.resolve(json({ entities: [] }));
				} else {
					read.resolve(await base(read.url));
				}
			}
		},
		/** Resolve the held row read, letting `worksByEventId` refill. */
		async releaseRowReads() {
			armedRows = false;
			const toRelease = heldRows.splice(0, heldRows.length);
			for (const read of toRelease) {
				read.resolve(await base(read.url));
			}
		}
	};
}

/** Drive the page through a REAL same-collective reload: season create success
 *  → `loadForSelected()`. Returns once the reload's picker reads are held. */
async function submitSeasonCreateAndEnterReload(
	container: HTMLElement,
	world: ReturnType<typeof installReloadWorld>,
	{ holdRows = false }: { holdRows?: boolean } = {}
) {
	await fireEvent.click(container.querySelector('[data-testid="season-create"]')!);
	await vi.waitFor(() => {
		expect(container.querySelector('[data-testid="season-create-name"]')).not.toBeNull();
	});
	await fireEvent.input(container.querySelector('[data-testid="season-create-name"]')!, {
		target: { value: 'Autumn 2026' }
	});
	await fireEvent.input(container.querySelector('[data-testid="season-create-start"]')!, {
		target: { value: '2026-09-01' }
	});
	await fireEvent.input(container.querySelector('[data-testid="season-create-end"]')!, {
		target: { value: '2026-12-20' }
	});
	world.armPickerHold();
	if (holdRows) world.armRowHold();
	await fireEvent.click(container.querySelector('[data-testid="season-create-submit"]')!);
	// Non-vacuous: BOTH picker reads of the reload are genuinely in flight and
	// held. This also proves the agenda phase of the reload is over — the
	// pickers are dispatched after `agendaLoading` goes false, so the rows are
	// (re)renderable while we hold.
	await vi.waitFor(() => {
		expect(world.heldCount()).toBe(2);
	});
	if (holdRows) {
		await vi.waitFor(() => {
			expect(world.rowHeldCount()).toBe(1);
		});
	}
}

/** Re-open the remounted Works disclosure after a reload. */
async function reExpandWorks(container: HTMLElement) {
	await vi.waitFor(() => {
		expect(container.querySelector('[data-testid="works-line"]')).not.toBeNull();
	});
	await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);
	await vi.waitFor(() => {
		expect(container.querySelector('[data-testid="work-manage-add-programme"]')).not.toBeNull();
	});
}

describe('#288 item 1 — the programme control keys visibility off "no options once loading has COMPLETED", not "no options right now"', () => {
	it('RELOAD, resolving non-empty: the select the admin just saw does NOT vanish while the picker refill is in flight, and still shows once it lands', async () => {
		const world = installReloadWorld({ seasonEditor: true, eventEditor: true, programItems: [] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		// The starting point the issue describes: the control is on screen.
		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-programme-select"]')
			).not.toBeNull();
		});

		await submitSeasonCreateAndEnterReload(container, world);
		await reExpandWorks(container);

		// THE #288 WINDOW: the reload's picker reads are held open. "Still
		// loading" is not "empty" — the select must not have vanished.
		expect(
			container.querySelector('[data-testid="work-manage-add-programme-select"]'),
			'reload in flight → the control the admin just saw must STAY on screen (PO ruling: ' +
				'visibility keys off "no options once loading has COMPLETED", never off a ' +
				'still-loading list being transiently empty)'
		).not.toBeNull();

		// Loading completes with options → visible, with the real options.
		await world.releasePickerReads();
		await vi.waitFor(() => {
			const select = container.querySelector(
				'[data-testid="work-manage-add-programme-select"]'
			) as HTMLSelectElement | null;
			expect(select).not.toBeNull();
			expect(select!.querySelector('option[value="ed-1"]')).not.toBeNull();
		});
	});

	it('RELOAD, resolving EMPTY: the select stays through the window, then hides on actual emptiness — loaded-and-empty still means no chooser', async () => {
		const world = installReloadWorld({ seasonEditor: true, eventEditor: true, programItems: [] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-programme-select"]')
			).not.toBeNull();
		});

		await submitSeasonCreateAndEnterReload(container, world);
		await reExpandWorks(container);

		// Mid-window: still loading → still visible (same pin as above; this is
		// where the fault lives today).
		expect(
			container.querySelector('[data-testid="work-manage-add-programme-select"]'),
			'reload in flight → the control must STAY visible until loading has COMPLETED'
		).not.toBeNull();

		// Loading completes to genuine emptiness → Mihkel's #272 rule takes over:
		// a chooser with nothing to choose is not shown. The wrapper stays (the
		// first-program_item scar), the rows stay.
		await world.releasePickerReads({ editionsEmpty: true });
		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-programme-select"]'),
				'loading COMPLETED with no options → the select resolves to hidden'
			).toBeNull();
		});
		expect(container.querySelector('[data-testid="work-manage-add-programme"]')).not.toBeNull();
		expect(container.querySelectorAll('[data-testid="work-row"]').length).toBeGreaterThan(0);
	});

	it('RELOAD with the PICKERS settling FIRST: the select survives the ROW load too — gating on the picker read alone only MOVES the vanish window (#288 review F1)', async () => {
		const world = installReloadWorld({ seasonEditor: true, eventEditor: true, programItems: [] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		// Same starting point as the two specs above: the control is on screen.
		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-programme-select"]')
			).not.toBeNull();
		});

		// This time BOTH of the visibility decision's sources are held: the picker
		// pair AND the row read (`listAllCopies`).
		await submitSeasonCreateAndEnterReload(container, world, { holdRows: true });

		// Rows are blank while their read is held, so the element renders its
		// `works-manage-empty` branch (no `works-line`, nothing to re-open) — and
		// the control the admin just saw is still there.
		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="works-manage-empty"]')).not.toBeNull();
		});
		expect(
			container.querySelector('[data-testid="work-manage-add-programme-select"]'),
			'both sources in flight → the control must STAY on screen'
		).not.toBeNull();

		// Release ONLY the pickers. `libraryWorks`/`libraryEditions` are back;
		// `worksByEventId` is still blank.
		await world.releasePickerReads();
		// Proven landed, not merely awaited: the add-work select's option comes off
		// `libraryWorks`, so it could not exist before this release.
		await vi.waitFor(() => {
			const addWork = container.querySelector('[data-testid="work-manage-add-work-select"]');
			expect(addWork).not.toBeNull();
			expect(addWork!.querySelector('option[value="work-3"]')).not.toBeNull();
		});
		expect(
			world.rowHeldCount(),
			'the row read must still be in flight here, or this spec pins nothing'
		).toBe(1);

		expect(
			container.querySelector('[data-testid="work-manage-add-programme-select"]'),
			'pickers SETTLED but the row read still in flight → `pickableEditionsByEventId` has no ' +
				'entry for this event yet (it is keyed off `worksByEventId`), so the decision is not ' +
				'decidable and the control must STILL be on screen. Gating the sticky effect on ' +
				'`libraryPickersLoading` alone recomputes an empty map here and wipes it for the ' +
				'whole remaining duration of the row load — the same visible→hidden→visible flip, ' +
				'just moved to the other read.'
		).not.toBeNull();

		// Both settled, options exist → visible with the real options, over real rows.
		await world.releaseRowReads();
		await reExpandWorks(container);
		const select = container.querySelector(
			'[data-testid="work-manage-add-programme-select"]'
		) as HTMLSelectElement | null;
		expect(select).not.toBeNull();
		expect(select!.querySelector('option[value="ed-1"]')).not.toBeNull();
		expect(container.querySelectorAll('[data-testid="work-row"]').length).toBeGreaterThan(0);
	});

	it('FIRST render guard (unchanged by #288): while the initial picker load is in flight the select is NOT yet shown — no placeholder-only flash — and appears once it lands', async () => {
		// Holds the INITIAL picker pair (armed before render). The PO ruling
		// changes nothing here: a control never yet shown has nothing to keep
		// visible, so a naive `length > 0 || loading` gate — which would flash a
		// placeholder-only dropdown on every first paint — is ruled out by this
		// pin exactly as the vanish is ruled out by the two above.
		const world = installReloadWorld({ seasonEditor: true, eventEditor: true, programItems: [] });
		world.armPickerHold();
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-manage-add-programme"]')).not.toBeNull();
		});
		await vi.waitFor(() => {
			expect(world.heldCount()).toBe(2);
		});
		expect(
			container.querySelector('[data-testid="work-manage-add-programme-select"]'),
			'first render, picker load in flight → nothing was ever visible, so nothing shows yet'
		).toBeNull();

		await world.releasePickerReads();
		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-programme-select"]')
			).not.toBeNull();
		});
	});
});

// (*MVOX:Josquin* — #91 review fix-forward: end-to-end management wiring)
// (*MVOX:Tallis* — #204 RED: picker labels carry the composer)
// (*MVOX:Tallis* — #204 review fix-forward: nameless work on the wire)
// (*MVOX:Tallis* — #272 RED: programme select + add link conditionally shown, page wiring)
// (*MVOX:Tallis* — #288 RED: the programme control survives its load window)
// (*MVOX:Josquin* — #288 review F1: the ROW read is the second load window)
