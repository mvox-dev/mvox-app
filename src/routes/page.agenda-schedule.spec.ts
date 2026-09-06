// @vitest-environment happy-dom
//
// #262 RED — INTEGRATION: schedule times on the REAL agenda route (/).
//
// Real +page.svelte + real AgendaList + the REAL schedule data layer
// ($lib/schedule/scheduleData) driven end-to-end from the stubbed wire — the
// same harness family as page.agenda-month-view.spec.ts, except the schedule
// producer is deliberately NOT mocked: these specs are what force GREEN to
// wire the bulk fetch into the page (a component that renders lines only in
// isolation cannot pass them).
//
// CONTRACT (issue #262, Gama 11:11 amendment + ruling 5558026158):
//   • The page bulk-fetches schedule items for the VISIBLE event ids —
//     upcoming AND recent (both row families carry the line) — via ONE
//     listScheduleItemsByEventId pass (mirror loadWorksAndManagement,
//     routes/+page.svelte:1195-1212): exactly one schedule GET per visible
//     event id, results threaded into AgendaList's NEW scheduleItemsByEventId
//     prop. The shared AgendaItem type is NOT extended.
//   • The fetch runs under its OWN load-id guard composed with the shared
//     requestId (the worksLoadId idiom) — pinned by a deterministically
//     ordered race spec.
//   • The #247 month view stays four-elements-per-row: AgendaMonthView, its
//     Props and its rendered output are byte-unchanged — with schedule data
//     PRESENT in the system, month rows still show none of it
//     (page.agenda-month-view.spec.ts:21-25 is the standing fence; the
//     with-items fixture here extends it).
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { get } from 'svelte/store';
import type { AgendaItem } from '$lib/agenda/types';

// Full-fallback paraglide mock — every key renders `[key {params}]`; copy
// assertions below match on DATA (names, clock digits, testids).
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
	resolveManageRights: vi.fn().mockResolvedValue('not-editor')
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
	listMyAttendance: vi.fn().mockResolvedValue([]),
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
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

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

// Verified Tallinn facts (EEST, UTC+3 on these dates):
//   2030-06-10T16:00Z → 19:00 Tallinn, Monday June 10 (upcoming)
//   2030-06-10T14:30Z → 17:30 Tallinn — up1's 'kogunemine'
//   2026-05-01T18:00Z → 21:00 Tallinn (recent)
//   2026-05-01T17:00Z → 20:00 Tallinn — rec1's 'proov'
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
	/** entities per `<db>:<eventId>` — absent key answers []. */
	byKey: Record<string, Array<Record<string, unknown>>>;
	/** hold every schedule GET for this db until release() — the race probe. */
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
			const db = url.includes('/crede/') ? 'crede' : 'polyphony';
			const eventId = url.match(/_parent\.reference=([^&]+)/)?.[1] ?? '';
			if (wire.holdDb === db) await gate;
			return json({ entities: wire.byKey[`${db}:${eventId}`] ?? [] });
		}
		return json({ entities: [] });
	});
	vi.stubGlobal('fetch', stub);
	return { stub, release: () => release() };
}

function setAuthed(dbs: string[] = ['polyphony']) {
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
		'polyphony:up1': [
			// Wire order reversed on purpose — the line must sort chronologically.
			scheduleEntity('s2', 'kontsert', '2030-06-10T16:00:00.000Z'), // 19:00
			scheduleEntity('s1', 'kogunemine', '2030-06-10T14:30:00.000Z') // 17:30
		],
		'polyphony:rec1': [scheduleEntity('s3', 'proov', '2026-05-01T17:00:00.000Z')] // 20:00
	}
};

async function renderAgenda(wire: ScheduleWire = DEFAULT_SCHEDULE, dbs: string[] = ['polyphony']) {
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
listMyRsvpsMock.mockResolvedValue([]);

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

// ═════════════════════════════════════════════════════════════════════════════
// 1 — the REAL producer chain reaches both row families on the real route
// ═════════════════════════════════════════════════════════════════════════════

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

// ═════════════════════════════════════════════════════════════════════════════
// 2 — the bulk fetch: one pass over the visible ids (upcoming + recent)
// ═════════════════════════════════════════════════════════════════════════════

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
		// One per visible id — never a per-row refetch storm, never a family
		// left out (both families carry the line).
		expect(parents).toEqual(['rec-bare', 'rec1', 'up-bare', 'up1']);
		// The read shape is the pinned one — type NAME, no raw id, no ordinal.
		for (const url of scheduleUrls) {
			expect(url).toContain('props=name,datetime');
			expect(url).not.toContain('_type.reference');
			expect(url).not.toContain('ordinal');
		}
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 — deterministic stale-response race (own load-id composed with requestId)
// ═════════════════════════════════════════════════════════════════════════════

describe('#262 — a stale bulk response never lands after a collective switch', () => {
	it("collective A's held schedule read, settling after the switch to B, must not reach the agenda", async () => {
		const { container, stub, release } = await renderAgenda(
			{
				byKey: {
					'polyphony:up1': [scheduleEntity('s-stale', 'stale-item', '2030-06-10T14:30:00.000Z')],
					'crede:up2': [scheduleEntity('s-fresh', 'fresh-item', '2030-07-01T14:30:00.000Z')]
				},
				holdDb: 'polyphony'
			},
			['polyphony', 'crede']
		);
		// The stale read is in flight — held by the test, deterministically.
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

		// NOW settle the stale response. Without the composed guard it would
		// overwrite the fresh record — the real assertions below trip, never a
		// timeout.
		release();
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));

		expect(container.textContent).not.toContain('stale-item');
		expect(line(container, 'up2')!.textContent).toContain('fresh-item');
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 — the #247 month view is a deliberate exclusion (four things per row)
// ═════════════════════════════════════════════════════════════════════════════

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
		// No times line survives anywhere in month mode…
		expect(container.querySelectorAll('[data-testid^="agenda-schedule-line-"]')).toHaveLength(0);
		// …and the with-items event's row carries its four things and nothing of
		// the schedule: no item name, no item time, not even the event's own time.
		const row = container.querySelector('[data-testid="agenda-month-row-up1"]')!;
		expect(row.textContent).toContain('Kevadkontsert');
		expect(row.querySelector('[data-testid="month-row-date"]')).not.toBeNull();
		expect(row.querySelector('[data-testid="event-type-badge-up1"]')).not.toBeNull();
		expect(row.textContent).not.toContain('kogunemine');
		expect(row.textContent).not.toContain('17:30');
		expect(row.textContent).not.toContain('19:00');
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 5 — structural fences: the data path is a NEW prop, not a type extension
// ═════════════════════════════════════════════════════════════════════════════

describe('#262 — scheduleItemsByEventId is the ONE data path (source fences)', () => {
	it('the prop lands in AgendaList (positive half — RED trips here) while AgendaMonthView.svelte stays schedule-free (byte-unchanged is the ruling)', () => {
		const agendaList = readFileSync(
			resolve('src/lib/components/agenda/AgendaList.svelte'),
			'utf8'
		);
		expect(agendaList).toContain('scheduleItemsByEventId');
		const monthView = readFileSync(
			resolve('src/lib/components/agenda/AgendaMonthView.svelte'),
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

// (*MVOX:Tallis* — #262 RED: agenda route integration — bulk fetch, race, month fence)
