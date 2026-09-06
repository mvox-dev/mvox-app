// @vitest-environment happy-dom
//
// #266 RED — INTEGRATION: wire values `trip` and `service` join the canonical
// event-type vocabulary, and every derived agenda surface picks them up FOR
// FREE from the ONE shared vocabulary (EVENT_TYPE_LABEL →
// CANONICAL_EVENT_TYPES → eventTypeBadgeClass). Real +page.svelte, real
// AgendaList / AgendaMonthView, real eventTypeLabels / eventTypeStyles — only
// the data seams are mocked (same harness family as page.agenda-filter.spec.ts
// and page.agenda-month-view.spec.ts).
//
// Pinned contract (#266, team-lead build shape):
//
//   - NEW canonical order (TEN types): rehearsal, concert, service, festival,
//     retreat, trip, workshop, meeting, social, other — service beside concert
//     (performance family), trip beside retreat (travel family).
//   - trip/service are QUIET-GREY-FIRST: eventTypeBadgeClass maps both to the
//     same default the social/other badges wear; the hued set stays the #211
//     six (daylight-distinguishability bar).
//   - #214 chips DERIVE the two new types from present events — own chips, in
//     canonical order, localized labels, chip colour = eventTypeBadgeClass
//     (never bucketed into 'other' once canonical).
//   - #247 month view renders their badges via the same label + class pair.
//   - Agenda day-list row badges likewise.
//   - Done-when 6 FENCE: a non-canonical free-text type still renders exactly
//     as today — raw label, quiet badge, grouped under the 'other' chip.
//   - Locale keys event_type_trip / event_type_service in ALL FOUR files,
//     exact text pinned (et fixed by the commission; en/lv/uk engineering
//     drafts flagged refinable): en Trip/Service, et Reis/Teenistus,
//     lv Brauciens/Dievkalpojums, uk Поїздка/Богослужіння — every draft within
//     the existing ~18-char ceiling (done-when 7, phone-width surfaces).
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgendaItem } from '$lib/agenda/types';
// #211's ONE scheme — chips and badges must consume the same map; asserting
// against it here proves "chip colour = badge colour" without a re-typed copy.
import { eventTypeBadgeClass } from '$lib/events/eventTypeStyles';

vi.mock('$lib/paraglide/messages.js', () => {
	const keys: Record<string, (params?: Record<string, unknown>) => string> = {
		agenda_duration_min: (params) => `${(params as { minutes: number }).minutes} min`,
		agenda_filter_all: () => '[msg:filter-all]',
		agenda_filter_group_label: () => '[msg:filter-group]',
		agenda_filter_empty: () => '[msg:filter-empty]',
		agenda_filter_recent_empty: () => '[msg:filter-recent-empty]',
		agenda_view_toggle_label: () => '[msg:view-toggle]',
		event_type_rehearsal: () => '[msg:rehearsal]',
		event_type_concert: () => '[msg:concert]',
		event_type_other: () => '[msg:other]',
		// #266 — the two new keys get DISTINCT markers: a label that renders as
		// the marker went through paraglide; the raw wire string ('trip') or the
		// bare key would fail these pins.
		event_type_trip: () => '[msg:trip]',
		event_type_service: () => '[msg:service]'
	};
	return {
		m: new Proxy(keys, {
			get: (target, key) => target[String(key)] ?? (() => `[${String(key)}]`)
		})
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

function item(id: string, name: string, startDatetime: string, eventType: string): AgendaItem {
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

// Far-future upcoming dates — AgendaList's relative-day decoration reads the
// real clock, so the fixtures stay ahead of it. These fixture events carry the
// NEW wire values and drive the REAL producer chain end to end.
const UP_REHEARSAL = item('up-reh', 'Tavaline proov', '2030-06-10T16:00:00.000Z', 'rehearsal');
const UP_CONCERT = item('up-con', 'Kevadkontsert', '2030-06-12T18:00:00.000Z', 'concert');
const UP_SERVICE = item('up-serv', 'Jumalateenistus', '2030-06-15T08:00:00.000Z', 'service');
const UP_TRIP = item('up-trip', 'Suvine ringreis', '2030-06-18T06:00:00.000Z', 'trip');
const UP_FREETEXT = item('up-proov', 'Eriproov', '2030-06-14T16:00:00.000Z', 'proov');

function chipGroup(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[role="group"][aria-label="[msg:filter-group]"]');
}

function chips(container: HTMLElement): HTMLButtonElement[] {
	const group = chipGroup(container);
	return group ? Array.from(group.querySelectorAll('button')) : [];
}

function chipTestids(container: HTMLElement): (string | null)[] {
	return chips(container).map((b) => b.getAttribute('data-testid'));
}

function chipTexts(container: HTMLElement): (string | undefined)[] {
	return chips(container).map((b) => b.textContent?.trim());
}

function chip(container: HTMLElement, testid: string): HTMLButtonElement {
	const el = container.querySelector(`[data-testid="${testid}"]`);
	expect(el, `chip ${testid} must exist`).not.toBeNull();
	return el as HTMLButtonElement;
}

function upcomingRowIds(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll('[data-testid^="agenda-row-"]')).map((el) =>
		(el.getAttribute('data-testid') as string).replace('agenda-row-', '')
	);
}

function badge(container: HTMLElement, id: string): HTMLElement {
	const el = container.querySelector(`[data-testid="event-type-badge-${id}"]`);
	expect(el, `event-type-badge-${id} must exist`).not.toBeNull();
	return el as HTMLElement;
}

/** Every class token of eventTypeBadgeClass(type), asserted PRESENT on el. */
function expectSchemeClasses(el: Element, type: string) {
	const classes = eventTypeBadgeClass(type).split(/\s+/).filter(Boolean);
	expect(classes.length).toBeGreaterThan(0);
	for (const cls of classes) {
		expect([...el.classList], `expected scheme class ${cls}`).toContain(cls);
	}
	// Quiet-grey-first: no hued type-* token may ride along.
	for (const cls of el.classList) {
		expect(cls, `unexpected hued token ${cls}`).not.toMatch(/^(bg|text|border)-type-/);
	}
}

async function renderAgenda(
	upcoming: AgendaItem[],
	recent: AgendaItem[] = []
): Promise<HTMLElement> {
	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ upcoming, recent }));
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="agenda-skeleton"]')).toBeNull();
	});
	return container as HTMLElement;
}

async function switchToMonth(container: HTMLElement): Promise<void> {
	const btn = container.querySelector('[data-testid="agenda-view-month"]');
	expect(btn, 'agenda-view-month toggle must exist').not.toBeNull();
	await fireEvent.click(btn as HTMLElement);
}

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue([]);

afterEach(async () => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	// The #247 view-mode preference is module-level state: reset it so one
	// test's Kuu choice never leaks into the next.
	const prefs = await import('$lib/preferences/agendaView').catch(() => null);
	prefs?.setAgendaView('list');
	if (typeof localStorage !== 'undefined') localStorage.clear();
});

// ═════════════════════════════════════════════════════════════════════════════
// #214 chips — trip and service derive their OWN chips (not the 'other' bucket)
// ═════════════════════════════════════════════════════════════════════════════

describe('#266 — the filter chips pick trip and service up from the vocabulary', () => {
	it('renders own chips for present trip/service events — canonical order (service after concert, trip after retreat-slot neighbours), localized labels, NO other bucket', async () => {
		const container = await renderAgenda([UP_REHEARSAL, UP_CONCERT, UP_SERVICE, UP_TRIP]);

		// Canonical NEW order among present types; trip/service are canonical
		// now, so NO 'other' chip appears — nothing here buckets into it.
		expect(chipTestids(container)).toEqual([
			'agenda-filter-all',
			'agenda-filter-rehearsal',
			'agenda-filter-concert',
			'agenda-filter-service',
			'agenda-filter-trip'
		]);
		expect(chipTexts(container)).toEqual([
			'[msg:filter-all]',
			'[msg:rehearsal]',
			'[msg:concert]',
			'[msg:service]',
			'[msg:trip]'
		]);
	});

	it('filtering by the trip chip shows the trip row alone; by the service chip, the service row alone', async () => {
		const container = await renderAgenda([UP_REHEARSAL, UP_CONCERT, UP_SERVICE, UP_TRIP]);

		await fireEvent.click(chip(container, 'agenda-filter-trip'));
		expect(upcomingRowIds(container)).toEqual(['up-trip']);

		// Toggle back to All, then the service chip.
		await fireEvent.click(chip(container, 'agenda-filter-trip'));
		await fireEvent.click(chip(container, 'agenda-filter-service'));
		expect(upcomingRowIds(container)).toEqual(['up-serv']);
	});

	it("chip colour = badge colour: the ACTIVE trip/service chip carries eventTypeBadgeClass's quiet scheme verbatim AND a visible pressed affordance (#214 F1)", async () => {
		const container = await renderAgenda([UP_SERVICE, UP_TRIP]);

		for (const type of ['trip', 'service']) {
			const testid = `agenda-filter-${type}`;
			const inactive = new Set(chip(container, testid).classList);

			await fireEvent.click(chip(container, testid));

			expect(chip(container, testid).getAttribute('aria-pressed')).toBe('true');
			// The scheme classes, verbatim from the SHARED map — quiet grey, the
			// same classes the row badge wears.
			expectSchemeClasses(chip(container, testid), type);
			// And — the #214 F1 lesson, which bites every QUIET type — the pressed
			// state must be visible beyond the hue: at least one class the
			// inactive chip did not carry.
			const added = [...chip(container, testid).classList].filter((cls) => !inactive.has(cls));
			expect(
				added.length,
				`the active ${type} chip must carry at least one class its inactive self does not`
			).toBeGreaterThan(0);

			// Back to All for the next type.
			await fireEvent.click(chip(container, testid));
		}
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// day-list row badges — localized label + quiet scheme from the shared pair
// ═════════════════════════════════════════════════════════════════════════════

describe('#266 — agenda day-list badges render trip and service localized and quiet', () => {
	it('the trip and service rows carry badges with the paraglide labels (never the raw wire string) and the shared quiet classes', async () => {
		const container = await renderAgenda([UP_SERVICE, UP_TRIP]);

		const trip = badge(container, 'up-trip');
		expect(trip.textContent?.trim()).toBe('[msg:trip]');
		expectSchemeClasses(trip, 'trip');

		const service = badge(container, 'up-serv');
		expect(service.textContent?.trim()).toBe('[msg:service]');
		expectSchemeClasses(service, 'service');
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// #247 month view — same label + class pair, for free
// ═════════════════════════════════════════════════════════════════════════════

describe('#266 — the month view renders trip and service via the same vocabulary pair', () => {
	it('month rows for trip/service events carry the localized badge with the shared quiet classes', async () => {
		const container = await renderAgenda([UP_SERVICE, UP_TRIP]);
		await switchToMonth(container);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-month-row-up-trip"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="agenda-month-row-up-serv"]')).not.toBeNull();

		const trip = badge(container, 'up-trip');
		expect(trip.textContent?.trim()).toBe('[msg:trip]');
		expectSchemeClasses(trip, 'trip');

		const service = badge(container, 'up-serv');
		expect(service.textContent?.trim()).toBe('[msg:service]');
		expectSchemeClasses(service, 'service');
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// done-when 6 FENCE — existing events untouched
// ═════════════════════════════════════════════════════════════════════════════

describe('#266 — existing-events fence: non-canonical free text renders exactly as today', () => {
	it("a free-text 'proov' event keeps its raw badge label, the quiet default classes, and still groups under the 'other' chip", async () => {
		const container = await renderAgenda([UP_TRIP, UP_FREETEXT]);

		// The raw string survives on the badge (visibly wrong beats invisibly
		// blank) with the quiet default — byte-identical posture to today.
		const freeText = badge(container, 'up-proov');
		expect(freeText.textContent?.trim()).toBe('proov');
		expectSchemeClasses(freeText, 'proov');

		// Free text buckets under 'other'; canonical trip stands apart.
		expect(chipTestids(container)).toEqual([
			'agenda-filter-all',
			'agenda-filter-trip',
			'agenda-filter-other'
		]);
		await fireEvent.click(chip(container, 'agenda-filter-other'));
		expect(upcomingRowIds(container)).toEqual(['up-proov']);
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// locale files — exact-text pins, all four languages (house style)
// ═════════════════════════════════════════════════════════════════════════════

describe('#266 — event_type_trip / event_type_service in all four locale files, exact text', () => {
	// et is FIXED by the commission (Mihkel, verbatim: "reis ja teenistus");
	// en/lv/uk are engineering drafts flagged refinable in the delivery report
	// (the #247 weekday-keys posture) — but pinned exactly, house style.
	const EXPECTED: Record<string, { trip: string; service: string }> = {
		en: { trip: 'Trip', service: 'Service' },
		et: { trip: 'Reis', service: 'Teenistus' },
		lv: { trip: 'Brauciens', service: 'Dievkalpojums' },
		uk: { trip: 'Поїздка', service: 'Богослужіння' }
	};

	// Done-when 7 — phone-width surfaces: the longest existing type label is 18
	// chars ('Saviesīgs pasākums' / 'Товариська зустріч'); no new label may
	// exceed that ceiling.
	const LENGTH_CEILING = 'Saviesīgs pasākums'.length;

	it.each(Object.keys(EXPECTED))('%s.json carries both keys with the pinned copy', (locale) => {
		const messages = JSON.parse(readFileSync(resolve(`messages/${locale}.json`), 'utf8')) as Record<
			string,
			unknown
		>;
		expect(messages['event_type_trip']).toBe(EXPECTED[locale].trip);
		expect(messages['event_type_service']).toBe(EXPECTED[locale].service);
		expect(EXPECTED[locale].trip.length).toBeLessThanOrEqual(LENGTH_CEILING);
		expect(EXPECTED[locale].service.length).toBeLessThanOrEqual(LENGTH_CEILING);
	});
});

// (*MVOX:Tallis* — #266 RED: trip + service join the app vocabulary — chips,
//  badges, month view, fence, four-locale copy pins)
