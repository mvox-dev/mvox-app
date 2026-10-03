// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgendaItem } from '$lib/agenda/types';
import { eventTypeBadgeClass } from '$lib/events/eventTypeStyles';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket', {
		agenda_duration_min: (params) => `${(params as { minutes: number }).minutes} min`,
		agenda_filter_all: () => '[msg:filter-all]',
		agenda_filter_group_label: () => '[msg:filter-group]',
		agenda_filter_empty: () => '[msg:filter-empty]',
		agenda_filter_recent_empty: () => '[msg:filter-recent-empty]',
		agenda_view_toggle_label: () => '[msg:view-toggle]',
		event_type_rehearsal: () => '[msg:rehearsal]',
		event_type_concert: () => '[msg:concert]',
		event_type_other: () => '[msg:other]',
		event_type_trip: () => '[msg:trip]',
		event_type_service: () => '[msg:service]'
	})
);

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).repertoireActionsModule(await importOriginal())
);
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).databaseEntityModule(await importOriginal())
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('empty')
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule()
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);

import Page from './+page.svelte';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';

function setAuthedWithOneCollective() {
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p1' }] });
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

function expectSchemeClasses(el: Element, type: string) {
	const classes = eventTypeBadgeClass(type).split(/\s+/).filter(Boolean);
	expect(classes.length).toBeGreaterThan(0);
	for (const cls of classes) {
		expect([...el.classList], `expected scheme class ${cls}`).toContain(cls);
	}
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
listMyRsvpsMock.mockResolvedValue(toListRead([]));

afterEach(async () => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	resetAppState();
	const prefs = await import('$lib/preferences/agendaView').catch(() => null);
	prefs?.setAgendaView('list');
	if (typeof localStorage !== 'undefined') localStorage.clear();
});

describe('#266 — the filter chips pick trip and service up from the vocabulary', () => {
	it('renders own chips for present trip/service events — canonical order (service after concert, trip after retreat-slot neighbours), localized labels, NO other bucket', async () => {
		const container = await renderAgenda([UP_REHEARSAL, UP_CONCERT, UP_SERVICE, UP_TRIP]);

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
			expectSchemeClasses(chip(container, testid), type);
			const added = [...chip(container, testid).classList].filter((cls) => !inactive.has(cls));
			expect(
				added.length,
				`the active ${type} chip must carry at least one class its inactive self does not`
			).toBeGreaterThan(0);

			await fireEvent.click(chip(container, testid));
		}
	});
});

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

describe('#266 — existing-events fence: non-canonical free text renders exactly as today', () => {
	it("a free-text 'proov' event keeps its raw badge label, the quiet default classes, and still groups under the 'other' chip", async () => {
		const container = await renderAgenda([UP_TRIP, UP_FREETEXT]);

		const freeText = badge(container, 'up-proov');
		expect(freeText.textContent?.trim()).toBe('proov');
		expectSchemeClasses(freeText, 'proov');

		expect(chipTestids(container)).toEqual([
			'agenda-filter-all',
			'agenda-filter-trip',
			'agenda-filter-other'
		]);
		await fireEvent.click(chip(container, 'agenda-filter-other'));
		expect(upcomingRowIds(container)).toEqual(['up-proov']);
	});
});

describe('#266 — event_type_trip / event_type_service in all four locale files, exact text', () => {
	const EXPECTED: Record<string, { trip: string; service: string }> = {
		en: { trip: 'Trip', service: 'Service' },
		et: { trip: 'Reis', service: 'Teenistus' },
		lv: { trip: 'Brauciens', service: 'Dievkalpojums' },
		uk: { trip: 'Поїздка', service: 'Богослужіння' }
	};

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
