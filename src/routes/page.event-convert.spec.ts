// @vitest-environment happy-dom
import { cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/entity/entityCreate', async () =>
	(await import('$lib/testing/mocks/events')).entityCreateModule()
);
vi.mock('$lib/events/eventConvert', async (importOriginal) =>
	(await import('$lib/testing/mocks/events')).eventConvertModule(importOriginal)
);
vi.mock('$lib/seasons/seasonManage', async () =>
	(await import('$lib/testing/mocks/seasons')).seasonManageModule()
);
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).entityIdModule(await importOriginal())
);
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).rightsModule(await importOriginal())
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
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
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);
vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/moduleStubs')).libraryDataModule()
);
vi.mock('$lib/repertoire/repertoireData', async () =>
	(await import('$lib/testing/mocks/seasons')).repertoireDataModule('empty')
);

import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import {
	isMessageEmpty,
	everyPatternContains,
	type MessageFile
} from '$lib/testing/messageFile.js';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { discoverMock, gotoMock } from '$lib/testing/routeMocks';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock
} from '$lib/testing/moduleHandles';
import { convertEventToSeriesMock, createEventMock } from '$lib/testing/mocks/events';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import {
	addSeasonConductorMock,
	getSeriesDefaultsMock,
	listEventSeriesForSeasonMock,
	listEventsForSeasonMock,
	listSeriesOptionsForSeasonMock,
	removeSeasonConductorMock,
	updateSeasonFieldMock
} from '$lib/testing/mocks/seasons';
import { q } from '$lib/testing/pages/dom';
import { ORG_EFK } from '$lib/testing/pages/rosterFixtures';
import { SEASON_ID, selectValue, seriesFixture } from '$lib/testing/pages/seasonPanel';
import { currentSeason } from '$lib/testing/pages/seasonEventCreate';
import { renderReady } from '$lib/testing/pages/seasonRender';

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

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead([]));
	createEventMock.mockResolvedValue('ev-new-1');
	convertEventToSeriesMock.mockResolvedValue({ seriesId: 'series-new-9', eventType: 'concert' });
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead(seriesFixture()));
	listSeriesOptionsForSeasonMock.mockResolvedValue(
		seriesFixture().map(({ id, name }) => ({ id, name }))
	);
	listEventsForSeasonMock.mockResolvedValue(toListRead([]));
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue({
		name: 'Monday rehearsals',
		durationMinutes: 90,
		defaultLocation: 'Main hall',
		defaultDescription: ''
	});
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	createEventMock.mockReset();
	convertEventToSeriesMock.mockReset();
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

async function openEventCreateFromPanel(container: HTMLElement): Promise<void> {
	await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-add-event')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'event-create-form')).not.toBeNull();
	});
}

describe('event-creation form — the "recurring wants a series" hint', () => {
	it('renders INSIDE the form through its localized key while NO series is selected', async () => {
		const container = await renderReady();
		await openEventCreateFromPanel(container);

		const form = q(container, 'event-create-form') as HTMLElement;
		const hint = form.querySelector('[data-testid="event-create-series-hint"]');
		expect(hint).not.toBeNull();
		expect(hint?.textContent).toContain('event_create_series_hint');
	});

	it('disappears the moment a series is chosen, and returns when the choice goes back to "" (standalone)', async () => {
		const container = await renderReady();
		await openEventCreateFromPanel(container);

		await selectValue(container, 'event-create-season', SEASON_ID);
		const series = q(container, 'event-create-series') as HTMLSelectElement;
		await waitFor(() => {
			expect(series.disabled).toBe(false);
		});
		expect(q(container, 'event-create-series-hint')).not.toBeNull();

		await selectValue(container, 'event-create-series', 'series-1');
		await waitFor(() => {
			expect(q(container, 'event-create-series-hint')).toBeNull();
		});

		await selectValue(container, 'event-create-series', '');
		await waitFor(() => {
			expect(q(container, 'event-create-series-hint')).not.toBeNull();
		});
	});
});

describe('locale parity — every #196 key present and non-empty in en/et/lv/uk', () => {
	const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
	const KEYS = [
		'event_create_series_hint',
		'season_manage_event_convert',
		'event_convert_form_label',
		'event_convert_interval_label',
		'event_convert_duration_label',
		'event_convert_end_date_label',
		'event_convert_submit',
		'event_convert_cancel',
		'event_convert_failed',
		'event_convert_interval_required',
		'event_convert_duration_required',
		'event_convert_end_required',
		'event_convert_end_before_start',
		'event_convert_start_missing',
		'event_convert_missing_name',
		'event_convert_missing_type',
		'event_convert_progress',
		'event_convert_generate_failed',
		'event_convert_resume_notice'
	] as const;

	function messages(locale: string): MessageFile {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as MessageFile;
	}

	it.each(LOCALES)('%s carries every key, none empty', (locale) => {
		const file = messages(locale);
		for (const key of KEYS) {
			expect(isMessageEmpty(file[key]), `messages/${locale}.json: ${key}`).toBe(false);
		}
	});

	it.each(LOCALES)('%s: event_convert_failed keeps its {step} placeholder — the loud-failure pin', (locale) => {
		expect(everyPatternContains(messages(locale)['event_convert_failed'], '{step}')).toBe(true);
	});
});

describe('#212 locale parity — event_convert_start_date_label present and non-empty in en/et/lv/uk', () => {
	function messages(locale: string): MessageFile {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as MessageFile;
	}

	it.each(['en', 'et', 'lv', 'uk'] as const)('%s carries the key, non-empty', (locale) => {
		expect(
			isMessageEmpty(messages(locale)['event_convert_start_date_label']),
			`messages/${locale}.json: event_convert_start_date_label`
		).toBe(false);
	});

	it('en reads "Starts", et reads "Algus" — the copy the #212 ruling pinned', () => {
		expect(messages('en')['event_convert_start_date_label']).toBe('Starts');
		expect(messages('et')['event_convert_start_date_label']).toBe('Algus');
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Tallis*)
