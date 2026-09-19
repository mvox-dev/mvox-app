import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarkerResult } from './types';

// Control the per-db marker verdict directly — discovery's job is aggregation
// (filter + preserve order + collect errors), tested independently of the query.
const { markerMock } = vi.hoisted(() => ({ markerMock: vi.fn() }));
vi.mock('./marker', () => ({
	checkCollectiveMarker: markerMock,
	MVOX_COLLECTIVE_MARKER_TYPE: 'mvox_collective'
}));

import { discoverCollectives } from './discover';

afterEach(() => markerMock.mockReset());

// Shaped after a real 5-db token (2026-08-05): four unrelated Entu apps, one
// choral collective.
const FIVE_DB = { esmuuseum: 'e1', piletilevi: 'pl1', sampledb: 'p1', template: 't1', ww: 'w1' };

function verdicts(map: Record<string, MarkerResult['kind']>) {
	markerMock.mockImplementation(async (db: string, personId: string): Promise<MarkerResult> => {
		const kind = map[db] ?? 'not-collective';
		if (kind === 'collective') return { db, kind, name: db.toUpperCase(), personId };
		if (kind === 'error') return { db, kind, reason: 'boom' };
		return { db, kind: 'not-collective' };
	});
}

describe('discoverCollectives', () => {
	it('MANY: keeps only marked dbs, drops non-mvox, preserves order', async () => {
		verdicts({ sampledb: 'collective', ww: 'collective' });
		const { collectives, erroredDbs } = await discoverCollectives(FIVE_DB, 'tok');

		expect(collectives.map((c) => c.db)).toEqual(['sampledb', 'ww']);
		expect(collectives[0]).toEqual({ db: 'sampledb', name: 'SAMPLEDB', personId: 'p1' });
		expect(erroredDbs).toEqual([]);
		expect(markerMock).toHaveBeenCalledTimes(5); // one probe per token db
	});

	it("ONE: Mihkel's actual slice-1 case → exactly sampledb", async () => {
		verdicts({ sampledb: 'collective' });
		const { collectives } = await discoverCollectives(FIVE_DB, 'tok');
		expect(collectives.map((c) => c.db)).toEqual(['sampledb']);
	});

	it('ZERO: no marked dbs → empty, no errors', async () => {
		verdicts({});
		const { collectives, erroredDbs } = await discoverCollectives(FIVE_DB, 'tok');
		expect(collectives).toEqual([]);
		expect(erroredDbs).toEqual([]);
	});

	it('surfaces errored dbs separately (not misreported as absent)', async () => {
		verdicts({ sampledb: 'collective', ww: 'error', template: 'error' });
		const { collectives, erroredDbs } = await discoverCollectives(FIVE_DB, 'tok');
		expect(collectives.map((c) => c.db)).toEqual(['sampledb']);
		// erroredDbs preserves token (accounts) order: template precedes ww.
		expect(erroredDbs).toEqual(['template', 'ww']);
	});

	it('empty token accounts → no probes, empty result', async () => {
		const { collectives, erroredDbs } = await discoverCollectives({}, 'tok');
		expect(collectives).toEqual([]);
		expect(erroredDbs).toEqual([]);
		expect(markerMock).not.toHaveBeenCalled();
	});
});
