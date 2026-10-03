// @vitest-environment happy-dom
// The agenda's RSVP control asks Entu whether the singer may write.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import type { AgendaItem } from '$lib/agenda/types';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred, json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const { loadFullAgendaMock, findMyMemberIdMock, listMyRsvpsMock, applyRsvpChangeMock } =
	vi.hoisted(() => ({
		loadFullAgendaMock: vi.fn(),
		findMyMemberIdMock: vi.fn(),
		listMyRsvpsMock: vi.fn(),
		applyRsvpChangeMock: vi.fn()
	}));
vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
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
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule({ lists: 'bare', byMember: 'records' })
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { discoverMock } from '$lib/testing/routeMocks';

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
const RIGHTS_URL_OTHER =
	'https://api.entu-test.invalid/other-choir/entity/person-p?props=_owner,_editor';

const SELF_EDITOR = {
	_id: 'person-p',
	_editor: [{ reference: 'person-p' }, { reference: 'someone-else' }]
};
const SELF_OWNER_ONLY = { _id: 'person-p', _owner: [{ reference: 'person-p' }] };
const NO_GRANT = { _id: 'person-p' };
const GRANTS_EXCLUDE_SELF = {
	_id: 'person-p',
	_owner: [{ reference: 'org-admin' }],
	_editor: [{ reference: 'someone-else' }, { reference: 'another-person' }]
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

function rsvpButtons(container: HTMLElement): HTMLButtonElement[] {
	return Array.from(container.querySelectorAll('button[data-testid^="rsvp-btn-"]'));
}

async function waitForRow(container: HTMLElement, id: string): Promise<HTMLElement> {
	return waitFor(() => {
		const r = row(container, id);
		expect(r).not.toBeNull();
		return r!;
	});
}

function rightsCalls(fetchStub: ReturnType<typeof vi.fn>, url: string) {
	return fetchStub.mock.calls.filter((c) => String(c[0]) === url);
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

describe('+page — RSVP enablement is the Entu grant on the singer’s own person (#372)', () => {
	it('WIRE: enablement is GET entity/{personId}?props=_owner,_editor — full shape — and does NOT wait on findMyMemberId', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockReturnValue(new Promise(() => {}));
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		const fetchStub = stubWire({ [RIGHTS_URL]: { body: SELF_EDITOR } });
		setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);

		const { container } = render(Page);

		await waitFor(() => {
			expect(rightsCalls(fetchStub, RIGHTS_URL).length).toBeGreaterThan(0);
		});
		const [, init] = rightsCalls(fetchStub, RIGHTS_URL)[0] as [unknown, RequestInit | undefined];
		expect(init?.method ?? 'GET').toBe('GET');
		expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer jwt-abc');

		await waitFor(() => {
			const btn = row(container, 'e1')?.querySelector(
				'[data-testid="rsvp-btn-going"]'
			) as HTMLButtonElement | null;
			expect(btn).not.toBeNull();
			expect(btn!.disabled).toBe(false);
		});
	});

	it('self-_editor on her person -> all four buttons enabled, no hint', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		const fetchStub = stubWire({ [RIGHTS_URL]: { body: SELF_EDITOR } });
		setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);

		const { container } = render(Page);
		await waitForRow(container, 'e1');
		await waitFor(() => {
			expect(rightsCalls(fetchStub, RIGHTS_URL).length).toBeGreaterThan(0);
		});

		await waitFor(() => {
			for (const status of ['going', 'not_going', 'maybe', 'late']) {
				const btn = row(container, 'e1')?.querySelector(
					`[data-testid="rsvp-btn-${status}"]`
				) as HTMLButtonElement | null;
				expect(btn, `rsvp-btn-${status}`).not.toBeNull();
				expect(btn!.disabled, `rsvp-btn-${status}`).toBe(false);
			}
		});
		expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).toBeNull();
	});

	it('self-_owner only -> enabled (ownership subsumes editing)', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		const fetchStub = stubWire({ [RIGHTS_URL]: { body: SELF_OWNER_ONLY } });
		setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);

		const { container } = render(Page);

		await waitFor(() => {
			expect(rightsCalls(fetchStub, RIGHTS_URL).length).toBeGreaterThan(0);
		});
		await waitFor(() => {
			const btn = row(container, 'e1')?.querySelector(
				'[data-testid="rsvp-btn-going"]'
			) as HTMLButtonElement | null;
			expect(btn).not.toBeNull();
			expect(btn!.disabled).toBe(false);
		});
	});

	it('no grant (rights props ABSENT — the private-bucket read of a no-grant caller) -> the control is NOT rendered, even for an active member', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1'); // an ACTIVE member — #369's trap
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		const fetchStub = stubWire({ [RIGHTS_URL]: { body: NO_GRANT } });
		setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);

		const { container } = render(Page);
		const r = await waitForRow(container, 'e1');

		await waitFor(() => {
			expect(rightsCalls(fetchStub, RIGHTS_URL).length).toBeGreaterThan(0);
		});
		await waitFor(() => expect(findMyMemberIdMock).toHaveBeenCalled());
		await Promise.resolve();
		await Promise.resolve();

		expect(r.querySelector('[data-testid="rsvp-control"]')).toBeNull();
		expect(container.querySelectorAll('[data-testid="rsvp-control"]').length).toBe(0);
		expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).toBeNull();
	});

	it('rights UNRESOLVED (read still in flight) -> disabled, no hint, no invitation', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		stubWire({ [RIGHTS_URL]: { hold: true } });
		setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);

		const { container } = render(Page);
		await waitForRow(container, 'e1');
		await waitFor(() => expect(findMyMemberIdMock).toHaveBeenCalled());
		await Promise.resolve();
		await Promise.resolve();

		const buttons = rsvpButtons(container);
		expect(buttons.every((b) => b.disabled)).toBe(true);
		expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).toBeNull();
	});

	it('a collective switch mid-flight DISCARDS the stale rights answer (sameCollectiveIdentity guard)', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		const stale = deferred<Response>();
		const fetchStub = stubWire({
			[RIGHTS_URL]: { deferredResponse: stale.promise }, // sampledb: held, resolves LATE
			[RIGHTS_URL_OTHER]: { hold: true } // other-choir: unresolved
		});
		setAuthed([
			{ db: 'sampledb', name: 'Sampledb' },
			{ db: 'other-choir', name: 'Other Choir' }
		]);

		const { container } = render(Page);
		await waitFor(() => {
			expect(rightsCalls(fetchStub, RIGHTS_URL).length).toBeGreaterThan(0);
		});

		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => {
			expect(rightsCalls(fetchStub, RIGHTS_URL_OTHER).length).toBeGreaterThan(0);
		});

		stale.resolve(json({ entity: SELF_EDITOR }));
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		const buttons = rsvpButtons(container);
		expect(buttons.every((b) => b.disabled)).toBe(true);
	});

	it('#369 regression: rights props present but self in NEITHER (the 19-of-24 shape) -> never an enabled button, no control', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1'); // active member, like all 19
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		const fetchStub = stubWire({ [RIGHTS_URL]: { body: GRANTS_EXCLUDE_SELF } });
		setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);

		const { container } = render(Page);
		const r = await waitForRow(container, 'e1');
		await waitFor(() => {
			expect(rightsCalls(fetchStub, RIGHTS_URL).length).toBeGreaterThan(0);
		});
		await Promise.resolve();
		await Promise.resolve();

		expect(rsvpButtons(container).filter((b) => !b.disabled).length).toBe(0);
		expect(r.querySelector('[data-testid="rsvp-control"]')).toBeNull();
	});

	it('F1: a CONFIRMED non-member who still holds self-_editor gets the hint, NOT an enabled control', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue(null); // archived / not yet accepted
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		const fetchStub = stubWire({ [RIGHTS_URL]: { body: SELF_EDITOR } });
		setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);

		const { container } = render(Page);
		const r = await waitForRow(container, 'e1');
		await waitFor(() => {
			expect(rightsCalls(fetchStub, RIGHTS_URL).length).toBeGreaterThan(0);
		});
		await waitFor(() => {
			expect(r.querySelector('[data-testid="rsvp-non-member-hint"]')).not.toBeNull();
		});
		expect(r.querySelector('[data-testid="rsvp-control"]')).toBeNull();
		expect(rsvpButtons(container)).toEqual([]);
	});
});

// (*MVOX:Tallis*)
