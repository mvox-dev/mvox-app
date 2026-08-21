// @vitest-environment happy-dom
//
// #111 TU.3 RED — INTEGRATION half of the repertoire UX corrections (#108
// findings 2–4): the same three contracts RepertoireElement.ux.spec.ts pins at
// unit level, asserted on the REAL agenda route (+page.svelte) with only the
// agenda loader mocked and the network stubbed at `fetch` — the harness of
// page.repertoire-manage-wiring.spec.ts. Unit specs alone once shipped 1047
// green tests around controls that were unreachable in the running app; these
// exist so GREEN cannot fix the component without the page actually rendering
// the fixed surface.
//
//   Finding #2 — dividers between work rows in the expanded works view
//     (divide-y on the list, never per-row borders — happy-dom applies no
//     real CSS, so the Tailwind class list is the testable surface).
//   Finding #3 — status chip + picker unified: NO separate chip in the header
//     when the management row (status picker + Remove, one row, bottom of the
//     panel) is on screen.
//   Finding #4 — "Add to programme" stays a native <select>, full-width below
//     the sm (640px) breakpoint so its widest "Work — Edition" option can no
//     longer overflow a phone-width agenda row; sm:w-auto keeps the existing
//     inline dropdown on desktop.
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
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
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

const REPERTOIRE_ITEMS = [
	{
		_id: 'ri-1',
		name: [{ string: 'Spem in alium' }],
		work: [{ reference: 'work-1' }],
		edition: [{ reference: 'ed-1' }],
		status: [{ string: 'active' }]
	},
	{
		_id: 'ri-2',
		name: [{ string: 'Old warhorse' }],
		work: [{ reference: 'work-2' }],
		status: [{ string: 'retired' }]
	}
];

/** person-p holds `_editor` on BOTH the season and the event, so every
 *  surface under test (status row, Remove, "Add to programme") renders. */
function installWorld() {
	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
		upcoming: [
			{
				id: 'ev-1',
				name: 'Rehearsal',
				startDatetime: future,
				durationMinutes: 90,
				location: '',
				conductors: [],
				owners: [],
				editors: ['person-p']
			}
		],
		recent: [],
		seasonId: 'season-1',
		seasonConductors: [],
		seasonOwners: [],
		seasonEditors: ['person-p']
	}));

	const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (method === 'DELETE') return json({ deleted: true });
		if (method === 'POST') return json({ _id: 'new-1' });
		if (url.includes('_type.string=entity')) return json({ entities: [{ _id: 'type-1' }] });
		if (url.includes('_type.string=work')) {
			return json({
				entities: [
					{ _id: 'work-1', name: [{ string: 'Spem in alium' }] },
					{ _id: 'work-2', name: [{ string: 'Old warhorse' }] }
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
					}
				]
			});
		}
		if (url.includes('_type.string=copy')) return json({ entities: [] });
		if (url.includes('_type.string=program_item')) return json({ entities: [] });
		if (url.includes('_type.string=repertoire_item')) return json({ entities: REPERTOIRE_ITEMS });
		return json({ error: `unrouted: ${url}` }, 404);
	});

	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

/** Open the agenda row's Works disclosure and wait for the management row —
 *  the surface all three findings live on. */
async function renderExpandedAsEditor() {
	installWorld();
	setAuthedWithOneCollective();
	const rendered = render(Page);
	await vi.waitFor(() => {
		expect(rendered.container.querySelector('[data-testid="works-line"]')).not.toBeNull();
	});
	await fireEvent.click(rendered.container.querySelector('[data-testid="works-line"]')!);
	await vi.waitFor(() => {
		expect(rendered.container.querySelector('[data-testid="work-manage-row"]')).not.toBeNull();
	});
	return rendered;
}

beforeEach(() => {
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

describe('+page — repertoire UX corrections on the real agenda route (#111)', () => {
	it('the expanded works list separates its rows with dividers, none on the outer edges (finding 2)', async () => {
		const { container } = await renderExpandedAsEditor();
		const list = container.querySelector(
			'[data-testid="works-expanded"] ol, [data-testid="works-expanded"] ul'
		);
		expect(list).not.toBeNull();
		expect((list as HTMLElement).className).toMatch(/(^|\s)divide-y(-\d+)?(\s|$)/);
		const workRows = container.querySelectorAll('[data-testid="work-row"]');
		expect(workRows.length).toBe(2);
		for (const li of workRows) {
			expect(li.className).not.toMatch(/(^|\s)(sm:|max-sm:)?border-[tby]\b/);
		}
	});

	it('an editor gets ONE status/actions row per panel — status buttons + Remove at the bottom, no separate header chip (finding 3)', async () => {
		const { container } = await renderExpandedAsEditor();
		// No chip anywhere on the editor surface …
		expect(container.querySelector('[data-testid="work-status-badge"]')).toBeNull();
		// … because the bottom row is the single status surface, Remove beside it.
		for (const li of container.querySelectorAll('[data-testid="work-row"]')) {
			const statusButton = li.querySelector('[data-testid="work-status-active"]');
			const remove = li.querySelector('[data-testid="work-manage-remove"]');
			expect(statusButton).not.toBeNull();
			expect(remove).not.toBeNull();
			const manageRow = statusButton!.closest('[data-testid="work-manage-row"]');
			expect(remove!.closest('[data-testid="work-manage-row"]')).toBe(manageRow);
			expect(manageRow!.parentElement!.lastElementChild).toBe(manageRow);
		}
	});

	it('"Add to programme" on the page is a native <select>, full-width on mobile, auto on desktop (finding 4)', async () => {
		const { container } = await renderExpandedAsEditor();
		const select = container.querySelector('[data-testid="work-manage-add-programme-select"]');
		expect(select).not.toBeNull();
		expect((select as HTMLElement).tagName).toBe('SELECT');
		expect((select as HTMLElement).className).toMatch(/(^|\s)w-full(\s|$)/);
		expect((select as HTMLElement).className).toMatch(/(^|\s)sm:w-auto(\s|$)/);
	});
});
