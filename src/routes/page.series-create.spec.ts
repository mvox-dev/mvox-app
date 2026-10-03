// @vitest-environment happy-dom
// Event series creation and the occurrence generator on the agenda page.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { isMessageEmpty, messagePatterns, type MessageFile } from '$lib/testing/messageFile.js';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);

const {
	listEventSeriesForSeasonMock,
	listEventsForSeasonMock,
	updateSeasonFieldMock,
	addSeasonConductorMock,
	removeSeasonConductorMock,
	getSeriesDefaultsMock
} = vi.hoisted(() => ({
	listEventSeriesForSeasonMock: vi.fn(),
	listEventsForSeasonMock: vi.fn(),
	updateSeasonFieldMock: vi.fn(),
	addSeasonConductorMock: vi.fn(),
	removeSeasonConductorMock: vi.fn(),
	getSeriesDefaultsMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/entity/entityCreate', async () =>
	(await import('$lib/testing/mocks/events')).entityCreateModule(['series', 'event'])
);
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: updateSeasonFieldMock,
	addSeasonConductor: addSeasonConductorMock,
	removeSeasonConductor: removeSeasonConductorMock,
	getSeriesDefaults: getSeriesDefaultsMock
}));
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).entityIdModule(await importOriginal())
);
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).rightsModule(await importOriginal())
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('empty')
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
vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/moduleStubs')).libraryDataModule()
);
vi.mock('$lib/repertoire/repertoireData', async () =>
	(await import('$lib/testing/mocks/seasons')).repertoireDataModule('empty')
);

import Page from './+page.svelte';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { HOURS_24, MINUTES_5, fillTime, optionValues } from '$lib/testing/timeControls';
import type { Season } from '$lib/seasons/types';
import type { CreateEventInput, CreateEventSeriesInput } from '$lib/entity/entityCreate';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { testCfg } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { discoverMock, gotoMock } from '$lib/testing/routeMocks';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock
} from '$lib/testing/moduleHandles';
import { createEventMock, createEventSeriesMock } from '$lib/testing/mocks/events';
import { loadRosterMock } from '$lib/testing/mocks/roster';

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const CFG = testCfg('sampledb', 'jwt-abc');
const SEASON_ID = 'season-1';
const NEW_SERIES_ID = 'series-new-1';

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

const SEASON_START = isoDate(-30);
const SEASON_END = isoDate(60);

function currentSeason(viewerIsEditor: boolean): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: SEASON_START,
		endDate: SEASON_END,
		conductors: [],
		owners: [],
		editors: viewerIsEditor ? ['person-p'] : []
	};
}

function agendaResult(opts: { editor?: boolean } = {}) {
	const { editor = true } = opts;
	const season = currentSeason(editor);
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

function standaloneFixture() {
	return [{ id: 'ev-9', name: 'Spring concert', startDatetime: '2027-04-18T18:00:00.000Z' }];
}

function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function setAuthedWithOneCollective() {
	signIn();
}

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead([]));
	createEventSeriesMock.mockResolvedValue(NEW_SERIES_ID);
	createEventMock.mockImplementation(async () => `ev-new-${createEventMock.mock.calls.length}`);
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead(seriesFixture()));
	listEventsForSeasonMock.mockResolvedValue(toListRead(standaloneFixture()));
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue(null);
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	createEventSeriesMock.mockReset();
	createEventMock.mockReset();
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
	resetAppState();
});

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

async function openSeriesForm(container: HTMLElement): Promise<void> {
	await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-add-series')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-add-series') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'series-create-form')).not.toBeNull();
	});
}

async function fill(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.input(q(container, testid) as HTMLElement, { target: { value } });
}

async function selectValue(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.change(q(container, testid) as HTMLElement, { target: { value } });
}

async function submit(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);
}

async function fillValidTemplate(container: HTMLElement): Promise<void> {
	await fill(container, 'series-create-name', 'Monday rehearsals');
	await fill(container, 'series-create-duration', '90');
	await fillTime(container, 'series-create-time', '19:00');
	await fill(container, 'series-create-from', '2026-09-01');
	await fill(container, 'series-create-until', '2026-09-21');
}

async function enableMondayGeneration(container: HTMLElement): Promise<void> {
	await selectValue(container, 'series-create-day', '1');
}

async function settleSeriesRun(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(q(container, 'series-create-form')).toBeNull();
	});
}

function previewDates(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-testid^="series-create-date-"]')].map(
		(el) => el.getAttribute('data-testid')?.replace('series-create-date-', '') ?? ''
	);
}

function dateChip(container: HTMLElement, iso: string): HTMLButtonElement | null {
	return container.querySelector(`[data-testid="series-create-date-${iso}"]`);
}

async function toggleDate(container: HTMLElement, iso: string): Promise<void> {
	const chip = dateChip(container, iso);
	expect(chip, `chip series-create-date-${iso} must be rendered`).not.toBeNull();
	await fireEvent.click(chip as HTMLButtonElement);
}

function activeDates(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-testid^="series-create-date-"]')]
		.filter((el) => el.getAttribute('aria-pressed') === 'true')
		.map((el) => el.getAttribute('data-testid')?.replace('series-create-date-', '') ?? '');
}

function gridSequence(container: HTMLElement): string[] {
	return [
		...container.querySelectorAll(
			'[data-testid^="series-create-month-"], [data-testid^="series-create-date-"]'
		)
	].map((el) => el.getAttribute('data-testid') ?? '');
}

function lastSeriesInput(): CreateEventSeriesInput {
	const calls = createEventSeriesMock.mock.calls;
	expect(calls.length).toBeGreaterThan(0);
	return calls[calls.length - 1][1] as CreateEventSeriesInput;
}

function eventInput(callIndex: number): CreateEventInput {
	expect(createEventMock.mock.calls.length).toBeGreaterThan(callIndex);
	return createEventMock.mock.calls[callIndex][1] as CreateEventInput;
}

describe('season panel — the [+ Series] entry point', () => {
	it('season editor: clicking season-manage-add-series opens series-create-form INLINE (no goto); merely opening writes nothing and shows no preview (the recurrence is incomplete, not gated — #240)', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		expect(gotoMock).not.toHaveBeenCalled();
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'series-create-preview')).toBeNull();

		expect(q(container, 'series-create-generate')).toBeNull();
	});

	it('NON-editor: no season card at all (#261 — the gear is gone for everyone) — the panel (and with it the form) is unreachable, fail-closed like every other rights gate', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		await flush();
		expect(q(container, 'agenda-admin-card')).toBeNull();
		expect(q(container, 'season-card-expand')).toBeNull();
		expect(q(container, 'season-manage-gear')).toBeNull();
		expect(q(container, 'series-create-form')).toBeNull();
	});

	it('cancel closes the form; nothing written', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Doomed draft');

		await fireEvent.click(q(container, 'series-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
	});
});

describe('season panel — the series form carries every sketch-D field', () => {
	it('name (text), type (#199: canonical select, PRE-SELECTED rehearsal — see page.event-type-picker.spec.ts for the full picker contract), duration (number), location (text), description (TEXTAREA), repeat/day (selects), time, from/until (dates) — NO generate checkbox (#240: generation is always on) and NO skip picker (#215: the chips are the skip mechanism)', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const name = q(container, 'series-create-name') as HTMLInputElement;
		expect(name).not.toBeNull();
		expect(name.tagName).toBe('INPUT');

		const type = q(container, 'series-create-type') as HTMLSelectElement;
		expect(type).not.toBeNull();
		expect(type.tagName).toBe('SELECT');
		expect(type.value).toBe('rehearsal');

		const duration = q(container, 'series-create-duration') as HTMLInputElement;
		expect(duration.type).toBe('number');

		const location = q(container, 'series-create-location') as HTMLInputElement;
		expect(location.tagName).toBe('INPUT');

		const description = q(container, 'series-create-description') as HTMLElement;
		expect(description.tagName).toBe('TEXTAREA');

		const repeat = q(container, 'series-create-repeat') as HTMLSelectElement;
		expect(repeat.tagName).toBe('SELECT');
		expect([...repeat.querySelectorAll('option')].map((o) => o.value)).toEqual([
			'weekly',
			'biweekly',
			'daily'
		]);
		expect(repeat.value).toBe('weekly');

		const day = q(container, 'series-create-day') as HTMLSelectElement;
		expect(day.tagName).toBe('SELECT');
		expect([...day.querySelectorAll('option')].map((o) => o.value)).toEqual([
			'',
			'1',
			'2',
			'3',
			'4',
			'5',
			'6',
			'0'
		]);
		expect(day.value).toBe('');

		const timeWrapper = q(container, 'series-create-time') as HTMLElement;
		expect(timeWrapper).not.toBeNull();
		expect(timeWrapper.tagName).not.toBe('INPUT');
		const timeHour = q(container, 'series-create-time-hour') as HTMLSelectElement;
		const timeMinute = q(container, 'series-create-time-minute') as HTMLSelectElement;
		expect(timeHour.tagName).toBe('SELECT');
		expect(timeMinute.tagName).toBe('SELECT');
		expect(timeHour.value).toBe('');
		expect(timeMinute.value).toBe('');
		expect(optionValues(timeHour).filter((v) => v !== '')).toEqual(HOURS_24);
		expect(optionValues(timeMinute).filter((v) => v !== '')).toEqual(MINUTES_5);
		expect(q(container, 'series-create-time-ampm')).toBeNull();
		expect((q(container, 'series-create-from') as HTMLInputElement).type).toBe('date');
		expect((q(container, 'series-create-until') as HTMLInputElement).type).toBe('date');
		expect(q(container, 'series-create-generate')).toBeNull();
		expect(q(container, 'series-create-skip-date')).toBeNull();
		expect(q(container, 'series-create-skip-add')).toBeNull();
		expect(q(container, 'series-create-skip-list')).toBeNull();
		expect(q(container, 'series-create-skip-heading')).toBeNull();
		expect(container.querySelector('[data-testid^="series-create-skip-remove-"]')).toBeNull();
	});

	it('from/until default to the SEASON dates — the sketch-D pin — so a fresh form already spans the season', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		expect((q(container, 'series-create-from') as HTMLInputElement).value).toBe(SEASON_START);
		expect((q(container, 'series-create-until') as HTMLInputElement).value).toBe(SEASON_END);
	});
});

describe('season panel — the recurrence preview is live and real', () => {
	it('day/time/from/until set → series-create-preview lists EXACTLY the generated dates (real generateEventDates: 13 Mondays for Sep 1 – Dec 1 2026) — and previewing writes NOTHING', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-12-01');
		await enableMondayGeneration(container);

		await waitFor(() => {
			expect(q(container, 'series-create-preview')).not.toBeNull();
		});
		expect(previewDates(container)).toEqual([
			'2026-09-07',
			'2026-09-14',
			'2026-09-21',
			'2026-09-28',
			'2026-10-05',
			'2026-10-12',
			'2026-10-19',
			'2026-10-26',
			'2026-11-02',
			'2026-11-09',
			'2026-11-16',
			'2026-11-23',
			'2026-11-30'
		]);
		expect(gridSequence(container)).toEqual([
			'series-create-month-2026-09',
			'series-create-date-2026-09-07',
			'series-create-date-2026-09-14',
			'series-create-date-2026-09-21',
			'series-create-date-2026-09-28',
			'series-create-month-2026-10',
			'series-create-date-2026-10-05',
			'series-create-date-2026-10-12',
			'series-create-date-2026-10-19',
			'series-create-date-2026-10-26',
			'series-create-month-2026-11',
			'series-create-date-2026-11-02',
			'series-create-date-2026-11-09',
			'series-create-date-2026-11-16',
			'series-create-date-2026-11-23',
			'series-create-date-2026-11-30'
		]);
		expect(activeDates(container)).toEqual(previewDates(container));
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('the preview UPDATES LIVE as params change: shortening until 2026-12-01 → 2026-09-30 shrinks 13 Mondays to 4', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-12-01');
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(13);
		});

		await fill(container, 'series-create-until', '2026-09-30');

		await waitFor(() => {
			expect(previewDates(container)).toEqual([
				'2026-09-07',
				'2026-09-14',
				'2026-09-21',
				'2026-09-28'
			]);
		});
	});

	it('#215 — tapping a chip SKIPS it: aria-pressed flips to "false", the chip stays RENDERED (struck + muted), the other chips are untouched; tapping again restores it', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-09-30');
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(4);
		});

		await toggleDate(container, '2026-09-14');

		await waitFor(() => {
			expect(dateChip(container, '2026-09-14')?.getAttribute('aria-pressed')).toBe('false');
		});
		expect(previewDates(container)).toEqual([
			'2026-09-07',
			'2026-09-14',
			'2026-09-21',
			'2026-09-28'
		]);
		expect(activeDates(container)).toEqual(['2026-09-07', '2026-09-21', '2026-09-28']);
		const skipped = dateChip(container, '2026-09-14') as HTMLButtonElement;
		const skippedClasses = Array.from(skipped.classList);
		expect(skippedClasses).toContain('line-through');
		expect(skippedClasses).toContain('text-ink-2');
		expect(skipped.textContent?.trim()).toBe('2026-09-14');

		await toggleDate(container, '2026-09-14');
		await waitFor(() => {
			expect(dateChip(container, '2026-09-14')?.getAttribute('aria-pressed')).toBe('true');
		});
		expect(Array.from((dateChip(container, '2026-09-14') as HTMLElement).classList)).not.toContain(
			'line-through'
		);
		expect(activeDates(container)).toHaveLength(4);
	});

	it('#215 — chip anatomy: a NATIVE <button type="button"> (rules 1/2) with the bare ISO date as its text (rule 7) and the 44x44 floor (min-h-11 min-w-11); the month heading is a display-only <h4> with a LOCALIZED month name, never the raw YYYY-MM', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(previewDates(container)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21']);
		});

		for (const iso of ['2026-09-07', '2026-09-14', '2026-09-21']) {
			const chip = dateChip(container, iso) as HTMLButtonElement;
			expect(chip.tagName).toBe('BUTTON');
			expect(chip.getAttribute('type')).toBe('button');
			expect(chip.getAttribute('aria-pressed')).toBe('true');
			expect(chip.textContent?.trim()).toBe(iso);
			const classes = Array.from(chip.classList);
			expect(classes, `${iso} chip must reserve the 44px height floor`).toContain('min-h-11');
			expect(classes, `${iso} chip must reserve the 44px width floor`).toContain('min-w-11');
		}

		const heading = q(container, 'series-create-month-2026-09') as HTMLElement;
		expect(heading).not.toBeNull();
		expect(heading.tagName).toBe('H4');
		expect(heading.closest('button')).toBeNull();
		const monthText = heading.textContent?.trim() ?? '';
		expect(monthText).not.toBe('');
		expect(monthText).not.toMatch(/^\d{4}-\d{2}$/);
	});

	it('#215→#241 — the grid still WRAPS (no scroll-trap class anywhere on or under the preview) but no longer renders flat: a 90-chip daily season opens at the FIRST 50 chips under TWO headings (Sep + Oct 1–20); show-all brings the full 90 under three', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Daily grind');
		await fill(container, 'series-create-duration', '90');
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-11-29');
		await selectValue(container, 'series-create-repeat', 'daily');

		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50); // of 90 = 30 + 31 + 29
		});
		expect(q(container, 'series-create-preview-count')?.textContent).toContain('"count":90');
		expect(
			[
				...(q(container, 'series-create-preview') as HTMLElement).querySelectorAll(
					'[data-testid^="series-create-month-"]'
				)
			].map((el) => el.getAttribute('data-testid'))
		).toEqual(['series-create-month-2026-09', 'series-create-month-2026-10']);

		await fireEvent.click(q(container, 'series-create-show-all') as HTMLElement);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(90);
		});
		expect(
			[
				...(q(container, 'series-create-preview') as HTMLElement).querySelectorAll(
					'[data-testid^="series-create-month-"]'
				)
			].map((el) => el.getAttribute('data-testid'))
		).toEqual([
			'series-create-month-2026-09',
			'series-create-month-2026-10',
			'series-create-month-2026-11'
		]);

		const preview = q(container, 'series-create-preview') as HTMLElement;
		const scrollTrap = /^(max-h-|overflow-y-auto$|overflow-auto$|overflow-scroll$|overflow-y-scroll$)/;
		for (const el of [preview, ...preview.querySelectorAll('*')]) {
			const offending = Array.from((el as HTMLElement).classList ?? []).filter((c) =>
				scrollTrap.test(c)
			);
			expect(offending, `no inner scroll region: <${el.tagName}> carries ${offending}`).toEqual(
				[]
			);
		}
	});

	it('#240 — the preview is UNCONDITIONAL: completing the recurrence brings it up immediately, with no checkbox, no button and no other trigger to find', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-09-30');
		await selectValue(container, 'series-create-day', '1');

		await waitFor(() => {
			expect(q(container, 'series-create-preview')).not.toBeNull();
		});
		expect(previewDates(container)).toEqual([
			'2026-09-07',
			'2026-09-14',
			'2026-09-21',
			'2026-09-28'
		]);
		expect(q(container, 'series-create-generate')).toBeNull();
	});

	it('recurrence INCOMPLETE (no day picked on a day-using pattern): no preview yet — incompleteness, not a gate (#240)', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-09-30');

		await flush();
		expect(q(container, 'series-create-preview')).toBeNull();
	});
});

describe('season panel — submit ALWAYS generates (#240): the series wire, full shape', () => {
	it('full flow: createEventSeries(cfg, {…}) ONCE, FULL shape — org from resolveDatabaseEntityId, season in extraParentIds, weekly → intervalDays 7, startDate/endDate = FIRST/LAST OCCURRENCE — and the occurrences ALWAYS follow (no series-only outcome exists); form closes, panel stays open, series list re-reads', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		const seriesReadsBefore = listEventSeriesForSeasonMock.mock.calls.length;

		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await fill(container, 'series-create-location', 'Main hall');
		await fill(container, 'series-create-description', 'Bring the black folder');
		await submit(container);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		expect(createEventSeriesMock).toHaveBeenCalledWith(CFG, {
			name: 'Monday rehearsals',
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'rehearsal',
			intervalDays: 7,
			startTime: '19:00',
			durationMinutes: 90,
			startDate: '2026-09-07',
			endDate: '2026-09-21',
			defaultLocation: 'Main hall',
			defaultDescription: 'Bring the black folder'
		});
		expect(resolveDatabaseEntityIdMock).toHaveBeenCalledWith(CFG);
		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(3);
		});

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock.mock.calls.length).toBeGreaterThan(seriesReadsBefore);
		});
	});

	it('untouched optional location/description arrive BLANK/ABSENT — never an invented "" that would shadow inheritance downstream', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		const input = lastSeriesInput();
		expect(input.defaultLocation ?? '').toBe('');
		expect(input.defaultDescription ?? '').toBe('');
		await settleSeriesRun(container);
	});

	it('#207 AM/PM preference (integration): the store flips the surface to 12h selects — and submit STILL sends the 24h HH:MM wire string', async () => {
		const timeFormatModulePath = '$lib/preferences/timeFormat';
		const { timeFormatStore } = (await import(/* @vite-ignore */ timeFormatModulePath)) as
			typeof import('$lib/preferences/timeFormat');
		timeFormatStore.set('ampm');
		try {
			const container = await renderReady();
			await openSeriesForm(container);
			await fill(container, 'series-create-name', 'Evening rehearsals');
			await fill(container, 'series-create-duration', '90');

			const ampm = q(container, 'series-create-time-ampm') as HTMLSelectElement;
			expect(ampm, 'AM/PM mode must render the third select').not.toBeNull();
			expect(optionValues(q(container, 'series-create-time-hour')).filter((v) => v !== '')).toEqual(
				Array.from({ length: 12 }, (_, i) => String(i + 1))
			);
			await fireEvent.change(q(container, 'series-create-time-hour') as HTMLElement, {
				target: { value: '7' }
			});
			await fireEvent.change(q(container, 'series-create-time-minute') as HTMLElement, {
				target: { value: '05' }
			});
			await fireEvent.change(ampm, { target: { value: 'PM' } });

			await fill(container, 'series-create-from', '2026-09-01');
			await fill(container, 'series-create-until', '2026-09-21');
			await enableMondayGeneration(container);
			await submit(container);

			await waitFor(() => {
				expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
			});
			const { defaultLocation, defaultDescription, ...rest } = lastSeriesInput();
			expect(rest).toEqual({
				name: 'Evening rehearsals',
				dbEntityId: ORG_EFK,
				extraParentIds: [SEASON_ID],
				eventType: 'rehearsal',
				intervalDays: 7,
				startTime: '19:05',
				durationMinutes: 90,
				startDate: '2026-09-07',
				endDate: '2026-09-21'
			});
			expect(defaultLocation ?? '').toBe('');
			expect(defaultDescription ?? '').toBe('');
			await settleSeriesRun(container);
		} finally {
			timeFormatStore.set('24h');
		}
	});

	it('the repeat select maps to intervalDays: biweekly → 14 — and still generates (two biweekly Mondays: Sep 7 + Sep 21)', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await selectValue(container, 'series-create-repeat', 'biweekly');
		await submit(container);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		expect(lastSeriesInput().intervalDays).toBe(14);
		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(2);
		});
		await settleSeriesRun(container);
	});

	it('a FAILED series write: series-create-error (role="alert"), the form stays OPEN with the work still in it, nothing generated', async () => {
		createEventSeriesMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'series-create-form')).not.toBeNull();
		expect((q(container, 'series-create-name') as HTMLInputElement).value).toBe(
			'Monday rehearsals'
		);
		expect(createEventMock).not.toHaveBeenCalled();
	});
});

describe('season panel — submit bulk-creates the occurrences (generation always on, #240)', () => {
	it('creates the series FIRST, then ONE createEvent per generated date, ascending: each occurrence sets ONLY org/series/season parents + eventType + startDatetime (Tallinn wall clock → UTC instant); name/duration/location/description INHERIT — never copied', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await fill(container, 'series-create-location', 'Main hall');
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(3);
		});
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		expect(createEventSeriesMock.mock.invocationCallOrder[0]).toBeLessThan(
			createEventMock.mock.invocationCallOrder[0]
		);

		expect(createEventMock.mock.calls.map((c) => (c[1] as CreateEventInput).startDatetime)).toEqual(
			['2026-09-07T16:00:00.000Z', '2026-09-14T16:00:00.000Z', '2026-09-21T16:00:00.000Z']
		);
		for (let i = 0; i < 3; i += 1) {
			expect(createEventMock.mock.calls[i][0]).toEqual(CFG);
			const input = eventInput(i);
			expect(input.dbEntityId).toBe(ORG_EFK);
			expect(input.seriesId).toBe(NEW_SERIES_ID);
			expect(input.extraParentIds).toEqual([SEASON_ID]);
			expect(input.eventType).toBe('rehearsal');
			expect(input.name ?? '').toBe('');
			expect(input.durationMinutes ?? undefined).toBeUndefined();
			expect(input.location ?? '').toBe('');
			expect(input.description ?? '').toBe('');
			expect(input.conductorRefs ?? []).toEqual([]);
			expect(input.capacity ?? undefined).toBeUndefined();
		}
	});

	it('review F1 — the series carries the FIRST and LAST OCCURRENCE as startDate/endDate, not the search range: Mondays over Tue 2026-09-01 → 2026-09-21 persist 2026-09-07 / 2026-09-21', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		expect(createEventSeriesMock).toHaveBeenCalledWith(CFG, {
			name: 'Monday rehearsals',
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'rehearsal',
			intervalDays: 7,
			startTime: '19:00',
			durationMinutes: 90,
			startDate: '2026-09-07',
			endDate: '2026-09-21'
		});
	});

	it('…and a SKIPPED first/last occurrence moves the bounds with it — the stored range is what was actually created (#215: skipped by tapping its chip)', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(3);
		});
		await toggleDate(container, '2026-09-07');
		await submit(container);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		expect(lastSeriesInput().startDate).toBe('2026-09-14');
		expect(lastSeriesInput().endDate).toBe('2026-09-21');
	});

	it('the bulk loop is STRICTLY SERIAL — never two createEvent calls in flight (Entu rate/ordering)', async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		createEventMock.mockImplementation(async () => {
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 0));
			inFlight -= 1;
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventMock).toHaveBeenCalledTimes(3);
		expect(maxInFlight).toBe(1);
	});

	it('the occurrences honour the SKIP set: toggling 2026-09-14 OFF creates 2 events, not 3 (#215: the chip IS the skip input)', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(3);
		});
		await toggleDate(container, '2026-09-14');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventMock).toHaveBeenCalledTimes(2);
		expect(createEventMock.mock.calls.map((c) => (c[1] as CreateEventInput).startDatetime)).toEqual(
			['2026-09-07T16:00:00.000Z', '2026-09-21T16:00:00.000Z']
		);
	});

	it('the Tallinn wall clock holds ACROSS the DST fall-back (2026-10-25): 19:00 local is 16:00Z before and 17:00Z after — never a fixed UTC offset', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await fill(container, 'series-create-from', '2026-10-19');
		await fill(container, 'series-create-until', '2026-11-02');
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventMock.mock.calls.map((c) => (c[1] as CreateEventInput).startDatetime)).toEqual(
			['2026-10-19T16:00:00.000Z', '2026-10-26T17:00:00.000Z', '2026-11-02T17:00:00.000Z']
		);
	});

	it('bulk success: form closes, the panel STAYS OPEN, its series list re-reads (the new series + counts must appear) and the agenda refreshes (the occurrences must land on it)', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		const seriesReadsBefore = listEventSeriesForSeasonMock.mock.calls.length;
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);

		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock.mock.calls.length).toBeGreaterThan(seriesReadsBefore);
		});
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
	});
});

describe('season panel — bulk creation reports progress and survives partial failure', () => {
	it('series-create-progress (role="status") tracks the loop: current 1 of 3 while the first POST is in flight, advancing as each resolves, gone when the run completes', async () => {
		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});
		const progress = q(container, 'series-create-progress') as HTMLElement;
		expect(progress).not.toBeNull();
		expect(progress.getAttribute('role')).toBe('status');
		expect(progress.textContent).toContain('series_create_progress');
		expect(progress.textContent).toContain('"current":1');
		expect(progress.textContent).toContain('"total":3');

		resolvers[0]('ev-new-1');
		await waitFor(() => {
			expect(resolvers.length).toBe(2);
		});
		expect(q(container, 'series-create-progress')?.textContent).toContain('"current":2');

		resolvers[1]('ev-new-2');
		await waitFor(() => {
			expect(resolvers.length).toBe(3);
		});
		resolvers[2]('ev-new-3');

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(q(container, 'series-create-progress')).toBeNull();
	});

	it('PARTIAL FAILURE: occurrence 2 of 3 fails → the loop STOPS (no 3rd POST), series-create-error (role="alert") reports created=1 / total=3, and the form stays OPEN; nothing is rolled back', async () => {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		await flush();
		expect(createEventMock).toHaveBeenCalledTimes(2);
		const error = q(container, 'series-create-error') as HTMLElement;
		expect(error.getAttribute('role')).toBe('alert');
		expect(error.textContent).toContain('series_create_bulk_failed');
		expect(error.textContent).toContain('"created":1');
		expect(error.textContent).toContain('"total":3');
		expect(q(container, 'series-create-form')).not.toBeNull();
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
	});
});

describe('season panel — series create REFUSES an incomplete form before it writes', () => {
	it('blank NAME: series-create-error names it, createEventSeries never runs, the form stays open', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-duration', '90');
		await fillTime(container, 'series-create-time', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		const error = q(container, 'series-create-error') as HTMLElement;
		expect(error.getAttribute('role')).toBe('alert');
		expect(error.textContent?.trim()).toBe('series_create_name_required');
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'series-create-form')).not.toBeNull();
	});

	it('review F4 — a refusal is wired to ITS OWN box: aria-invalid + aria-describedby point at the error, and only that field carries them', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-duration', '90');
		await fillTime(container, 'series-create-time', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.getAttribute('id')).toBe('series-create-error');
		const name = q(container, 'series-create-name') as HTMLInputElement;
		expect(name.getAttribute('aria-invalid')).toBe('true');
		expect(name.getAttribute('aria-describedby')).toBe('series-create-error');
		for (const testid of [
			'series-create-type',
			'series-create-duration',
			'series-create-time-hour',
			'series-create-time-minute'
		]) {
			const el = q(container, testid) as HTMLElement;
			expect(el.getAttribute('aria-invalid')).toBeNull();
			expect(el.getAttribute('aria-describedby')).toBeNull();
		}

		await fill(container, 'series-create-name', 'Monday rehearsals');
		await waitFor(() => {
			expect(q(container, 'series-create-error')).toBeNull();
		});
		expect(
			(q(container, 'series-create-name') as HTMLInputElement).getAttribute('aria-invalid')
		).toBeNull();
	});

	it('…and a range refusal hands the wiring to the UNTIL box instead', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await fill(container, 'series-create-until', '2026-08-01');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		const until = q(container, 'series-create-until') as HTMLInputElement;
		expect(until.getAttribute('aria-invalid')).toBe('true');
		expect(until.getAttribute('aria-describedby')).toBe('series-create-error');
		expect(
			(q(container, 'series-create-name') as HTMLInputElement).getAttribute('aria-invalid')
		).toBeNull();
	});

	it('blank TIME: refused with the TIME message — v4E start_time is required and T1 would throw anyway; the page says WHICH field first', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Monday rehearsals');
		await fill(container, 'series-create-duration', '90');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_time_required'
		);
		expect(createEventSeriesMock).not.toHaveBeenCalled();
	});

	it('blank DURATION: refused with the DURATION message', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Monday rehearsals');
		await fillTime(container, 'series-create-time', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_duration_required'
		);
		expect(createEventSeriesMock).not.toHaveBeenCalled();
	});

	it('NO day picked on a day-using pattern: refused with the DAY message and NO write at all — the check is unconditional now that generation is (#240) — otherwise a refused form leaves a half-made series behind', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_day_required'
		);
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('the refusal is not sticky: filling the named field and re-submitting writes', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-duration', '90');
		await fillTime(container, 'series-create-time', '19:00');
		await selectValue(container, 'series-create-day', '1');
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});

		await fill(container, 'series-create-name', 'Monday rehearsals');
		await submit(container);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		await settleSeriesRun(container);
	});
});

describe('season panel — DAILY generation needs no day of week', () => {
	it('daily HIDES the inert day select and previews immediately: generateEventDates ignores dayOfWeek for daily, so demanding one would gate generation behind a field with no effect', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-09-04');
		await selectValue(container, 'series-create-repeat', 'daily');

		await waitFor(() => {
			expect(q(container, 'series-create-preview')).not.toBeNull();
		});
		expect(q(container, 'series-create-day')).toBeNull();
		expect(previewDates(container)).toEqual([
			'2026-09-01',
			'2026-09-02',
			'2026-09-03',
			'2026-09-04'
		]);
	});

	it('…and submits without a day: one occurrence per calendar day, no day_required refusal', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Festival week');
		await fill(container, 'series-create-duration', '90');
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-09-04');
		await selectValue(container, 'series-create-repeat', 'daily');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(q(container, 'series-create-error')).toBeNull();
		expect(lastSeriesInput().intervalDays).toBe(1);
		expect(createEventMock).toHaveBeenCalledTimes(4);
		expect(createEventMock.mock.calls.map((c) => (c[1] as CreateEventInput).startDatetime)).toEqual(
			[
				'2026-09-01T16:00:00.000Z',
				'2026-09-02T16:00:00.000Z',
				'2026-09-03T16:00:00.000Z',
				'2026-09-04T16:00:00.000Z'
			]
		);
	});

	it('a day-using pattern still demands one — switching back to weekly restores the select and the refusal', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await selectValue(container, 'series-create-repeat', 'daily');
		await selectValue(container, 'series-create-repeat', 'weekly');

		await waitFor(() => {
			expect(q(container, 'series-create-day')).not.toBeNull();
		});
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_day_required'
		);
		expect(createEventSeriesMock).not.toHaveBeenCalled();
	});
});

describe('season panel — the date range is validated BEFORE any fetch', () => {
	it('blank FROM: named refusal, no org round-trip, no write', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await fill(container, 'series-create-from', '');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_from_required'
		);
		expect(resolveDatabaseEntityIdMock).not.toHaveBeenCalled();
		expect(createEventSeriesMock).not.toHaveBeenCalled();
	});

	it('blank UNTIL: named refusal, no write', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await fill(container, 'series-create-until', '');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_until_required'
		);
		expect(createEventSeriesMock).not.toHaveBeenCalled();
	});

	it('UNTIL before FROM: named refusal — never the generic "try again" that retrying cannot fix', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await fill(container, 'series-create-until', '2026-08-01');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_until_before_from'
		);
		expect(resolveDatabaseEntityIdMock).not.toHaveBeenCalled();
		expect(createEventSeriesMock).not.toHaveBeenCalled();
	});
});

describe('season panel — the preview counts, scrolls, and refuses an empty set', () => {
	it('states how many events will be created (plural), and the singular form when exactly one', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-12-01');
		await enableMondayGeneration(container);

		await waitFor(() => {
			expect(q(container, 'series-create-preview-count')).not.toBeNull();
		});
		const count = q(container, 'series-create-preview-count') as HTMLElement;
		expect(count.textContent).toContain('series_create_preview_count_other');
		expect(count.textContent).toContain('"count":13');

		await fill(container, 'series-create-until', '2026-09-07');
		await waitFor(() => {
			expect(previewDates(container)).toEqual(['2026-09-07']);
		});
		expect(q(container, 'series-create-preview-count')?.textContent?.trim()).toBe(
			'series_create_preview_count_one'
		);
	});

	it('#215 — the count line tracks TOGGLES live: 3 chips, one toggled off → the _other form with count 2, exactly', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(3);
		});
		expect(q(container, 'series-create-preview-count')?.textContent?.trim()).toBe(
			'series_create_preview_count_other {"count":3}'
		);

		await toggleDate(container, '2026-09-14');

		await waitFor(() => {
			expect(q(container, 'series-create-preview-count')?.textContent?.trim()).toBe(
				'series_create_preview_count_other {"count":2}'
			);
		});
	});

	it('#215 Gama ruling (2) — ALL chips toggled off: submit DISABLED, the count line reads the 0 form of series_create_preview_count ("Luuakse 0 sündmust") and series_create_no_dates is NOT shown; toggling one back on re-enables submit', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(previewDates(container)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21']);
		});
		expect((q(container, 'series-create-submit') as HTMLButtonElement).disabled).toBe(false);

		await toggleDate(container, '2026-09-07');
		await toggleDate(container, '2026-09-14');
		await toggleDate(container, '2026-09-21');

		await waitFor(() => {
			expect(activeDates(container)).toEqual([]);
		});
		expect(q(container, 'series-create-preview-count')?.textContent?.trim()).toBe(
			'series_create_preview_count_other {"count":0}'
		);
		expect(container.textContent).not.toContain('series_create_no_dates');
		expect((q(container, 'series-create-submit') as HTMLButtonElement).disabled).toBe(true);
		await flush();
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();

		await toggleDate(container, '2026-09-14');
		await waitFor(() => {
			expect((q(container, 'series-create-submit') as HTMLButtonElement).disabled).toBe(false);
		});
		expect(activeDates(container)).toEqual(['2026-09-14']);
	});

	it('a recurrence that yields NOTHING (Mondays over a Tue–Sun range) is REFUSED before the series is written — never a silent success with a childless series behind it', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Impossible Mondays');
		await fill(container, 'series-create-duration', '90');
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-09-06');
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_no_dates'
		);
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'series-create-form')).not.toBeNull();
	});
});

describe('season panel — dismissal is refused while a bulk run is in flight', () => {
	it('Escape when IDLE closes the form but NOT the panel it sits in — the WAI-APG two-Escapes-to-leave layering', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		await fireEvent.keyDown(q(container, 'series-create-form') as HTMLElement, { key: 'Escape' });

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(createEventSeriesMock).not.toHaveBeenCalled();
	});

	it('cancel is DISABLED and Escape is ignored mid-run: the form cannot unmount while the loop is still POSTing', async () => {
		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});
		expect((q(container, 'series-create-cancel') as HTMLButtonElement).disabled).toBe(true);

		await fireEvent.click(q(container, 'series-create-cancel') as HTMLElement);
		await fireEvent.keyDown(q(container, 'series-create-form') as HTMLElement, { key: 'Escape' });
		await flush();
		expect(q(container, 'series-create-form')).not.toBeNull();

		resolvers[0]('ev-new-1');
		await waitFor(() => {
			expect(resolvers.length).toBe(2);
		});
		resolvers[1]('ev-new-2');
		await waitFor(() => {
			expect(resolvers.length).toBe(3);
		});
		resolvers[2]('ev-new-3');
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect((q(container, 'series-create-cancel') as HTMLButtonElement | null) ?? null).toBeNull();
	});
});

describe('season panel — a STOPPED bulk run resumes instead of duplicating', () => {
	it('the failure path re-reads the agenda AND the panel lists so the occurrences that DID land become visible', async () => {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		const seriesReadsBefore = listEventSeriesForSeasonMock.mock.calls.length;
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);

		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock.mock.calls.length).toBeGreaterThan(seriesReadsBefore);
		});
		const resume = q(container, 'series-create-resume') as HTMLElement;
		expect(resume).not.toBeNull();
		expect(resume.textContent).toContain('series_create_resume_notice');
		expect(resume.textContent).toContain('"remaining":2');
		expect(resume.textContent).toContain('"total":3');
		expect(q(container, 'series-create-preview-count')).toBeNull();
	});

	it('review F3 — the preview ROWS shrink to the remainder too: the list and the resume notice describe the SAME set (never 3 dates over a "2 remaining")', async () => {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(previewDates(container)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21']);
		});

		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});

		await waitFor(() => {
			expect(previewDates(container)).toEqual(['2026-09-14', '2026-09-21']);
		});
		expect(q(container, 'series-create-resume')?.textContent).toContain('"remaining":2');
	});

	it('review F5 — the template and recurrence boxes go INERT while a run is resumable: submit finishes THAT run, so an edit here would be silently discarded', async () => {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});
		for (const testid of [
			'series-create-name',
			'series-create-type',
			'series-create-duration',
			'series-create-location',
			'series-create-description',
			'series-create-repeat',
			'series-create-day',
			'series-create-time-hour',
			'series-create-time-minute',
			'series-create-from',
			'series-create-until'
		]) {
			expect(
				(q(container, testid) as HTMLInputElement | HTMLButtonElement | null)?.disabled
			).toBe(true);
		}
		expect((q(container, 'series-create-submit') as HTMLButtonElement).disabled).toBe(false);
		expect((q(container, 'series-create-cancel') as HTMLButtonElement).disabled).toBe(false);
	});

	it('re-submitting creates NO second series and only the occurrences that never landed', async () => {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(createEventMock).toHaveBeenCalledTimes(2);

		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		expect(createEventMock).toHaveBeenCalledTimes(4);
		expect(
			createEventMock.mock.calls.slice(2).map((c) => (c[1] as CreateEventInput).startDatetime)
		).toEqual(['2026-09-14T16:00:00.000Z', '2026-09-21T16:00:00.000Z']);
		for (const call of createEventMock.mock.calls.slice(2)) {
			expect((call[1] as CreateEventInput).seriesId).toBe(NEW_SERIES_ID);
		}
	});

});

describe('#138 — a stopped series run survives a collective round trip', () => {
	function setAuthedWithTwoCollectives(): void {
		signIn({
			collectives: [
				{ db: 'org-a', name: 'Org A', personId: 'person-p' },
				{ db: 'org-b', name: 'Org B', personId: 'person-p' }
			]
		});
	}

	async function renderTwoReady(): Promise<HTMLElement> {
		setAuthedWithTwoCollectives();
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		return container;
	}

	async function stopRunInOrgA(container: HTMLElement): Promise<void> {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});
	}

	async function leaveOrgA(container: HTMLElement): Promise<void> {
		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
	}

	it('coming back to org-a re-surfaces the run, and a re-submit creates NO second series and re-POSTs nothing that landed', async () => {
		const container = await renderTwoReady();
		await stopRunInOrgA(container);
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		expect(createEventMock).toHaveBeenCalledTimes(2);

		await leaveOrgA(container);
		selectedCollectiveDbStore.set('org-a');

		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});
		const resume = q(container, 'series-create-resume') as HTMLElement;
		expect(resume.textContent).toContain('"remaining":2');
		expect(resume.textContent).toContain('"total":3');
		expect(previewDates(container)).toEqual(['2026-09-14', '2026-09-21']);
		expect((q(container, 'series-create-submit') as HTMLButtonElement).disabled).toBe(false);
		expect((q(container, 'series-create-cancel') as HTMLButtonElement).disabled).toBe(false);

		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		expect(createEventMock).toHaveBeenCalledTimes(4);
		expect(
			createEventMock.mock.calls.slice(2).map((c) => (c[1] as CreateEventInput).startDatetime)
		).toEqual(['2026-09-14T16:00:00.000Z', '2026-09-21T16:00:00.000Z']);
		for (const call of createEventMock.mock.calls.slice(2)) {
			expect((call[1] as CreateEventInput).seriesId).toBe(NEW_SERIES_ID);
			expect(call[0]).toEqual({ db: 'org-a', token: 'jwt-abc' });
		}
		await waitFor(() => {
			expect((q(container, 'season-manage-add-series') as HTMLButtonElement).disabled).toBe(false);
		});
	});

	it('a switch MID-generation (nothing failed) records what org-a still owes — the orphan #138 is actually named after', async () => {
		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		const container = await renderTwoReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);
		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});

		await leaveOrgA(container);
		resolvers[0]('ev-new-1');
		await flush();
		expect(createEventMock).toHaveBeenCalledTimes(1);
		expect(q(container, 'series-create-resume')).toBeNull();

		selectedCollectiveDbStore.set('org-a');
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});
		expect((q(container, 'series-create-resume') as HTMLElement).textContent).toContain(
			'"remaining":2'
		);

		createEventMock.mockImplementation(async () => `ev-resumed-${createEventMock.mock.calls.length}`);
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		expect(createEventMock).toHaveBeenCalledTimes(3);
		expect(
			createEventMock.mock.calls.slice(1).map((c) => (c[1] as CreateEventInput).startDatetime)
		).toEqual(['2026-09-14T16:00:00.000Z', '2026-09-21T16:00:00.000Z']);
	});

	it('org-b is unaffected while org-a owes a run: its entry points stay live and it creates its own series', async () => {
		const container = await renderTwoReady();
		await stopRunInOrgA(container);

		await leaveOrgA(container);
		await openSeriesForm(container);
		expect(q(container, 'series-create-resume')).toBeNull();

		createEventMock.mockImplementation(async () => `ev-b-${createEventMock.mock.calls.length}`);
		await fillValidTemplate(container);
		await enableMondayGeneration(container); // #240 — every submit generates
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventSeriesMock).toHaveBeenCalledTimes(2);
		expect(createEventSeriesMock.mock.calls[1][0]).toEqual({ db: 'org-b', token: 'jwt-abc' });

		selectedCollectiveDbStore.set('org-a');
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});
	});

	it('Cancel after the round trip abandons the run and unlocks org-a', async () => {
		const container = await renderTwoReady();
		await stopRunInOrgA(container);
		await leaveOrgA(container);
		selectedCollectiveDbStore.set('org-a');
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});

		await fireEvent.click(q(container, 'series-create-cancel') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect((q(container, 'season-manage-add-series') as HTMLButtonElement).disabled).toBe(false);
		await fireEvent.click(q(container, 'season-manage-add-series') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'series-create-form')).not.toBeNull();
		});
		expect(q(container, 'series-create-resume')).toBeNull();
		expect((q(container, 'series-create-name') as HTMLInputElement).value).toBe('');
	});

	it('a run still IN FLIGHT in the collective just left does not swallow the arriving one’s restore', async () => {
		const container = await renderTwoReady();

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-card-expand')).not.toBeNull();
		});
		await stopRunInOrgA(container); // db-agnostic: it runs in whatever is selected
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);

		selectedCollectiveDbStore.set('org-a');
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});

		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);
		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});

		resolvers[0]('ev-a-1');
		await flush();
		expect(q(container, 'series-create-resume')).not.toBeNull();
		expect(previewDates(container)).toEqual(['2026-09-14', '2026-09-21']);
		expect((q(container, 'series-create-submit') as HTMLButtonElement).disabled).toBe(false);
		expect((q(container, 'series-create-cancel') as HTMLButtonElement).disabled).toBe(false);

		await fireEvent.click(q(container, 'series-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect((q(container, 'season-manage-add-series') as HTMLButtonElement).disabled).toBe(false);

		selectedCollectiveDbStore.set('org-a');
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});
		expect((q(container, 'series-create-resume') as HTMLElement).textContent).toContain(
			'"remaining":2'
		);
	});
});

describe('#277 review F2 — a season switch takes the series form with the panel', () => {
	const SEASON_B_ID = 'season-2';

	function twoSeasonResult() {
		return fullAgendaResult({
			seasons: [
				currentSeason(true),
				{
					id: SEASON_B_ID,
					name: 'Season 2027',
					startDate: isoDate(61),
					endDate: isoDate(240),
					conductors: [],
					owners: [],
					editors: ['person-p']
				}
			]
		});
	}

	function expandButtons(container: HTMLElement): HTMLButtonElement[] {
		return Array.from(
			container.querySelectorAll('[data-testid="season-card-expand"]')
		) as HTMLButtonElement[];
	}

	function expandFor(container: HTMLElement, seasonName: string): HTMLButtonElement | null {
		return expandButtons(container).find((b) => b.textContent?.includes(seasonName)) ?? null;
	}

	it('form open under A, click B’s entry: no form survives under B — and the one re-opened there prefills B’s dates and submits under B', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		const container = await renderReady();
		await openSeriesForm(container);
		expect((q(container, 'series-create-from') as HTMLInputElement).value).toBe(SEASON_START);

		await fireEvent.click(expandFor(container, 'Season 2027') as HTMLButtonElement);

		await waitFor(() => {
			expect(q(container, 'season-manage-label')?.textContent?.trim()).toBe('Season 2027');
		});
		expect(q(container, 'series-create-form')).toBeNull();

		await waitFor(() => {
			expect(q(container, 'season-manage-add-series')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'season-manage-add-series') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'series-create-form')).not.toBeNull();
		});
		expect((q(container, 'series-create-from') as HTMLInputElement).value).toBe(isoDate(61));

		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);
		await settleSeriesRun(container);

		expect(lastSeriesInput().extraParentIds).toEqual([SEASON_B_ID]);
		for (const call of createEventMock.mock.calls) {
			expect((call[1] as CreateEventInput).extraParentIds).toEqual([SEASON_B_ID]);
		}
	});

	it('a STOPPED run refuses the switch: B’s entry is DISABLED, the panel stays A’s with its resume notice, and the run’s record survives to be finished', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});

		const bEntry = expandFor(container, 'Season 2027') as HTMLButtonElement;
		expect(bEntry.disabled).toBe(true);
		await fireEvent.click(bEntry);
		await flush();

		expect(q(container, 'season-manage-label')?.textContent?.trim()).toBe('Season 2026');
		expect(q(container, 'series-create-resume')).not.toBeNull();
		createEventMock.mockImplementation(
			async () => `ev-resumed-${createEventMock.mock.calls.length}`
		);
		await submit(container);
		await settleSeriesRun(container);

		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		expect(lastSeriesInput().extraParentIds).toEqual([SEASON_ID]);
		expect(createEventMock).toHaveBeenCalledTimes(4);
		expect(
			createEventMock.mock.calls.slice(2).map((c) => (c[1] as CreateEventInput).startDatetime)
		).toEqual(['2026-09-14T16:00:00.000Z', '2026-09-21T16:00:00.000Z']);
	});

	it('the season ALREADY in play is never disabled by its own run: it has no entry of its own while open — the collapse control carries the refusal (#135)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});

		expect(expandFor(container, 'Season 2026')).toBeNull();
		expect((q(container, 'season-card-collapse') as HTMLButtonElement).disabled).toBe(true);
	});
});

describe('#215 — chips while LOCKED, and the retired skip UI', () => {
	it('LOCKED (resumable run): the REMAINDER renders as chips — disabled, still pressed — and clicking one changes NOTHING (the skip set is frozen with the rest of the form)', async () => {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});

		await waitFor(() => {
			expect(previewDates(container)).toEqual(['2026-09-14', '2026-09-21']);
		});
		for (const iso of ['2026-09-14', '2026-09-21']) {
			const chip = dateChip(container, iso) as HTMLButtonElement;
			expect(chip.disabled, `${iso} chip must be disabled while locked`).toBe(true);
			expect(chip.getAttribute('aria-pressed')).toBe('true');
		}

		await fireEvent.click(dateChip(container, '2026-09-14') as HTMLButtonElement);
		await flush();
		expect(dateChip(container, '2026-09-14')?.getAttribute('aria-pressed')).toBe('true');
		expect(activeDates(container)).toEqual(['2026-09-14', '2026-09-21']);
		expect(q(container, 'series-create-resume')?.textContent).toContain('"remaining":2');
	});

	it('no trace of the retired skip UI remains anywhere in the open form — input, Add, list, chips, heading', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(3);
		});
		await toggleDate(container, '2026-09-14');

		expect(q(container, 'series-create-skip-date')).toBeNull();
		expect(q(container, 'series-create-skip-add')).toBeNull();
		expect(q(container, 'series-create-skip-list')).toBeNull();
		expect(q(container, 'series-create-skip-heading')).toBeNull();
		expect(container.querySelector('[data-testid^="series-create-skip-"]')).toBeNull();
	});
});

describe('#215 — locale files: skip keys retired, preview keys stay', () => {
	const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
	const RETIRED_KEYS = [
		'series_create_skip_heading',
		'series_create_skip_date_label',
		'series_create_skip_add',
		'series_create_skip_remove'
	] as const;
	const KEPT_KEYS = [
		'series_create_preview_label',
		'series_create_preview_count_one',
		'series_create_preview_count_other',
		'series_create_no_dates'
	] as const;

	function messageFile(locale: string): MessageFile {
		return JSON.parse(
			readFileSync(resolvePath(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as MessageFile;
	}

	it.each(LOCALES)('%s: the four series_create_skip_* keys are ABSENT', (locale) => {
		const file = messageFile(locale);
		for (const key of RETIRED_KEYS) {
			expect(key in file, `${key} must be gone from messages/${locale}.json`).toBe(false);
		}
	});

	it.each(LOCALES)('%s: the preview keys the grid uses are present and non-empty', (locale) => {
		const file = messageFile(locale);
		for (const key of KEPT_KEYS) {
			expect(isMessageEmpty(file[key]), `${key} must exist, non-empty, in ${locale}`).toBe(false);
		}
	});

	it.each(LOCALES)('%s: series_create_generate_label is ABSENT (#240 — the checkbox is retired)', (locale) => {
		const file = messageFile(locale);
		expect(
			'series_create_generate_label' in file,
			`series_create_generate_label must be gone from messages/${locale}.json`
		).toBe(false);
	});
});

describe('#239 — every control carries a visible label that IS its accessible name', () => {
	function labelElementOf(container: HTMLElement, el: HTMLElement): HTMLLabelElement | null {
		const id = el.getAttribute('id');
		if (id) {
			const forLabel = container.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
			if (forLabel) return forLabel;
		}
		return el.closest('label');
	}

	function labelText(label: HTMLElement): string {
		const clone = label.cloneNode(true) as HTMLElement;
		for (const embedded of clone.querySelectorAll('input, select, textarea')) embedded.remove();
		return clone.textContent?.replace(/\s+/g, ' ').trim() ?? '';
	}

	function computedName(container: HTMLElement, el: HTMLElement): string {
		const labelledby = el.getAttribute('aria-labelledby');
		if (labelledby) {
			return labelledby
				.split(/\s+/)
				.map((id) => container.querySelector(`[id="${id}"]`)?.textContent?.trim() ?? '')
				.join(' ')
				.trim();
		}
		const ariaLabel = el.getAttribute('aria-label');
		if (ariaLabel !== null) return ariaLabel.trim();
		const label = labelElementOf(container, el);
		return label ? labelText(label) : '';
	}

	function expectVisibleText(el: HTMLElement, what: string): void {
		expect(el.hasAttribute('hidden'), `${what} must not be [hidden]`).toBe(false);
		expect(el.getAttribute('aria-hidden'), `${what} must not be aria-hidden`).not.toBe('true');
		expect(
			Array.from(el.classList),
			`${what} must be visibly rendered, not screen-reader-only`
		).not.toContain('sr-only');
	}

	const FIELD_LABEL_KEYS: ReadonlyArray<readonly [testid: string, key: string]> = [
		['series-create-name', 'series_create_name_label'],
		['series-create-type', 'series_create_type_label'],
		['series-create-duration', 'series_create_duration_label'],
		['series-create-location', 'series_create_location_label'],
		['series-create-description', 'series_create_description_label'],
		['series-create-repeat', 'series_create_repeat_label'],
		['series-create-day', 'series_create_day_label'],
		['series-create-from', 'series_create_from_label'],
		['series-create-until', 'series_create_until_label']
	];

	it('all nine labelable controls: a visible <label> (for= or wrapping) computes as the accessible name, and the old aria-label is GONE — never a placeholder as the only name', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		for (const [testid, key] of FIELD_LABEL_KEYS) {
			const control = q(container, testid) as HTMLElement;
			expect(control, testid).not.toBeNull();

			expect(
				control.getAttribute('aria-label'),
				`${testid}: aria-label must be dropped once the visible label names it`
			).toBeNull();

			const label = labelElementOf(container, control);
			expect(label, `${testid}: needs a label[for] or wrapping <label>`).not.toBeNull();
			expectVisibleText(label as HTMLElement, `${testid}'s label`);

			expect(
				computedName(container, control),
				`${testid}: computed accessible name must be the visible label's text`
			).toBe(key);
		}
	});

	it('the time composite: the role="group" wrapper is named by a VISIBLE series_create_time_label element (aria-labelledby), its own aria-label gone; the hour/minute selects keep their PART names', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const group = q(container, 'series-create-time') as HTMLElement;
		expect(group).not.toBeNull();
		expect(group.getAttribute('role')).toBe('group');

		expect(
			group.getAttribute('aria-label'),
			'the group must be named by its visible label, not an aria-label'
		).toBeNull();
		const labelledby = group.getAttribute('aria-labelledby');
		expect(labelledby, 'series-create-time needs aria-labelledby').not.toBeNull();
		const nameEl = container.querySelector(`[id="${labelledby}"]`) as HTMLElement | null;
		expect(nameEl, `aria-labelledby="${labelledby}" must resolve inside the form`).not.toBeNull();
		expectVisibleText(nameEl as HTMLElement, "the time group's label");
		expect(computedName(container, group)).toBe('series_create_time_label');

		for (const part of ['series-create-time-hour', 'series-create-time-minute']) {
			const sel = q(container, part) as HTMLSelectElement;
			expect(sel, part).not.toBeNull();
			expect(sel.getAttribute('aria-label')?.trim(), `${part} keeps its part name`).toBeTruthy();
		}
	});
});

describe('#239 — the form is grouped into four native fieldsets with visible legends', () => {
	function formFieldsets(container: HTMLElement): HTMLFieldSetElement[] {
		const form = q(container, 'series-create-form') as HTMLElement;
		expect(form).not.toBeNull();
		return [...form.querySelectorAll<HTMLFieldSetElement>('fieldset')];
	}

	const GROUP_LEGEND_KEYS = [
		'series_create_group_general_label',
		'series_create_group_location_label',
		'series_create_group_schedule_label',
		'series_create_group_preview_label'
	] as const;

	it('exactly four <fieldset>s, unnested, in the PO-ruled order, each led by a visible <legend> carrying its group key', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const fieldsets = formFieldsets(container);
		expect(fieldsets, 'the form must hold exactly four fieldsets').toHaveLength(4);

		fieldsets.forEach((fieldset, i) => {
			expect(
				fieldset.parentElement?.closest('fieldset'),
				`fieldset ${i} must not nest inside another`
			).toBeNull();
			const legend = fieldset.firstElementChild as HTMLElement | null;
			expect(legend?.tagName, `fieldset ${i} must LEAD with its <legend>`).toBe('LEGEND');
			expect((legend as HTMLElement).textContent?.trim()).toBe(GROUP_LEGEND_KEYS[i]);
			expect(
				(legend as HTMLElement).hasAttribute('hidden') ||
					(legend as HTMLElement).getAttribute('aria-hidden') === 'true' ||
					Array.from((legend as HTMLElement).classList).includes('sr-only'),
				`fieldset ${i}'s legend must be visible — the heading is the point`
			).toBe(false);
		});
	});

	it('membership: general(name,type,description) · location(location,duration) · schedule(repeat,day,time,from,until)', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const fieldsets = formFieldsets(container);
		expect(fieldsets).toHaveLength(4);

		const MEMBERSHIP: ReadonlyArray<readonly [testid: string, group: number]> = [
			['series-create-name', 0],
			['series-create-type', 0],
			['series-create-description', 0],
			['series-create-location', 1],
			['series-create-duration', 1],
			['series-create-repeat', 2],
			['series-create-day', 2], // weekly default → rendered
			['series-create-time', 2],
			['series-create-from', 2],
			['series-create-until', 2]
		];
		for (const [testid, group] of MEMBERSHIP) {
			const control = q(container, testid) as HTMLElement;
			expect(control, testid).not.toBeNull();
			expect(
				control.closest('fieldset'),
				`${testid} belongs in fieldset ${group} (${GROUP_LEGEND_KEYS[group]})`
			).toBe(fieldsets[group]);
		}
	});

	it('group 4 (Loodavad sündmused): the live preview and the submit button sit under the preview legend — and no generate control returns to anchor it', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(q(container, 'series-create-preview')).not.toBeNull();
		});

		const fieldsets = formFieldsets(container);
		expect(fieldsets).toHaveLength(4);
		const previewFieldset = fieldsets[3];

		expect((q(container, 'series-create-preview') as HTMLElement).closest('fieldset')).toBe(
			previewFieldset
		);
		expect((q(container, 'series-create-preview-count') as HTMLElement).closest('fieldset')).toBe(
			previewFieldset
		);
		expect((q(container, 'series-create-submit') as HTMLElement).closest('fieldset')).toBe(
			previewFieldset
		);
		expect(q(container, 'series-create-generate')).toBeNull();
	});

	it('375px stays fluid (class contract, happy-dom computes no layout): every fieldset carries min-w-0 — the UA default min-inline-size:min-content would floor the row — and no legend or label text is whitespace-nowrap', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const fieldsets = formFieldsets(container);
		expect(fieldsets).toHaveLength(4);
		for (const fieldset of fieldsets) {
			expect(
				Array.from(fieldset.classList),
				'a fieldset defaults to min-inline-size:min-content — min-w-0 keeps it shrinkable at 375px'
			).toContain('min-w-0');
		}
		const form = q(container, 'series-create-form') as HTMLElement;
		for (const el of form.querySelectorAll<HTMLElement>('legend, label')) {
			expect(
				Array.from(el.classList),
				'long lv/uk copy must be allowed to wrap, not overflow the card'
			).not.toContain('whitespace-nowrap');
		}
	});
});

describe('#239 — locale files: group keys verbatim (et/en), present everywhere; field keys stay', () => {
	const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
	const GROUP_KEYS = [
		'series_create_group_general_label',
		'series_create_group_location_label',
		'series_create_group_schedule_label',
		'series_create_group_preview_label'
	] as const;
	const REUSED_FIELD_KEYS = [
		'series_create_name_label',
		'series_create_type_label',
		'series_create_duration_label',
		'series_create_location_label',
		'series_create_description_label',
		'series_create_repeat_label',
		'series_create_day_label',
		'series_create_time_label',
		'series_create_from_label',
		'series_create_until_label'
	] as const;

	function messageFile(locale: string): MessageFile {
		return JSON.parse(
			readFileSync(resolvePath(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as MessageFile;
	}

	it.each(LOCALES)('%s: the four series_create_group_* keys are present, non-empty', (locale) => {
		const file = messageFile(locale);
		for (const key of GROUP_KEYS) {
			expect(isMessageEmpty(file[key]), `${key} must exist, non-empty, in ${locale}`).toBe(false);
		}
	});

	it('et carries the PO-ruled copy VERBATIM', () => {
		const file = messageFile('et');
		expect(file['series_create_group_general_label']).toBe('Üldandmed');
		expect(file['series_create_group_location_label']).toBe('Koht ja kestus');
		expect(file['series_create_group_schedule_label']).toBe('Kordumine ja ajad');
		expect(file['series_create_group_preview_label']).toBe('Loodavad sündmused');
	});

	it('en carries the PO-ruled copy VERBATIM', () => {
		const file = messageFile('en');
		expect(file['series_create_group_general_label']).toBe('General');
		expect(file['series_create_group_location_label']).toBe('Place and duration');
		expect(file['series_create_group_schedule_label']).toBe('Repeat and dates');
		expect(file['series_create_group_preview_label']).toBe('Events to create');
	});

	it.each(LOCALES)('%s: the ten reused field-label keys stay, non-empty', (locale) => {
		const file = messageFile(locale);
		for (const key of REUSED_FIELD_KEYS) {
			expect(isMessageEmpty(file[key]), `${key} must stay, non-empty, in ${locale}`).toBe(false);
		}
	});
});

describe('#241 — the preview caps at 50 chips, with show-next-50 / show-all-N', () => {
	function dailyIsoDates(from: string, until: string): string[] {
		const dates: string[] = [];
		const cursor = new Date(`${from}T00:00:00Z`);
		const end = new Date(`${until}T00:00:00Z`);
		while (cursor.getTime() <= end.getTime()) {
			dates.push(cursor.toISOString().slice(0, 10));
			cursor.setUTCDate(cursor.getUTCDate() + 1);
		}
		return dates;
	}

	function expectedSequence(isoDates: string[]): string[] {
		const seq: string[] = [];
		let month = '';
		for (const iso of isoDates) {
			if (iso.slice(0, 7) !== month) {
				month = iso.slice(0, 7);
				seq.push(`series-create-month-${month}`);
			}
			seq.push(`series-create-date-${iso}`);
		}
		return seq;
	}

	function showNextButton(container: HTMLElement): HTMLButtonElement | null {
		return q(container, 'series-create-show-next') as HTMLButtonElement | null;
	}

	function showAllButton(container: HTMLElement): HTMLButtonElement | null {
		return q(container, 'series-create-show-all') as HTMLButtonElement | null;
	}

	function countLine(container: HTMLElement): string {
		return q(container, 'series-create-preview-count')?.textContent ?? '';
	}

	async function renderDaily(from: string, until: string): Promise<HTMLElement> {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', from);
		await fill(container, 'series-create-until', until);
		await selectValue(container, 'series-create-repeat', 'daily');
		return container;
	}

	const FULL_153 = dailyIsoDates('2026-09-01', '2027-01-31');

	it('a 153-date daily season renders EXACTLY the first 50 chips (Sep + Oct 1–20, TWO headings), the count line reads the FULL 153, and two NATIVE keyboard-reachable buttons follow the grid: show-next {"count":50}, then show-all {"count":153} — and nothing is written', async () => {
		const container = await renderDaily('2026-09-01', '2027-01-31');

		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50);
		});
		expect(previewDates(container)).toEqual(FULL_153.slice(0, 50));
		expect(gridSequence(container)).toEqual(expectedSequence(FULL_153.slice(0, 50)));
		expect(countLine(container)).toContain('"count":153');

		const next = showNextButton(container);
		const all = showAllButton(container);
		expect(next, 'series-create-show-next must render').not.toBeNull();
		expect(all, 'series-create-show-all must render').not.toBeNull();
		for (const btn of [next as HTMLButtonElement, all as HTMLButtonElement]) {
			expect(btn.tagName).toBe('BUTTON');
			expect(btn.getAttribute('type')).toBe('button');
			expect(btn.disabled).toBe(false);
			expect(btn.tabIndex).toBeGreaterThanOrEqual(0);
		}
		expect(next?.textContent?.trim()).toBe('series_create_show_next_label {"count":50}');
		expect(all?.textContent?.trim()).toBe('series_create_show_all_label {"count":153}');

		const lastChip = dateChip(container, '2026-10-20') as HTMLElement;
		expect(
			lastChip.compareDocumentPosition(next as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING,
			'show-next must come after the grid'
		).not.toBe(0);
		expect(
			(next as HTMLElement).compareDocumentPosition(all as HTMLElement) &
				Node.DOCUMENT_POSITION_FOLLOWING,
			'show-all must come after show-next'
		).not.toBe(0);

		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('show-next is CUMULATIVE and order-preserving: 50 → 100 → 150 → 153; the boundary month keeps its ONE heading; the label carries the ACTUAL batch size ({"count":3} on the last step); both controls leave once everything is shown', async () => {
		const container = await renderDaily('2026-09-01', '2027-01-31');
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50);
		});

		await fireEvent.click(showNextButton(container) as HTMLElement);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(100);
		});
		expect(previewDates(container)).toEqual(FULL_153.slice(0, 100));
		expect(gridSequence(container)).toEqual(expectedSequence(FULL_153.slice(0, 100)));
		expect(
			container.querySelectorAll('[data-testid="series-create-month-2026-10"]')
		).toHaveLength(1);
		expect(countLine(container)).toContain('"count":153');

		await fireEvent.click(showNextButton(container) as HTMLElement);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(150);
		});
		expect(showNextButton(container)?.textContent?.trim()).toBe(
			'series_create_show_next_label {"count":3}'
		);
		expect(showAllButton(container)?.textContent?.trim()).toBe(
			'series_create_show_all_label {"count":153}'
		);

		await fireEvent.click(showNextButton(container) as HTMLElement);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(153);
		});
		expect(previewDates(container)).toEqual(FULL_153);
		expect(gridSequence(container)).toEqual(expectedSequence(FULL_153));
		expect(showNextButton(container)).toBeNull();
		expect(showAllButton(container)).toBeNull();
	});

	it('show-all reveals the remainder in ONE step: 50 → 153, full month-grouped sequence, both controls gone', async () => {
		const container = await renderDaily('2026-09-01', '2027-01-31');
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50);
		});

		await fireEvent.click(showAllButton(container) as HTMLElement);

		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(153);
		});
		expect(previewDates(container)).toEqual(FULL_153);
		expect(gridSequence(container)).toEqual(expectedSequence(FULL_153));
		expect(showNextButton(container)).toBeNull();
		expect(showAllButton(container)).toBeNull();
	});

	it('50 or fewer dates: no cap engages and NEITHER control renders (exactly-50 boundary)', async () => {
		const container = await renderDaily('2026-09-01', '2026-10-20'); // 30 + 20 = 50
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50);
		});
		expect(previewDates(container)).toEqual(dailyIsoDates('2026-09-01', '2026-10-20'));
		expect(showNextButton(container)).toBeNull();
		expect(showAllButton(container)).toBeNull();
	});

	it('revealing is a VIEW operation (#241 point 4): skips survive it, a skip toggle never collapses the reveal, the count line and show-all N track the SKIP-APPLIED total while show-next tracks the GRID', async () => {
		const container = await renderDaily('2026-09-01', '2026-11-29'); // 90
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50);
		});
		expect(countLine(container)).toContain('"count":90');
		expect(showNextButton(container)?.textContent?.trim()).toBe(
			'series_create_show_next_label {"count":40}'
		);
		expect(showAllButton(container)?.textContent?.trim()).toBe(
			'series_create_show_all_label {"count":90}'
		);

		await toggleDate(container, '2026-09-05');
		await waitFor(() => {
			expect(countLine(container)).toContain('"count":89');
		});
		expect(previewDates(container)).toHaveLength(50);
		expect(previewDates(container)).toEqual(dailyIsoDates('2026-09-01', '2026-10-20'));
		expect(dateChip(container, '2026-09-05')?.getAttribute('aria-pressed')).toBe('false');
		expect(showAllButton(container)?.textContent?.trim()).toBe(
			'series_create_show_all_label {"count":89}'
		);
		expect(showNextButton(container)?.textContent?.trim()).toBe(
			'series_create_show_next_label {"count":40}'
		);

		await fireEvent.click(showAllButton(container) as HTMLElement);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(90);
		});
		expect(dateChip(container, '2026-09-05')?.getAttribute('aria-pressed')).toBe('false');
		expect(dateChip(container, '2026-11-20')?.getAttribute('aria-pressed')).toBe('true');
		expect(activeDates(container)).toHaveLength(89);
		expect(countLine(container)).toContain('"count":89');

		await toggleDate(container, '2026-11-20');
		await waitFor(() => {
			expect(dateChip(container, '2026-11-20')?.getAttribute('aria-pressed')).toBe('false');
		});
		expect(previewDates(container)).toHaveLength(90);
		expect(countLine(container)).toContain('"count":88');
		expect(showNextButton(container)).toBeNull();
		expect(showAllButton(container)).toBeNull();
	});

	it('review F1 — under a RESUMABLE stopped run show-all counts the REMAINDER, not the re-generated full set: a 153-date run that stops after 20 shows "show all 133" over a button that reveals exactly those 133 — the same number the resume notice carries', async () => {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 21) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Daily grind');
		await fill(container, 'series-create-duration', '90');
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2027-01-31');
		await selectValue(container, 'series-create-repeat', 'daily');
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50); // of 153
		});

		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});

		const REMAINING_133 = dailyIsoDates('2026-09-21', '2027-01-31');
		expect(REMAINING_133).toHaveLength(133);
		await waitFor(() => {
			expect(previewDates(container)).toEqual(REMAINING_133.slice(0, 50));
		});
		expect(q(container, 'series-create-preview-count')).toBeNull();
		expect(q(container, 'series-create-resume')?.textContent).toContain('"remaining":133');
		expect(q(container, 'series-create-resume')?.textContent).toContain('"total":153');

		expect(showAllButton(container)?.textContent?.trim()).toBe(
			'series_create_show_all_label {"count":133}'
		);
		expect(showNextButton(container)?.textContent?.trim()).toBe(
			'series_create_show_next_label {"count":50}'
		);

		await fireEvent.click(showAllButton(container) as HTMLElement);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(133);
		});
		expect(previewDates(container)).toEqual(REMAINING_133);
		expect(showNextButton(container)).toBeNull();
		expect(showAllButton(container)).toBeNull();
	});

	it('the reveal RESETS to the first 50 when the range changes (#241 point 5): show-all 153, then until → 2026-12-31 collapses to the new 122-set’s first 50, controls back with the NEW numbers', async () => {
		const container = await renderDaily('2026-09-01', '2027-01-31');
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50);
		});
		await fireEvent.click(showAllButton(container) as HTMLElement);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(153);
		});

		await fill(container, 'series-create-until', '2026-12-31');

		const FULL_122 = dailyIsoDates('2026-09-01', '2026-12-31');
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50);
		});
		expect(previewDates(container)).toEqual(FULL_122.slice(0, 50));
		expect(countLine(container)).toContain('"count":122');
		expect(showNextButton(container)?.textContent?.trim()).toBe(
			'series_create_show_next_label {"count":50}'
		);
		expect(showAllButton(container)?.textContent?.trim()).toBe(
			'series_create_show_all_label {"count":122}'
		);
	});

	it('the reset keys off the SET, not its length: a time-only edit (same 153 calendar days, new datetimes) collapses show-all back to the first 50 — a length-keyed or bare-counter reset fails exactly here', async () => {
		const container = await renderDaily('2026-09-01', '2027-01-31');
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50);
		});
		await fireEvent.click(showAllButton(container) as HTMLElement);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(153);
		});

		await fillTime(container, 'series-create-time', '20:00');

		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50);
		});
		expect(previewDates(container)).toEqual(FULL_153.slice(0, 50));
		expect(countLine(container)).toContain('"count":153');
		expect(showAllButton(container)?.textContent?.trim()).toBe(
			'series_create_show_all_label {"count":153}'
		);
	});

	it('submit is UNAFFECTED by the cap (#241 point 6): 60 generated, 50 shown → the series carries the true occurrence bounds and ALL 60 occurrences are created, ascending', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Daily grind');
		await fill(container, 'series-create-duration', '90');
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-10-30');
		await selectValue(container, 'series-create-repeat', 'daily');
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50); // of 60
		});

		await submit(container);
		await settleSeriesRun(container);

		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		const input = lastSeriesInput();
		expect(input.startDate).toBe('2026-09-01');
		expect(input.endDate).toBe('2026-10-30');

		expect(createEventMock).toHaveBeenCalledTimes(60);
		const expectedInstants = dailyIsoDates('2026-09-01', '2026-10-30').map(
			(iso) => `${iso}T${iso >= '2026-10-25' ? '17' : '16'}:00:00.000Z`
		);
		expect(
			createEventMock.mock.calls.map((c) => (c[1] as CreateEventInput).startDatetime)
		).toEqual(expectedInstants);
	});
});

describe('#241 — locale files: series_create_show_next_label / series_create_show_all_label', () => {
	const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
	const REVEAL_KEYS = ['series_create_show_next_label', 'series_create_show_all_label'] as const;

	function messageFile(locale: string): MessageFile {
		return JSON.parse(
			readFileSync(resolvePath(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as MessageFile;
	}

	it.each(LOCALES)(
		'%s: both keys exist, non-empty, carry {count}, and never bake the cap into the copy',
		(locale) => {
			const file = messageFile(locale);
			for (const key of REVEAL_KEYS) {
				expect(isMessageEmpty(file[key]), `${key} must exist, non-empty, in ${locale}`).toBe(
					false
				);
				for (const pattern of messagePatterns(file[key])) {
					expect(pattern, `${key} in ${locale} must parameterise the count`).toContain(
						'{count}'
					);
					expect(pattern, `${key} in ${locale} must never hard-code 50`).not.toMatch(/50/);
				}
			}
		}
	);

	it('et/en carry the PO-ruled copy VERBATIM (partitive intact in both Estonian strings)', () => {
		const en = messageFile('en');
		const et = messageFile('et');
		expect(en.series_create_show_next_label).toBe('Show next {count} events');
		expect(en.series_create_show_all_label).toBe('Show all {count} events');
		expect(et.series_create_show_next_label).toBe('Näita järgmisi {count} sündmust');
		expect(et.series_create_show_all_label).toBe('Näita kõiki {count} sündmust');
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Palestrina*)
