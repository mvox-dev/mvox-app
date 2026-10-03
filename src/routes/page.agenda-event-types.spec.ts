// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgendaItem } from '$lib/agenda/types';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket', {
		agenda_duration_min: (params) => `${(params as { minutes: number }).minutes} min`,
		event_type_rehearsal: () => '[msg:rehearsal]',
		event_type_concert: () => '[msg:concert]'
	})
);

const { loadFullAgendaMock, findMyMemberIdMock, listMyRsvpsMock } =
	vi.hoisted(() => ({
		loadFullAgendaMock: vi.fn(),
		findMyMemberIdMock: vi.fn(),
		listMyRsvpsMock: vi.fn()
	}));
vi.mock('$lib/agenda/agendaData', () => ({
	loadFullAgenda: loadFullAgendaMock
}));
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn((..._args: unknown[]) => {
		const [, entityId, personId] = _args as [unknown, string, string];
		return Promise.resolve(entityId === personId ? 'editor' : 'not-editor');
	})
}));
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).databaseEntityModule(await importOriginal())
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
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn() }));
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

import Page from './+page.svelte';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

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

const REHEARSAL = item('ev-proov', 'Tavaline proov', '2030-06-10T16:00:00.000Z', 'rehearsal');
const CONCERT = item('ev-kontsert', 'Kevadkontsert', '2030-06-12T18:00:00.000Z', 'concert');

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue(toListRead([]));

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	resetAppState();
});

describe('+page — agenda shows ALL event types (#194/#202 integration)', () => {
	it('renders the concert row alongside the rehearsal row, each with its LOCALIZED type badge', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ upcoming: [REHEARSAL, CONCERT] }));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		const concertRow = await waitFor(() => {
			const row = container.querySelector('[data-testid="agenda-row-ev-kontsert"]');
			expect(row).not.toBeNull();
			return row as HTMLElement;
		});
		expect(container.textContent).toContain('Kevadkontsert');
		expect(
			concertRow.querySelector('[data-testid="event-type-badge-ev-kontsert"]')?.textContent?.trim()
		).toBe('[msg:concert]');

		const rehearsalRow = container.querySelector(
			'[data-testid="agenda-row-ev-proov"]'
		) as HTMLElement;
		expect(rehearsalRow).not.toBeNull();
		expect(
			rehearsalRow.querySelector('[data-testid="event-type-badge-ev-proov"]')?.textContent?.trim()
		).toBe('[msg:rehearsal]');
	});

	it("a FREE-TEXT type ('laulupidu') renders its raw value as the badge on the real route", async () => {
		const freeText = item('ev-laulupidu', 'Üldlaulupidu', '2030-07-01T16:00:00.000Z', 'laulupidu');
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ upcoming: [freeText] }));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		const row = await waitFor(() => {
			const el = container.querySelector('[data-testid="agenda-row-ev-laulupidu"]');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(row.querySelector('[data-testid="event-type-badge-ev-laulupidu"]')?.textContent?.trim()).toBe(
			'laulupidu'
		);
	});
});

// (*MVOX:Palestrina* — #194/#202 RED)
