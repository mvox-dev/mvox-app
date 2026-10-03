import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/runtime.js', async () =>
	(await import('$lib/testing/moduleStubs')).runtimeModule()
);

import { groupByMonth, longDayFormatter, monthLabel, tallinnDayKey } from './timeFormat';

describe('Tallinn day helpers', () => {
	it('tallinnDayKey names the Tallinn calendar day, not the UTC one', () => {
		expect(tallinnDayKey(new Date('2026-03-31T22:30:00.000Z'))).toBe('2026-04-01');
	});

	it('longDayFormatter writes the Tallinn weekday and date in the app language', () => {
		expect(longDayFormatter().format(new Date('2026-03-31T22:30:00.000Z'))).toBe(
			'Wednesday, April 1'
		);
	});

	it('groupByMonth groups runs of the same month in order', () => {
		const dates = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-11-05'];
		expect(groupByMonth(dates, (d) => d)).toEqual([
			{ month: '2026-09', items: ['2026-09-29', '2026-09-30'] },
			{ month: '2026-10', items: ['2026-10-01'] },
			{ month: '2026-11', items: ['2026-11-05'] }
		]);
	});

	it('monthLabel writes the month and year', () => {
		expect(monthLabel('2026-10')).toBe('October 2026');
	});
});
