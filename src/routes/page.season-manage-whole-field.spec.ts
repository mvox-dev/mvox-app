// @vitest-environment happy-dom
// Whole-field hit areas and tab activation on the season manage panel's edits.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('raw')
);

const {
	loadFullAgendaMock,
	loadRosterMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock,
	findMyMemberIdMock,
	listMyRsvpsMock,
	listEventSeriesForSeasonMock,
	listEventsForSeasonMock,
	updateSeasonFieldMock,
	addSeasonConductorMock,
	removeSeasonConductorMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	loadRosterMock: vi.fn(),
	resolveDatabaseEntityIdMock: vi.fn(),
	resolveManageRightsMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	listEventSeriesForSeasonMock: vi.fn(),
	listEventsForSeasonMock: vi.fn(),
	updateSeasonFieldMock: vi.fn(),
	addSeasonConductorMock: vi.fn(),
	removeSeasonConductorMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: updateSeasonFieldMock,
	addSeasonConductor: addSeasonConductorMock,
	removeSeasonConductor: removeSeasonConductorMock
}));
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: vi.fn(),
	createEventSeries: vi.fn(),
	createEvent: vi.fn()
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
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
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
import type { Season } from '$lib/seasons/types';
import type { RosterRow } from '$lib/roster/rosterData';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { testCfg } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { gotoMock, discoverMock } from '$lib/testing/routeMocks';

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const CFG = testCfg('sampledb', 'jwt-abc');
const SEASON_ID = 'season-1';

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

const SEASON_START = isoDate(-30);
const SEASON_END = isoDate(60);

function currentSeason(): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: SEASON_START,
		endDate: SEASON_END,
		conductors: ['p-grace'],
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

function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-grace',
			personId: 'p-grace',
			name: 'Grace Hopper',
			email: 'grace@x.com',
			sectionIds: [],
			dbEntityId: ORG_EFK
		},
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

function setAuthedWithOneCollective() {
	signIn();
}

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead([]));
	listEventsForSeasonMock.mockResolvedValue(toListRead([]));
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
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

async function openPanel(container: HTMLElement): Promise<void> {
	await openSeasonCardPanel(container);
}

const FIELDS = ['name', 'start_date', 'end_date'] as const;

describe('#205 — season manage panel: whole-field activators (name/start_date/end_date)', () => {
	for (const field of FIELDS) {
		it(`${field}: the activator is ONE full-width native <button> that CONTAINS the value — not an icon-sized sibling`, async () => {
			const container = await renderReady();
			await openPanel(container);

			const btn = q(container, `season-edit-btn-${field}`) as HTMLElement;
			expect(btn, `season-edit-btn-${field} must render in the panel`).not.toBeNull();

			expect(btn.tagName).toBe('BUTTON');
			expect(
				btn.getAttribute('tabindex'),
				'a native button is in the tab order by default — never opt it out'
			).not.toBe('-1');
			expect((btn as HTMLButtonElement).disabled).toBe(false);

			const classes = Array.from(btn.classList);
			expect(classes, 'the activator must reserve a 44px-tall touch target').toContain('min-h-11');
			expect(classes, 'the WHOLE field is the target, not the ✎ glyph').toContain('w-full');

			const value = q(container, `season-manage-${field}`);
			expect(value, `season-manage-${field} (the value element) must render`).not.toBeNull();
			expect(
				btn.contains(value),
				`season-manage-${field} must be INSIDE season-edit-btn-${field} — a flex sibling leaves the value dead to clicks`
			).toBe(true);
		});

		it(`${field}: the button carries an sr-only ACTION label, and the value is part of its own content (visible to AT)`, async () => {
			const container = await renderReady();
			await openPanel(container);

			const btn = q(container, `season-edit-btn-${field}`) as HTMLElement;
			expect(btn).not.toBeNull();

			const srOnly = btn.querySelector('.sr-only');
			expect(srOnly, 'the activator must carry an sr-only action label').not.toBeNull();
			expect((srOnly as HTMLElement).textContent?.trim()).not.toBe('');
		});

		it(`${field}: the computed ACCESSIBLE NAME is "<action label> <value>"`, async () => {
			const container = await renderReady();
			await openPanel(container);

			const btn = q(container, `season-edit-btn-${field}`) as HTMLElement;
			const action = (btn.querySelector('.sr-only')?.textContent ?? '')
				.replace(/\s+/g, ' ')
				.trim();
			const value = (q(container, `season-manage-${field}`)?.textContent ?? '')
				.replace(/\s+/g, ' ')
				.trim();
			expect(action, 'action label').not.toBe('');
			expect(value, 'value text').not.toBe('');

			expect(within(container).getByRole('button', { name: `${action} ${value}` })).toBe(btn);
			expect(btn.hasAttribute('aria-labelledby'), 'aria-labelledby supersedes contents').toBe(
				false
			);
			expect(btn.hasAttribute('aria-label'), 'aria-label supersedes contents').toBe(false);
		});
	}

	it('name: clicking the VALUE (not the pencil) opens the editor — the field area activates', async () => {
		const container = await renderReady();
		await openPanel(container);

		const value = q(container, 'season-manage-name') as HTMLElement;
		expect(value.textContent).toContain('Season 2026');
		await fireEvent.click(value);

		await waitFor(() => {
			expect(q(container, 'season-edit-input-name')).not.toBeNull();
		});
		expect((q(container, 'season-edit-input-name') as HTMLInputElement).value).toBe('Season 2026');
	});

	it('start_date: clicking the VALUE opens the date editor', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-manage-start_date') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'season-edit-input-start_date')).not.toBeNull();
		});
		expect((q(container, 'season-edit-input-start_date') as HTMLInputElement).value).toBe(
			SEASON_START
		);
	});

	it('end_date: clicking the VALUE opens the date editor', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-manage-end_date') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'season-edit-input-end_date')).not.toBeNull();
		});
		expect((q(container, 'season-edit-input-end_date') as HTMLInputElement).value).toBe(
			SEASON_END
		);
	});

	it('regression: the save path through the new activator is unchanged — Enter calls updateSeasonField(cfg, seasonId, field, value)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-manage-name') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-name')).not.toBeNull();
		});
		const input = q(container, 'season-edit-input-name') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'Autumn splendour' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(updateSeasonFieldMock).toHaveBeenCalledWith(
				CFG,
				SEASON_ID,
				'name',
				'Autumn splendour'
			);
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Autumn splendour');
		});
		expect(
			(q(container, 'season-edit-btn-name') as HTMLElement).contains(
				q(container, 'season-manage-name')
			)
		).toBe(true);
	});

	for (const field of ['start_date', 'end_date'] as const) {
		it(`${field}: the activator's COLUMN claims flex basis — a w-full button inside an auto-width flex item is still content-sized`, async () => {
			const container = await renderReady();
			await openPanel(container);

			const btn = q(container, `season-edit-btn-${field}`) as HTMLElement;
			const column = btn.parentElement as HTMLElement;
			expect(column, `the ${field} activator must sit in a column div`).not.toBeNull();

			const row = column.parentElement as HTMLElement;
			expect(
				Array.from(row.classList),
				'sanity: the two date columns share one flex row'
			).toContain('flex');

			expect(
				Array.from(column.classList),
				`the ${field} column must claim flex basis, or its activator's w-full means "as wide as the date text"`
			).toContain('flex-1');
		});
	}

	it('the two date columns claim EQUAL basis — neither is wider for holding a longer value', async () => {
		const container = await renderReady();
		await openPanel(container);

		const startCol = (q(container, 'season-edit-btn-start_date') as HTMLElement).parentElement!;
		const endCol = (q(container, 'season-edit-btn-end_date') as HTMLElement).parentElement!;
		expect(startCol.parentElement, 'siblings in one flex row').toBe(endCol.parentElement);
		const basis = (el: HTMLElement) =>
			Array.from(el.classList).filter((c) => c.startsWith('flex-'));
		expect(basis(startCol).length).toBeGreaterThan(0);
		expect(basis(endCol)).toEqual(basis(startCol));
	});
});

// (*MVOX:Tallis*)
