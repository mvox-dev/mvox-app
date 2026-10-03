// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);

const {
	loadFullAgendaMock,
	loadRosterMock,
	createSeasonMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock,
	findMyMemberIdMock,
	listMyRsvpsMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	loadRosterMock: vi.fn(),
	createSeasonMock: vi.fn(),
	resolveDatabaseEntityIdMock: vi.fn(),
	resolveManageRightsMock: vi.fn(),
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
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
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
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { gotoMock, discoverMock } from '$lib/testing/routeMocks';

const ORG_EFK = '69c7f8718489bfcb0e81b065';

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

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

function freshCollectiveResult() {
	return fullAgendaResult({ seasons: [] });
}

function setAuthedWithOneCollective() {
	signIn();
}

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(freshCollectiveResult());
	loadRosterMock.mockResolvedValue(toListRead([]));
	createSeasonMock.mockResolvedValue('season-new-1');
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
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
	resetAppState();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderSettled(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-skeleton')).toBeNull();
	});
	return container;
}

describe('agenda — empty-state onboarding banner (#201): the gate', () => {
	it('renders for a season-editor on a fresh collective (loaded, zero seasons)', async () => {
		const container = await renderSettled();

		await waitFor(() => {
			expect(q(container, 'agenda-onboarding')).not.toBeNull();
		});
	});

	it('is ABSENT while the agenda is still loading — never over the skeleton', async () => {
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

		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		expect(q(container, 'agenda-onboarding')).toBeNull();
	});

	it('is ABSENT for a non-editor — the existing generic empty state stays', async () => {
		resolveManageRightsMock.mockResolvedValue('not-editor');
		const container = await renderSettled();

		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalled();
		});
		expect(q(container, 'agenda-empty')).not.toBeNull();
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

describe('agenda — empty-state onboarding banner (#201): the content', () => {
	it('guides season → series → events IN ORDER, via localized keys (never hardcoded copy)', async () => {
		const container = await renderSettled();

		const banner = await waitFor(() => {
			const el = q(container, 'agenda-onboarding');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});

		const text = banner.textContent ?? '';
		const seasonAt = text.indexOf('agenda_onboarding_step_season');
		const seriesAt = text.indexOf('agenda_onboarding_step_series');
		const eventsAt = text.indexOf('agenda_onboarding_step_events');
		expect(seasonAt).toBeGreaterThanOrEqual(0);
		expect(seriesAt).toBeGreaterThanOrEqual(0);
		expect(eventsAt).toBeGreaterThanOrEqual(0);
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
		expect(gotoMock).not.toHaveBeenCalled();
		expect(createSeasonMock).not.toHaveBeenCalled();
	});

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
		expect(q(container, 'agenda-onboarding')).toBeNull();
		expect(q(container, 'agenda-onboarding-cta')).toBeNull();
		expect(q(container, 'season-create')).toBeNull();

		await fireEvent.input(nameInput, { target: { value: 'Hooaeg 2027' } });
		expect(nameInput.value).toBe('Hooaeg 2027');
	});
});

// (*MVOX:Tallis*)
