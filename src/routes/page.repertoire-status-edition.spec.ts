// @vitest-environment happy-dom
//
// #125 RED — INTEGRATION half of the repertoire status/edition UX rework
// (SPIKE findings F4/F5a/F5b): the same contracts
// RepertoireElement.status-edition.spec.ts pins at unit level, asserted on the
// REAL agenda route (+page.svelte) with only the agenda loader mocked and the
// network stubbed at `fetch` — the harness of
// page.repertoire-manage-wiring.spec.ts. Unit specs alone once shipped 1047
// green tests around controls that were unreachable in the running app; these
// exist so GREEN cannot fix the component without the page actually wiring the
// new controls to the real write layer.
//
//   F4  — `works-expanded` loses its pl-4: work titles sit near the event
//         row's left edge.
//   F5a — four inline status buttons (no <select>); clicking one drives the
//         REAL optimistic path: `data-status` on the row flips (the
//         render-owned surface — a control's value is tautological under
//         fireEvent) and the Entu wire sees the status POST.
//   F5b — one unified edition picker (no [Pin] button); changing it drives
//         pinEdition on the wire with no confirm step. A work with no
//         editions gets no picker on the page either.
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

// ri-1 (Spem, work-1) has TWO editions to pick between; ri-2 (Old warhorse,
// work-2) has NONE — the picker-hidden case on the real page.
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
 *  management surface under test renders. Write routes answer like the
 *  wiring spec's world so the GET → POST → DELETE replace flow completes. */
function installWorld() {
	loadFullAgendaMock.mockResolvedValue({ seasons: [],
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
	});

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

/** Open the agenda row's Works disclosure and wait for the management row. */
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

/** The <li> rendering the named work. */
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
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
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
		// Current status distinguished, and [Remove] shares the row.
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
		// Optimistic render — the row's own attribute, never a control's value.
		await vi.waitFor(() => {
			expect(workRowOf(container, 'Spem in alium').getAttribute('data-status')).toBe('retired');
		});
		// And the Entu wire actually saw the status write for ri-1.
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
