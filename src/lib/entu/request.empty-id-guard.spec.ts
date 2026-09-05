// #258 RED — PART 2, the choke-point guard. Every Entu call in the codebase
// funnels through entuFetch -> entuUrl with an already-composed pathAndQuery.
// A path whose entity segment ends with a trailing slash and NO id — 'entity/'
// terminal, or 'entity/?query' — is NEVER legitimate: entu-api resolves it to
// the entity LIST route, which answers 200 with a plausible-looking body, so an
// empty id becomes a silent wrong answer instead of an error. That shape shipped
// twice (#255 B2 fail-open rights read; library blank copy names/chains from
// '' lending refs). Gama verified every trailing-'entity/' occurrence in this
// repo lives in spec files asserting URLs — zero production sites — so the
// guard breaks nothing and converts the 44 traced-safe call sites into
// structurally-safe ones, and catches Finn's three unverifiable assumptions
// (sectionActions/_parent, inviteData/session.ts cast, eventDetail falsy-only
// guard) at the point of use whether or not they hold.
//
// Pinned here: the request layer THROWS loudly on such a path — an Error whose
// message names the empty-id composition — BEFORE any network call. Whether the
// throw lives in entuUrl or entuFetch is GREEN's pick; entuFetch is exercised
// as the outermost seam either way. Legitimate paths (single-entity reads and
// the INTENTIONAL list query 'entity?...' without a trailing slash) are pinned
// byte-unaffected.
import { describe, expect, it, vi } from 'vitest';
import { entuUrl, entuFetch } from './request';
import { listDeactivateBlockers } from '$lib/roster/memberLifecycle';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

/**
 * Runs entuFetch and captures EITHER a synchronous throw or an async rejection
 * (the guard's placement — entuUrl vs entuFetch — decides which; both count as
 * "before any network call" as long as fetchImpl was never invoked).
 */
async function captureEntuFetch(pathAndQuery: string) {
	const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
	let err: unknown = null;
	try {
		await entuFetch('polyphony', pathAndQuery, 'jwt-abc', {}, fetchImpl);
	} catch (e) {
		err = e;
	}
	return { err, fetchImpl };
}

describe('#258 part 2 — empty-id entity path is refused at the choke point', () => {
	it("entuFetch throws on terminal 'entity/' (bare) — loudly, naming the empty-id composition, with NO network call", async () => {
		const { err, fetchImpl } = await captureEntuFetch('entity/');
		expect(err).toBeInstanceOf(Error);
		// "typed/recognizable": the message must name the class of failure — an
		// empty entity id composed into the path — not a generic bad-input line.
		expect(String((err as Error).message)).toMatch(/empty/i);
		expect(String((err as Error).message)).toMatch(/entity/i);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("entuFetch throws on 'entity/?props=...' (empty id + query) — same guard, NO network call", async () => {
		const { err, fetchImpl } = await captureEntuFetch('entity/?props=name,copy_number');
		expect(err).toBeInstanceOf(Error);
		expect(String((err as Error).message)).toMatch(/empty/i);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("entuFetch throws on '/entity/' with the tolerated leading slash too", async () => {
		const { err, fetchImpl } = await captureEntuFetch('/entity/');
		expect(err).toBeInstanceOf(Error);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("entuUrl (the composition point) never RETURNS a URL addressing 'entity/' with no id", () => {
		// Whichever function carries the guard, no caller may ever OBTAIN a
		// composed empty-id URL: entuUrl either throws or is unreachable with
		// this input — it must not hand back '.../entity/' as a string.
		for (const bad of ['entity/', 'entity/?props=person', '/entity/?limit=1']) {
			let composed: string | null = null;
			try {
				composed = entuUrl('polyphony', bad);
			} catch {
				continue; // throwing is the expected shape
			}
			expect.fail(`entuUrl('polyphony', '${bad}') returned '${composed}' instead of throwing`);
		}
	});
});

describe('#258 part 2 — negative pins: legitimate paths are byte-unaffected', () => {
	it('single-entity read passes through untouched', async () => {
		const { err, fetchImpl } = await captureEntuFetch('entity/abc123');
		expect(err).toBeNull();
		expect(String(fetchImpl.mock.calls[0][0])).toBe('https://api.entu-test.invalid/polyphony/entity/abc123');
	});

	it('single-entity read with props passes through untouched', async () => {
		const { err, fetchImpl } = await captureEntuFetch('entity/abc123?props=name,copy_number');
		expect(err).toBeNull();
		expect(String(fetchImpl.mock.calls[0][0])).toBe(
			'https://api.entu-test.invalid/polyphony/entity/abc123?props=name,copy_number'
		);
	});

	it("the INTENTIONAL list query — 'entity?...' with NO trailing slash — passes through untouched", async () => {
		const { err, fetchImpl } = await captureEntuFetch('entity?_type.string=member&limit=1');
		expect(err).toBeNull();
		expect(String(fetchImpl.mock.calls[0][0])).toBe(
			'https://api.entu-test.invalid/polyphony/entity?_type.string=member&limit=1'
		);
	});

	it("bare 'entity' (no query, no slash) passes through untouched — existing pin kept", () => {
		expect(entuUrl('polyphony', 'entity')).toBe('https://api.entu-test.invalid/polyphony/entity');
	});

	it('non-entity paths (property/...) pass through untouched', async () => {
		const { err, fetchImpl } = await captureEntuFetch('property/prop-1');
		expect(err).toBeNull();
		expect(String(fetchImpl.mock.calls[0][0])).toBe('https://api.entu-test.invalid/polyphony/property/prop-1');
	});
});

// #255's own guard predates this issue and STAYS — the choke point is a SECOND
// net beneath it, not a replacement. Both nets must trip independently.
describe('#258 cross-check — #255 first net and #258 second net trip independently', () => {
	const cfg: EntuCfg = { db: 'polyphony', token: 'jwt' };

	it("first net: listDeactivateBlockers('' dbEntityId) still refuses outright, before any fetch (#255 r3 F1 — unchanged)", async () => {
		const fetchImpl = vi.fn();
		await expect(listDeactivateBlockers(cfg, 'person-1', '', null, fetchImpl)).rejects.toThrow(
			/no database entity id/
		);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('second net: even a caller that BYPASSES the #255 guard cannot reach the network with the empty-id rights path', async () => {
		// The exact path #255's fail-open composed: entity/${''}?props=_owner,_editor
		const { err, fetchImpl } = await captureEntuFetch('entity/?props=_owner,_editor');
		expect(err).toBeInstanceOf(Error);
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis* — RED spec)
