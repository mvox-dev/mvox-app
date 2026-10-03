// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare', {
		season_created: (p: { name: string }) => `season_created ${p.name}`,
		event_created: (p: { name: string; when: string }) => `event_created ${p.name} @ ${p.when}`,
		event_created_hidden_by_filter: (p: { name: string; when: string }) =>
			`event_created_hidden_by_filter ${p.name} @ ${p.when}`,
	})
);

const {
	loadRosterMock,
	createSeasonMock,
	createEventMock,
	listEventSeriesForSeasonMock,
	listSeriesOptionsForSeasonMock,
	listEventsForSeasonMock,
	updateSeasonFieldMock,
	addSeasonConductorMock,
	removeSeasonConductorMock,
	getSeriesDefaultsMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	createSeasonMock: vi.fn(),
	createEventMock: vi.fn(),
	listEventSeriesForSeasonMock: vi.fn(),
	listSeriesOptionsForSeasonMock: vi.fn(),
	listEventsForSeasonMock: vi.fn(),
	updateSeasonFieldMock: vi.fn(),
	addSeasonConductorMock: vi.fn(),
	removeSeasonConductorMock: vi.fn(),
	getSeriesDefaultsMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: createSeasonMock,
	createEventSeries: vi.fn(),
	createEvent: createEventMock
}));
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listSeriesOptionsForSeason: listSeriesOptionsForSeasonMock,
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
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
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
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));
vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/moduleStubs')).libraryDataModule()
);
vi.mock('$lib/repertoire/repertoireData', () => ({
	listRepertoireItems: vi.fn().mockResolvedValue([])
}));

import Page from './+page.svelte';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import { fillDateTime } from '$lib/testing/timeControls';
import type { Season } from '$lib/seasons/types';
import type { AgendaItem } from '$lib/agenda/types';
import type { RosterRow } from '$lib/roster/rosterData';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { gotoMock, discoverMock } from '$lib/testing/routeMocks';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	listSectionsMock,
	loadFullAgendaMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock
} from '$lib/testing/moduleHandles';

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const SEASON_ID = 'season-1';

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

function editorSeason(): Season {
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

function agendaResult(overrides: { upcoming?: AgendaItem[] } = {}) {
	return fullAgendaResult({
		seasons: [editorSeason()],
		upcoming: overrides.upcoming ?? []
	});
}

function upcomingRehearsal(): AgendaItem {
	return {
		id: 'up-reh',
		name: 'Tavaline proov',
		startDatetime: '2030-06-10T16:00:00.000Z',
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: [],
		eventType: 'rehearsal'
	} as AgendaItem;
}

function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-pete',
			personId: 'person-p',
			name: 'Pete Wilson',
			email: 'pete@x.com',
			sectionIds: [],
			dbEntityId: ORG_EFK
		}
	];
}

async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 20; i++) await Promise.resolve();
}

function setAuthedWithTwoCollectives() {
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }, { db: 'bravura', name: 'Bravura', personId: 'person-b' }] });
}

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue([]);
	createSeasonMock.mockResolvedValue('season-new-1');
	createEventMock.mockResolvedValue('ev-new-1');
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead([]));
	listSeriesOptionsForSeasonMock.mockResolvedValue([]);
	listEventsForSeasonMock.mockResolvedValue(toListRead([]));
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue(null);
});

afterEach(() => {
	vi.useRealTimers();
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	createSeasonMock.mockReset();
	createEventMock.mockReset();
	resolveDatabaseEntityIdMock.mockReset();
	resolveManageRightsMock.mockReset();
	discoverMock.mockReset();
	gotoMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	listEventSeriesForSeasonMock.mockReset();
	listSeriesOptionsForSeasonMock.mockReset();
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

function region(container: HTMLElement, testid: string): HTMLElement {
	const el = q(container, testid);
	expect(el, `expected ${testid} to be in the DOM`).not.toBeNull();
	return el as HTMLElement;
}

function expectEmptyAndHidden(el: HTMLElement, label: string): void {
	expect(el.textContent?.trim(), `${label}: expected no text`).toBe('');
	expect(
		el.classList.contains('sr-only'),
		`${label}: an EMPTY region must carry sr-only — it may occupy no visible space`
	).toBe(true);
	expect(el.hasAttribute('hidden'), `${label}: hidden would silence the live region`).toBe(false);
	expect(el.getAttribute('aria-hidden'), `${label}: aria-hidden would silence the live region`).toBeNull();
}

function expectVisibleWithText(el: HTMLElement, text: string, label: string): void {
	expect(el.textContent?.trim(), `${label}: expected the success text`).toBe(text);
	expect(
		el.classList.contains('sr-only'),
		`${label}: a POPULATED region must NOT carry sr-only — the confirmation is for sighted users too (#298)`
	).toBe(false);
	expect(el.hasAttribute('hidden'), label).toBe(false);
	expect(el.getAttribute('aria-hidden'), label).toBeNull();
}

function expectSingleRendering(container: HTMLElement, node: HTMLElement, text: string): void {
	const matches = Array.from(container.querySelectorAll('*')).filter(
		(el) => el.textContent?.trim() === text
	);
	expect(matches.length, 'the success text must exist somewhere').toBeGreaterThanOrEqual(1);
	for (const el of matches) {
		expect(
			el === node || el.contains(node) || node.contains(el),
			'the success text must render ONLY inside the status region — no second element may carry it (reuse what is there, #298)'
		).toBe(true);
	}
}

async function renderReady(): Promise<HTMLElement> {
	setAuthedWithTwoCollectives();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-empty')).not.toBeNull();
	});
	return container;
}

async function renderReadyWithRehearsal(): Promise<HTMLElement> {
	loadFullAgendaMock.mockResolvedValue(agendaResult({ upcoming: [upcomingRehearsal()] }));
	setAuthedWithTwoCollectives();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-filter-rehearsal')).not.toBeNull();
	});
	return container;
}

async function fill(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.input(q(container, testid) as HTMLElement, { target: { value } });
}

async function selectValue(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.change(q(container, testid) as HTMLElement, { target: { value } });
}

async function openSeasonForm(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(q(container, 'season-create')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-create') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-create-form')).not.toBeNull();
	});
}

async function submitSeasonCreate(container: HTMLElement, name: string): Promise<void> {
	await openSeasonForm(container);
	await fill(container, 'season-create-name', name);
	await fill(container, 'season-create-start', '2031-09-01');
	await fill(container, 'season-create-end', '2032-06-30');
	await fireEvent.click(q(container, 'season-create-submit') as HTMLElement);
	await waitFor(() => {
		expect(createSeasonMock).toHaveBeenCalled();
	});
}

async function openEventFormFromPanel(container: HTMLElement): Promise<void> {
	await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-add-event')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'event-create-form')).not.toBeNull();
	});
}

async function fillEventForm(
	container: HTMLElement,
	opts: { type?: string; name?: string } = {}
): Promise<void> {
	await selectValue(container, 'event-create-season', SEASON_ID);
	await selectValue(container, 'event-create-type', opts.type ?? 'concert');
	if (opts.name !== undefined) await fill(container, 'event-create-name', opts.name);
	await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
}

async function submitEventCreate(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);
}

const EVENT_SUCCESS = 'event_created Spring concert @ 2027-04-18 19:00';
const SEASON_SUCCESS = 'season_created Season 2031';

describe('#298 — both regions are mounted-empty-hidden from first render', () => {
	it('season-create-status and event-create-status: present before any create, role=status aria-live=polite, no text, sr-only (no visible space), not silenced', async () => {
		const container = await renderReady();
		for (const testid of ['season-create-status', 'event-create-status']) {
			const el = region(container, testid);
			expect(el.getAttribute('role'), testid).toBe('status');
			expect(el.getAttribute('aria-live'), testid).toBe('polite');
			expectEmptyAndHidden(el, testid);
		}
	});
});

describe('#298 — season create: a successful create is announced AND seen', () => {
	it('the SAME always-mounted node goes empty → populated (the announcement), loses sr-only (the sight), and no second element carries the text', async () => {
		const container = await renderReady();

		const node = region(container, 'season-create-status');
		expectEmptyAndHidden(node, 'season-create-status at mount');

		await submitSeasonCreate(container, 'Season 2031');

		await waitFor(() => {
			expect(q(container, 'season-create-status')?.textContent?.trim()).toBe(SEASON_SUCCESS);
		});
		expect(
			q(container, 'season-create-status'),
			'the populated region must be the IDENTICAL DOM node observed empty at mount — never an {#if}-mounted replacement (a live region inserted already-populated is not announced)'
		).toBe(node);
		expectVisibleWithText(node, SEASON_SUCCESS, 'season-create-status after create');
		expect(container.querySelectorAll('[data-testid="season-create-status"]').length).toBe(1);
		expectSingleRendering(container, node, SEASON_SUCCESS);
	});

	it('clears on form REOPEN: opening [+ Season] again empties the region and returns it to sr-only', async () => {
		const container = await renderReady();
		await submitSeasonCreate(container, 'Season 2031');
		const node = region(container, 'season-create-status');
		await waitFor(() => {
			expectVisibleWithText(node, SEASON_SUCCESS, 'season-create-status before reopen');
		});

		await openSeasonForm(container);
		expectEmptyAndHidden(node, 'season-create-status after reopen');
	});

	it('clears on a COLLECTIVE SWITCH: "Season X created" must not survive into a collective it never happened in', async () => {
		const container = await renderReady();
		await submitSeasonCreate(container, 'Season 2031');
		const node = region(container, 'season-create-status');
		await waitFor(() => {
			expectVisibleWithText(node, SEASON_SUCCESS, 'season-create-status before switch');
		});

		selectedCollectiveDbStore.set('bravura');
		await waitFor(() => {
			expect(
				q(container, 'season-create-status')?.textContent?.trim(),
				'a genuine context change makes the message untrue — it must clear (Done-when #5)'
			).toBe('');
		});
		expectEmptyAndHidden(
			region(container, 'season-create-status'),
			'season-create-status after switch'
		);
	});
});

describe('#298 — event create: a successful create is announced AND seen', () => {
	it('the SAME always-mounted node goes empty → populated, loses sr-only, and no second element carries the text', async () => {
		const container = await renderReady();
		const node = region(container, 'event-create-status');
		expectEmptyAndHidden(node, 'event-create-status at mount');

		await openEventFormFromPanel(container);
		await fillEventForm(container, { name: 'Spring concert' });
		await submitEventCreate(container);

		await waitFor(() => {
			expect(q(container, 'event-create-status')?.textContent?.trim()).toBe(EVENT_SUCCESS);
		});
		expect(
			q(container, 'event-create-status'),
			'the populated region must be the IDENTICAL DOM node observed empty at mount — never an {#if}-mounted replacement'
		).toBe(node);
		expectVisibleWithText(node, EVENT_SUCCESS, 'event-create-status after create');
		expect(container.querySelectorAll('[data-testid="event-create-status"]').length).toBe(1);
		expectSingleRendering(container, node, EVENT_SUCCESS);
	});

	it('a FAILED write keeps the region empty and hidden — failure has its own role="alert", not this surface', async () => {
		createEventMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openEventFormFromPanel(container);
		await fillEventForm(container, { name: 'Spring concert' });
		await submitEventCreate(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expectEmptyAndHidden(
			region(container, 'event-create-status'),
			'event-create-status after failed write'
		);
	});

	it('clears on form REOPEN (the HEAD gap: openEventCreateForm resets every field EXCEPT the status): reopening [+ Event] empties the region and returns it to sr-only', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);
		await fillEventForm(container, { name: 'Spring concert' });
		await submitEventCreate(container);
		const node = region(container, 'event-create-status');
		await waitFor(() => {
			expectVisibleWithText(node, EVENT_SUCCESS, 'event-create-status before reopen');
		});

		await openEventFormFromPanel(container);
		expectEmptyAndHidden(node, 'event-create-status after reopen with nothing created');
	});

	it('clears on a COLLECTIVE SWITCH: the message must not sit on screen over a collective it does not belong to', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);
		await fillEventForm(container, { name: 'Spring concert' });
		await submitEventCreate(container);
		const node = region(container, 'event-create-status');
		await waitFor(() => {
			expectVisibleWithText(node, EVENT_SUCCESS, 'event-create-status before switch');
		});

		selectedCollectiveDbStore.set('bravura');
		await waitFor(() => {
			expect(
				q(container, 'event-create-status')?.textContent?.trim(),
				'a genuine context change makes the message untrue — it must clear (Done-when #5)'
			).toBe('');
		});
		expectEmptyAndHidden(
			region(container, 'event-create-status'),
			'event-create-status after switch'
		);
	});

	it('NO timer: the visible confirmation survives two full minutes — it clears on events, never on a clock', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);
		await fillEventForm(container, { name: 'Spring concert' });

		const write = deferred<string>();
		createEventMock.mockReturnValueOnce(write.promise);
		await submitEventCreate(container);
		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});

		vi.useFakeTimers();
		write.resolve('ev-new-1');
		await flushMicrotasks();
		const node = region(container, 'event-create-status');
		expectVisibleWithText(node, EVENT_SUCCESS, 'event-create-status on settle');

		vi.advanceTimersByTime(120_000);
		await flushMicrotasks();
		expectVisibleWithText(
			node,
			EVENT_SUCCESS,
			'event-create-status after 120s — a message that vanishes mid-read fails the readers who need it most (Done-when #5: no timer)'
		);
	});
});

describe('#298 — the active filter excluding the new event is SAID, not implied', () => {
	it('filter active (rehearsal) + a CONCERT created → the region carries event_created_hidden_by_filter with the same {name}/{when}, visibly', async () => {
		const container = await renderReadyWithRehearsal();

		await fireEvent.click(q(container, 'agenda-filter-rehearsal') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'agenda-filter-rehearsal')?.getAttribute('aria-pressed')).toBe('true');
		});

		await openEventFormFromPanel(container);
		await fillEventForm(container, { type: 'concert', name: 'Spring concert' });
		await submitEventCreate(container);

		const HIDDEN = 'event_created_hidden_by_filter Spring concert @ 2027-04-18 19:00';
		await waitFor(() => {
			expect(
				q(container, 'event-create-status')?.textContent?.trim(),
				'created-but-filtered must say BOTH halves: created successfully, and the active filter is why it is not in the list (#244 / Done-when #6)'
			).toBe(HIDDEN);
		});
		const node = region(container, 'event-create-status');
		expectVisibleWithText(node, HIDDEN, 'event-create-status, excluded-by-filter');
		expectSingleRendering(container, node, HIDDEN);
	});

	it('filter active (rehearsal) + a REHEARSAL created → the plain event_created message: the filter admits it, nothing to explain', async () => {
		const container = await renderReadyWithRehearsal();

		await fireEvent.click(q(container, 'agenda-filter-rehearsal') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'agenda-filter-rehearsal')?.getAttribute('aria-pressed')).toBe('true');
		});

		await openEventFormFromPanel(container);
		await fillEventForm(container, { type: 'rehearsal', name: 'Extra rehearsal' });
		await submitEventCreate(container);

		await waitFor(() => {
			expect(q(container, 'event-create-status')?.textContent?.trim()).toBe(
				'event_created Extra rehearsal @ 2027-04-18 19:00'
			);
		});
	});
});

describe('#298 — locale coverage for the hidden-by-filter confirmation', () => {
	function messages(locale: string): Record<string, string> {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as Record<string, string>;
	}

	it('event_created_hidden_by_filter exists in en/et/lv/uk, is non-empty, and carries the {name} and {when} slots', () => {
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const msg = messages(locale)['event_created_hidden_by_filter'];
			expect(msg, `${locale}.json is missing event_created_hidden_by_filter`).toBeDefined();
			expect(msg, `${locale}.json event_created_hidden_by_filter is empty`).toMatch(/\S/);
			expect(msg, `${locale}.json event_created_hidden_by_filter lacks {name}`).toContain(
				'{name}'
			);
			expect(msg, `${locale}.json event_created_hidden_by_filter lacks {when}`).toContain(
				'{when}'
			);
		}
	});
});

// (*MVOX:Tallis*)
