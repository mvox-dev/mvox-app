import { describe, expect, it, vi } from 'vitest';
import { checkCollectiveMarker, MVOX_COLLECTIVE_MARKER_TYPE } from './marker';

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

describe('checkCollectiveMarker', () => {
	it('issues ONE cheap marker query per db under the user token', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ count: 0, entities: [] }));
		await checkCollectiveMarker('polyphony', 'p1', 'jwt-abc', fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe(
			`https://api.entu-test.invalid/polyphony/entity?_type.string=${MVOX_COLLECTIVE_MARKER_TYPE}&props=name&limit=1`
		);
		expect(init.headers.Authorization).toBe('Bearer jwt-abc');
	});

	it('marked db → collective (with display name + personId)', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				jsonResponse({ count: 1, entities: [{ _id: 'm1', name: [{ string: 'EFK' }] }] })
			);
		const result = await checkCollectiveMarker('polyphony', 'p1', 't', fetchImpl);
		expect(result).toEqual({ db: 'polyphony', kind: 'collective', name: 'EFK', personId: 'p1' });
	});

	it('marked db without a name → falls back to the db name as label', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ count: 1, entities: [{ _id: 'm1' }] }));
		const result = await checkCollectiveMarker('polyphony', 'p1', 't', fetchImpl);
		expect(result).toEqual({ db: 'polyphony', kind: 'collective', name: 'polyphony', personId: 'p1' });
	});

	it('unmarked db (count 0) → not-collective', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ count: 0, entities: [] }));
		const result = await checkCollectiveMarker('esmuuseum', 'p2', 't', fetchImpl);
		expect(result).toEqual({ db: 'esmuuseum', kind: 'not-collective' });
	});

	it('non-2xx → error (NOT silently not-collective)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 500));
		const result = await checkCollectiveMarker('polyphony', 'p1', 't', fetchImpl);
		expect(result).toMatchObject({ db: 'polyphony', kind: 'error' });
	});

	it('network throw → error', async () => {
		const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
		const result = await checkCollectiveMarker('polyphony', 'p1', 't', fetchImpl);
		expect(result).toMatchObject({ db: 'polyphony', kind: 'error', reason: 'offline' });
	});
});
