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
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));
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
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn() }));
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

	// #91 review F1 — rights arrive WITH THE AGENDA now: listSeasons/listRehearsals
	// ask for `_owner,_editor` (private bucket → absent for a non-grantee, which
	// IS the 'not-editor' signal), so the page derives them with zero extra
	// round-trips. The fetch router below therefore has NO rights route left: a
	// regression back to per-entity probing surfaces as an unrouted 404 here, and
	// as a failure of the "issues NO per-entity rights probe" spec.
	loadFullAgendaMock.mockResolvedValue({
		upcoming: [{ ...upcoming[0], editors: eventEditor ? ['person-p'] : [] }],
		recent: [],
		seasonId: 'season-1',
		seasonConductors: [],
		seasonOwners: [],
		seasonEditors: seasonEditor ? ['person-p'] : []
	});

	const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';

		if (method === 'DELETE') return json({ deleted: true });
		if (method === 'POST') return json({ _id: 'new-1' });

		// Pre-write value-id lookups (GET → POST → DELETE replace semantics).
		if (url.includes('?props=status')) return json({ entity: { status: [{ _id: 'val-status' }] } });
		if (url.includes('?props=edition')) return json({ entity: { edition: [] } });
		if (url.includes('?props=ordinal')) {
			return json({ entity: { ordinal: [{ _id: `val-${url.split('/').pop()}` }] } });
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

function postsTo(fetchMock: ReturnType<typeof installWorld>, fragment: string) {
	return fetchMock.mock.calls.filter(
		([url, init]) =>
			String(url).includes(fragment) && (init as RequestInit | undefined)?.method === 'POST'
	);
}

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue({
		upcoming,
		recent: [],
		seasonId: 'season-1',
		seasonConductors: [], seasonOwners: [], seasonEditors: []
	});
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
			expect(container.querySelector('[data-testid="work-manage-status-select"]')).not.toBeNull();
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
		const selects = container.querySelectorAll('[data-testid="work-manage-status-select"]');
		expect((selects[1] as HTMLSelectElement).value).toBe('retired');

		await fireEvent.change(selects[1], { target: { value: 'active' } });
		await vi.waitFor(() => {
			expect(postsTo(fetchMock, 'entity/ri-2').length).toBe(1);
		});
		expect(JSON.parse(String(postsTo(fetchMock, 'entity/ri-2')[0][1]!.body))).toEqual([
			{ type: 'status', string: 'active' }
		]);
	});

	it('changing a status writes it through: value-id lookup, DELETE of the old value, POST of the new one', async () => {
		const fetchMock = installWorld({ seasonEditor: true });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-manage-status-select"]')).not.toBeNull();
		});
		await fireEvent.change(container.querySelector('[data-testid="work-manage-status-select"]')!, {
			target: { value: 'learning' }
		});

		await vi.waitFor(() => {
			expect(postsTo(fetchMock, 'entity/ri-1').length).toBe(1);
		});
		const urls = fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${String(url)}`);
		expect(urls).toContain('GET https://api.entu.app/polyphony/entity/ri-1?props=status');
		expect(urls).toContain('DELETE https://api.entu.app/polyphony/property/val-status');
		expect(JSON.parse(String(postsTo(fetchMock, 'entity/ri-1')[0][1]!.body))).toEqual([
			{ type: 'status', string: 'learning' }
		]);
	});

	it('the status change lands OPTIMISTICALLY — the badge updates on tap, before any refetch', async () => {
		installWorld({ seasonEditor: true, repertoireItems: [RI_ACTIVE] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-status-badge"]')?.textContent).toContain(
				'active'
			);
		});
		await fireEvent.change(container.querySelector('[data-testid="work-manage-status-select"]')!, {
			target: { value: 'learning' }
		});
		expect(container.querySelector('[data-testid="work-status-badge"]')?.textContent).toContain(
			'learning'
		);
	});

	it('adding a work creates a repertoire_item under the SEASON, with an explicit domain _sharing', async () => {
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
			{ type: 'status', string: 'active' },
			{ type: '_sharing', string: 'domain' }
		]);
	});

	// #91 review F1 — the fanout. `listRehearsals` reads up to 500 events, and the
	// old shape fired one rights GET per event PLUS one for the season, on every
	// page load, for every member.
	it('issues NO per-entity rights probe — rights ride on the agenda read', async () => {
		const fetchMock = installWorld({ seasonEditor: true });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-manage-status-select"]')).not.toBeNull();
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
			expect(container.querySelector('[data-testid="work-manage-status-select"]')).not.toBeNull();
		});
		const worksReadsBefore = fetchMock.mock.calls.filter(([url]) =>
			String(url).includes('_type.string=work')
		).length;

		await fireEvent.change(container.querySelector('[data-testid="work-manage-status-select"]')!, {
			target: { value: 'learning' }
		});
		await vi.waitFor(() => {
			expect(postsTo(fetchMock, 'entity/ri-1').length).toBe(1);
		});

		expect(
			fetchMock.mock.calls.filter(([url]) => String(url).includes('_type.string=work')).length
		).toBe(worksReadsBefore);
	});

	// #91 review F5 — POST before DELETE, so a failed POST cannot leave the
	// status property EMPTY (which reads back as the schema default 'active').
	it('the status write POSTs the new value BEFORE deleting the old value-id', async () => {
		const fetchMock = installWorld({ seasonEditor: true, repertoireItems: [RI_ACTIVE] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-manage-status-select"]')).not.toBeNull();
		});
		await fireEvent.change(container.querySelector('[data-testid="work-manage-status-select"]')!, {
			target: { value: 'learning' }
		});
		await vi.waitFor(() => {
			const calls = fetchMock.mock.calls.map(
				([url, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${String(url)}`
			);
			expect(calls).toContain('DELETE https://api.entu.app/polyphony/property/val-status');
		});
		const calls = fetchMock.mock.calls.map(
			([url, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${String(url)}`
		);
		const postIdx = calls.findIndex((c) => c === 'POST https://api.entu.app/polyphony/entity/ri-1');
		const deleteIdx = calls.findIndex(
			(c) => c === 'DELETE https://api.entu.app/polyphony/property/val-status'
		);
		expect(deleteIdx).toBeGreaterThan(postIdx);
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
		await fireEvent.change(container.querySelector('[data-testid="work-manage-status-select"]')!, {
			target: { value: 'learning' }
		});
		expect(container.querySelector('[data-testid="work-status-badge"]')?.textContent).toContain(
			'learning'
		);

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
		expect(container.querySelector('[data-testid="work-status-badge"]')?.textContent).toContain(
			'learning'
		);
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
				'https://api.entu.app/polyphony/entity/ri-1'
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
			{ type: 'ordinal', number: 0 }
		]);
		expect(JSON.parse(String(postsTo(fetchMock, 'entity/pi-a')[0][1]!.body))).toEqual([
			{ type: 'ordinal', number: 1 }
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
			expect(deletes).toContain('https://api.entu.app/polyphony/entity/pi-a');
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

// (*MVOX:Josquin* — #91 review fix-forward: end-to-end management wiring)
