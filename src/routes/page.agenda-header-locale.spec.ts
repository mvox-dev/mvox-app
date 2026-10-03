// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgendaItem } from '$lib/agenda/types';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

type AppLocale = 'en' | 'et' | 'lv' | 'uk';
vi.mock('$lib/paraglide/runtime.js', async () =>
	(await import('$lib/testing/mocks/session')).localeRuntimeModule()
);
function setAppLocale(locale: AppLocale): void {
	localeMock.state?.set('locale', locale);
}

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
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';
import { localeMock } from '$lib/testing/mocks/session';

function setAuthedWithOneCollective() {
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p1' }] });
}

function item(id: string, name: string, startDatetime: string): AgendaItem {
	return {
		id,
		name,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: [],
		eventType: 'rehearsal'
	} as AgendaItem;
}

const REHEARSAL = item('ev-proov', 'Tavaline proov', '2030-06-10T16:00:00.000Z');

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue(toListRead([]));

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	resetAppState();
	setAppLocale('en');
});

describe('+page — agenda headers follow the app language on the real route (#251 integration)', () => {
	it("app language 'et' on an en-US device: the day-group header reads 'esmaspäev, 10. juuni'", async () => {
		setAppLocale('et');
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ upcoming: [REHEARSAL] }));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		const header = await waitFor(() => {
			const el = container.querySelector('[data-testid="agenda-date-header"]');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(header.textContent?.trim()).toBe('esmaspäev, 10. juuni');
	});

	it('switching the app language live re-renders the header without a reload', async () => {
		setAppLocale('en');
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ upcoming: [REHEARSAL] }));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		const headerText = () =>
			container.querySelector('[data-testid="agenda-date-header"]')?.textContent?.trim();
		await waitFor(() => {
			expect(headerText()).toBe('Monday, June 10');
		});

		setAppLocale('et');
		await waitFor(() => {
			expect(headerText()).toBe('esmaspäev, 10. juuni');
		});
	});
});

// (*MVOX:Tallis* — #251 RED)
