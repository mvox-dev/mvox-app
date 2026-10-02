// @vitest-environment happy-dom
// Repertoire and programme management wired through the agenda page; only fetch is stubbed.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

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
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: vi.fn().mockResolvedValue('member-1'),
	listMyRsvps: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({
	loadRoster: vi.fn(async () => ({ items: [], total: 0, truncated: false }))
}));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn(),
	listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
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

interface WorldOptions {
	seasonEditor?: boolean;
	eventEditor?: boolean;
	programItems?: Array<Record<string, unknown>>;
	repertoireItems?: Array<Record<string, unknown>>;
	workCount?: number;
	editionCount?: number;
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

function installWorld(options: WorldOptions = {}) {
	const {
		seasonEditor = true,
		eventEditor = false,
		programItems = [],
		repertoireItems = [RI_ACTIVE, RI_RETIRED],
		workCount,
		editionCount
	} = options;

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

		if (url.includes('?props=status')) return json({ entity: { status: [{ _id: 'val-status' }] } });
		if (url.includes('?props=edition')) return json({ entity: { edition: [] } });
		if (url.includes('?props=ordinal')) {
			const itemId = url.split('/').pop()?.split('?')[0];
			return json({ entity: { ordinal: [{ _id: `val-${itemId}` }] } });
		}
		if (url.includes('_type.string=entity')) return json({ entities: [{ _id: 'type-1' }] });
		if (url.includes('_type.string=work')) {
			return json({
				...(workCount === undefined ? {} : { count: workCount }),
				entities: [
					{ _id: 'work-1', name: [{ string: 'Spem in alium' }] },
					{ _id: 'work-2', name: [{ string: 'Old warhorse' }] },
					{ _id: 'work-3', name: [{ string: 'Nunc dimittis' }] }
				]
			});
		}
		if (url.includes('_type.string=edition')) {
			return json({
				...(editionCount === undefined ? {} : { count: editionCount }),
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

async function renderAndExpand() {
	const rendered = render(Page);
	await vi.waitFor(() => {
		expect(rendered.container.querySelector('[data-testid="works-line"]')).not.toBeNull();
	});
	await fireEvent.click(rendered.container.querySelector('[data-testid="works-line"]')!);
	return rendered;
}

function rowStatus(container: HTMLElement, workName: string): string | null {
	const li = Array.from(container.querySelectorAll('[data-testid="work-row"]')).find(
		(el) => el.querySelector('[data-testid="work-name"]')?.textContent?.trim() === workName
	);
	return li?.getAttribute('data-status') ?? null;
}

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
		expect(urls).toContain('GET https://api.entu-test.invalid/sampledb/entity/ri-1?props=status');
		expect(urls).not.toContain('DELETE https://api.entu-test.invalid/sampledb/property/val-status');
		expect(JSON.parse(String(postsTo(fetchMock, 'entity/ri-1')[0][1]!.body))).toEqual([
			{ _id: 'val-status', type: 'status', string: 'learning' }
		]);
	});

	it('the status change lands OPTIMISTICALLY — the picker updates on tap, before any refetch', async () => {
		installWorld({ seasonEditor: true, repertoireItems: [RI_ACTIVE] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

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

	it('issues NO per-entity rights probe — rights ride on the agenda read', async () => {
		const fetchMock = installWorld({ seasonEditor: true });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-status-active"]')).not.toBeNull();
		});
		const rightsProbes = fetchMock.mock.calls.filter(
			([url]) => String(url).includes('props=_owner,_editor') && !String(url).includes('/entity/person-p?')
		);
		expect(rightsProbes).toEqual([]);
	});

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
		expect(calls).not.toContain('DELETE https://api.entu-test.invalid/sampledb/property/val-status');
		expect(JSON.parse(String(postsTo(fetchMock, 'entity/ri-1')[0][1]!.body))).toEqual([
			{ _id: 'val-status', type: 'status', string: 'learning' }
		]);
	});

	it('a settling create does NOT clobber a still-in-flight status change', async () => {
		let releaseStatusPost: (() => void) | undefined;
		const statusPostLanded = new Promise<void>((resolve) => {
			releaseStatusPost = resolve;
		});
		const base = installWorld({ seasonEditor: true, repertoireItems: [RI_ACTIVE] });
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

		expect(rowStatus(container, 'Spem in alium')).toBe('learning');
		releaseStatusPost!();
	});

	it('a removed work becomes pickable again without waiting for a page reload', async () => {
		installWorld({ seasonEditor: true, repertoireItems: [RI_ACTIVE] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		const optionCount = () =>
			container.querySelector('[data-testid="work-manage-add-work-select"]')?.querySelectorAll('option')
				.length ?? 0;

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
				'https://api.entu-test.invalid/sampledb/entity/ri-1'
			);
		});
	});
});

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

	it('a reorder disables EVERY row in the programme, and a second move while it runs is a no-op', async () => {
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
		await fireEvent.click(container.querySelectorAll('[data-testid="work-manage-move-up"]')[1]);

		const ups = [...container.querySelectorAll('[data-testid="work-manage-move-up"]')];
		expect(ups.every((btn) => (btn as HTMLButtonElement).disabled)).toBe(true);

		await fireEvent.click(ups[2]);
		await vi.waitFor(() => {
			expect(postsTo(fetchMock, 'entity/pi-b').length).toBe(1);
		});
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
			expect(deletes).toContain('https://api.entu-test.invalid/sampledb/entity/pi-a');
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
			{ type: 'ordinal', number: 0 }
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

type WireWork = { _id: string; name?: Array<{ string: string }>; composer?: Array<{ string: string }> };

const DEFAULT_COMPOSER_WORKS: WireWork[] = [
	{
		_id: 'work-1',
		name: [{ string: 'Spem in alium' }],
		composer: [{ string: 'Thomas Tallis' }]
	},
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
			'Old warhorse — Eulenburg'
		]);
	});

	it('an edition whose work has NO name on the wire falls back to the bare edition label — no leading " — "', async () => {
		installComposerWorld({ seasonEditor: false, eventEditor: true, programItems: [] }, [
			{
				_id: 'work-1',
				name: [{ string: 'Spem in alium' }],
				composer: [{ string: 'Thomas Tallis' }]
			},
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
		await vi.waitFor(() => {
			expect(
				postsTo(fetchMock, '/entity').filter(([url]) => String(url).endsWith('/entity')).length
			).toBe(1);
		});
		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-programme-button"]'),
				'post-add: selection reset → button hidden again'
			).toBeNull();
		});
	});

	it('an EVENT editor with NO programme yet and NOTHING pickable still gets the wrapper — select absent, button absent, the fallback works render un-crashed', async () => {
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
		expect(container.querySelectorAll('[data-testid="work-row"]').length).toBeGreaterThan(0);
	});
});

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
		armPickerHold() {
			armed = true;
			heldWork = false;
			heldEdition = false;
		},
		armRowHold() {
			armedRows = true;
			heldRow = false;
		},
		heldCount: () => held.length,
		rowHeldCount: () => heldRows.length,
		async releasePickerReads({ editionsEmpty = false, worksEmpty = false, fail = false } = {}) {
			armed = false;
			const toRelease = held.splice(0, held.length);
			for (const read of toRelease) {
				if (fail) {
					read.resolve(json({ error: 'boom' }, 500));
				} else if (editionsEmpty && read.kind === 'edition') {
					read.resolve(json({ entities: [] }));
				} else if (worksEmpty && read.kind === 'work') {
					read.resolve(json({ entities: [] }));
				} else {
					read.resolve(await base(read.url));
				}
			}
		},
		async releaseRowReads() {
			armedRows = false;
			const toRelease = heldRows.splice(0, heldRows.length);
			for (const read of toRelease) {
				read.resolve(await base(read.url));
			}
		}
	};
}

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
	await vi.waitFor(() => {
		expect(world.heldCount()).toBe(2);
	});
	if (holdRows) {
		await vi.waitFor(() => {
			expect(world.rowHeldCount()).toBe(1);
		});
	}
}

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

		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-programme-select"]')
			).not.toBeNull();
		});

		await submitSeasonCreateAndEnterReload(container, world);
		await reExpandWorks(container);

		expect(
			container.querySelector('[data-testid="work-manage-add-programme-select"]'),
			'reload in flight → the control the admin just saw must STAY on screen (PO ruling: ' +
				'visibility keys off "no options once loading has COMPLETED", never off a ' +
				'still-loading list being transiently empty)'
		).not.toBeNull();

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

		expect(
			container.querySelector('[data-testid="work-manage-add-programme-select"]'),
			'reload in flight → the control must STAY visible until loading has COMPLETED'
		).not.toBeNull();

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

		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-programme-select"]')
			).not.toBeNull();
		});

		await submitSeasonCreateAndEnterReload(container, world, { holdRows: true });

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="works-manage-empty"]')).not.toBeNull();
		});
		expect(
			container.querySelector('[data-testid="work-manage-add-programme-select"]'),
			'both sources in flight → the control must STAY on screen'
		).not.toBeNull();

		await world.releasePickerReads();
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

describe('#311 — the Add Work picker keys hiding off "nothing left to pick once loading COMPLETED SUCCESSFULLY"', () => {
	it('RELOAD resolving works-EMPTY: the select stays through the window, then hides once the load completes with nothing left to pick', async () => {
		const world = installReloadWorld({ seasonEditor: true, eventEditor: true, programItems: [] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			const select = container.querySelector('[data-testid="work-manage-add-work-select"]');
			expect(select).not.toBeNull();
			expect(select!.querySelector('option[value="work-3"]')).not.toBeNull();
		});

		await submitSeasonCreateAndEnterReload(container, world);
		await reExpandWorks(container);

		expect(
			container.querySelector('[data-testid="work-manage-add-work-select"]'),
			'reload in flight → the Add Work control the admin just saw must STAY on screen'
		).not.toBeNull();

		await world.releasePickerReads({ worksEmpty: true });
		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-work-select"]'),
				'loading COMPLETED with nothing left to pick → the select resolves to hidden'
			).toBeNull();
		});
		expect(container.querySelector('[data-testid="work-manage-add-work-button"]')).toBeNull();
		expect(container.querySelectorAll('[data-testid="work-row"]').length).toBeGreaterThan(0);
	});

	it('RELOAD resolving NON-empty: the select never vanishes — visible before, THROUGH the window, and after, with the real options', async () => {
		const world = installReloadWorld({ seasonEditor: true, eventEditor: true, programItems: [] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-work-select"]')
			).not.toBeNull();
		});

		await submitSeasonCreateAndEnterReload(container, world);
		await reExpandWorks(container);

		expect(
			container.querySelector('[data-testid="work-manage-add-work-select"]'),
			'a reload with a non-empty library must never make the control vanish and reappear'
		).not.toBeNull();

		await world.releasePickerReads();
		await vi.waitFor(() => {
			const select = container.querySelector(
				'[data-testid="work-manage-add-work-select"]'
			) as HTMLSelectElement | null;
			expect(select).not.toBeNull();
			expect(select!.querySelector('option[value="work-3"]')).not.toBeNull();
		});
	});

	it('RELOAD whose picker load FAILS: the select does NOT hide — "Empty pickers, not a broken page" stands, hiding requires a load that completed SUCCESSFULLY', async () => {
		const world = installReloadWorld({ seasonEditor: true, eventEditor: true, programItems: [] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-work-select"]')
			).not.toBeNull();
		});

		await submitSeasonCreateAndEnterReload(container, world);
		await reExpandWorks(container);

		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await world.releasePickerReads({ fail: true });
		await new Promise((r) => setTimeout(r, 30));
		expect(errorSpy.mock.calls.map((call) => call[0])).toEqual(
			expect.arrayContaining([
				'repertoire pickers: loading the library works failed',
				'repertoire pickers: loading the library editions failed'
			])
		);
		errorSpy.mockRestore();
		expect(
			container.querySelector('[data-testid="work-manage-add-work-select"]'),
			'a FAILED load must never hide the control — no picker, no error, nothing anywhere is the bug'
		).not.toBeNull();
	});

	it('FIRST render with the picker load held: the select is ALREADY visible (safe default — deliberately asymmetric with the editions first-render guard), and hides only once the load completes empty', async () => {
		const world = installReloadWorld({ seasonEditor: true, eventEditor: true, programItems: [] });
		world.armPickerHold();
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(world.heldCount()).toBe(2);
		});
		expect(
			container.querySelector('[data-testid="work-manage-add-work-select"]'),
			'first render, load in flight → the works select renders (default is RENDER, not length > 0)'
		).not.toBeNull();

		await world.releasePickerReads({ worksEmpty: true });
		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-work-select"]'),
				'the initial load completing to genuine emptiness hides it — same rule as the reload'
			).toBeNull();
		});
	});
});

describe('#321 review F2 — the agenda repertoire pickers state a truncated library read', () => {
	const WORK_OPTION = 'work-manage-add-work-partial-option';
	const PROGRAMME_OPTION = 'work-manage-add-programme-partial-option';

	function lastOption(container: HTMLElement, selectTestid: string): HTMLOptionElement {
		const select = container.querySelector(`[data-testid="${selectTestid}"]`) as HTMLSelectElement;
		expect(select, `expected [data-testid="${selectTestid}"]`).not.toBeNull();
		const options = Array.from(select.options);
		return options[options.length - 1];
	}

	it('a truncated WORK read puts the notice inside the Add-work select, as a trailing disabled option', async () => {
		installWorld({ workCount: 900 });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector(`[data-testid="${WORK_OPTION}"]`)).not.toBeNull();
		});
		const last = lastOption(container, 'work-manage-add-work-select');
		expect(last.getAttribute('data-testid')).toBe(WORK_OPTION);
		expect(last.disabled).toBe(true);
		expect(last.textContent?.trim()).toBe('[picker_partial_options_notice]');
		expect(
			Array.from(
				(container.querySelector('[data-testid="work-manage-add-work-select"]') as HTMLSelectElement)
					.options
			).some((o) => o.textContent?.includes('Nunc dimittis'))
		).toBe(true);
	});

	it('a truncated EDITION read raises it in the Add-to-programme select — and NOT in the works one', async () => {
		installWorld({ eventEditor: true, editionCount: 4000 });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector(`[data-testid="${PROGRAMME_OPTION}"]`)).not.toBeNull();
		});
		expect(lastOption(container, 'work-manage-add-programme-select').disabled).toBe(true);
		expect(container.querySelector(`[data-testid="${WORK_OPTION}"]`)).toBeNull();
	});

	it('with both reads complete neither option is in the DOM', async () => {
		installWorld({ eventEditor: true });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();
		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-manage-add-work-select"]')).not.toBeNull();
		});

		expect(container.querySelector(`[data-testid="${WORK_OPTION}"]`)).toBeNull();
		expect(container.querySelector(`[data-testid="${PROGRAMME_OPTION}"]`)).toBeNull();
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Josquin*)
