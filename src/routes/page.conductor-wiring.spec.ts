// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/pages/agendaCopy')).agendaMessages()
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
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('records')
);

vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule({ lists: 'bare', byMember: 'records' })
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
import { cleanupResetAgendaGate } from '$lib/testing/pages/agenda';
import { setAuthedWithOneCollective } from '$lib/testing/pages/agendaAttendance';
import { agendaItem } from '$lib/testing/pages/agendaConductor';

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue(toListRead([]));

afterEach(cleanupResetAgendaGate);

describe('+page — recent items reach AgendaList (#83 conductor wiring)', () => {
	it('renders the Recent section with recent items from loadFullAgenda', async () => {
		const recentEvent = agendaItem('past-1', '2026-06-10T16:00:00.000Z');
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming: [],
			recent: [recentEvent],
			seasonId: 's1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-recent"]')).not.toBeNull();
		});
		expect(
			container.querySelector('[data-testid="agenda-recent-row-past-1"]')
		).not.toBeNull();
	});

	it('renders no Recent section when loadFullAgenda returns empty recent', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming: [agendaItem('up-1', '2026-09-10T16:00:00.000Z')],
			recent: [],
			seasonId: 's1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-list"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="agenda-recent"]')).toBeNull();
	});
});

describe('+page — conductorEventIds reach AgendaList (#83 conductor wiring)', () => {
	it('a conductor sees the Recent section with their conducted events identified', async () => {
		const recentEvent = { ...agendaItem('past-1', '2026-06-10T16:00:00.000Z', []), editors: ['person-p'] };
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming: [],
			recent: [recentEvent],
			seasonId: 's1',
			seasonConductors: ['person-p'], seasonOwners: [], seasonEditors: []
		}));
		setAuthedWithOneCollective('person-p');
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-recent-row-past-1"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="take-attendance-btn"]')).not.toBeNull();
	});

	it('a non-conductor sees recent rows but no attendance button, conductorEventIds is empty', async () => {
		const recentEvent = agendaItem('past-1', '2026-06-10T16:00:00.000Z', []);
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming: [],
			recent: [recentEvent],
			seasonId: 's1',
			seasonConductors: ['other-person'], seasonOwners: [], seasonEditors: []
		}));
		setAuthedWithOneCollective('person-p');
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-recent-row-past-1"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="take-attendance-btn"]')).toBeNull();
	});
});

// (*MVOX:Josquin*)
