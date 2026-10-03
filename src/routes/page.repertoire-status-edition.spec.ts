// @vitest-environment happy-dom
// The repertoire status and edition controls on the real agenda page.
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
		if (url.includes('?props=status')) return json({ entity: { status: [{ _id: 'val-status' }] } });
		if (url.includes('?props=edition')) {
			return json({ entity: { edition: [{ _id: 'val-edition' }] } });
		}
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
					},
					{
						_id: 'ed-2',
						name: [{ string: 'Bärenreiter urtext' }],
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
	const fetchMock = installWorld();
	setAuthedWithOneCollective();
	const rendered = render(Page);
	await vi.waitFor(() => {
		expect(rendered.container.querySelector('[data-testid="works-line"]')).not.toBeNull();
	});
	await fireEvent.click(rendered.container.querySelector('[data-testid="works-line"]')!);
	await vi.waitFor(() => {
		expect(rendered.container.querySelector('[data-testid="work-manage-row"]')).not.toBeNull();
	});
	return { ...rendered, fetchMock };
}

function workRowOf(container: HTMLElement, workName: string): HTMLElement {
	const li = Array.from(container.querySelectorAll('[data-testid="work-row"]')).find(
		(el) => el.querySelector('[data-testid="work-name"]')?.textContent?.trim() === workName
	);
	expect(li, `work-row for ${workName}`).not.toBeUndefined();
	return li as HTMLElement;
}

function postsTo(fetchMock: ReturnType<typeof installWorld>, fragment: string) {
	return fetchMock.mock.calls.filter(
		([url, init]) =>
			String(url).includes(fragment) && (init as RequestInit | undefined)?.method === 'POST'
	);
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

describe('+page — repertoire status/edition UX on the real agenda route (#125)', () => {
	it('the expanded works wrapper is unindented — no pl-4 (nor pl-3+) on works-expanded (F4)', async () => {
		const { container } = await renderExpandedAsEditor();
		const wrapper = container.querySelector('[data-testid="works-expanded"]');
		expect(wrapper).not.toBeNull();
		expect((wrapper as HTMLElement).className).not.toMatch(
			/(^|\s)pl-(?:[3-9]|[1-9]\d)(?:\.\d+)?(\s|$)/
		);
	});

	it('the page renders four inline status buttons per row inside work-manage-row, no status <select> (F5a)', async () => {
		const { container } = await renderExpandedAsEditor();
		expect(container.querySelector('[data-testid="work-manage-status-select"]')).toBeNull();
		const li = workRowOf(container, 'Spem in alium');
		const manageRow = li.querySelector('[data-testid="work-manage-row"]');
		expect(manageRow).not.toBeNull();
		for (const status of ['learning', 'active', 'retired', 'dropped']) {
			const btn = manageRow!.querySelector(`[data-testid="work-status-${status}"]`);
			expect(btn, `work-status-${status}`).not.toBeNull();
			expect((btn as HTMLElement).tagName).toBe('BUTTON');
		}
		expect(
			manageRow!.querySelector('[data-testid="work-status-active"]')!.getAttribute('aria-pressed')
		).toBe('true');
		expect(
			manageRow!.querySelector('[data-testid="work-status-retired"]')!.getAttribute('aria-pressed')
		).toBe('false');
		expect(manageRow!.querySelector('[data-testid="work-manage-remove"]')).not.toBeNull();
	});

	it('clicking a status button drives the REAL write path: data-status flips and the wire sees the POST (F5a)', async () => {
		const { container, fetchMock } = await renderExpandedAsEditor();
		const li = workRowOf(container, 'Spem in alium');
		expect(li.getAttribute('data-status')).toBe('active');
		await fireEvent.click(li.querySelector('[data-testid="work-status-retired"]')!);
		await vi.waitFor(() => {
			expect(workRowOf(container, 'Spem in alium').getAttribute('data-status')).toBe('retired');
		});
		await vi.waitFor(() => {
			const posts = postsTo(fetchMock, 'entity/ri-1');
			expect(
				posts.some(([, init]) =>
					String((init as RequestInit).body).includes('"string":"retired"')
				)
			).toBe(true);
		});
	});

	it('the page renders ONE unified edition picker showing the pinned edition, no [Pin] button (F5b)', async () => {
		const { container } = await renderExpandedAsEditor();
		expect(container.querySelector('[data-testid="work-manage-pin-edition-button"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-manage-pin-edition-select"]')).toBeNull();
		const picker = workRowOf(container, 'Spem in alium').querySelector(
			'[data-testid="work-edition-picker"]'
		);
		expect(picker).not.toBeNull();
		expect((picker as HTMLElement).tagName).toBe('SELECT');
		expect((picker as HTMLSelectElement).value).toBe('ed-1');
	});

	it('changing the picker pins immediately on the wire — edition POST for ri-1, no confirm step (F5b)', async () => {
		const { container, fetchMock } = await renderExpandedAsEditor();
		const picker = workRowOf(container, 'Spem in alium').querySelector(
			'[data-testid="work-edition-picker"]'
		)!;
		await fireEvent.change(picker, { target: { value: 'ed-2' } });
		await vi.waitFor(() => {
			const posts = postsTo(fetchMock, 'entity/ri-1');
			expect(
				posts.some(([, init]) =>
					String((init as RequestInit).body).includes('"reference":"ed-2"')
				)
			).toBe(true);
		});
	});

	it('a work with no editions gets NO picker on the page; its read-only edition line stays (F5b)', async () => {
		const { container } = await renderExpandedAsEditor();
		const li = workRowOf(container, 'Old warhorse');
		expect(li.querySelector('[data-testid="work-edition-picker"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-no-edition"]')).not.toBeNull();
	});
});
