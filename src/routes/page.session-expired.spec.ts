// @vitest-environment happy-dom
//
// #107 RED — auth token expiry recovery on the AGENDA page (integration).
//
// When the agenda load fails BECAUSE THE SESSION EXPIRED (Entu 401 → the
// entuFetch layer rejects with an error whose `name === 'AuthExpiredError'` —
// see request.auth-expired.spec.ts for that contract), the page must say so:
// a session-expired notice with a sign-in link — NOT the misleading
// "Couldn't load the agenda" + Retry (retrying with a dead token can never
// succeed).
//
// CONTRACT (for the GREEN implementer):
//   - detection via `isAuthExpiredError` from `$lib/entu/request` (name-tag
//     duck typing — this spec constructs a plain Error with the name set, so
//     the check must NOT be instanceof);
//   - `data-testid="session-expired"` — the notice container;
//   - `data-testid="session-expired-signin"` — an <a> whose href points at
//     `/auth/login`;
//   - Paraglide keys `session_expired_message` / `session_expired_signin`
//     (mocked below);
//   - the generic `agenda-error` / `agenda-retry` UI must NOT render for this
//     failure class. (Generic failures keep it — page.agenda-error.spec.ts
//     already pins that regression side.)
//
// Mock scaffolding is inherited verbatim from page.agenda-error.spec.ts — the
// page pulls the same module graph regardless of which failure we exercise.
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		agenda_empty_no_events: () => 'No upcoming events.',
		agenda_duration_min: (params: { minutes: number }) => `${params.minutes} min`,
		agenda_today: () => 'Today',
		agenda_tomorrow: () => 'Tomorrow',
		agenda_gap_weeks: (params: { weeks: number }) => `In ${params.weeks} weeks`,
		agenda_load_error: () => "Couldn't load the agenda.",
		agenda_retry: () => 'Retry',
		// #214 — the filter chip row renders whenever the agenda has any
		// events at all, so its message keys must exist in every mock that
		// renders the real +page.svelte with a non-empty agenda.
		agenda_filter_all: () => 'All',
		agenda_filter_group_label: () => 'Filter by event type',
		agenda_filter_empty: () => 'No events match this filter.',
		// #107 — the session-expired notice this RED spec introduces.
		session_expired_message: () => 'Your session has expired. Please sign in again.',
		session_expired_signin: () => 'Sign in'
	}
}));

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
// Same boundary severing as page.agenda-error.spec.ts (see the rationale
// comments there): $env is unavailable outside a SvelteKit request context
// under happy-dom, and the write layers are not this spec's subject.
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn().mockResolvedValue('not-editor')
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
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn() }));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn(),
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
vi.mock('$lib/repertoire/workRows', () => ({ loadWorksByEventId: vi.fn().mockResolvedValue({}) }));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

/** The error shape the entuFetch layer rejects with on 401 — duck-typed by
 *  name so the page's detection works across module boundaries (contract in
 *  request.auth-expired.spec.ts). */
function authExpiredError(): Error {
	const e = new Error('Entu returned 401 — session expired');
	e.name = 'AuthExpiredError';
	return e;
}

function setAuthedWithOneCollective() {
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'p1' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'p1' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue([]);

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	gotoMock.mockReset();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('/ (agenda) — session expired (#107)', () => {
	it('an auth-expired load shows the session-expired notice with a sign-in link — NOT "Couldn\'t load the agenda" + Retry', async () => {
		loadFullAgendaMock.mockRejectedValueOnce(authExpiredError());
		setAuthedWithOneCollective();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-skeleton"]')).toBeNull();
		});

		// The truthful state: session expired, with a way back in.
		const notice = container.querySelector('[data-testid="session-expired"]');
		expect(notice, 'session-expired notice must render').not.toBeNull();
		const signin = container.querySelector('[data-testid="session-expired-signin"]');
		expect(signin, 'session-expired notice must carry a sign-in link').not.toBeNull();
		expect(signin?.getAttribute('href') ?? '').toContain('/auth/login');

		// The misleading state: a data-loading error with a Retry that can never
		// succeed against a dead token.
		expect(container.querySelector('[data-testid="agenda-error"]')).toBeNull();
		expect(container.querySelector('[data-testid="agenda-retry"]')).toBeNull();
	});

	it('a GENERIC load failure still shows the agenda error + retry (auth handling must not swallow it)', async () => {
		loadFullAgendaMock.mockRejectedValueOnce(new Error('network down'));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-skeleton"]')).toBeNull();
		});
		expect(container.querySelector('[data-testid="agenda-error"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="agenda-retry"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="session-expired"]')).toBeNull();
	});
});

// (*MVOX:Tallis*)
