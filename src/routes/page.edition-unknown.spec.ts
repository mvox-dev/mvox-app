// @vitest-environment happy-dom
// The agenda's rsvp read and the edition-state wording; the picker states live on /event.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { messagePatterns } from '$lib/testing/messageFile.js';
import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket')
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
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('list')
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule({ lists: 'bare' })
);

import Page from './+page.svelte';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { listMyRsvpsMock, loadFullAgendaMock } from '$lib/testing/moduleHandles';
import { cleanupUnstubResetAgendaRsvps, future } from '$lib/testing/pages/agendaWorks';
import { setAuthedWithOneCollective } from '$lib/testing/pages/roster';
import { LOCALES, readMessages as localeMessages } from '$lib/testing/pages/profile';

function installWorld() {
	loadFullAgendaMock.mockResolvedValue(
		fullAgendaResult({
			seasons: [],
			upcoming: [
				{
					id: 'ev-1',
					name: 'Rehearsal',
					startDatetime: future,
					durationMinutes: 90,
					location: '',
					conductors: [],
					owners: [],
					editors: []
				}
			],
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [],
			seasonOwners: [],
			seasonEditors: ['person-p']
		})
	);
	vi.stubGlobal('fetch', vi.fn(async () => json({ entities: [] })));
}

async function renderAgenda() {
	setAuthedWithOneCollective();
	const rendered = render(Page);
	await vi.waitFor(() => {
		expect(rendered.container.querySelector('[data-testid="agenda-row-ev-1"]')).not.toBeNull();
	});
	return rendered;
}

beforeEach(() => {
	resetTypeIdCache();
	listMyRsvpsMock.mockResolvedValue({ items: [], total: 0, truncated: false });
});

afterEach(cleanupUnstubResetAgendaRsvps);

describe('#329 — the lifetime listMyRsvps read keeps its OTHER consumer', () => {
	it('the agenda still seeds its rows from listMyRsvps — this issue moves only the EVENT PAGE off it', async () => {
		installWorld();
		await renderAgenda();
		expect(listMyRsvpsMock).toHaveBeenCalled();
		expect(listMyRsvpsMock.mock.calls.some((c) => c[1] === 'person-p')).toBe(true);
	});
});

const NO_EDITION_TODAY: Record<(typeof LOCALES)[number], string> = {
	en: 'No pinned edition',
	et: 'Trükiväljaanne valimata',
	lv: 'Izdevums nav norādīts',
	uk: 'Видання не вказано'
};

describe('#329 i18n — repertoire_edition_unknown is its own sentence', () => {
	it.each(LOCALES)(
		'%s: unknown and known-absent are DIFFERENT sentences — the two states must not share wording',
		(locale) => {
			const messages = localeMessages(locale);
			const unknown = messagePatterns(messages['repertoire_edition_unknown']).join(' ');
			const noEdition = messagePatterns(messages['repertoire_no_edition']).join(' ');
			expect(unknown).not.toBe('');
			expect(unknown).not.toBe(noEdition);
		}
	);

	it.each(LOCALES)("%s: repertoire_no_edition keeps today's wording byte-identically", (locale) => {
		const messages = localeMessages(locale);
		expect(messages['repertoire_no_edition']).toBe(NO_EDITION_TODAY[locale]);
	});
});

describe('#342 i18n — the three edition-state messages are distinct', () => {
	it.each(LOCALES)(
		'%s: no_edition, edition_unknown and edition_unknown_pinned are pairwise DIFFERENT sentences',
		(locale) => {
			const messages = localeMessages(locale);
			const noEdition = messagePatterns(messages['repertoire_no_edition']).join(' ');
			const unknown = messagePatterns(messages['repertoire_edition_unknown']).join(' ');
			const pinned = messagePatterns(messages['repertoire_edition_unknown_pinned']).join(' ');
			expect(pinned).not.toBe('');
			expect(pinned).not.toBe(unknown);
			expect(pinned).not.toBe(noEdition);
			expect(unknown).not.toBe(noEdition);
		}
	);
});

// (*MVOX:Tallis*)
