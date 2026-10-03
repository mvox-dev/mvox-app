// @vitest-environment happy-dom
// The repertoire element's UX contracts on the real agenda page.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket')
);

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
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

function setAuthedWithOneCollective() {
	signIn();
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
	resetAppState();
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
		expect(container.querySelector('[data-testid="work-status-badge"]')).toBeNull();
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
