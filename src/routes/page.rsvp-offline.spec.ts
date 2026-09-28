// @vitest-environment happy-dom
//
// #434 slice 6/6 RED (agenda integration) — the agenda row's RSVP is gated
// while offline, through the REAL +page -> AgendaList -> RsvpControl chain.
//
// CONTRACT: the ONE signal store ($lib/net/online) flips to offline
// (navigator.onLine false + the window `offline` event). Then on the agenda:
//   • every rsvp-btn-* on a row the singer may write is `disabled`;
//   • the row's rsvp-control shows the VISIBLE sentence
//     [data-testid="rsvp-write-unavailable"] = m.write_unavailable_no_signal();
//   • a click dispatches nothing: applyRsvpChange is never called and fetch is
//     not called at all (nothing is queued for later either);
//   • the `online` event re-enables the buttons, removes the sentence, and a
//     click dispatches the write again.
// Harness: page.rsvp-rights-gate.spec.ts's (real rights predicate, global
// fetch stubbed at the wire, applyRsvpChange module-mocked).
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import type { AgendaItem } from '$lib/agenda/types';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const { loadFullAgendaMock, discoverMock, gotoMock, findMyMemberIdMock, listMyRsvpsMock, applyRsvpChangeMock } =
	vi.hoisted(() => ({
		loadFullAgendaMock: vi.fn(),
		discoverMock: vi.fn(),
		gotoMock: vi.fn(),
		findMyMemberIdMock: vi.fn(),
		listMyRsvpsMock: vi.fn(),
		applyRsvpChangeMock: vi.fn()
	}));
vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
// NOTE — deliberately NO mock of $lib/repertoire/repertoireActions here: the
// enablement read must reach the WIRE through the real resolveManageRights, so
// this spec can pin the request URL full-shape. The database-entity fallback is
// stubbed to null so the ONLY resolveManageRights caller is rsvp enablement.
vi.mock('$lib/collective/databaseEntity', async (importActual) => ({
	...(await importActual<typeof import('$lib/collective/databaseEntity')>()),
	resolveDatabaseEntityId: vi.fn().mockResolvedValue(null)
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: findMyMemberIdMock,
	listMyRsvps: listMyRsvpsMock,
	rsvpsByEventId: (rsvps: Array<{ rsvpId: string; eventId: string; status: string }>) => {
		const map: Record<string, { rsvpId: string; status: string }> = {};
		for (const r of rsvps) map[r.eventId] = { rsvpId: r.rsvpId, status: r.status };
		return map;
	},
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/rsvp/rsvpOptimistic', () => ({ applyRsvpChange: applyRsvpChangeMock }));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn() }));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn(),
	listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllRsvpsForEvent: vi.fn(),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: (
		records: Array<{ attendanceId: string; memberId: string; status: string }>
	) => {
		const map: Record<string, { attendanceId: string; status: string }> = {};
		for (const r of records) map[r.memberId] = { attendanceId: r.attendanceId, status: r.status };
		return map;
	}
}));
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { goOffline, goOnline, resetOnLine, settle, expectVisibleReason } from '$lib/testing/networkSignal';


function agendaEvent(id: string, startDatetime: string): AgendaItem {
	return {
		id,
		name: `Rehearsal ${id}`,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: []
	} as AgendaItem;
}

const E1 = agendaEvent('e1', '2026-06-15T09:00:00.000Z');

function agendaWith(events: AgendaItem[]) {
	return fullAgendaResult({
		seasons: [],
		upcoming: events,
		recent: [],
		seasonId: null,
		seasonConductors: [],
		seasonOwners: [],
		seasonEditors: []
	});
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

/** The exact enablement read (ER-26 shape) — full URL, pinned byte-for-byte. */
const RIGHTS_URL = 'https://api.entu-test.invalid/sampledb/entity/person-p?props=_owner,_editor';

/** Person-entity rights fixtures — on the PERSON entity, never member rows. */
const SELF_EDITOR = {
	_id: 'person-p',
	_editor: [{ reference: 'person-p' }, { reference: 'someone-else' }]
};
type RightsAnswer = { body?: unknown; hold?: boolean; deferredResponse?: Promise<Response> };

/** Global-fetch stub: answers the person rights read per fixture; everything
 *  else (sections, library, repertoire lists…) gets an inert empty list. */
function stubWire(rights: Record<string, RightsAnswer>) {
	const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		for (const [rightsUrl, answer] of Object.entries(rights)) {
			if (url === rightsUrl) {
				if (answer.hold) return new Promise<Response>(() => {});
				if (answer.deferredResponse) return answer.deferredResponse;
				return json({ entity: answer.body });
			}
		}
		void init;
		return json({ entities: [] });
	});
	vi.stubGlobal('fetch', fetchStub);
	return fetchStub;
}

function setAuthed(dbs: Array<{ db: string; name: string }>) {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: Object.fromEntries(dbs.map((d) => [d.db, 'person-p'])),
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: dbs.map((d) => ({ db: d.db, name: d.name, personId: 'person-p' })),
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(dbs[0].db);
	completionGateStore.set('complete');
}

function row(container: HTMLElement, id: string): HTMLElement | null {
	return container.querySelector(`[data-testid="agenda-row-${id}"]`);
}

async function waitForRow(container: HTMLElement, id: string): Promise<HTMLElement> {
	return waitFor(() => {
		const r = row(container, id);
		expect(r).not.toBeNull();
		return r!;
	});
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	applyRsvpChangeMock.mockReset();
	discoverMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetGate();
});


const REASON = '[write_unavailable_no_signal]';

afterEach(() => {
	resetOnLine();
});

async function renderWritableRow() {
	loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
	findMyMemberIdMock.mockResolvedValue('member-1');
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	applyRsvpChangeMock.mockResolvedValue(undefined);
	const fetchStub = stubWire({ [RIGHTS_URL]: { body: SELF_EDITOR } });
	setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);
	await goOnline();

	const { container } = render(Page);
	const r = await waitForRow(container, 'e1');
	await waitFor(() => {
		const btn = r.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
		expect(btn).not.toBeNull();
		expect(btn!.disabled).toBe(false);
	});
	return { container, row: r, fetchStub };
}

describe('+page (agenda) — RSVP while offline (#434 slice 6)', () => {
	it('offline: the row’s four buttons are disabled and the reason is visible inside its control', async () => {
		const { row: r } = await renderWritableRow();
		await goOffline();

		await waitFor(() => {
			for (const status of ['going', 'not_going', 'maybe', 'late']) {
				const btn = r.querySelector(`[data-testid="rsvp-btn-${status}"]`) as HTMLButtonElement;
				expect(btn.disabled, `rsvp-btn-${status}`).toBe(true);
			}
		});
		const control = r.querySelector('[data-testid="rsvp-control"]') as HTMLElement;
		expectVisibleReason(control, 'rsvp-write-unavailable', REASON);
	});

	it('offline: a click dispatches no write and issues no fetch', async () => {
		const { row: r, fetchStub } = await renderWritableRow();
		await goOffline();
		await settle();
		const callsBefore = fetchStub.mock.calls.length;

		await fireEvent.click(r.querySelector('[data-testid="rsvp-btn-going"]') as HTMLElement);
		await settle();

		expect(applyRsvpChangeMock).not.toHaveBeenCalled();
		expect(fetchStub.mock.calls.length).toBe(callsBefore);
	});

	it('back online: enabled again, the reason gone, and a click dispatches the write', async () => {
		const { row: r } = await renderWritableRow();
		await goOffline();
		await goOnline();

		await waitFor(() => {
			const btn = r.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement;
			expect(btn.disabled).toBe(false);
		});
		expect(r.querySelector('[data-testid="rsvp-write-unavailable"]')).toBeNull();
		await fireEvent.click(r.querySelector('[data-testid="rsvp-btn-going"]') as HTMLElement);
		await waitFor(() => expect(applyRsvpChangeMock).toHaveBeenCalledTimes(1));
	});
});

// (*MVOX:Tallis* — #434 slice 6 RED)
