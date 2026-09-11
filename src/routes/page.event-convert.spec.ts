// @vitest-environment happy-dom
//
// #196 — the standalone hint in the event-creation form, plus the locale
// parity guards for the event-convert key set (integration: real +page.svelte;
// only the data seams are mocked — same harness family as
// page.event-create.spec.ts / page.season-manage.spec.ts).
//
// WHY (#196, Joosep / Crede pilot 2026-08-31): "I started intuitively, created
// a standalone 'proov' expecting to make it recurring. The app doesn't offer a
// path from standalone to series — the standalone event was wasted effort."
//
//   PHASE 1 — THE HINT: the event-creation form says, while NO series is
//   selected, that recurring events want the series flow (localized key,
//   never hardcoded copy). The hint leaves the moment a series is chosen.
//   Still HERE: the event-create form lives in the season panel.
//
//   PHASE 2 — THE CONVERSION: RELOCATED by #313. The season panel's
//   standalone-event list (and its per-row convert control) is REMOVED; the
//   conversion flow now lives on the EVENT PAGE. The full behaviour contract
//   — form, validation, occurrence loop, resume, dialog — moved with it to
//   src/routes/event/[id]/page.event-convert.spec.ts. The event_convert_*
//   keys are REUSED by the relocated form, so their locale parity stays
//   pinned here unchanged.
//
//   TESTIDS
//     event-create-series-hint            the phase-1 hint INSIDE the event
//                                         creation form — rendered while the
//                                         series select holds '' (standalone),
//                                         gone while a series is chosen
//
//   I18N — all user-visible copy through Paraglide keys, present and
//   non-empty in ALL FOUR locales (en/et/lv/uk); `event_convert_failed`
//   carries the {step} placeholder in every locale (the loud-failure pin).
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
// Unlike the plain key-echo proxy elsewhere, this one appends the params as
// JSON so a spec can pin that a message RECEIVED its parameter without
// pinning translated copy.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy(
		{},
		{
			get:
				(_target, key) =>
				(params?: Record<string, unknown>) =>
					params && Object.keys(params).length > 0
						? `${String(key)} ${JSON.stringify(params)}`
						: String(key)
		}
	)
}));

const {
	loadFullAgendaMock,
	loadRosterMock,
	createEventMock,
	convertEventToSeriesMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock,
	discoverMock,
	gotoMock,
	findMyMemberIdMock,
	listMyRsvpsMock,
	listEventSeriesForSeasonMock,
	listEventsForSeasonMock,
	updateSeasonFieldMock,
	addSeasonConductorMock,
	removeSeasonConductorMock,
	getSeriesDefaultsMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	loadRosterMock: vi.fn(),
	createEventMock: vi.fn(),
	convertEventToSeriesMock: vi.fn(),
	resolveDatabaseEntityIdMock: vi.fn(),
	resolveManageRightsMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	listEventSeriesForSeasonMock: vi.fn(),
	listEventsForSeasonMock: vi.fn(),
	updateSeasonFieldMock: vi.fn(),
	addSeasonConductorMock: vi.fn(),
	removeSeasonConductorMock: vi.fn(),
	getSeriesDefaultsMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: vi.fn(),
	createEventSeries: vi.fn(),
	createEvent: createEventMock
}));
// #196 — the conversion seam (its page wiring lives on the event page since
// #313). The real module's error class rides along.
vi.mock('$lib/events/eventConvert', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/events/eventConvert')>();
	return { ...actual, convertEventToSeries: convertEventToSeriesMock };
});
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: updateSeasonFieldMock,
	addSeasonConductor: addSeasonConductorMock,
	removeSeasonConductor: removeSeasonConductorMock,
	getSeriesDefaults: getSeriesDefaultsMock
}));
vi.mock('$lib/collective/databaseEntity', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/collective/databaseEntity')>();
	return { ...actual, resolveDatabaseEntityId: resolveDatabaseEntityIdMock };
});
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: resolveManageRightsMock
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
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
	listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllRsvpsForEvent: vi.fn().mockResolvedValue([]),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
}));
// #234 — importOriginal for collectSources/buildWorkRows: the panel's
// repertoire section calls them for real (pure, no fetch); only
// loadWorksByEventId (the fetching entry point) is mocked here.
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));
vi.mock('$lib/library/libraryData', () => ({
	listWorks: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllEditions: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllCopies: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false })
}));
vi.mock('$lib/repertoire/repertoireData', () => ({
	listRepertoireItems: vi.fn().mockResolvedValue([])
}));

import Page from './+page.svelte';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { isMessageEmpty, everyPatternContains, type MessageFile } from '$lib/testing/messageFile.js';
import type { Season } from '$lib/seasons/types';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── fixtures ────────────────────────────────────────────────────────────────────

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const SEASON_ID = 'season-1';

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

function currentSeason(): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
		conductors: [],
		owners: [],
		editors: ['person-p']
	};
}

function agendaResult() {
	const season = currentSeason();
	return fullAgendaResult({
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: [season]
	});
}

function seriesFixture() {
	return [{ id: 'series-1', name: 'Monday rehearsals', eventCount: 12 }];
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
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead([]));
	createEventMock.mockResolvedValue('ev-new-1');
	convertEventToSeriesMock.mockResolvedValue({ seriesId: 'series-new-9', eventType: 'concert' });
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead(seriesFixture()));
	// #313 — the panel no longer lists standalone events; the mock stays only
	// because the module mock above must export the function.
	listEventsForSeasonMock.mockResolvedValue(toListRead([]));
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue({
		name: 'Monday rehearsals',
		durationMinutes: 90,
		defaultLocation: 'Main hall',
		defaultDescription: ''
	});
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	createEventMock.mockReset();
	convertEventToSeriesMock.mockReset();
	resolveDatabaseEntityIdMock.mockReset();
	resolveManageRightsMock.mockReset();
	discoverMock.mockReset();
	gotoMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	listEventSeriesForSeasonMock.mockReset();
	listEventsForSeasonMock.mockReset();
	updateSeasonFieldMock.mockReset();
	addSeasonConductorMock.mockReset();
	removeSeasonConductorMock.mockReset();
	getSeriesDefaultsMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

// ── helpers ─────────────────────────────────────────────────────────────────────

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderReady(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-empty')).not.toBeNull();
	});
	return container;
}

/** #213 — the page-level [+ Event] is gone; the panel's [+ Event] is the way
 *  in. (#313: the panel has no standalone-event rows any more, so the panel
 *  itself is what we wait for.) */
async function openEventCreateFromPanel(container: HTMLElement): Promise<void> {
	await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-add-event')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'event-create-form')).not.toBeNull();
	});
}

async function selectValue(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.change(q(container, testid) as HTMLElement, { target: { value } });
}

// ── phase 1 — the standalone hint on the event-creation form (#196 test 5) ─────

describe('event-creation form — the "recurring wants a series" hint', () => {
	it('renders INSIDE the form through its localized key while NO series is selected', async () => {
		const container = await renderReady();
		await openEventCreateFromPanel(container);

		const form = q(container, 'event-create-form') as HTMLElement;
		const hint = form.querySelector('[data-testid="event-create-series-hint"]');
		expect(hint).not.toBeNull();
		// localized key, never hardcoded copy — the paraglide mock echoes keys
		expect(hint?.textContent).toContain('event_create_series_hint');
	});

	it('disappears the moment a series is chosen, and returns when the choice goes back to "" (standalone)', async () => {
		const container = await renderReady();
		await openEventCreateFromPanel(container);

		await selectValue(container, 'event-create-season', SEASON_ID);
		const series = q(container, 'event-create-series') as HTMLSelectElement;
		await waitFor(() => {
			expect(series.disabled).toBe(false);
		});
		// still standalone → hint stands
		expect(q(container, 'event-create-series-hint')).not.toBeNull();

		await selectValue(container, 'event-create-series', 'series-1');
		await waitFor(() => {
			expect(q(container, 'event-create-series-hint')).toBeNull();
		});

		await selectValue(container, 'event-create-series', '');
		await waitFor(() => {
			expect(q(container, 'event-create-series-hint')).not.toBeNull();
		});
	});
});

// ── i18n — the #196 keys exist, non-empty, in ALL FOUR locales ──────────────────
//
// #313 relocated the conversion FLOW to the event page, but the key set is
// REUSED by the relocated form — parity stays pinned here unchanged. (The new
// event-page key `event_detail_convert` and the REWRITTEN
// `event_create_series_hint` copy are pinned in
// src/routes/event/[id]/page.event-convert.spec.ts.)

describe('locale parity — every #196 key present and non-empty in en/et/lv/uk', () => {
	const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
	const KEYS = [
		'event_create_series_hint',
		'season_manage_event_convert',
		'event_convert_form_label',
		'event_convert_interval_label',
		'event_convert_duration_label',
		'event_convert_end_date_label',
		'event_convert_submit',
		'event_convert_cancel',
		'event_convert_failed',
		// #196 review F1/F2 — the occurrence run and the per-field refusals.
		'event_convert_interval_required',
		'event_convert_duration_required',
		'event_convert_end_required',
		'event_convert_end_before_start',
		'event_convert_start_missing',
		// #196 review F1 — the two pre-write refusals say WHY, not "(read-event)".
		'event_convert_missing_name',
		'event_convert_missing_type',
		'event_convert_progress',
		'event_convert_generate_failed',
		'event_convert_resume_notice'
	] as const;

	function messages(locale: string): MessageFile {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as MessageFile;
	}

	it.each(LOCALES)('%s carries every key, none empty', (locale) => {
		const file = messages(locale);
		for (const key of KEYS) {
			expect(isMessageEmpty(file[key]), `messages/${locale}.json: ${key}`).toBe(false);
		}
	});

	it.each(LOCALES)('%s: event_convert_failed keeps its {step} placeholder — the loud-failure pin', (locale) => {
		expect(everyPatternContains(messages(locale)['event_convert_failed'], '{step}')).toBe(true);
	});
});

// ── i18n — the #212 start-date label, present in ALL FOUR locales ───────────────

describe('#212 locale parity — event_convert_start_date_label present and non-empty in en/et/lv/uk', () => {
	function messages(locale: string): MessageFile {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as MessageFile;
	}

	it.each(['en', 'et', 'lv', 'uk'] as const)('%s carries the key, non-empty', (locale) => {
		expect(
			isMessageEmpty(messages(locale)['event_convert_start_date_label']),
			`messages/${locale}.json: event_convert_start_date_label`
		).toBe(false);
	});

	// Gama named the en/et copy in the #212 ruling; lv/uk stay Comenius's call.
	it('en reads "Starts", et reads "Algus" — the copy the #212 ruling pinned', () => {
		expect(messages('en')['event_convert_start_date_label']).toBe('Starts');
		expect(messages('et')['event_convert_start_date_label']).toBe('Algus');
	});
});

// (*MVOX:Tallis* — #196 RED: standalone hint + i18n keys)
// (*MVOX:Tallis* — #313: the panel-side conversion wiring, the #212 start-date
//  display and the single-action-context tests moved with the flow to
//  src/routes/event/[id]/page.event-convert.spec.ts; the panel's standalone-
//  event rows they drove through are removed)
