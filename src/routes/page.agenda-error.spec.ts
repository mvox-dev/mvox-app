// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/pages/agendaCopy')).agendaMessages({
		agenda_gap_weeks: (params: { weeks: number }) => `In ${params.weeks} weeks`
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
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';
import {
	cleanupResetAgendaMocks,
	setAuthedWithOneCollective,
	setAuthedWithTwoCollectives
} from '$lib/testing/pages/agenda';

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue(toListRead([]));

afterEach(cleanupResetAgendaMocks);

describe('+page — agenda load error + retry (M2)', () => {
	it('surfaces an error + retry affordance on rejection, instead of a permanent skeleton', async () => {
		loadFullAgendaMock.mockRejectedValueOnce(new Error('network down'));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-skeleton"]')).toBeNull();
		});
		expect(container.querySelector('[data-testid="agenda-error"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="agenda-retry"]')).not.toBeNull();
	});

	it('retry re-invokes loadAgenda and recovers on success', async () => {
		loadFullAgendaMock.mockRejectedValueOnce(new Error('network down'));
		loadFullAgendaMock.mockResolvedValueOnce(fullAgendaResult({ seasons: [], upcoming: [], recent: [], seasonId: null, seasonConductors: [] }));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		const retryBtn = await waitFor(() => {
			const btn = container.querySelector('[data-testid="agenda-retry"]');
			expect(btn).not.toBeNull();
			return btn as HTMLButtonElement;
		});

		await fireEvent.click(retryBtn);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-error"]')).toBeNull();
		});
		expect(container.querySelector('[data-testid="agenda-empty"]')).not.toBeNull();
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
	});

	it('a later successful load is not clobbered by a stale rejection (requestId guard)', async () => {
		let rejectFirst!: (err: Error) => void;
		loadFullAgendaMock.mockImplementationOnce(
			() => new Promise((_resolve, reject) => { rejectFirst = reject; })
		);
		loadFullAgendaMock.mockResolvedValueOnce(fullAgendaResult({ seasons: [], upcoming: [], recent: [], seasonId: null, seasonConductors: [] }));
		setAuthedWithTwoCollectives();
		const { container } = render(Page);

		selectedCollectiveDbStore.set('org-b');

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-empty"]')).not.toBeNull();
		});

		rejectFirst(new Error('stale'));
		await new Promise((r) => setTimeout(r, 0));

		expect(container.querySelector('[data-testid="agenda-error"]')).toBeNull();
		expect(container.querySelector('[data-testid="agenda-empty"]')).not.toBeNull();
	});
});

// (*MVOX:Byrd*)
