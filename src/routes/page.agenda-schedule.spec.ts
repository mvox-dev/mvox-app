// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { get } from 'svelte/store';
import type { AgendaItem } from '$lib/agenda/types';
import { json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

type AppLocale = 'en' | 'et' | 'lv' | 'uk';
const localeMock = vi.hoisted(() => ({
	state: null as { get(k: string): string | undefined; set(k: string, v: string): unknown } | null
}));
vi.mock('$lib/paraglide/runtime.js', async () => {
	const { SvelteMap } = await import('svelte/reactivity');
	localeMock.state ??= new SvelteMap<string, string>([['locale', 'en']]);
	return {
		getLocale: () => localeMock.state!.get('locale'),
		setLocale: vi.fn(),
		locales: ['en', 'et', 'lv', 'uk'],
		overwriteGetLocale: vi.fn()
	};
});

const { loadFullAgendaMock, discoverMock, gotoMock, findMyMemberIdMock, listMyRsvpsMock } =
	vi.hoisted(() => ({
		loadFullAgendaMock: vi.fn(),
		discoverMock: vi.fn(),
		gotoMock: vi.fn(),
		findMyMemberIdMock: vi.fn(),
		listMyRsvpsMock: vi.fn()
	}));
vi.mock('$lib/agenda/agendaData', () => ({
	loadFullAgenda: loadFullAgendaMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn((..._args: unknown[]) => {
		const [, entityId, personId] = _args as [unknown, string, string];
		return Promise.resolve(entityId === personId ? 'editor' : 'not-editor');
	})
}));
vi.mock('$lib/collective/databaseEntity', async (importActual) => ({
	...(await importActual<typeof import('$lib/collective/databaseEntity')>()),
	resolveDatabaseEntityId: vi.fn().mockResolvedValue(null)
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: findMyMemberIdMock,
	listMyRsvps: listMyRsvpsMock,
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn() }));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn().mockResolvedValue([]),
	listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllRsvpsForEvent: vi.fn().mockResolvedValue([]),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
}));
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

function item(
	id: string,
	name: string,
	startDatetime: string,
	eventType = 'rehearsal'
): AgendaItem {
	return {
		id,
		name,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: [],
		eventType
	} as AgendaItem;
}

const UP1 = item('up1', 'Kevadkontsert', '2030-06-10T16:00:00.000Z', 'concert');
const UP_BARE = item('up-bare', 'Tavaline proov', '2030-06-12T16:00:00.000Z');
const REC1 = item('rec1', 'Talvekontsert', '2026-05-01T18:00:00.000Z', 'concert');
const REC_BARE = item('rec-bare', 'Vana proov', '2026-05-02T18:00:00.000Z');

function scheduleEntity(id: string, name: string, iso: string) {
	return {
		_id: id,
		name: [{ _id: `val-${id}-name`, string: name }],
		datetime: [{ _id: `val-${id}-dt`, datetime: iso }]
	};
}

type ScheduleWire = {
	byKey: Record<string, Array<Record<string, unknown>>>;
	holdDb?: string;
};

function stubScheduleWire(wire: ScheduleWire) {
	let release: () => void = () => {};
	const gate = new Promise<void>((r) => {
		release = r;
	});
	const stub = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('_type.string=schedule_item')) {
			const db = url.includes('/crede/') ? 'crede' : 'sampledb';
			const eventId = url.match(/_parent\.reference=([^&]+)/)?.[1] ?? '';
			if (wire.holdDb === db) await gate;
			return json({ entities: wire.byKey[`${db}:${eventId}`] ?? [] });
		}
		return json({ entities: [] });
	});
	vi.stubGlobal('fetch', stub);
	return { stub, release: () => release() };
}

function setAuthed(dbs: string[] = ['sampledb']) {
	authStore.set({
		status: 'authenticated',
		personIdByDb: Object.fromEntries(dbs.map((db) => [db, 'p1'])),
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: dbs.map((db) => ({ db, name: db, personId: 'p1' })),
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(dbs[0]);
}

const DEFAULT_SCHEDULE: ScheduleWire = {
	byKey: {
		'sampledb:up1': [
			scheduleEntity('s2', 'kontsert', '2030-06-10T16:00:00.000Z'),
			scheduleEntity('s1', 'kogunemine', '2030-06-10T14:30:00.000Z')
		],
		'sampledb:rec1': [scheduleEntity('s3', 'proov', '2026-05-01T17:00:00.000Z')]
	}
};

async function renderAgenda(wire: ScheduleWire = DEFAULT_SCHEDULE, dbs: string[] = ['sampledb']) {
	const { stub, release } = stubScheduleWire(wire);
	loadFullAgendaMock.mockImplementation(async () =>
		get(selectedCollectiveDbStore) === 'crede'
			? fullAgendaResult({
					upcoming: [item('up2', 'Crede kontsert', '2030-07-01T16:00:00.000Z', 'concert')],
					recent: []
				})
			: fullAgendaResult({ upcoming: [UP1, UP_BARE], recent: [REC1, REC_BARE] })
	);
	setAuthed(dbs);
	const rendered = render(Page);
	await waitFor(() => {
		expect(rendered.container.querySelector('[data-testid="agenda-skeleton"]')).toBeNull();
	});
	return { container: rendered.container as HTMLElement, stub, release };
}

function line(container: HTMLElement, eventId: string): HTMLElement | null {
	return container.querySelector(`[data-testid="agenda-schedule-line-${eventId}"]`);
}

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue(toListRead([]));

beforeEach(() => {
	localeMock.state?.set('locale', 'en');
});

afterEach(async () => {
	cleanup();
	vi.unstubAllGlobals();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	const prefs = await import('$lib/preferences/agendaView').catch(() => null);
	prefs?.setAgendaView('list');
	if (typeof localStorage !== 'undefined') localStorage.clear();
});

describe('#262 — / renders the times line from the real wire (both families)', () => {
	it('an upcoming row with items shows its chronological line; bare rows stay line-free', async () => {
		const { container } = await renderAgenda();
		await waitFor(() => {
			expect(line(container, 'up1')).not.toBeNull();
		});
		const row = container.querySelector('[data-testid="agenda-row-up1"]')!;
		expect(row.contains(line(container, 'up1'))).toBe(true);
		const text = line(container, 'up1')!.textContent ?? '';
		expect(text).toContain('17:30 kogunemine');
		expect(text).toContain('19:00 kontsert');
		expect(text.indexOf('kogunemine')).toBeLessThan(text.indexOf('kontsert'));
		expect(line(container, 'up-bare')).toBeNull();
	});

	it("a RECENT row with items shows the line too (ruling 5558026158) — and its bare sibling doesn't", async () => {
		const { container } = await renderAgenda();
		await waitFor(() => {
			expect(line(container, 'rec1')).not.toBeNull();
		});
		const recentRow = container.querySelector('[data-testid="agenda-recent-row-rec1"]')!;
		expect(recentRow.contains(line(container, 'rec1'))).toBe(true);
		expect(line(container, 'rec1')!.textContent).toContain('20:00 proov');
		expect(line(container, 'rec-bare')).toBeNull();
	});

	it("event.start_datetime keeps the row's primary time slot — the row-time cell still shows the event's own 19:00, not a schedule item's", async () => {
		const { container } = await renderAgenda();
		await waitFor(() => {
			expect(line(container, 'up1')).not.toBeNull();
		});
		const rowTime = container.querySelector(
			'[data-testid="agenda-row-up1"] [data-testid="row-time"]'
		);
		expect(rowTime?.textContent?.trim()).toBe('19:00');
	});
});

describe('#262 — bulk schedule fetch (the loadWorksAndManagement idiom)', () => {
	it('issues exactly ONE schedule GET per visible event id, covering upcoming AND recent', async () => {
		const { container, stub } = await renderAgenda();
		await waitFor(() => {
			expect(line(container, 'up1')).not.toBeNull();
			expect(line(container, 'rec1')).not.toBeNull();
		});
		const scheduleUrls = stub.mock.calls
			.map((c) => String(c[0]))
			.filter((u) => u.includes('_type.string=schedule_item'));
		const parents = scheduleUrls.map((u) => u.match(/_parent\.reference=([^&]+)/)?.[1]).sort();
		expect(parents).toEqual(['rec-bare', 'rec1', 'up-bare', 'up1']);
		for (const url of scheduleUrls) {
			expect(url).toContain('props=name,datetime');
			expect(url).not.toContain('_type.reference');
			expect(url).not.toContain('ordinal');
		}
	});
});

describe('#262 — a stale bulk response never lands after a collective switch', () => {
	it("collective A's held schedule read, settling after the switch to B, must not reach the agenda", async () => {
		const { container, stub, release } = await renderAgenda(
			{
				byKey: {
					'sampledb:up1': [scheduleEntity('s-stale', 'stale-item', '2030-06-10T14:30:00.000Z')],
					'crede:up2': [scheduleEntity('s-fresh', 'fresh-item', '2030-07-01T14:30:00.000Z')]
				},
				holdDb: 'sampledb'
			},
			['sampledb', 'crede']
		);
		await waitFor(() => {
			expect(
				stub.mock.calls.some((c) => String(c[0]).includes('_type.string=schedule_item'))
			).toBe(true);
		});

		selectedCollectiveDbStore.set('crede');
		await waitFor(() => {
			expect(line(container, 'up2')).not.toBeNull();
		});
		expect(line(container, 'up2')!.textContent).toContain('fresh-item');

		release();
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));

		expect(container.textContent).not.toContain('stale-item');
		expect(line(container, 'up2')!.textContent).toContain('fresh-item');
	});
});

describe('#262 — month view shows NO schedule data (extends the #247 fence with a with-items fixture)', () => {
	it('with schedule items present in the system, month rows render none of them — the four-things contract holds', async () => {
		const { container } = await renderAgenda();
		await waitFor(() => {
			expect(line(container, 'up1')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="agenda-view-month"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-month-row-up1"]')).not.toBeNull();
		});
		expect(container.querySelectorAll('[data-testid^="agenda-schedule-line-"]')).toHaveLength(0);
		const row = container.querySelector('[data-testid="agenda-month-row-up1"]')!;
		expect(row.textContent).toContain('Kevadkontsert');
		expect(row.querySelector('[data-testid="month-row-date"]')).not.toBeNull();
		expect(row.querySelector('[data-testid="event-type-badge-up1"]')).not.toBeNull();
		expect(row.textContent).not.toContain('kogunemine');
		expect(row.textContent).not.toContain('17:30');
		expect(row.textContent).not.toContain('19:00');
	});
});

describe('#262 — scheduleItemsByEventId is the ONE data path (source fences)', () => {
	it('the prop lands in AgendaList (positive half — RED trips here) while AgendaMonthView.svelte stays schedule-free (byte-unchanged is the ruling)', () => {
		const agendaList = readFileSync(
			resolve('src/lib/agenda/AgendaList.svelte'),
			'utf8'
		);
		expect(agendaList).toContain('scheduleItemsByEventId');
		const monthView = readFileSync(
			resolve('src/lib/agenda/AgendaMonthView.svelte'),
			'utf8'
		);
		expect(monthView).not.toMatch(/schedule/i);
	});

	it('the schedule module exists as the ONE producer (positive half — RED trips here) while the shared AgendaItem type is NOT extended', () => {
		const scheduleModule = readFileSync(resolve('src/lib/schedule/scheduleData.ts'), 'utf8');
		expect(scheduleModule).toContain('listScheduleItemsByEventId');
		const types = readFileSync(resolve('src/lib/agenda/types.ts'), 'utf8');
		expect(types).not.toMatch(/schedule/i);
	});
});
