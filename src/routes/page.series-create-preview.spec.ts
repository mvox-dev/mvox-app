// @vitest-environment happy-dom
// Series creation on the agenda page: the occurrence preview and its date chips.
import { fireEvent, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { messagePatterns, type MessageFile } from '$lib/testing/messageFile.js';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);
vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/entity/entityCreate', async () =>
	(await import('$lib/testing/mocks/events')).entityCreateModule(['series', 'event'])
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

import { fillTime } from '$lib/testing/timeControls';
import type { CreateEventInput } from '$lib/entity/entityCreate';
import { resolveDatabaseEntityIdMock } from '$lib/testing/moduleHandles';
import { createEventMock, createEventSeriesMock } from '$lib/testing/mocks/events';
import { q } from '$lib/testing/pages/dom';
import {
	enableMondayGeneration,
	fill,
	lastSeriesInput,
	openSeriesForm,
	selectValue
} from '$lib/testing/pages/seasonPanel';
import { renderReady } from '$lib/testing/pages/seasonRender';
import { flush } from '$lib/testing/pages/seasonEventCreate';
import {
	dateChip,
	fillValidTemplate,
	previewDates,
	settleSeriesRun,
	submit,
	toggleDate,
	useSeriesCreatePage
} from '$lib/testing/pages/seriesCreate';

useSeriesCreatePage();

function activeDates(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-testid^="series-create-date-"]')]
		.filter((el) => el.getAttribute('aria-pressed') === 'true')
		.map((el) => el.getAttribute('data-testid')?.replace('series-create-date-', '') ?? '');
}

function gridSequence(container: HTMLElement): string[] {
	return [
		...container.querySelectorAll(
			'[data-testid^="series-create-month-"], [data-testid^="series-create-date-"]'
		)
	].map((el) => el.getAttribute('data-testid') ?? '');
}

describe('season panel — the recurrence preview is live and real', () => {
	it('day/time/from/until set → series-create-preview lists EXACTLY the generated dates (real generateEventDates: 13 Mondays for Sep 1 – Dec 1 2026) — and previewing writes NOTHING', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-12-01');
		await enableMondayGeneration(container);

		await waitFor(() => {
			expect(q(container, 'series-create-preview')).not.toBeNull();
		});
		expect(previewDates(container)).toEqual([
			'2026-09-07',
			'2026-09-14',
			'2026-09-21',
			'2026-09-28',
			'2026-10-05',
			'2026-10-12',
			'2026-10-19',
			'2026-10-26',
			'2026-11-02',
			'2026-11-09',
			'2026-11-16',
			'2026-11-23',
			'2026-11-30'
		]);
		expect(gridSequence(container)).toEqual([
			'series-create-month-2026-09',
			'series-create-date-2026-09-07',
			'series-create-date-2026-09-14',
			'series-create-date-2026-09-21',
			'series-create-date-2026-09-28',
			'series-create-month-2026-10',
			'series-create-date-2026-10-05',
			'series-create-date-2026-10-12',
			'series-create-date-2026-10-19',
			'series-create-date-2026-10-26',
			'series-create-month-2026-11',
			'series-create-date-2026-11-02',
			'series-create-date-2026-11-09',
			'series-create-date-2026-11-16',
			'series-create-date-2026-11-23',
			'series-create-date-2026-11-30'
		]);
		expect(activeDates(container)).toEqual(previewDates(container));
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('the preview UPDATES LIVE as params change: shortening until 2026-12-01 → 2026-09-30 shrinks 13 Mondays to 4', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-12-01');
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(13);
		});

		await fill(container, 'series-create-until', '2026-09-30');

		await waitFor(() => {
			expect(previewDates(container)).toEqual([
				'2026-09-07',
				'2026-09-14',
				'2026-09-21',
				'2026-09-28'
			]);
		});
	});

	it('#215 — tapping a chip SKIPS it: aria-pressed flips to "false", the chip stays RENDERED (struck + muted), the other chips are untouched; tapping again restores it', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-09-30');
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(4);
		});

		await toggleDate(container, '2026-09-14');

		await waitFor(() => {
			expect(dateChip(container, '2026-09-14')?.getAttribute('aria-pressed')).toBe('false');
		});
		expect(previewDates(container)).toEqual([
			'2026-09-07',
			'2026-09-14',
			'2026-09-21',
			'2026-09-28'
		]);
		expect(activeDates(container)).toEqual(['2026-09-07', '2026-09-21', '2026-09-28']);
		const skipped = dateChip(container, '2026-09-14') as HTMLButtonElement;
		const skippedClasses = Array.from(skipped.classList);
		expect(skippedClasses).toContain('line-through');
		expect(skippedClasses).toContain('text-ink-2');
		expect(skipped.textContent?.trim()).toBe('2026-09-14');

		await toggleDate(container, '2026-09-14');
		await waitFor(() => {
			expect(dateChip(container, '2026-09-14')?.getAttribute('aria-pressed')).toBe('true');
		});
		expect(Array.from((dateChip(container, '2026-09-14') as HTMLElement).classList)).not.toContain(
			'line-through'
		);
		expect(activeDates(container)).toHaveLength(4);
	});

	it('#215 — chip anatomy: a NATIVE <button type="button"> (rules 1/2) with the bare ISO date as its text (rule 7) and the 44x44 floor (min-h-11 min-w-11); the month heading is a display-only <h4> with a LOCALIZED month name, never the raw YYYY-MM', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(previewDates(container)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21']);
		});

		for (const iso of ['2026-09-07', '2026-09-14', '2026-09-21']) {
			const chip = dateChip(container, iso) as HTMLButtonElement;
			expect(chip.tagName).toBe('BUTTON');
			expect(chip.getAttribute('type')).toBe('button');
			expect(chip.getAttribute('aria-pressed')).toBe('true');
			expect(chip.textContent?.trim()).toBe(iso);
			const classes = Array.from(chip.classList);
			expect(classes, `${iso} chip must reserve the 44px height floor`).toContain('min-h-11');
			expect(classes, `${iso} chip must reserve the 44px width floor`).toContain('min-w-11');
		}

		const heading = q(container, 'series-create-month-2026-09') as HTMLElement;
		expect(heading).not.toBeNull();
		expect(heading.tagName).toBe('H4');
		expect(heading.closest('button')).toBeNull();
		const monthText = heading.textContent?.trim() ?? '';
		expect(monthText).not.toBe('');
		expect(monthText).not.toMatch(/^\d{4}-\d{2}$/);
	});

	it('#215→#241 — the grid still WRAPS (no scroll-trap class anywhere on or under the preview) but no longer renders flat: a 90-chip daily season opens at the FIRST 50 chips under TWO headings (Sep + Oct 1–20); show-all brings the full 90 under three', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Daily grind');
		await fill(container, 'series-create-duration', '90');
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-11-29');
		await selectValue(container, 'series-create-repeat', 'daily');

		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50); // of 90 = 30 + 31 + 29
		});
		expect(q(container, 'series-create-preview-count')?.textContent).toContain('"count":90');
		expect(
			[
				...(q(container, 'series-create-preview') as HTMLElement).querySelectorAll(
					'[data-testid^="series-create-month-"]'
				)
			].map((el) => el.getAttribute('data-testid'))
		).toEqual(['series-create-month-2026-09', 'series-create-month-2026-10']);

		await fireEvent.click(q(container, 'series-create-show-all') as HTMLElement);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(90);
		});
		expect(
			[
				...(q(container, 'series-create-preview') as HTMLElement).querySelectorAll(
					'[data-testid^="series-create-month-"]'
				)
			].map((el) => el.getAttribute('data-testid'))
		).toEqual([
			'series-create-month-2026-09',
			'series-create-month-2026-10',
			'series-create-month-2026-11'
		]);

		const preview = q(container, 'series-create-preview') as HTMLElement;
		const scrollTrap = /^(max-h-|overflow-y-auto$|overflow-auto$|overflow-scroll$|overflow-y-scroll$)/;
		for (const el of [preview, ...preview.querySelectorAll('*')]) {
			const offending = Array.from((el as HTMLElement).classList ?? []).filter((c) =>
				scrollTrap.test(c)
			);
			expect(offending, `no inner scroll region: <${el.tagName}> carries ${offending}`).toEqual(
				[]
			);
		}
	});

	it('#240 — the preview is UNCONDITIONAL: completing the recurrence brings it up immediately, with no checkbox, no button and no other trigger to find', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-09-30');
		await selectValue(container, 'series-create-day', '1');

		await waitFor(() => {
			expect(q(container, 'series-create-preview')).not.toBeNull();
		});
		expect(previewDates(container)).toEqual([
			'2026-09-07',
			'2026-09-14',
			'2026-09-21',
			'2026-09-28'
		]);
		expect(q(container, 'series-create-generate')).toBeNull();
	});

	it('recurrence INCOMPLETE (no day picked on a day-using pattern): no preview yet — incompleteness, not a gate (#240)', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-09-30');

		await flush();
		expect(q(container, 'series-create-preview')).toBeNull();
	});
});

describe('season panel — the date range is validated BEFORE any fetch', () => {
	it('blank FROM: named refusal, no org round-trip, no write', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await fill(container, 'series-create-from', '');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_from_required'
		);
		expect(resolveDatabaseEntityIdMock).not.toHaveBeenCalled();
		expect(createEventSeriesMock).not.toHaveBeenCalled();
	});

	it('blank UNTIL: named refusal, no write', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await fill(container, 'series-create-until', '');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_until_required'
		);
		expect(createEventSeriesMock).not.toHaveBeenCalled();
	});

	it('UNTIL before FROM: named refusal — never the generic "try again" that retrying cannot fix', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await fill(container, 'series-create-until', '2026-08-01');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_until_before_from'
		);
		expect(resolveDatabaseEntityIdMock).not.toHaveBeenCalled();
		expect(createEventSeriesMock).not.toHaveBeenCalled();
	});
});

describe('season panel — the preview counts, scrolls, and refuses an empty set', () => {
	it('states how many events will be created (plural), and the singular form when exactly one', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-12-01');
		await enableMondayGeneration(container);

		await waitFor(() => {
			expect(q(container, 'series-create-preview-count')).not.toBeNull();
		});
		const count = q(container, 'series-create-preview-count') as HTMLElement;
		expect(count.textContent).toContain('series_create_preview_count_other');
		expect(count.textContent).toContain('"count":13');

		await fill(container, 'series-create-until', '2026-09-07');
		await waitFor(() => {
			expect(previewDates(container)).toEqual(['2026-09-07']);
		});
		expect(q(container, 'series-create-preview-count')?.textContent?.trim()).toBe(
			'series_create_preview_count_one'
		);
	});

	it('#215 — the count line tracks TOGGLES live: 3 chips, one toggled off → the _other form with count 2, exactly', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(3);
		});
		expect(q(container, 'series-create-preview-count')?.textContent?.trim()).toBe(
			'series_create_preview_count_other {"count":3}'
		);

		await toggleDate(container, '2026-09-14');

		await waitFor(() => {
			expect(q(container, 'series-create-preview-count')?.textContent?.trim()).toBe(
				'series_create_preview_count_other {"count":2}'
			);
		});
	});

	it('#215 Gama ruling (2) — ALL chips toggled off: submit DISABLED, the count line reads the 0 form of series_create_preview_count ("Luuakse 0 sündmust") and series_create_no_dates is NOT shown; toggling one back on re-enables submit', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(previewDates(container)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21']);
		});
		expect((q(container, 'series-create-submit') as HTMLButtonElement).disabled).toBe(false);

		await toggleDate(container, '2026-09-07');
		await toggleDate(container, '2026-09-14');
		await toggleDate(container, '2026-09-21');

		await waitFor(() => {
			expect(activeDates(container)).toEqual([]);
		});
		expect(q(container, 'series-create-preview-count')?.textContent?.trim()).toBe(
			'series_create_preview_count_other {"count":0}'
		);
		expect(container.textContent).not.toContain('series_create_no_dates');
		expect((q(container, 'series-create-submit') as HTMLButtonElement).disabled).toBe(true);
		await flush();
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();

		await toggleDate(container, '2026-09-14');
		await waitFor(() => {
			expect((q(container, 'series-create-submit') as HTMLButtonElement).disabled).toBe(false);
		});
		expect(activeDates(container)).toEqual(['2026-09-14']);
	});

	it('a recurrence that yields NOTHING (Mondays over a Tue–Sun range) is REFUSED before the series is written — never a silent success with a childless series behind it', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Impossible Mondays');
		await fill(container, 'series-create-duration', '90');
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-09-06');
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_no_dates'
		);
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'series-create-form')).not.toBeNull();
	});
});

describe('#215 — chips while LOCKED, and the retired skip UI', () => {
	it('LOCKED (resumable run): the REMAINDER renders as chips — disabled, still pressed — and clicking one changes NOTHING (the skip set is frozen with the rest of the form)', async () => {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});

		await waitFor(() => {
			expect(previewDates(container)).toEqual(['2026-09-14', '2026-09-21']);
		});
		for (const iso of ['2026-09-14', '2026-09-21']) {
			const chip = dateChip(container, iso) as HTMLButtonElement;
			expect(chip.disabled, `${iso} chip must be disabled while locked`).toBe(true);
			expect(chip.getAttribute('aria-pressed')).toBe('true');
		}

		await fireEvent.click(dateChip(container, '2026-09-14') as HTMLButtonElement);
		await flush();
		expect(dateChip(container, '2026-09-14')?.getAttribute('aria-pressed')).toBe('true');
		expect(activeDates(container)).toEqual(['2026-09-14', '2026-09-21']);
		expect(q(container, 'series-create-resume')?.textContent).toContain('"remaining":2');
	});

	it('no trace of the retired skip UI remains anywhere in the open form — input, Add, list, chips, heading', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(3);
		});
		await toggleDate(container, '2026-09-14');

		expect(q(container, 'series-create-skip-date')).toBeNull();
		expect(q(container, 'series-create-skip-add')).toBeNull();
		expect(q(container, 'series-create-skip-list')).toBeNull();
		expect(q(container, 'series-create-skip-heading')).toBeNull();
		expect(container.querySelector('[data-testid^="series-create-skip-"]')).toBeNull();
	});
});

describe('#215 — locale files: skip keys retired, preview keys stay', () => {
	const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
	const RETIRED_KEYS = [
		'series_create_skip_heading',
		'series_create_skip_date_label',
		'series_create_skip_add',
		'series_create_skip_remove'
	] as const;

	function messageFile(locale: string): MessageFile {
		return JSON.parse(
			readFileSync(resolvePath(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as MessageFile;
	}

	it.each(LOCALES)('%s: the four series_create_skip_* keys are ABSENT', (locale) => {
		const file = messageFile(locale);
		for (const key of RETIRED_KEYS) {
			expect(key in file, `${key} must be gone from messages/${locale}.json`).toBe(false);
		}
	});

	it.each(LOCALES)('%s: series_create_generate_label is ABSENT (#240 — the checkbox is retired)', (locale) => {
		const file = messageFile(locale);
		expect(
			'series_create_generate_label' in file,
			`series_create_generate_label must be gone from messages/${locale}.json`
		).toBe(false);
	});
});

describe('#241 — the preview caps at 50 chips, with show-next-50 / show-all-N', () => {
	function dailyIsoDates(from: string, until: string): string[] {
		const dates: string[] = [];
		const cursor = new Date(`${from}T00:00:00Z`);
		const end = new Date(`${until}T00:00:00Z`);
		while (cursor.getTime() <= end.getTime()) {
			dates.push(cursor.toISOString().slice(0, 10));
			cursor.setUTCDate(cursor.getUTCDate() + 1);
		}
		return dates;
	}

	function expectedSequence(isoDates: string[]): string[] {
		const seq: string[] = [];
		let month = '';
		for (const iso of isoDates) {
			if (iso.slice(0, 7) !== month) {
				month = iso.slice(0, 7);
				seq.push(`series-create-month-${month}`);
			}
			seq.push(`series-create-date-${iso}`);
		}
		return seq;
	}

	function showNextButton(container: HTMLElement): HTMLButtonElement | null {
		return q(container, 'series-create-show-next') as HTMLButtonElement | null;
	}

	function showAllButton(container: HTMLElement): HTMLButtonElement | null {
		return q(container, 'series-create-show-all') as HTMLButtonElement | null;
	}

	function countLine(container: HTMLElement): string {
		return q(container, 'series-create-preview-count')?.textContent ?? '';
	}

	async function renderDaily(from: string, until: string): Promise<HTMLElement> {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', from);
		await fill(container, 'series-create-until', until);
		await selectValue(container, 'series-create-repeat', 'daily');
		return container;
	}

	const FULL_153 = dailyIsoDates('2026-09-01', '2027-01-31');

	it('a 153-date daily season renders EXACTLY the first 50 chips (Sep + Oct 1–20, TWO headings), the count line reads the FULL 153, and two NATIVE keyboard-reachable buttons follow the grid: show-next {"count":50}, then show-all {"count":153} — and nothing is written', async () => {
		const container = await renderDaily('2026-09-01', '2027-01-31');

		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50);
		});
		expect(previewDates(container)).toEqual(FULL_153.slice(0, 50));
		expect(gridSequence(container)).toEqual(expectedSequence(FULL_153.slice(0, 50)));
		expect(countLine(container)).toContain('"count":153');

		const next = showNextButton(container);
		const all = showAllButton(container);
		expect(next, 'series-create-show-next must render').not.toBeNull();
		expect(all, 'series-create-show-all must render').not.toBeNull();
		for (const btn of [next as HTMLButtonElement, all as HTMLButtonElement]) {
			expect(btn.tagName).toBe('BUTTON');
			expect(btn.getAttribute('type')).toBe('button');
			expect(btn.disabled).toBe(false);
			expect(btn.tabIndex).toBeGreaterThanOrEqual(0);
		}
		expect(next?.textContent?.trim()).toBe('series_create_show_next_label {"count":50}');
		expect(all?.textContent?.trim()).toBe('series_create_show_all_label {"count":153}');

		const lastChip = dateChip(container, '2026-10-20') as HTMLElement;
		expect(
			lastChip.compareDocumentPosition(next as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING,
			'show-next must come after the grid'
		).not.toBe(0);
		expect(
			(next as HTMLElement).compareDocumentPosition(all as HTMLElement) &
				Node.DOCUMENT_POSITION_FOLLOWING,
			'show-all must come after show-next'
		).not.toBe(0);

		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('show-next is CUMULATIVE and order-preserving: 50 → 100 → 150 → 153; the boundary month keeps its ONE heading; the label carries the ACTUAL batch size ({"count":3} on the last step); both controls leave once everything is shown', async () => {
		const container = await renderDaily('2026-09-01', '2027-01-31');
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50);
		});

		await fireEvent.click(showNextButton(container) as HTMLElement);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(100);
		});
		expect(previewDates(container)).toEqual(FULL_153.slice(0, 100));
		expect(gridSequence(container)).toEqual(expectedSequence(FULL_153.slice(0, 100)));
		expect(
			container.querySelectorAll('[data-testid="series-create-month-2026-10"]')
		).toHaveLength(1);
		expect(countLine(container)).toContain('"count":153');

		await fireEvent.click(showNextButton(container) as HTMLElement);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(150);
		});
		expect(showNextButton(container)?.textContent?.trim()).toBe(
			'series_create_show_next_label {"count":3}'
		);
		expect(showAllButton(container)?.textContent?.trim()).toBe(
			'series_create_show_all_label {"count":153}'
		);

		await fireEvent.click(showNextButton(container) as HTMLElement);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(153);
		});
		expect(previewDates(container)).toEqual(FULL_153);
		expect(gridSequence(container)).toEqual(expectedSequence(FULL_153));
		expect(showNextButton(container)).toBeNull();
		expect(showAllButton(container)).toBeNull();
	});

	it('show-all reveals the remainder in ONE step: 50 → 153, full month-grouped sequence, both controls gone', async () => {
		const container = await renderDaily('2026-09-01', '2027-01-31');
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50);
		});

		await fireEvent.click(showAllButton(container) as HTMLElement);

		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(153);
		});
		expect(previewDates(container)).toEqual(FULL_153);
		expect(gridSequence(container)).toEqual(expectedSequence(FULL_153));
		expect(showNextButton(container)).toBeNull();
		expect(showAllButton(container)).toBeNull();
	});

	it('50 or fewer dates: no cap engages and NEITHER control renders (exactly-50 boundary)', async () => {
		const container = await renderDaily('2026-09-01', '2026-10-20'); // 30 + 20 = 50
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50);
		});
		expect(previewDates(container)).toEqual(dailyIsoDates('2026-09-01', '2026-10-20'));
		expect(showNextButton(container)).toBeNull();
		expect(showAllButton(container)).toBeNull();
	});

	it('revealing is a VIEW operation (#241 point 4): skips survive it, a skip toggle never collapses the reveal, the count line and show-all N track the SKIP-APPLIED total while show-next tracks the GRID', async () => {
		const container = await renderDaily('2026-09-01', '2026-11-29'); // 90
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50);
		});
		expect(countLine(container)).toContain('"count":90');
		expect(showNextButton(container)?.textContent?.trim()).toBe(
			'series_create_show_next_label {"count":40}'
		);
		expect(showAllButton(container)?.textContent?.trim()).toBe(
			'series_create_show_all_label {"count":90}'
		);

		await toggleDate(container, '2026-09-05');
		await waitFor(() => {
			expect(countLine(container)).toContain('"count":89');
		});
		expect(previewDates(container)).toHaveLength(50);
		expect(previewDates(container)).toEqual(dailyIsoDates('2026-09-01', '2026-10-20'));
		expect(dateChip(container, '2026-09-05')?.getAttribute('aria-pressed')).toBe('false');
		expect(showAllButton(container)?.textContent?.trim()).toBe(
			'series_create_show_all_label {"count":89}'
		);
		expect(showNextButton(container)?.textContent?.trim()).toBe(
			'series_create_show_next_label {"count":40}'
		);

		await fireEvent.click(showAllButton(container) as HTMLElement);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(90);
		});
		expect(dateChip(container, '2026-09-05')?.getAttribute('aria-pressed')).toBe('false');
		expect(dateChip(container, '2026-11-20')?.getAttribute('aria-pressed')).toBe('true');
		expect(activeDates(container)).toHaveLength(89);
		expect(countLine(container)).toContain('"count":89');

		await toggleDate(container, '2026-11-20');
		await waitFor(() => {
			expect(dateChip(container, '2026-11-20')?.getAttribute('aria-pressed')).toBe('false');
		});
		expect(previewDates(container)).toHaveLength(90);
		expect(countLine(container)).toContain('"count":88');
		expect(showNextButton(container)).toBeNull();
		expect(showAllButton(container)).toBeNull();
	});

	it('review F1 — under a RESUMABLE stopped run show-all counts the REMAINDER, not the re-generated full set: a 153-date run that stops after 20 shows "show all 133" over a button that reveals exactly those 133 — the same number the resume notice carries', async () => {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 21) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Daily grind');
		await fill(container, 'series-create-duration', '90');
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2027-01-31');
		await selectValue(container, 'series-create-repeat', 'daily');
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50); // of 153
		});

		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});

		const REMAINING_133 = dailyIsoDates('2026-09-21', '2027-01-31');
		expect(REMAINING_133).toHaveLength(133);
		await waitFor(() => {
			expect(previewDates(container)).toEqual(REMAINING_133.slice(0, 50));
		});
		expect(q(container, 'series-create-preview-count')).toBeNull();
		expect(q(container, 'series-create-resume')?.textContent).toContain('"remaining":133');
		expect(q(container, 'series-create-resume')?.textContent).toContain('"total":153');

		expect(showAllButton(container)?.textContent?.trim()).toBe(
			'series_create_show_all_label {"count":133}'
		);
		expect(showNextButton(container)?.textContent?.trim()).toBe(
			'series_create_show_next_label {"count":50}'
		);

		await fireEvent.click(showAllButton(container) as HTMLElement);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(133);
		});
		expect(previewDates(container)).toEqual(REMAINING_133);
		expect(showNextButton(container)).toBeNull();
		expect(showAllButton(container)).toBeNull();
	});

	it('the reveal RESETS to the first 50 when the range changes (#241 point 5): show-all 153, then until → 2026-12-31 collapses to the new 122-set’s first 50, controls back with the NEW numbers', async () => {
		const container = await renderDaily('2026-09-01', '2027-01-31');
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50);
		});
		await fireEvent.click(showAllButton(container) as HTMLElement);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(153);
		});

		await fill(container, 'series-create-until', '2026-12-31');

		const FULL_122 = dailyIsoDates('2026-09-01', '2026-12-31');
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50);
		});
		expect(previewDates(container)).toEqual(FULL_122.slice(0, 50));
		expect(countLine(container)).toContain('"count":122');
		expect(showNextButton(container)?.textContent?.trim()).toBe(
			'series_create_show_next_label {"count":50}'
		);
		expect(showAllButton(container)?.textContent?.trim()).toBe(
			'series_create_show_all_label {"count":122}'
		);
	});

	it('the reset keys off the SET, not its length: a time-only edit (same 153 calendar days, new datetimes) collapses show-all back to the first 50 — a length-keyed or bare-counter reset fails exactly here', async () => {
		const container = await renderDaily('2026-09-01', '2027-01-31');
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50);
		});
		await fireEvent.click(showAllButton(container) as HTMLElement);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(153);
		});

		await fillTime(container, 'series-create-time', '20:00');

		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50);
		});
		expect(previewDates(container)).toEqual(FULL_153.slice(0, 50));
		expect(countLine(container)).toContain('"count":153');
		expect(showAllButton(container)?.textContent?.trim()).toBe(
			'series_create_show_all_label {"count":153}'
		);
	});

	it('submit is UNAFFECTED by the cap (#241 point 6): 60 generated, 50 shown → the series carries the true occurrence bounds and ALL 60 occurrences are created, ascending', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Daily grind');
		await fill(container, 'series-create-duration', '90');
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-10-30');
		await selectValue(container, 'series-create-repeat', 'daily');
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(50); // of 60
		});

		await submit(container);
		await settleSeriesRun(container);

		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		const input = lastSeriesInput();
		expect(input.startDate).toBe('2026-09-01');
		expect(input.endDate).toBe('2026-10-30');

		expect(createEventMock).toHaveBeenCalledTimes(60);
		const expectedInstants = dailyIsoDates('2026-09-01', '2026-10-30').map(
			(iso) => `${iso}T${iso >= '2026-10-25' ? '17' : '16'}:00:00.000Z`
		);
		expect(
			createEventMock.mock.calls.map((c) => (c[1] as CreateEventInput).startDatetime)
		).toEqual(expectedInstants);
	});
});

describe('#241 — locale files: series_create_show_next_label / series_create_show_all_label', () => {
	const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
	const REVEAL_KEYS = ['series_create_show_next_label', 'series_create_show_all_label'] as const;

	function messageFile(locale: string): MessageFile {
		return JSON.parse(
			readFileSync(resolvePath(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as MessageFile;
	}

	it.each(LOCALES)(
		'%s: both keys carry {count}, and never bake the cap into the copy',
		(locale) => {
			const file = messageFile(locale);
			for (const key of REVEAL_KEYS) {
				for (const pattern of messagePatterns(file[key])) {
					expect(pattern, `${key} in ${locale} must parameterise the count`).toContain(
						'{count}'
					);
					expect(pattern, `${key} in ${locale} must never hard-code 50`).not.toMatch(/50/);
				}
			}
		}
	);

	it('et/en carry the PO-ruled copy VERBATIM (partitive intact in both Estonian strings)', () => {
		const en = messageFile('en');
		const et = messageFile('et');
		expect(en.series_create_show_next_label).toBe('Show next {count} events');
		expect(en.series_create_show_all_label).toBe('Show all {count} events');
		expect(et.series_create_show_next_label).toBe('Näita järgmisi {count} sündmust');
		expect(et.series_create_show_all_label).toBe('Näita kõiki {count} sündmust');
	});
});

// (*MVOX:Tallis*) (*MVOX:Palestrina*)
