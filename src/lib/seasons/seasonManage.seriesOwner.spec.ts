// The series list read carries each series' own _owner grant.
import { describe, expect, it, vi } from 'vitest';
import { listEventSeriesForSeason } from './seasonManage';
import { json, testCfg, type Call } from '$lib/testing/entuFetchKit';

const cfg = testCfg('sampledb');

function recordingFetch(route: (url: string) => Response | Promise<Response>) {
	const calls: Call[] = [];
	const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		const u = String(url);
		calls.push({ url: u, method: init?.method ?? 'GET' });
		return route(u);
	});
	return { impl: impl as unknown as typeof fetch, calls };
}

const seriesEntities = [
	{
		_id: 's1',
		name: [{ string: 'Monday rehearsals' }],
		_owner: [
			{ reference: 'person-a', string: 'Alice Owner' },
			{ reference: 'person-b', string: 'Bob Owner' }
		]
	},
	{ _id: 's2', name: [{ string: 'Sectionals' }] },
	{
		_id: 's3',
		name: [{ string: 'Concert week' }],
		_owner: [{ reference: 'person-c', string: 'Carol Owner' }, { string: 'no-ref junk' }]
	}
];

const seasonEvents = [
	{
		_id: 'e1',
		_parent: [
			{ reference: 'season1', entity_type: 'season' },
			{ reference: 's1', entity_type: 'event_series' }
		]
	}
];

function route(url: string): Response {
	if (url.includes('_type.string=event_series')) return json({ entities: seriesEntities });
	return json({ entities: seasonEvents });
}

describe('#400 — listEventSeriesForSeason reads each series’ own _owner', () => {
	it('asks Entu for the series’ _owner alongside name — the FULL series-list URL, pinned', async () => {
		const { impl, calls } = recordingFetch(route);
		await listEventSeriesForSeason(cfg, 'season1', impl);

		const seriesCall = calls.find((c) => c.url.includes('_type.string=event_series'));
		expect(seriesCall).toBeDefined();
		expect(seriesCall!.url).toMatch(
			/^https:\/\/api\.entu-test\.invalid\/sampledb\/entity\?_type\.string=event_series&_parent\.reference=season1&props=name,_owner(,_editor)?&limit=200$/
		);
	});

	it('SeriesListItem carries ownerIds — ids only from _owner[].reference, never the .string (ER-26); absent _owner → [], a no-reference value contributes nothing', async () => {
		const { impl } = recordingFetch(route);
		const result = await listEventSeriesForSeason(cfg, 'season1', impl);

		const byId = [...result.items].sort((a, b) => a.id.localeCompare(b.id));
		expect(byId).toEqual([
			{ id: 's1', name: 'Monday rehearsals', eventCount: 1, ownerIds: ['person-a', 'person-b'] },
			{ id: 's2', name: 'Sectionals', eventCount: 0, ownerIds: [] },
			{ id: 's3', name: 'Concert week', eventCount: 0, ownerIds: ['person-c'] }
		]);
		const flat = JSON.stringify(result);
		expect(flat).not.toContain('Alice Owner');
		expect(flat).not.toContain('Bob Owner');
		expect(flat).not.toContain('Carol Owner');
	});
});

// (*MVOX:Tallis*)
