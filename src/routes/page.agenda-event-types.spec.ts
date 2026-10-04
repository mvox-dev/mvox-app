// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket', {
		agenda_duration_min: (params) => `${(params as { minutes: number }).minutes} min`,
		event_type_rehearsal: () => '[msg:rehearsal]',
		event_type_concert: () => '[msg:concert]'
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
import { toListRead } from '$lib/testing/listReadFixtures.js';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';
import {
	cleanupResetAgendaMocks,
	item,
	setAuthedWithOneCollective
} from '$lib/testing/pages/agenda';

const REHEARSAL = item('ev-proov', 'Tavaline proov', '2030-06-10T16:00:00.000Z', 'rehearsal');
const CONCERT = item('ev-kontsert', 'Kevadkontsert', '2030-06-12T18:00:00.000Z', 'concert');

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue(toListRead([]));

afterEach(cleanupResetAgendaMocks);

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
