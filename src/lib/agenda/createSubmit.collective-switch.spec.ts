// A create that rejects after the collective switched reports no error to the new collective.
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);
vi.mock('$lib/collective/resolveDbEntityOrLog', () => ({
	resolveDbEntityOrLog: vi.fn(async () => 'org-efk')
}));

import { runSeasonCreate } from '$lib/agenda/seasonCreateSubmit';
import { runEventCreate, type EventCreateRun } from '$lib/agenda/eventCreateSubmit';
import type { Collective } from '$lib/collectives/types';

const A: Collective = { db: 'org-a', name: 'Org A', personId: 'p' };
const B: Collective = { db: 'org-b', name: 'Org B', personId: 'p' };

describe('create rejects after a collective switch', () => {
	it('season: no error is set', async () => {
		let selected: Collective = A;
		const setError = vi.fn();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await runSeasonCreate({
			form: { name: 'S', startDate: '2026-09-01', endDate: '2026-12-01', conductorIds: [] },
			selected: () => selected,
			seams: {
				createSeason: async () => {
					selected = B;
					throw new Error('entu down');
				}
			},
			setError,
			setStatus: vi.fn(),
			onclose: vi.fn(),
			loadForSelected: vi.fn()
		});
		expect(setError).not.toHaveBeenCalled();
	});

	it('event: no error is set', async () => {
		let selected: Collective = A;
		const setError = vi.fn();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const run: EventCreateRun = {
			form: {
				seasonId: 's1',
				type: 'rehearsal',
				startDatetime: '2026-09-15T16:00:00.000Z',
				durationMinutes: undefined,
				name: 'E',
				seriesId: '',
				seriesName: () => undefined,
				location: '',
				description: '',
				capacity: undefined,
				conductorIds: []
			},
			panelSeasonId: null,
			selected: () => selected,
			isMounted: () => true,
			showableUnderFilter: () => true,
			when: () => 'w',
			seams: {
				createEvent: async () => {
					selected = B;
					throw new Error('entu down');
				}
			},
			setError,
			setStatus: vi.fn(),
			onclose: vi.fn(),
			loadForSelected: vi.fn(),
			refreshSeasonManageLists: vi.fn(),
			surfaceCreatedEvent: vi.fn(),
			restoreFocus: vi.fn()
		};
		await runEventCreate(run);
		expect(setError).not.toHaveBeenCalled();
	});
});

// (*MVOX:Josquin*)
