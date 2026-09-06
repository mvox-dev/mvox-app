import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
// #165 RED — the contract module does not exist yet; GREEN creates it.
import { resolveCollectiveNameMarker, updateCollectiveName } from './collectiveName';

// #165 RED — the data layer behind the admin page's editable collective name.
//
// WHAT is edited: the `mvox_collective` MARKER entity's `name` property — the
// collective display name every member sees (collective picker, agenda header).
// NOT the database entity's `name` (that is the platform-level identifier and
// stays untouched by this module).
//
// CONTRACT (defined HERE, implemented in GREEN):
//
//   src/lib/collectives/collectiveName.ts (new)
//     export type CollectiveNameMarker = { markerId: string; name: string };
//     export async function resolveCollectiveNameMarker(
//       cfg: EntuCfg,
//       fetchImpl?: typeof fetch
//     ): Promise<CollectiveNameMarker | null>;
//     export async function updateCollectiveName(
//       cfg: EntuCfg,
//       markerId: string,
//       name: string,
//       fetchImpl?: typeof fetch
//     ): Promise<void>;
//
//   resolveCollectiveNameMarker — ONE cheap query, the same one the discovery
//   probe runs (marker.ts): `entity?_type.string=mvox_collective&props=name&limit=1`
//   scoped to cfg.db. First hit → { markerId: _id, name: trimmed display name
//   ('' when the property is absent — the page can still SET it) }. No hit →
//   null (the surface hides; a collective without its marker has nothing to
//   edit here). Non-2xx → throw (fail loud — a broken read must never render
//   as "no marker").
//
//   updateCollectiveName — the shared replaceEntityProperty choreography,
//   ATOMIC since #264 (the POST entry carries the first old value's `_id`;
//   Entu's native overwrite replaces it in the same call — a rejected POST
//   leaves the old name intact, so the marker can never go NAMELESS):
//     1. GET entity/{markerId}?props=name → the PRE-EXISTING value ids;
//     2. POST entity/{markerId} with exactly ONE value:
//        [{ _id: <first existing id>, type: 'name', string: name }]
//        (the `_id` is dropped when no value exists yet);
//     3. corrupted EXTRA ids only → DELETE property/{valueId}, strictly AFTER
//        the POST (a phantom double-value must not survive on the marker).
//   Non-2xx anywhere → throw (fail loud, no silent success).

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

function callUrls(fetchImpl: ReturnType<typeof vi.fn>): string[] {
	return fetchImpl.mock.calls.map((c) => String(c[0]));
}

function callMethods(fetchImpl: ReturnType<typeof vi.fn>): Array<string | undefined> {
	return fetchImpl.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method);
}

// ── resolveCollectiveNameMarker ──────────────────────────────────────────────

describe('resolveCollectiveNameMarker', () => {
	it('queries the marker type scoped to cfg.db and answers { markerId, name } off the first hit', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				count: 1,
				entities: [{ _id: 'marker-1', name: [{ _id: 'nv-1', string: '  Koor Polyphony  ' }] }]
			})
		);

		const result = await resolveCollectiveNameMarker(cfg, fetchImpl);

		// The display name is TRIMMED — the raw wire value may carry padding.
		expect(result).toEqual({ markerId: 'marker-1', name: 'Koor Polyphony' });

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const url = callUrls(fetchImpl)[0];
		expect(url).toContain('/testdb/entity?');
		expect(url).toContain('_type.string=mvox_collective');
		expect(url).toContain('props=name');
		expect(url).toContain('limit=1');
		// A read, never a write.
		const method = (fetchImpl.mock.calls[0][1] as RequestInit | undefined)?.method;
		expect(method === undefined || method === 'GET').toBe(true);
	});

	it("a marker WITHOUT a name property answers name: '' (the page can still SET it) — never the db slug", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(json({ count: 1, entities: [{ _id: 'marker-1' }] }));

		const result = await resolveCollectiveNameMarker(cfg, fetchImpl);
		// Unlike checkCollectiveMarker (a picker LABEL, where the db slug is a
		// serviceable fallback), an EDIT surface pre-filling 'testdb' would write
		// the slug back as the collective's display name on a blind confirm.
		expect(result).toEqual({ markerId: 'marker-1', name: '' });
	});

	it('no marker in the db → null', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ count: 0, entities: [] }));
		await expect(resolveCollectiveNameMarker(cfg, fetchImpl)).resolves.toBeNull();
	});

	it('non-2xx → throws (a broken read must never render as "no marker")', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ error: 'forbidden' }, 403));
		await expect(resolveCollectiveNameMarker(cfg, fetchImpl)).rejects.toThrow(/403/);
	});
});

// ── updateCollectiveName ─────────────────────────────────────────────────────

/** The marker's aggregated read: TWO pre-existing name values (a phantom
 *  double — both must die), so "delete only the first" fails visibly. */
function markerWithNames(): Response {
	return json({
		entity: {
			_id: 'marker-1',
			name: [
				{ _id: 'nv-old', string: 'Vana Nimi' },
				{ _id: 'nv-phantom', string: 'Phantom' }
			]
		}
	});
}

describe('updateCollectiveName', () => {
	it('#264 atomic overwrite: GET existing ids → ONE POST carrying the first old id; only the corrupted phantom is deleted, strictly after the POST', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(markerWithNames())
			.mockResolvedValue(json({}));

		await updateCollectiveName(cfg, 'marker-1', 'Uus Nimi', fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(3);
		const urls = callUrls(fetchImpl);
		const methods = callMethods(fetchImpl);

		// 1. the lookup — FIRST: the overwrite entry cannot be built blind
		expect(urls[0]).toContain('/testdb/entity/marker-1?props=name');
		expect(methods[0] === undefined || methods[0] === 'GET').toBe(true);

		// 2. the POST — the old value's `_id` rides the entry (Entu's native
		// overwrite replaces it in the same call). FULL body shape (toEqual,
		// never objectContaining) — exactly ONE value, no stray keys.
		expect(urls[1]).toContain('/testdb/entity/marker-1');
		expect(methods[1]).toBe('POST');
		const postBody = JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body));
		expect(postBody).toEqual([{ _id: 'nv-old', type: 'name', string: 'Uus Nimi' }]);

		// 3. only the corrupted EXTRA dies — property endpoint, never entity
		expect(urls[2]).toContain('/testdb/property/nv-phantom');
		expect(methods[2]).toBe('DELETE');
	});

	it('a failed POST throws and DELETES NOTHING — the old name must survive a failed write', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(markerWithNames())
			.mockResolvedValueOnce(json({ error: 'forbidden' }, 403));

		await expect(updateCollectiveName(cfg, 'marker-1', 'Uus Nimi', fetchImpl)).rejects.toThrow(
			/403/
		);
		// No DELETE went out: nv-old / nv-phantom still stand server-side.
		expect(callMethods(fetchImpl)).not.toContain('DELETE');
	});

	it('a failed lookup throws and POSTS NOTHING (writing blind would guarantee a phantom double-value)', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(json({ error: 'nope' }, 500));

		await expect(updateCollectiveName(cfg, 'marker-1', 'Uus Nimi', fetchImpl)).rejects.toThrow(
			/500/
		);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('a failed DELETE throws (the caller must know the replace only half-landed)', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(markerWithNames())
			.mockResolvedValueOnce(json({})) // POST ok
			.mockResolvedValueOnce(json({ error: 'gone wrong' }, 500));

		await expect(updateCollectiveName(cfg, 'marker-1', 'Uus Nimi', fetchImpl)).rejects.toThrow(
			/500/
		);
	});
});

// (*MVOX:Tallis* — #165 RED)
