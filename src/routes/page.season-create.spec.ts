// @vitest-environment happy-dom
// Season creation on the agenda page.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const {
	loadFullAgendaMock,
	loadRosterMock,
	listSectionsMock,
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
	listSectionsMock: vi.fn(),
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
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: resolveManageRightsMock
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/sections/sectionData')>()),
	listSections: listSectionsMock
}));
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
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import type { Season } from '$lib/seasons/types';
import type { RosterRow } from '$lib/roster/rosterData';
import { expectNameMarkedOnce } from '$lib/testing/nameMarker';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { testCfg } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const ORG_EFK = '69c7f8718489bfcb0e81b065'; // live sampledb collective id shape
const CFG = testCfg('sampledb', 'jwt-abc');

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

function currentSeason(viewerIsEditor: boolean): Season {
	return {
		id: 'season-1',
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
		conductors: [],
		owners: [],
		editors: viewerIsEditor ? ['person-p'] : []
	};
}

function upcomingSeason(): Season {
	return {
		id: 'season-2',
		name: 'Season 2027',
		startDate: isoDate(61),
		endDate: isoDate(240),
		conductors: [],
		owners: [],
		editors: ['person-p']
	};
}

function agendaResult(opts: { editor?: boolean; withUpcomingSeason?: boolean } = {}) {
	const { editor = true, withUpcomingSeason = false } = opts;
	const season = currentSeason(editor);
	return fullAgendaResult({
		seasonId: season.id,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: withUpcomingSeason ? [season, upcomingSeason()] : [season]
	});
}

function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-ada',
			personId: 'p-ada',
			name: 'Ada Lovelace',
			email: 'ada@x.com',
			sectionIds: [],
			dbEntityId: ORG_EFK
		},
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
	listSectionsMock.mockResolvedValue([]);
	createSeasonMock.mockResolvedValue('season-new-1');
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	createSeasonMock.mockReset();
	resolveDatabaseEntityIdMock.mockReset();
	resolveManageRightsMock.mockReset();
	discoverMock.mockReset();
	gotoMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
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

async function openForm(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(q(container, 'season-create')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-create') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-create-form')).not.toBeNull();
	});
}

async function fill(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.input(q(container, testid) as HTMLElement, { target: { value } });
}

function conductorSelect(container: HTMLElement): HTMLSelectElement {
	const form = q(container, 'season-create-form') as HTMLElement;
	const select = form.querySelector(
		'[data-testid="season-create-conductor-select"]'
	) as HTMLSelectElement;
	expect(select, 'expected the native season-create-conductor-select').not.toBeNull();
	expect(select.tagName).toBe('SELECT');
	return select;
}

function optionValues(select: HTMLSelectElement): string[] {
	return Array.from(select.querySelectorAll('option')).map((o) => o.value);
}

function promptOption(select: HTMLSelectElement): HTMLOptionElement {
	const prompt = select.querySelector('option') as HTMLOptionElement;
	expect(prompt, 'expected a first (prompt) option').not.toBeNull();
	expect(prompt.value).toBe('');
	expect(prompt.disabled).toBe(true);
	expect(prompt.hidden).toBe(true);
	return prompt;
}

async function pickConductor(container: HTMLElement, personId: string): Promise<void> {
	await fireEvent.change(conductorSelect(container), { target: { value: personId } });
}

async function submit(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'season-create-submit') as HTMLElement);
}

describe('agenda — the [+ Season] entry point (rights gate; upcoming seasons do NOT suppress it — #261 reopen)', () => {
	it('season editor + NO upcoming season: season-create renders, at page level (not inside any agenda row), and merely rendering writes nothing', async () => {
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
		const control = q(container, 'season-create') as HTMLElement;
		expect(control.closest('[data-testid^="agenda-row-"]')).toBeNull();
		expect(control.closest('[data-testid^="agenda-recent-row-"]')).toBeNull();

		expect(createSeasonMock).not.toHaveBeenCalled();
		expect(q(container, 'season-create-form')).toBeNull();
	});

	it('NON-editor (no _owner/_editor on the season visible to this caller): season-create does NOT render — fail-closed, same as every other rights gate', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		expect(q(container, 'season-create')).toBeNull();
	});

	it('an UPCOMING season already exists (startDate strictly after today): season-create STILL renders for an editor — #261 reopen: visible whenever the user may create a season', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: true, withUpcomingSeason: true }));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
	});

	it('NON-editor + an UPCOMING season: season-create does NOT render — the #261 reopen removes only the upcoming-season clause, it never widens the RIGHTS gate', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false, withUpcomingSeason: true }));
		const container = await renderReady();

		expect(q(container, 'season-create')).toBeNull();
	});

	it("rights fallback answers 'error' + an UPCOMING season: still fail-closed — season-create does NOT render", async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false, withUpcomingSeason: true }));
		resolveManageRightsMock.mockResolvedValue('error');
		const container = await renderReady();

		expect(q(container, 'season-create')).toBeNull();
	});
});

describe('agenda — clicking [+ Season] opens the INLINE creation form', () => {
	it('the form appears IN PLACE (no route change): name auto-focused, start/end are type="date", the NATIVE conductor select (#209) is inside the form — nothing written by opening', async () => {
		const container = await renderReady();
		await openForm(container);

		expect(gotoMock).not.toHaveBeenCalled();

		const name = q(container, 'season-create-name') as HTMLInputElement;
		expect(name).not.toBeNull();
		await waitFor(() => {
			expect(document.activeElement).toBe(name);
		});

		const start = q(container, 'season-create-start') as HTMLInputElement;
		const end = q(container, 'season-create-end') as HTMLInputElement;
		expect(start).not.toBeNull();
		expect(end).not.toBeNull();
		expect(start.type).toBe('date');
		expect(end.type).toBe('date');

		const select = conductorSelect(container);
		expect(select.getAttribute('aria-label')).toBe('season_conductor_label');
		expect(promptOption(select).textContent?.trim()).toBe('season_conductor_placeholder');
		expect(select.value).toBe('');

		expect(createSeasonMock).not.toHaveBeenCalled();
	});

	it('cancel closes the form; nothing written', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');

		await fireEvent.click(q(container, 'season-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-create-form')).toBeNull();
		});
		expect(createSeasonMock).not.toHaveBeenCalled();
	});

	it('Escape dismisses the form; nothing written (fired on the name input, so the Autocomplete dropdown layer is not involved)', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');

		await fireEvent.keyDown(q(container, 'season-create-name') as HTMLElement, { key: 'Escape' });
		await waitFor(() => {
			expect(q(container, 'season-create-form')).toBeNull();
		});
		expect(createSeasonMock).not.toHaveBeenCalled();
	});
});

describe('agenda — the conductor select lists the collective’s persons', () => {
	it('persons come from loadRoster, loaded ONCE on form open: the select offers every roster person (value = person id, text = display name) behind the prompt — no per-keystroke fetch, there is nothing to type', async () => {
		const container = await renderReady();
		expect(loadRosterMock).not.toHaveBeenCalled();

		await openForm(container);
		await waitFor(() => {
			expect(loadRosterMock).toHaveBeenCalledTimes(1);
		});

		const select = conductorSelect(container);
		await waitFor(() => {
			expect(optionValues(select)).toEqual(['', 'p-ada', 'p-grace', 'person-p']);
		});
		const texts = Array.from(select.querySelectorAll('option')).map((o) =>
			o.textContent?.trim()
		);
		expect(texts).toEqual([
			'season_conductor_placeholder',
			'Ada Lovelace',
			'Grace Hopper',
			'Pete Wilson'
		]);

		expect(loadRosterMock).toHaveBeenCalledTimes(1);
	});

	it('re-opening the form does NOT re-fetch the roster: the cached list serves every later open', async () => {
		const container = await renderReady();

		await openForm(container);
		await waitFor(() => {
			expect(loadRosterMock).toHaveBeenCalledTimes(1);
		});

		await fireEvent.click(q(container, 'season-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-create-form')).toBeNull();
		});
		await openForm(container);

		await waitFor(() => {
			expect(optionValues(conductorSelect(container))).toEqual([
				'',
				'p-ada',
				'p-grace',
				'person-p'
			]);
		});
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
	});

	it('a picked conductor renders as a chip (season-create-conductor-<personId>) showing the person’s name; the select RESETS to the prompt and stops offering the picked person', async () => {
		const container = await renderReady();
		await openForm(container);

		await pickConductor(container, 'p-ada');

		await waitFor(() => {
			expect(q(container, 'season-create-conductor-p-ada')).not.toBeNull();
		});
		expect(q(container, 'season-create-conductor-p-ada')?.textContent).toContain('Ada Lovelace');

		const select = conductorSelect(container);
		await waitFor(() => {
			expect(select.value).toBe('');
		});
		expect(optionValues(select)).toEqual(['', 'p-grace', 'person-p']);
	});

	it('option order is ROSTER order — section (listSections tree order), then position within section, Unassigned last — NOT alphabetical (Gama ruling 3)', async () => {
		loadRosterMock.mockResolvedValue(toListRead([
			{ ...fixtureRows()[0], sectionIds: ['sec-t'] }, // Ada → Tenor
			{ ...fixtureRows()[1], sectionIds: ['sec-s'] }, // Grace → Sopran
			{ ...fixtureRows()[2], sectionIds: [] } // Pete → Unassigned
		]));
		listSectionsMock.mockResolvedValue([
			{ id: 'sec-s', name: 'Sopran', displayOrder: 1, parentId: null, depth: 0, children: [] },
			{ id: 'sec-t', name: 'Tenor', displayOrder: 2, parentId: null, depth: 0, children: [] }
		]);

		const container = await renderReady();
		await openForm(container);

		await waitFor(() => {
			expect(optionValues(conductorSelect(container))).toEqual([
				'',
				'p-grace',
				'p-ada',
				'person-p'
			]);
		});
	});

	it('a MULTI-SECTION person (roster page renders her in every group) is offered exactly ONCE, at her first roster position — option values must stay unique', async () => {
		loadRosterMock.mockResolvedValue(toListRead([
			{ ...fixtureRows()[0], sectionIds: ['sec-s', 'sec-t'] }, // Ada → both
			{ ...fixtureRows()[1], sectionIds: ['sec-s'] }, // Grace → Sopran
			{ ...fixtureRows()[2], sectionIds: ['sec-t'] } // Pete → Tenor
		]));
		listSectionsMock.mockResolvedValue([
			{ id: 'sec-s', name: 'Sopran', displayOrder: 1, parentId: null, depth: 0, children: [] },
			{ id: 'sec-t', name: 'Tenor', displayOrder: 2, parentId: null, depth: 0, children: [] }
		]);

		const container = await renderReady();
		await openForm(container);

		await waitFor(() => {
			expect(optionValues(conductorSelect(container))).toEqual([
				'',
				'p-ada',
				'p-grace',
				'person-p'
			]);
		});
	});

	it('EVERYONE picked: the select stays MOUNTED but disabled and its prompt text becomes picker_everyone_added (Gama ruling 2 — never hidden, never inert-enabled)', async () => {
		const container = await renderReady();
		await openForm(container);

		await pickConductor(container, 'p-ada');
		await pickConductor(container, 'p-grace');
		await pickConductor(container, 'person-p');

		await waitFor(() => {
			expect(q(container, 'season-create-conductor-person-p')).not.toBeNull();
		});
		const select = conductorSelect(container);
		await waitFor(() => {
			expect(select.disabled).toBe(true);
		});
		expect(optionValues(select)).toEqual(['']);
		expect(promptOption(select).textContent?.trim()).toBe('picker_everyone_added');

		await fireEvent.click(q(container, 'season-create-conductor-remove-p-ada') as HTMLElement);
		await waitFor(() => {
			expect(conductorSelect(container).disabled).toBe(false);
		});
		expect(optionValues(conductorSelect(container))).toEqual(['', 'p-ada']);
		expect(promptOption(conductorSelect(container)).textContent?.trim()).toBe(
			'season_conductor_placeholder'
		);
	});
});

describe('agenda — submit calls createSeason and refreshes', () => {
	it("full flow: name + dates + one conductor → createSeason(cfg, { name, dbEntityId: <resolveDatabaseEntityId's answer>, startDate, endDate, conductorRefs }) fires ONCE; the form closes; the agenda REFRESHES (loadFullAgenda re-invoked)", async () => {
		const container = await renderReady();
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);

		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');
		await fill(container, 'season-create-start', '2026-09-01');
		await fill(container, 'season-create-end', '2026-12-20');
		await pickConductor(container, 'p-ada');
		await submit(container);

		await waitFor(() => {
			expect(createSeasonMock).toHaveBeenCalledTimes(1);
		});
		expect(createSeasonMock).toHaveBeenCalledWith(CFG, {
			name: 'Autumn 2026',
			dbEntityId: ORG_EFK,
			startDate: '2026-09-01',
			endDate: '2026-12-20',
			conductorRefs: ['p-ada']
		});
		expect(resolveDatabaseEntityIdMock).toHaveBeenCalledWith(CFG);

		await waitFor(() => {
			expect(q(container, 'season-create-form')).toBeNull();
		});
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
	});

	it('no conductor picked: conductorRefs is EMPTY (a season without conductors is legal — v4E marks conductor optional)', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');
		await fill(container, 'season-create-start', '2026-09-01');
		await fill(container, 'season-create-end', '2026-12-20');
		await submit(container);

		await waitFor(() => {
			expect(createSeasonMock).toHaveBeenCalledTimes(1);
		});
		expect(createSeasonMock).toHaveBeenCalledWith(CFG, {
			name: 'Autumn 2026',
			dbEntityId: ORG_EFK,
			startDate: '2026-09-01',
			endDate: '2026-12-20',
			conductorRefs: []
		});
	});
});

describe('agenda — form validation refuses the write with an inline error', () => {
	it('blank name: season-create-error shows (role="alert"), NO write, the form stays open', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-start', '2026-09-01');
		await fill(container, 'season-create-end', '2026-12-20');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'season-create-error')).not.toBeNull();
		});
		expect(q(container, 'season-create-error')?.getAttribute('role')).toBe('alert');
		expect(createSeasonMock).not.toHaveBeenCalled();
		expect(q(container, 'season-create-form')).not.toBeNull();
	});

	it('end date BEFORE start date: season-create-error shows, NO write', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');
		await fill(container, 'season-create-start', '2026-12-01');
		await fill(container, 'season-create-end', '2026-09-01');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'season-create-error')).not.toBeNull();
		});
		expect(createSeasonMock).not.toHaveBeenCalled();
	});
});

function noCurrentSeasonResult(seasons: Season[]) {
	return fullAgendaResult({ seasons });
}

function lapsedSeason(viewerIsEditor: boolean): Season {
	return {
		id: 'season-0',
		name: 'Season 2025',
		startDate: isoDate(-300),
		endDate: isoDate(-1),
		conductors: [],
		owners: [],
		editors: viewerIsEditor ? ['person-p'] : []
	};
}

describe('agenda — [+ Season] survives the states where no season is current', () => {
	it('(G) a collective with NO seasons at all: the gate falls back to the ORGANIZATION’s rights, so the FIRST season is creatable in-app', async () => {
		loadFullAgendaMock.mockResolvedValue(noCurrentSeasonResult([]));
		resolveManageRightsMock.mockResolvedValue('editor');
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
		expect(resolveDatabaseEntityIdMock).toHaveBeenCalledWith(CFG);
		expect(resolveManageRightsMock).toHaveBeenCalledWith(CFG, ORG_EFK, 'person-p');
	});

	it('(G) fail-closed: no seasons AND no organization rights → no season-create', async () => {
		loadFullAgendaMock.mockResolvedValue(noCurrentSeasonResult([]));
		resolveManageRightsMock.mockResolvedValue('not-editor');
		const container = await renderReady();

		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalled();
		});
		expect(q(container, 'season-create')).toBeNull();
	});

	it('(G) fail-closed: an ERRORED organization rights read is not a grant', async () => {
		loadFullAgendaMock.mockResolvedValue(noCurrentSeasonResult([]));
		resolveManageRightsMock.mockResolvedValue('error');
		const container = await renderReady();

		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalled();
		});
		expect(q(container, 'season-create')).toBeNull();
	});

	it('(H) the season LAPSED yesterday and the viewer is one of its editors: season-create renders — no organization round-trip needed, the rights rode along on the season list', async () => {
		loadFullAgendaMock.mockResolvedValue(noCurrentSeasonResult([lapsedSeason(true)]));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
		const orgProbes = resolveManageRightsMock.mock.calls.filter((c) => c[1] !== 'person-p');
		expect(orgProbes).toEqual([]);
	});

	it('(H) fail-closed: a lapsed season the viewer does NOT edit still hides season-create', async () => {
		loadFullAgendaMock.mockResolvedValue(noCurrentSeasonResult([lapsedSeason(false)]));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		expect(q(container, 'season-create')).toBeNull();
	});
});

describe('agenda — the submit is guarded against double-firing', () => {
	it('three synchronous clicks while the write is in flight produce exactly ONE createSeason call, and the button reports itself busy', async () => {
		let releaseCreate: (id: string) => void = () => {};
		createSeasonMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					releaseCreate = resolve;
				})
		);

		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');
		await fill(container, 'season-create-start', '2026-09-01');
		await fill(container, 'season-create-end', '2026-12-20');

		const submitBtn = q(container, 'season-create-submit') as HTMLButtonElement;
		submitBtn.click();
		submitBtn.click();
		submitBtn.click();

		await waitFor(() => {
			expect(createSeasonMock).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect((q(container, 'season-create-submit') as HTMLButtonElement).disabled).toBe(true);
		});
		expect(q(container, 'season-create-submit')?.getAttribute('aria-busy')).toBe('true');

		releaseCreate('season-new-1');
		await waitFor(() => {
			expect(q(container, 'season-create-form')).toBeNull();
		});
		expect(createSeasonMock).toHaveBeenCalledTimes(1);
	});

	it('a FAILED write releases the guard: the button is submittable again', async () => {
		createSeasonMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');
		await fill(container, 'season-create-start', '2026-09-01');
		await fill(container, 'season-create-end', '2026-12-20');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'season-create-error')).not.toBeNull();
		});
		expect((q(container, 'season-create-submit') as HTMLButtonElement).disabled).toBe(false);

		createSeasonMock.mockResolvedValue('season-new-1');
		await submit(container);
		await waitFor(() => {
			expect(createSeasonMock).toHaveBeenCalledTimes(2);
		});
	});
});

describe('agenda — Escape on the form with the conductor select focused', () => {
	it('Escape fired at the FOCUSED conductor select dismisses the form without creating; typed work is discarded like any other Escape dismissal', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');
		await fill(container, 'season-create-start', '2026-09-01');

		const select = conductorSelect(container);
		select.focus();
		await fireEvent.keyDown(select, { key: 'Escape' });

		await waitFor(() => {
			expect(q(container, 'season-create-form')).toBeNull();
		});
		expect(createSeasonMock).not.toHaveBeenCalled();
	});
});

describe('agenda — validation messages are honest and transient', () => {
	it('BOTH dates blank reports "dates required", NOT the inverted-range message', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'season-create-error')).not.toBeNull();
		});
		expect(q(container, 'season-create-error')?.textContent).toContain('season_dates_required');
		expect(q(container, 'season-create-error')?.textContent).not.toContain(
			'season_date_range_invalid'
		);
		expect(createSeasonMock).not.toHaveBeenCalled();
	});

	it('only the END date missing also reports "dates required"', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');
		await fill(container, 'season-create-start', '2026-09-01');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'season-create-error')?.textContent).toContain('season_dates_required');
		});
	});

	it('an INVERTED range still reports the inverted-range message', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');
		await fill(container, 'season-create-start', '2026-12-01');
		await fill(container, 'season-create-end', '2026-09-01');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'season-create-error')?.textContent).toContain(
				'season_date_range_invalid'
			);
		});
	});

	it('an inverted range flags the DATE inputs, not the (perfectly good) name', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');
		await fill(container, 'season-create-start', '2026-12-01');
		await fill(container, 'season-create-end', '2026-09-01');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'season-create-error')).not.toBeNull();
		});
		const nameEl = q(container, 'season-create-name') as HTMLInputElement;
		expect(nameEl.getAttribute('aria-invalid')).toBeNull();
		expect(nameEl.getAttribute('aria-describedby')).toBeNull();
		for (const testid of ['season-create-start', 'season-create-end']) {
			const dateEl = q(container, testid) as HTMLInputElement;
			expect(dateEl.getAttribute('aria-invalid')).toBe('true');
			expect(dateEl.getAttribute('aria-describedby')).toBe('season-create-error');
		}
		expect(q(container, 'season-create-error')?.id).toBe('season-create-error');
	});

	it('a missing NAME flags the name input and leaves the date inputs unflagged', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-start', '2026-09-01');
		await fill(container, 'season-create-end', '2026-12-20');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'season-create-error')?.textContent).toContain('season_name_required');
		});
		expect(q(container, 'season-create-name')?.getAttribute('aria-invalid')).toBe('true');
		expect(q(container, 'season-create-start')?.getAttribute('aria-invalid')).toBeNull();
		expect(q(container, 'season-create-end')?.getAttribute('aria-invalid')).toBeNull();
	});

	it('editing a field clears the error, and the name field stops announcing itself invalid', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-start', '2026-09-01');
		await fill(container, 'season-create-end', '2026-12-20');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'season-create-error')).not.toBeNull();
		});
		expect(q(container, 'season-create-name')?.getAttribute('aria-invalid')).toBe('true');

		await fill(container, 'season-create-name', 'Autumn 2026');

		await waitFor(() => {
			expect(q(container, 'season-create-error')).toBeNull();
		});
		const nameEl = q(container, 'season-create-name') as HTMLInputElement;
		expect(nameEl.getAttribute('aria-invalid')).toBeNull();
		expect(nameEl.getAttribute('aria-describedby')).toBeNull();
	});
});

describe('agenda — the season-create conductor select tells its empties apart (#209 review F1)', () => {
	it('roster read STILL IN FLIGHT: disabled with the LOADING prompt, never picker_everyone_added', async () => {
		loadRosterMock.mockReturnValue(new Promise<never>(() => {})); // never settles

		const container = await renderReady();
		await openForm(container);

		const select = conductorSelect(container);
		expect(select.disabled).toBe(true);
		expect(optionValues(select)).toEqual(['']);
		expect(promptOption(select).textContent?.trim()).toBe('picker_roster_loading');
	});

	it('roster read FAILED: the prompt says the member list is UNAVAILABLE — the failure stays visible instead of reading as "everyone is already added"', async () => {
		loadRosterMock.mockRejectedValue(new Error('roster boom'));

		const container = await renderReady();
		await openForm(container);

		await waitFor(() => {
			expect(promptOption(conductorSelect(container)).textContent?.trim()).toBe(
				'picker_roster_unavailable'
			);
		});
		expect(conductorSelect(container).disabled).toBe(true);
		expect(optionValues(conductorSelect(container))).toEqual(['']);
	});

	it('roster resolved EMPTY (this collective has no members): the prompt says there is nobody to add', async () => {
		loadRosterMock.mockResolvedValue(toListRead([]));

		const container = await renderReady();
		await openForm(container);

		await waitFor(() => {
			expect(promptOption(conductorSelect(container)).textContent?.trim()).toBe(
				'picker_no_members'
			);
		});
	});

	it('SECTION read failed: an ORDERING failure, not an empty picker — the select stays usable in the roster’s own name order and says so', async () => {
		listSectionsMock.mockReset().mockRejectedValue(new Error('sections boom'));

		const container = await renderReady();
		await openForm(container);

		await waitFor(() => {
			expect(q(container, 'season-create-conductor-order-note')).not.toBeNull();
		});
		const select = conductorSelect(container);
		expect(select.disabled).toBe(false);
		expect(optionValues(select)).toEqual(['', 'p-ada', 'p-grace', 'person-p']);
		expect(promptOption(select).textContent?.trim()).toBe('season_conductor_placeholder');
	});
});

// (*MVOX:Tallis*)

describe('the season-create conductor picker (#321 review F2)', () => {
	const NOTICE = '[data-testid="season-create-conductor-partial-notice"]';

	it('a truncated roster read renders the shared role="status" notice beside the picker', async () => {
		loadRosterMock.mockResolvedValue({ items: fixtureRows(), total: 500, truncated: true });
		const container = await renderReady();
		await openForm(container);

		await waitFor(() => {
			expect(container.querySelector(NOTICE)).not.toBeNull();
		});
		const notice = container.querySelector(NOTICE)!;
		expect(notice.getAttribute('role')).toBe('status');
		expect(notice.className).not.toMatch(/sr-only|hidden/);
	});

	it('a complete roster read leaves it ABSENT from the DOM', async () => {
		const container = await renderReady();
		await openForm(container);
		await waitFor(() => {
			expect(conductorSelect(container).options.length).toBeGreaterThan(1);
		});

		expect(container.querySelector(NOTICE)).toBeNull();
	});
});

// (*MVOX:Palestrina*)

describe('#361 — season-create conductor chip: the member name is marked', () => {
	it('a picked conductor chip renders the name through PersonName — marked, and marked once', async () => {
		const container = await renderReady();
		await openForm(container);
		await pickConductor(container, 'p-ada');
		await waitFor(() => {
			expect(q(container, 'season-create-conductor-p-ada')).not.toBeNull();
		});
		expectNameMarkedOnce(
			q(container, 'season-create-conductor-p-ada') as HTMLElement,
			'Ada Lovelace',
			'in the season-create conductor chip'
		);
	});
});

// (*MVOX:Tallis*)
