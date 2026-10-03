// @vitest-environment happy-dom
// The agenda row's RSVP is gated while offline.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import type { AgendaItem } from '$lib/agenda/types';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const { applyRsvpChangeMock } = vi.hoisted(() => ({
		applyRsvpChangeMock: vi.fn()
	}));
vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).databaseEntityModule(await importOriginal())
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('records')
);
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
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { goOffline, goOnline, resetOnLine, settle, expectVisibleReason } from '$lib/testing/networkSignal';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { discoverMock } from '$lib/testing/routeMocks';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';

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

const RIGHTS_URL = 'https://api.entu-test.invalid/sampledb/entity/person-p?props=_owner,_editor';

const SELF_EDITOR = {
	_id: 'person-p',
	_editor: [{ reference: 'person-p' }, { reference: 'someone-else' }]
};
type RightsAnswer = { body?: unknown; hold?: boolean; deferredResponse?: Promise<Response> };

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
	signIn({ collectives: dbs.map((d) => ({ db: d.db, name: d.name, personId: 'person-p' })) });
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
	resetAppState();
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

// (*MVOX:Tallis*)
