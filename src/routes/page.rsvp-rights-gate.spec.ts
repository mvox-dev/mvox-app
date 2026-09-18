// @vitest-environment happy-dom
//
// #372 RED (agenda surface) — the RSVP control asks Entu whether the singer
// may write.
//
// PARADIGM (issue #362, ratified): Entu's grants are the only authority. The
// rsvp entity is created with `_parent` = the singer's own PERSON entity
// (rsvpData.createRsvp), so the grant that permits the write is
// `_editor`/`_owner` on that person (ER-27). The control's ENABLED state must
// derive from exactly that grant — read on the wire as
//
//   GET entity/{personId}?props=_owner,_editor
//
// via the app's ONE rights predicate (repertoireActions.resolveManageRights /
// manageRightsFrom, `.reference` only — ER-26). Membership (findMyMemberId)
// may survive as DISPLAY (the non-member hint) and as the WRITE payload's
// memberId — it must never feed enablement.
//
// Where the grant is ABSENT (rights props live in the private bucket: a
// no-grant caller reads the person entity WITHOUT `_owner`/`_editor` at all),
// NO control renders — not disabled, not a hint-bearing invitation (Gama
// ruling on #372). #369 is the mismatch this pins: 19 of 24 crede members saw
// fully enabled buttons for a write Entu always refused.
//
// INTEGRATION posture: the real +page -> AgendaList -> RsvpControl chain with
// the REAL rights predicate — only global fetch is stubbed at the wire, so the
// enablement read's URL is pinned full-shape, end to end.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import type { AgendaItem } from '$lib/agenda/types';
import { render, cleanup, waitFor } from '@testing-library/svelte';
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

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

/** The exact enablement read (ER-26 shape) — full URL, pinned byte-for-byte. */
const RIGHTS_URL = 'https://api.entu-test.invalid/polyphony/entity/person-p?props=_owner,_editor';
const RIGHTS_URL_OTHER =
	'https://api.entu-test.invalid/other-choir/entity/person-p?props=_owner,_editor';

/** Person-entity rights fixtures — on the PERSON entity, never member rows. */
const SELF_EDITOR = {
	_id: 'person-p',
	_editor: [{ reference: 'person-p' }, { reference: 'someone-else' }]
};
const SELF_OWNER_ONLY = { _id: 'person-p', _owner: [{ reference: 'person-p' }] };
/** The private-bucket case: a no-grant caller sees NO rights props at all. */
const NO_GRANT = { _id: 'person-p' };
/** The #369 shape: rights props visible but the singer's own id in NEITHER. */
const GRANTS_EXCLUDE_SELF = {
	_id: 'person-p',
	_owner: [{ reference: 'org-admin' }],
	_editor: [{ reference: 'someone-else' }, { reference: 'another-person' }]
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
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetGate();
});

describe('+page — RSVP enablement is the Entu grant on the singer’s own person (#372)', () => {
	it('WIRE: enablement is GET entity/{personId}?props=_owner,_editor — full shape — and does NOT wait on findMyMemberId', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		// The member lookup NEVER resolves: if enablement consulted it, the
		// control could never enable in this test.
		findMyMemberIdMock.mockReturnValue(new Promise(() => {}));
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		const fetchStub = stubWire({ [RIGHTS_URL]: { body: SELF_EDITOR } });
		setAuthed([{ db: 'polyphony', name: 'Polyphony' }]);

		const { container } = render(Page);

		// The read happened, byte-exact URL, authenticated GET.
		await waitFor(() => {
			expect(rightsCalls(fetchStub, RIGHTS_URL).length).toBeGreaterThan(0);
		});
		const [, init] = rightsCalls(fetchStub, RIGHTS_URL)[0] as [unknown, RequestInit | undefined];
		expect(init?.method ?? 'GET').toBe('GET');
		expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer jwt-abc');

		// Grant in hand -> enabled, while the member lookup is STILL in flight:
		// membership is not consulted for enablement.
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
		setAuthed([{ db: 'polyphony', name: 'Polyphony' }]);

		const { container } = render(Page);
		await waitForRow(container, 'e1');
		// The MECHANISM is the pin, not the coincidence of an enabled button:
		// the grant was actually read off her person entity.
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
		setAuthed([{ db: 'polyphony', name: 'Polyphony' }]);

		const { container } = render(Page);

		// Mechanism pin — the grant read happened (RED today: it never does).
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
		setAuthed([{ db: 'polyphony', name: 'Polyphony' }]);

		const { container } = render(Page);
		const r = await waitForRow(container, 'e1');

		// The rights answer arrived and settled…
		await waitFor(() => {
			expect(rightsCalls(fetchStub, RIGHTS_URL).length).toBeGreaterThan(0);
		});
		await waitFor(() => expect(findMyMemberIdMock).toHaveBeenCalled());
		await Promise.resolve();
		await Promise.resolve();

		// …and NO control renders on the row: not disabled, not a hint.
		expect(r.querySelector('[data-testid="rsvp-control"]')).toBeNull();
		expect(container.querySelectorAll('[data-testid="rsvp-control"]').length).toBe(0);
		expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).toBeNull();
	});

	it('rights UNRESOLVED (read still in flight) -> disabled, no hint, no invitation', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		stubWire({ [RIGHTS_URL]: { hold: true } });
		setAuthed([{ db: 'polyphony', name: 'Polyphony' }]);

		const { container } = render(Page);
		await waitForRow(container, 'e1');
		await waitFor(() => expect(findMyMemberIdMock).toHaveBeenCalled());
		await Promise.resolve();
		await Promise.resolve();

		// Whatever renders while the answer is pending, it must not INVITE: no
		// enabled button, no hint.
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
			[RIGHTS_URL]: { deferredResponse: stale.promise }, // polyphony: held, resolves LATE
			[RIGHTS_URL_OTHER]: { hold: true } // other-choir: unresolved
		});
		setAuthed([
			{ db: 'polyphony', name: 'Polyphony' },
			{ db: 'other-choir', name: 'Other Choir' }
		]);

		const { container } = render(Page);
		// Polyphony's rights read is in flight…
		await waitFor(() => {
			expect(rightsCalls(fetchStub, RIGHTS_URL).length).toBeGreaterThan(0);
		});

		// …switch away while it hangs…
		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => {
			expect(rightsCalls(fetchStub, RIGHTS_URL_OTHER).length).toBeGreaterThan(0);
		});

		// …NOW the stale polyphony answer lands: editor. It belongs to the OLD
		// identity and must be discarded — other-choir's own answer is still
		// unresolved, so nothing may enable.
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
		setAuthed([{ db: 'polyphony', name: 'Polyphony' }]);

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

	// #372 review F1 — the grant alone is NOT sufficient. Every person mvox mints
	// carries self-`_editor` on her own person (inviteData.ts step 3, mirroring
	// entu-api's auth auto-create) and deactivation never revokes it
	// (memberLifecycle flips only the member `status`), so an archived — or
	// invited-but-not-yet-accepted — person arrives here as
	// "confirmed non-member + self-editor". Reading the grant first gave her a
	// fully enabled control whose every tap throws 'cannot create without a
	// memberId' (the rsvp entity requires a `member` reference she hasn't got) —
	// #372's own defect, reintroduced by a different route — and made the hint
	// unreachable in production, since only a person WITHOUT self-editor could
	// ever have seen it.
	it('F1: a CONFIRMED non-member who still holds self-_editor gets the hint, NOT an enabled control', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue(null); // archived / not yet accepted
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		const fetchStub = stubWire({ [RIGHTS_URL]: { body: SELF_EDITOR } });
		setAuthed([{ db: 'polyphony', name: 'Polyphony' }]);

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
