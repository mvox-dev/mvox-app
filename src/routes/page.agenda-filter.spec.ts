// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgendaItem } from '$lib/agenda/types';
import { eventTypeBadgeClass } from '$lib/events/eventTypeStyles';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket', {
		agenda_duration_min: (params) => `${(params as { minutes: number }).minutes} min`,
		agenda_filter_all: () => '[msg:filter-all]',
		agenda_filter_group_label: () => '[msg:filter-group]',
		agenda_filter_empty: () => '[msg:filter-empty]',
		agenda_filter_recent_empty: () => '[msg:filter-recent-empty]',
		event_type_rehearsal: () => '[msg:rehearsal]',
		event_type_concert: () => '[msg:concert]',
		event_type_social: () => '[msg:social]',
		event_type_other: () => '[msg:other]'
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
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn() }));
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule()
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { collectiveState, selectedCollectiveDbStore } from '$lib/collectives/store';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';

function setAuthedWithOneCollective() {
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p1' }] });
}

function setAuthedWithTwoCollectives() {
	signIn({ collectives: [{ db: 'org-a', name: 'Org A', personId: 'p1' }, { db: 'org-b', name: 'Org B', personId: 'p1' }] });
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

const UP_REHEARSAL = item('up-reh', 'Tavaline proov', '2030-06-10T16:00:00.000Z', 'rehearsal');
const UP_CONCERT = item('up-con', 'Kevadkontsert', '2030-06-12T18:00:00.000Z', 'concert');
const UP_OTHER = item('up-other', 'Muu üritus', '2030-06-15T16:00:00.000Z', 'other');
const UP_FREETEXT = item('up-proov', 'Eriproov', '2030-06-14T16:00:00.000Z', 'proov');
const UP_UNTYPED = item('up-untyped', 'Tüübita üritus', '2030-06-16T16:00:00.000Z', '');
const RECENT_SOCIAL = item('rec-soc', 'Suvepidu', '2026-05-01T18:00:00.000Z', 'social');
const RECENT_CONCERT = item('rec-con', 'Talvekontsert', '2026-04-01T18:00:00.000Z', 'concert');

function chipGroup(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[role="group"][aria-label="[msg:filter-group]"]');
}

function chips(container: HTMLElement): HTMLButtonElement[] {
	const group = chipGroup(container);
	return group ? Array.from(group.querySelectorAll('button')) : [];
}

function chipTestids(container: HTMLElement): (string | null)[] {
	return chips(container).map((b) => b.getAttribute('data-testid'));
}

function chipTexts(container: HTMLElement): (string | undefined)[] {
	return chips(container).map((b) => b.textContent?.trim());
}

function chip(container: HTMLElement, testid: string): HTMLButtonElement {
	const el = container.querySelector(`[data-testid="${testid}"]`);
	expect(el, `chip ${testid} must exist`).not.toBeNull();
	return el as HTMLButtonElement;
}

function upcomingRowIds(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll('[data-testid^="agenda-row-"]')).map((el) =>
		(el.getAttribute('data-testid') as string).replace('agenda-row-', '')
	);
}

function recentRowIds(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll('[data-testid^="agenda-recent-row-"]')).map((el) =>
		(el.getAttribute('data-testid') as string).replace('agenda-recent-row-', '')
	);
}

async function renderAgenda(
	upcoming: AgendaItem[],
	recent: AgendaItem[] = []
): Promise<HTMLElement> {
	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ upcoming, recent }));
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="agenda-skeleton"]')).toBeNull();
	});
	return container as HTMLElement;
}

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue(toListRead([]));

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	resetAppState();
	resetGate();
});

describe('#214 — chip DERIVATION from the rendered agenda', () => {
	it('renders exactly [All, rehearsal, concert, social] for a rehearsal+concert upcoming and a social recent — canonical order, native buttons, above the agenda', async () => {
		const container = await renderAgenda([UP_REHEARSAL, UP_CONCERT], [RECENT_SOCIAL]);

		expect(chipTestids(container)).toEqual([
			'agenda-filter-all',
			'agenda-filter-rehearsal',
			'agenda-filter-concert',
			'agenda-filter-social'
		]);
		expect(chipTexts(container)).toEqual([
			'[msg:filter-all]',
			'[msg:rehearsal]',
			'[msg:concert]',
			'[msg:social]'
		]);

		for (const btn of chips(container)) {
			expect(btn.tagName).toBe('BUTTON');
			expect(btn.getAttribute('type')).toBe('button');
			expect(btn.getAttribute('aria-pressed')).not.toBeNull();
		}
		expect(chip(container, 'agenda-filter-all').getAttribute('aria-pressed')).toBe('true');
		expect(chip(container, 'agenda-filter-rehearsal').getAttribute('aria-pressed')).toBe('false');
		expect(chip(container, 'agenda-filter-concert').getAttribute('aria-pressed')).toBe('false');
		expect(chip(container, 'agenda-filter-social').getAttribute('aria-pressed')).toBe('false');

		const group = chipGroup(container) as HTMLElement;
		const recentSection = container.querySelector('[data-testid="agenda-recent"]') as HTMLElement;
		expect(recentSection).not.toBeNull();
		expect(
			// eslint-disable-next-line no-bitwise
			group.compareDocumentPosition(recentSection) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});

	it("a free-text type ('proov') adds the 'other' chip — grouped, never its own raw-labeled chip", async () => {
		const container = await renderAgenda([UP_REHEARSAL, UP_CONCERT, UP_FREETEXT], [RECENT_SOCIAL]);

		expect(chipTestids(container)).toEqual([
			'agenda-filter-all',
			'agenda-filter-rehearsal',
			'agenda-filter-concert',
			'agenda-filter-social',
			'agenda-filter-other'
		]);
		expect(chipTexts(container)).toEqual([
			'[msg:filter-all]',
			'[msg:rehearsal]',
			'[msg:concert]',
			'[msg:social]',
			'[msg:other]'
		]);
	});

	it('no events at all → the chip row is hidden entirely (no group, no All chip)', async () => {
		const container = await renderAgenda([], []);

		expect(container.querySelector('[data-testid="agenda-empty"]')).not.toBeNull();
		expect(chipGroup(container)).toBeNull();
		expect(container.querySelector('[data-testid="agenda-filter-all"]')).toBeNull();
	});
});

describe('#214 — single-select TOGGLE (polyphony.uk pattern)', () => {
	it('tap concert → only concert rows in BOTH sections; tap concert again → all rows back', async () => {
		const container = await renderAgenda(
			[UP_REHEARSAL, UP_CONCERT],
			[RECENT_SOCIAL, RECENT_CONCERT]
		);
		await fireEvent.click(
			container.querySelector('[data-testid="agenda-recent-show-more"]')!
		);
		expect(upcomingRowIds(container)).toEqual(['up-reh', 'up-con']);
		expect(recentRowIds(container)).toEqual(['rec-soc', 'rec-con']);

		await fireEvent.click(chip(container, 'agenda-filter-concert'));

		expect(upcomingRowIds(container)).toEqual(['up-con']);
		expect(recentRowIds(container)).toEqual(['rec-con']);
		expect(chip(container, 'agenda-filter-concert').getAttribute('aria-pressed')).toBe('true');
		expect(chip(container, 'agenda-filter-all').getAttribute('aria-pressed')).toBe('false');
		expect(chip(container, 'agenda-filter-rehearsal').getAttribute('aria-pressed')).toBe('false');

		await fireEvent.click(chip(container, 'agenda-filter-concert'));
		expect(upcomingRowIds(container)).toEqual(['up-reh', 'up-con']);
		expect(recentRowIds(container)).toEqual(['rec-soc', 'rec-con']);
		expect(chip(container, 'agenda-filter-all').getAttribute('aria-pressed')).toBe('true');
		expect(chip(container, 'agenda-filter-concert').getAttribute('aria-pressed')).toBe('false');
	});

	it('the explicit All chip clears an active filter too', async () => {
		const container = await renderAgenda([UP_REHEARSAL, UP_CONCERT], [RECENT_SOCIAL]);

		await fireEvent.click(chip(container, 'agenda-filter-rehearsal'));
		expect(upcomingRowIds(container)).toEqual(['up-reh']);
		expect(recentRowIds(container)).toEqual([]);

		await fireEvent.click(chip(container, 'agenda-filter-all'));
		expect(upcomingRowIds(container)).toEqual(['up-reh', 'up-con']);
		expect(recentRowIds(container)).toEqual(['rec-soc']);
		expect(chip(container, 'agenda-filter-all').getAttribute('aria-pressed')).toBe('true');
		expect(chip(container, 'agenda-filter-rehearsal').getAttribute('aria-pressed')).toBe('false');
	});

	it('the Recent section is filtered too (a recent-only type hides under a different filter)', async () => {
		const container = await renderAgenda([UP_CONCERT], [RECENT_SOCIAL, RECENT_CONCERT]);

		await fireEvent.click(chip(container, 'agenda-filter-concert'));

		expect(container.querySelector('[data-testid="agenda-recent-row-rec-soc"]')).toBeNull();
		expect(container.querySelector('[data-testid="agenda-recent-row-rec-con"]')).not.toBeNull();
		expect(upcomingRowIds(container)).toEqual(['up-con']);
	});
});

describe("#214 — the 'other' bucket (free-text and empty types)", () => {
	it("filtering by 'other' shows canonical-other, free-text AND type-less rows; badges keep the raw string", async () => {
		const container = await renderAgenda([UP_REHEARSAL, UP_OTHER, UP_FREETEXT, UP_UNTYPED]);
		expect(chipTestids(container)).toEqual([
			'agenda-filter-all',
			'agenda-filter-rehearsal',
			'agenda-filter-other'
		]);

		await fireEvent.click(chip(container, 'agenda-filter-other'));

		expect(upcomingRowIds(container)).toEqual(['up-other', 'up-proov', 'up-untyped']);

		expect(
			container.querySelector('[data-testid="event-type-badge-up-proov"]')?.textContent?.trim()
		).toBe('proov');
		expect(
			container.querySelector('[data-testid="event-type-badge-up-other"]')?.textContent?.trim()
		).toBe('[msg:other]');
		expect(container.querySelector('[data-testid="event-type-badge-up-untyped"]')).toBeNull();
	});
});

describe('#214 — chip set RECOMPUTES when the list changes', () => {
	it('the active type disappearing from the list removes its chip and resets the filter to all', async () => {
		loadFullAgendaMock
			.mockResolvedValueOnce(fullAgendaResult({ upcoming: [UP_REHEARSAL, UP_CONCERT] }))
			.mockResolvedValueOnce(fullAgendaResult({ upcoming: [UP_REHEARSAL] }));
		setAuthedWithOneCollective();
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-row-up-con"]')).not.toBeNull();
		});

		await fireEvent.click(chip(container as HTMLElement, 'agenda-filter-concert'));
		expect(upcomingRowIds(container as HTMLElement)).toEqual(['up-con']);

		collectiveState.set({
			status: 'ready',
			collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p1' }],
			erroredDbs: []
		});

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-row-up-reh"]')).not.toBeNull();
		});

		expect(chipTestids(container as HTMLElement)).toEqual([
			'agenda-filter-all',
			'agenda-filter-rehearsal'
		]);
		expect(chip(container as HTMLElement, 'agenda-filter-all').getAttribute('aria-pressed')).toBe(
			'true'
		);
		expect(upcomingRowIds(container as HTMLElement)).toEqual(['up-reh']);
		expect(container.querySelector('[data-testid="agenda-filter-empty"]')).toBeNull();
	});
});

describe('#214 — filtered-empty state', () => {
	it('a filter yielding ZERO upcoming rows shows agenda-filter-empty, NOT agenda-empty', async () => {
		const container = await renderAgenda([UP_REHEARSAL], [RECENT_SOCIAL]);

		await fireEvent.click(chip(container, 'agenda-filter-social'));

		expect(upcomingRowIds(container)).toEqual([]);
		const filterEmpty = container.querySelector('[data-testid="agenda-filter-empty"]');
		expect(filterEmpty).not.toBeNull();
		expect(filterEmpty?.textContent?.trim()).toBe('[msg:filter-empty]');
		expect(container.querySelector('[data-testid="agenda-empty"]')).toBeNull();
		expect(recentRowIds(container)).toEqual(['rec-soc']);
	});
});

describe('#214 review F3 — a type filter never hides the season summary', () => {
	async function renderAsMember(
		upcoming: AgendaItem[],
		recent: AgendaItem[]
	): Promise<HTMLElement> {
		findMyMemberIdMock.mockResolvedValue('m-me');
		completionGateStore.set('complete');
		const container = await renderAgenda(upcoming, recent);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="season-summary"]')).not.toBeNull();
		});
		return container;
	}

	it('a member filtering to a type with zero matching RECENT rows still sees the summary', async () => {
		const container = await renderAsMember([UP_REHEARSAL], [RECENT_SOCIAL]);

		await fireEvent.click(chip(container, 'agenda-filter-rehearsal'));

		expect(recentRowIds(container)).toEqual([]);
		expect(container.querySelector('[data-testid="agenda-recent"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="season-summary"]')).not.toBeNull();
		expect(
			container.querySelector('[data-testid="agenda-recent-filter-empty"]')?.textContent?.trim()
		).toBe('[msg:filter-recent-empty]');
	});

	it('with no recent events at all, a filter does not conjure an empty Recent section', async () => {
		const container = await renderAgenda([UP_REHEARSAL, UP_CONCERT], []);

		await fireEvent.click(chip(container, 'agenda-filter-concert'));

		expect(container.querySelector('[data-testid="agenda-recent"]')).toBeNull();
		expect(container.querySelector('[data-testid="agenda-recent-filter-empty"]')).toBeNull();
	});
});

describe('#214 — collective switch resets the filter', () => {
	it('an active filter does not survive into the next collective', async () => {
		loadFullAgendaMock
			.mockResolvedValueOnce(fullAgendaResult({ upcoming: [UP_REHEARSAL, UP_CONCERT] }))
			.mockResolvedValueOnce(
				fullAgendaResult({
					upcoming: [
						item('b-reh', 'B proov', '2030-07-10T16:00:00.000Z', 'rehearsal'),
						item('b-con', 'B kontsert', '2030-07-12T18:00:00.000Z', 'concert')
					]
				})
			);
		setAuthedWithTwoCollectives();
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-row-up-con"]')).not.toBeNull();
		});

		await fireEvent.click(chip(container as HTMLElement, 'agenda-filter-concert'));
		expect(upcomingRowIds(container as HTMLElement)).toEqual(['up-con']);

		selectedCollectiveDbStore.set('org-b');

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-row-b-reh"]')).not.toBeNull();
		});
		expect(upcomingRowIds(container as HTMLElement)).toEqual(['b-reh', 'b-con']);
		expect(chip(container as HTMLElement, 'agenda-filter-all').getAttribute('aria-pressed')).toBe(
			'true'
		);
		expect(
			chip(container as HTMLElement, 'agenda-filter-concert').getAttribute('aria-pressed')
		).toBe('false');
	});
});

describe("#214 — visual scheme: #211's eventTypeBadgeClass on the ACTIVE chip only", () => {
	it('the active chip carries the shared scheme classes for its type; inactive chips do not', async () => {
		const container = await renderAgenda([UP_REHEARSAL, UP_CONCERT]);

		const concertClasses = eventTypeBadgeClass('concert').split(/\s+/).filter(Boolean);
		const rehearsalClasses = eventTypeBadgeClass('rehearsal').split(/\s+/).filter(Boolean);
		expect(concertClasses.length).toBeGreaterThan(0);

		for (const cls of concertClasses) {
			expect(
				chip(container, 'agenda-filter-concert').classList.contains(cls),
				`inactive concert chip must not carry ${cls}`
			).toBe(false);
		}

		await fireEvent.click(chip(container, 'agenda-filter-concert'));

		for (const cls of concertClasses) {
			expect(
				chip(container, 'agenda-filter-concert').classList.contains(cls),
				`active concert chip must carry ${cls}`
			).toBe(true);
		}
		for (const cls of rehearsalClasses) {
			expect(
				chip(container, 'agenda-filter-rehearsal').classList.contains(cls),
				`inactive rehearsal chip must not carry ${cls}`
			).toBe(false);
		}
	});

	it('EVERY chip — hued or quiet — is visibly different when active, social and other included', async () => {
		const container = await renderAgenda([UP_REHEARSAL, UP_OTHER], [RECENT_SOCIAL]);

		for (const type of ['rehearsal', 'social', 'other']) {
			const testid = `agenda-filter-${type}`;
			const inactive = new Set(chip(container, testid).classList);

			await fireEvent.click(chip(container, testid));

			expect(chip(container, testid).getAttribute('aria-pressed')).toBe('true');
			const active = new Set(chip(container, testid).classList);
			const added = [...active].filter((cls) => !inactive.has(cls));
			expect(
				added.length,
				`the active ${type} chip must carry at least one class its inactive self does not`
			).toBeGreaterThan(0);

			await fireEvent.click(chip(container, testid));
			expect(chip(container, testid).getAttribute('aria-pressed')).toBe('false');
		}
	});
});

describe('#214 — the new keys exist in all four locales', () => {
	const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
	const NEW_KEYS = [
		'agenda_filter_all',
		'agenda_filter_group_label',
		'agenda_filter_empty',
		'agenda_filter_recent_empty'
	];

	function messages(locale: (typeof LOCALES)[number]): Record<string, unknown> {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as Record<string, unknown>;
	}

	it.each(LOCALES)('%s carries all three keys, non-empty', (locale) => {
		const file = messages(locale);
		for (const key of NEW_KEYS) {
			expect(file[key], `${locale}.json must define ${key}`).toBeDefined();
			expect(typeof file[key]).toBe('string');
			expect((file[key] as string).trim().length).toBeGreaterThan(0);
		}
	});

	it("agenda_filter_all is the verbatim copy: en 'All', et 'Kõik'", () => {
		expect(messages('en').agenda_filter_all).toBe('All');
		expect(messages('et').agenda_filter_all).toBe('Kõik');
	});

	it('each filtered-empty copy names the list it governs, in every locale', () => {
		expect(messages('en').agenda_filter_empty).toBe('No upcoming events match this filter.');
		expect(messages('en').agenda_filter_recent_empty).toBe('No recent events match this filter.');
		expect(messages('et').agenda_filter_empty).toBe(
			'Ükski eelseisev sündmus ei vasta sellele filtrile.'
		);
		expect(messages('et').agenda_filter_recent_empty).toBe(
			'Ükski hiljutine sündmus ei vasta sellele filtrile.'
		);
		for (const locale of LOCALES) {
			const file = messages(locale);
			expect(file.agenda_filter_empty, locale).not.toBe(file.agenda_filter_recent_empty);
		}
	});
});

// (*MVOX:Tallis* — #214 RED)
