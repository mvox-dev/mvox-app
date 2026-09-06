// @vitest-environment happy-dom
//
// #201 RED — empty-state onboarding banner on the ACTUAL agenda route
// (integration: real +page.svelte, real AgendaList, real manageRightsFrom /
// deriveSeasonCreateRights — only the data seams are mocked; same harness
// family as page.season-create.spec.ts).
//
// WHY (#201): a fresh collective's agenda is an empty page with no guidance.
// The correct flow (create a season → open its management panel → add an event
// series → events are generated) was only discoverable via the runbook (Crede
// pilot, Joosep). The app must teach the flow when the collective is fresh.
//
// Pinned wiring contract (GREEN must implement):
//
//   GATE — the banner renders IFF ALL THREE hold:
//     - `!agendaLoading`               (never over the skeleton)
//     - `seasons.length === 0`         (the collective has NO seasons at all —
//                                       the moment the flow needs teaching; a
//                                       lapsed season means the flow is known)
//     - `seasonCreateRights === 'editor'` (only someone who CAN create a season
//                                       gets told to; fail-closed like every
//                                       other gate on this page — a non-editor
//                                       keeps the existing generic empty state)
//
//   TESTIDS
//     agenda-onboarding        the banner container (explanatory steps)
//     agenda-onboarding-cta    RETIRED by #261: with zero seasons the
//                              standalone [+ Season] (season-create) is the
//                              ONLY control on the surface — the banner keeps
//                              its explanatory steps but presents no second
//                              create button of its own
//
//   COPY — localized paraglide keys, never hardcoded strings (Comenius owns
//   the real copy; this spec asserts KEYS via the proxy message mock):
//     agenda_onboarding_step_season    step 1 — create a season
//     agenda_onboarding_step_series    step 2 — add an event series
//     agenda_onboarding_step_events    step 3 — events are generated
//   The three step keys must appear IN THAT ORDER in the banner's text — the
//   sequence IS the content (season → series → events).
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — every key renders as its own name, so content
// assertions below can only pass when the component goes through paraglide
// (a hardcoded English string would NOT contain the key name).
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const {
	loadFullAgendaMock,
	loadRosterMock,
	createSeasonMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock,
	discoverMock,
	gotoMock,
	findMyMemberIdMock,
	listMyRsvpsMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	loadRosterMock: vi.fn(),
	createSeasonMock: vi.fn(),
	resolveDatabaseEntityIdMock: vi.fn(),
	resolveManageRightsMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: createSeasonMock,
	createEventSeries: vi.fn(),
	createEvent: vi.fn()
}));
vi.mock('$lib/collective/databaseEntity', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/collective/databaseEntity')>();
	return { ...actual, resolveDatabaseEntityId: resolveDatabaseEntityIdMock };
});
// Only the ONE entity-rights round-trip is stubbed (`manageRightsFrom` and every
// other helper stays real): with no season at all, the season-create gate falls
// back to the ORGANIZATION's rights — this mock IS the banner's rights switch.
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: resolveManageRightsMock
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
// $env/dynamic/public is unavailable outside a SvelteKit request context under
// happy-dom; stubbing the base url keeps every real module in play.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
// Supplementary page data, irrelevant here — mocked so no real fetch fires.
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: findMyMemberIdMock,
	listMyRsvps: listMyRsvpsMock,
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn().mockResolvedValue([]),
	listMyAttendance: vi.fn().mockResolvedValue([]),
	listAllRsvpsForEvent: vi.fn().mockResolvedValue([]),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
}));
// #234 — importOriginal for collectSources/buildWorkRows: the panel's new
// repertoire section calls them for real (pure, no fetch); only
// loadWorksByEventId (the fetching entry point) is mocked here.
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));
vi.mock('$lib/library/libraryData', () => ({
	listWorks: vi.fn().mockResolvedValue([]),
	listAllEditions: vi.fn().mockResolvedValue([]),
	listAllCopies: vi.fn().mockResolvedValue([])
}));
vi.mock('$lib/repertoire/repertoireData', () => ({
	listRepertoireItems: vi.fn().mockResolvedValue([])
}));

import Page from './+page.svelte';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import type { Season } from '$lib/seasons/types';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── fixtures ────────────────────────────────────────────────────────────────────

const ORG_EFK = '69c7f8718489bfcb0e81b065';

/** ISO calendar date `offsetDays` from now — keeps the fixtures time-bomb-free. */
function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/** A CURRENT season (started a month ago, two months to run) the viewer edits. */
function currentSeason(): Season {
	return {
		id: 'season-1',
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
		conductors: [],
		owners: [],
		editors: ['person-p']
	};
}

/** The FRESH collective: no seasons, no events — the #201 state. */
function freshCollectiveResult() {
	return fullAgendaResult({ seasons: [] });
}

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

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(freshCollectiveResult());
	loadRosterMock.mockResolvedValue([]);
	createSeasonMock.mockResolvedValue('season-new-1');
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	// Default: the viewer MAY create seasons (the banner's happy path). The
	// fail-closed cases override this per test.
	resolveManageRightsMock.mockResolvedValue('editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue([]);
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	createSeasonMock.mockReset();
	resolveDatabaseEntityIdMock.mockReset();
	resolveManageRightsMock.mockReset();
	discoverMock.mockReset();
	gotoMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

/** Render + wait for the agenda load to settle (skeleton gone). */
async function renderSettled(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-skeleton')).toBeNull();
	});
	return container;
}

// ── the gate ────────────────────────────────────────────────────────────────────

describe('agenda — empty-state onboarding banner (#201): the gate', () => {
	it('renders for a season-editor on a fresh collective (loaded, zero seasons)', async () => {
		const container = await renderSettled();

		await waitFor(() => {
			expect(q(container, 'agenda-onboarding')).not.toBeNull();
		});
	});

	it('is ABSENT while the agenda is still loading — never over the skeleton', async () => {
		// A load that never settles: the page stays in agendaLoading forever.
		loadFullAgendaMock.mockImplementation(() => new Promise(() => {}));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		await waitFor(() => {
			expect(q(container, 'agenda-skeleton')).not.toBeNull();
		});
		expect(q(container, 'agenda-onboarding')).toBeNull();
	});

	it('is ABSENT when the collective has seasons — even for an editor', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [currentSeason()] }));
		const container = await renderSettled();

		// The empty agenda has settled (no events in the fixture) …
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		// … and a collective that already HAS a season gets no onboarding.
		expect(q(container, 'agenda-onboarding')).toBeNull();
	});

	it('is ABSENT for a non-editor — the existing generic empty state stays', async () => {
		resolveManageRightsMock.mockResolvedValue('not-editor');
		const container = await renderSettled();

		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalled();
		});
		// The pre-#201 empty state is untouched for singers …
		expect(q(container, 'agenda-empty')).not.toBeNull();
		// … and no onboarding tells them to do something they cannot.
		expect(q(container, 'agenda-onboarding')).toBeNull();
	});

	it('fail-closed: an ERRORED organization rights read is not a grant', async () => {
		resolveManageRightsMock.mockResolvedValue('error');
		const container = await renderSettled();

		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalled();
		});
		expect(q(container, 'agenda-onboarding')).toBeNull();
	});
});

// ── the content ─────────────────────────────────────────────────────────────────

describe('agenda — empty-state onboarding banner (#201): the content', () => {
	it('guides season → series → events IN ORDER, via localized keys (never hardcoded copy)', async () => {
		const container = await renderSettled();

		const banner = await waitFor(() => {
			const el = q(container, 'agenda-onboarding');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});

		// The proxy message mock renders each key AS its key name — so these
		// substrings can only appear if the banner goes through paraglide.
		const text = banner.textContent ?? '';
		const seasonAt = text.indexOf('agenda_onboarding_step_season');
		const seriesAt = text.indexOf('agenda_onboarding_step_series');
		const eventsAt = text.indexOf('agenda_onboarding_step_events');
		expect(seasonAt).toBeGreaterThanOrEqual(0);
		expect(seriesAt).toBeGreaterThanOrEqual(0);
		expect(eventsAt).toBeGreaterThanOrEqual(0);
		// The sequence IS the lesson: season first, then series, then events.
		expect(seasonAt).toBeLessThan(seriesAt);
		expect(seriesAt).toBeLessThan(eventsAt);
	});

	it('#261 — the banner presents NO cta of its own: agenda-onboarding-cta is retired, and the standalone [+ Season] is the single create control on the surface', async () => {
		const container = await renderSettled();

		await waitFor(() => {
			expect(q(container, 'agenda-onboarding')).not.toBeNull();
		});
		expect(
			q(container, 'agenda-onboarding-cta'),
			'#261 — the banner’s second create button merges into the standalone [+ Season]'
		).toBeNull();
		const create = q(container, 'season-create') as HTMLElement;
		expect(create, 'the ONE control an admin can act on').not.toBeNull();
		expect(
			q(container, 'agenda-onboarding')?.contains(create),
			'[+ Season] stands on its own, not inside the banner'
		).toBe(false);
	});
});

// ── the single create control (#261) ────────────────────────────────────────────

describe('agenda — empty-state onboarding (#201/#261): the standalone [+ Season]', () => {
	it('clicking [+ Season] opens the EXISTING inline season-create form — step 1 made actionable, same route', async () => {
		const container = await renderSettled();

		const create = await waitFor(() => {
			const el = q(container, 'season-create');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		await fireEvent.click(create);

		await waitFor(() => {
			expect(q(container, 'season-create-form')).not.toBeNull();
		});
		// Actionable in place: no navigation, and nothing was written yet.
		expect(gotoMock).not.toHaveBeenCalled();
		expect(createSeasonMock).not.toHaveBeenCalled();
	});

	// #201 review F1 (held through #261) — the banner must UNMOUNT once the
	// form is open (`showSeasonCreate && !seasonCreateOpen` idiom): left
	// mounted, a second trigger click would re-run `openSeasonCreateForm`,
	// which unconditionally blanks every season-create field — silently
	// discarding in-progress input.
	it('the banner unmounts once the form is open, so no leftover trigger can re-run and blank in-progress input', async () => {
		const container = await renderSettled();

		const create = await waitFor(() => {
			const el = q(container, 'season-create');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		await fireEvent.click(create);

		const nameInput = await waitFor(() => {
			const el = q(container, 'season-create-name');
			expect(el).not.toBeNull();
			return el as HTMLInputElement;
		});
		// No second trigger survives above the open form …
		expect(q(container, 'agenda-onboarding')).toBeNull();
		expect(q(container, 'agenda-onboarding-cta')).toBeNull();
		expect(q(container, 'season-create')).toBeNull();

		// … so typed input cannot be blanked out from under the editor.
		await fireEvent.input(nameInput, { target: { value: 'Hooaeg 2027' } });
		expect(nameInput.value).toBe('Hooaeg 2027');
	});
});

// (*MVOX:Tallis*)
