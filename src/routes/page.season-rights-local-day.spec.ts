// @vitest-environment happy-dom
// A season counts for rights through its last day on the device, not UTC's day.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('raw')
);
vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/seasons/seasonManage', async () =>
	(await import('$lib/testing/mocks/seasons')).seasonManageWritesModule({ deleteEvent: true })
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import type { Season } from '$lib/seasons/types';
import { loadFullAgendaMock } from '$lib/testing/moduleHandles';
import { resetDeviceClock, setDeviceClock, TALLINN_SUMMER_NIGHT } from '$lib/testing/deviceClock';
import { cleanupResetSeasonDeleteMocks } from '$lib/testing/pages/seasonPanel';
import { renderReady } from '$lib/testing/pages/seasonManageRender';

function season(id: string, startDate: string, endDate: string): Season {
	return { id, name: id, startDate, endDate, conductors: [], owners: [], editors: ['person-p'] };
}

function seasonRow(container: HTMLElement, id: string): Element | null {
	return container.querySelector(`[data-testid="season-card-expand"][data-season-manage-id="${id}"]`);
}

afterEach(() => {
	resetDeviceClock();
	cleanupResetSeasonDeleteMocks();
});

describe("seasons for rights at 01:30 in Tallinn on 2026-10-21 (UTC's 20th)", () => {
	it.each([
		['on its last day still counts', '2026-10-21', true],
		['that ended the day before no longer counts', '2026-10-20', false]
	])('a season %s', async (_case, endDate, listed) => {
		setDeviceClock(TALLINN_SUMMER_NIGHT);
		loadFullAgendaMock.mockResolvedValue(
			fullAgendaResult({
				seasons: [season('s-current', '2026-09-01', ''), season('s-old', '2026-01-01', endDate)]
			})
		);
		const container = await renderReady();

		await waitFor(() => expect(seasonRow(container, 's-current')).not.toBeNull());
		expect(seasonRow(container, 's-old') !== null).toBe(listed);
	});
});

// (*MVOX:Josquin*)
