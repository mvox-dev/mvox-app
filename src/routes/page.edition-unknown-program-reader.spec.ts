// @vitest-environment happy-dom
//
// #337 (agenda half) — RepertoireElement is SHARED: `repertoireData` returns
// `source: 'program'` for ANY event with program_items, so the agenda renders
// program rows through the identical path as /event/[id]. One test rides that:
// a rights-less reader, a TRUNCATED collective-wide edition read, a program
// row whose edition that read could not name — the row must take the unknown
// wording, never "No pinned edition" (a claim of absence a program row cannot
// express: its `edition` reference is required).
//
// Unlike its #331 sibling (page.edition-unknown-reader.spec.ts, which mocks
// `loadWorksByEventId` at its module seam and hands `truncated` over by hand),
// the works path here is REAL: the page runs the real `loadWorksByEventId`
// against a wire `fetch` stub, and the truncation is built where production
// builds it — an edition response whose `count` exceeds the rows returned,
// flowing through the real `deriveListRead`. Nothing in this file names a
// `truncated` field.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get: (_target, key) => () => `[${String(key)}]`
	})
}));

const { loadFullAgendaMock, discoverMock, gotoMock, listMyRsvpsMock } = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	listMyRsvpsMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
// NO mock of $lib/repertoire/workRows — that seam staying real is the point.
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: vi.fn().mockResolvedValue('member-1'),
	findMyRsvpForEvent: vi.fn().mockResolvedValue(null),
	listMyRsvps: listMyRsvpsMock,
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn() }));
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

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

/** The viewer holds NO rights anywhere: not on the season, not on the event.
 *  The reader branch of `loadWorksAndManagement` runs — the real
 *  `loadWorksByEventId` against the wire stub below. */
function setAuthedReader() {
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

function installAgenda() {
	loadFullAgendaMock.mockImplementation(async () =>
		fullAgendaResult({
			seasons: [],
			upcoming: [
				{
					id: 'pv-ev',
					name: 'Season Concert',
					startDatetime: future,
					durationMinutes: 90,
					location: '',
					conductors: [],
					owners: [],
					editors: []
				}
			],
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [],
			seasonOwners: [],
			seasonEditors: []
		})
	);
}

// The event HAS a programme: one program_item, its REQUIRED `edition`
// reference pointing at ed-9 — which the collective-wide edition read below
// never returns. The label lookup cannot name the pin.
const PROGRAM_ITEMS = [
	{
		_id: 'pi-2',
		name: [{ string: 'Ghost piece' }],
		edition: [{ reference: 'ed-9' }],
		ordinal: [{ number: 1 }]
	}
];

/** TRUNCATED at the wire when `editionCount` is set far above the one row
 *  returned — the real `deriveListRead` inside `listAllEditions` is what has
 *  to turn this into `truncated`, `loadWorksByEventId` is what has to put it
 *  on the row. Absent (#342's dangling-complete case), the read is COMPLETE
 *  and ed-9 is simply not in it. */
function wireStub(opts: { editionCount?: number } = {}) {
	const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (method !== 'GET') return json({ _id: 'new-1' });
		if (url.includes('_type.string=program_item')) return json({ entities: PROGRAM_ITEMS });
		if (url.includes('_type.string=edition')) {
			return json({
				...(opts.editionCount === undefined ? {} : { count: opts.editionCount }),
				entities: [
					{
						_id: 'ed-1',
						name: [{ string: 'Bärenreiter BA 5103' }],
						_parent: [{ reference: 'w-2', entity_type: 'work' }]
					}
				]
			});
		}
		if (url.includes('_type.string=work'))
			return json({
				entities: [
					{ _id: 'w-2', name: [{ string: 'Mass in B minor' }], composer: [{ string: 'J. S. Bach' }] }
				]
			});
		return json({ entities: [] });
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function workRowOf(container: HTMLElement, workName: string): HTMLElement {
	const li = Array.from(container.querySelectorAll('[data-testid="work-row"]')).find(
		(el) => el.querySelector('[data-testid="work-name"]')?.textContent?.trim() === workName
	);
	expect(li, `work-row for ${workName}`).not.toBeUndefined();
	return li as HTMLElement;
}

beforeEach(() => {
	resetTypeIdCache();
	installAgenda();
	listMyRsvpsMock.mockResolvedValue({ items: [], total: 0, truncated: false });
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadFullAgendaMock.mockReset();
	listMyRsvpsMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('#337 agenda — a reader’s program row through the shared element', () => {
	it('a program row whose pin the truncated wire read could not name says UNKNOWN, never "no pinned edition"', async () => {
		wireStub({ editionCount: 4000 });
		setAuthedReader();
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="works-line"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="work-row"]')).not.toBeNull();
		});

		const li = workRowOf(container, 'Ghost piece');
		const unknown = li.querySelector('[data-testid="work-edition-unknown"]');
		expect(unknown, 'work-edition-unknown on the reader’s program row').not.toBeNull();
		expect(unknown!.textContent).toContain('[repertoire_edition_unknown]');
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(li.textContent).not.toContain('[repertoire_no_edition]');

		// Still a reader: no management surface rides along with the wording.
		expect(li.querySelector('[data-testid="work-edition-picker"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-manage-row"]')).toBeNull();
	});
});

// #342 — the coverage gap research named: this suite (agenda, program rows,
// real works path) had NO dangling-complete case. The read below is COMPLETE
// (no `count` on the wire) and ed-9 is simply not in it — the same unknown
// row, but nothing about the list is incomplete, so the wording is the NEW
// key, never the truncated state's incompleteness claim.
describe('#342 agenda — a reader’s program row, dangling pin under a COMPLETE read', () => {
	it('a program row pinned to an edition the complete read does not hold gets the dangling wording', async () => {
		wireStub();
		setAuthedReader();
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="works-line"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="work-row"]')).not.toBeNull();
		});

		const li = workRowOf(container, 'Ghost piece');
		const unknown = li.querySelector('[data-testid="work-edition-unknown"]');
		expect(unknown, 'work-edition-unknown on the reader’s program row').not.toBeNull();
		expect(unknown!.textContent).toContain('[repertoire_edition_unknown_pinned]');
		expect(li.textContent).not.toContain('[repertoire_edition_unknown]');
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(li.textContent).not.toContain('[repertoire_no_edition]');

		// Still a reader: no management surface rides along with the wording.
		expect(li.querySelector('[data-testid="work-edition-picker"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-manage-row"]')).toBeNull();
	});
});

// (*MVOX:Tallis* — #337 RED)
// (*MVOX:Tallis* — #342 RED: dangling-complete program case added — the gap
// the research named)
