// listEventLocations flags a truncated location corpus from the server count.
import { describe, expect, it, vi } from 'vitest';
import { listEventLocations } from './eventDetail';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('testdb');

describe('listEventLocations — count-based truncation detection (#321)', () => {
	it('dedup + blank-dropping do NOT fabricate a truncation: count compares against RAW entities.length', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				count: 4,
				entities: [
					{ location: [{ string: 'St Mary’s Church' }] },
					{ location: [{ string: 'St Mary’s Church' }] },
					{ location: [{ string: 'Town Hall' }] },
					{ location: [] }
				]
			})
		);
		expect(await listEventLocations(cfg, fetchImpl)).toEqual({
			items: ['St Mary’s Church', 'Town Hall'],
			total: 4,
			truncated: false
		});
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=event');
		expect(url).toContain('props=location');
		expect(url).toContain('limit=1000');
		expect(url).not.toContain('skip=');
	});

	it('count > entities.length → the corpus is a partial sample: truncated true', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				count: 1500,
				entities: [{ location: [{ string: 'Town Hall' }] }, { location: [{ string: 'Rehearsal room' }] }]
			})
		);
		expect(await listEventLocations(cfg, fetchImpl)).toEqual({
			items: ['Town Hall', 'Rehearsal room'],
			total: 1500,
			truncated: true
		});
	});

	it('a body without count reads as complete', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({ entities: [{ location: [{ string: 'Town Hall' }] }] })
		);
		expect(await listEventLocations(cfg, fetchImpl)).toEqual({
			items: ['Town Hall'],
			total: 1,
			truncated: false
		});
	});
});

// (*MVOX:Tallis* — RED spec, #321)
