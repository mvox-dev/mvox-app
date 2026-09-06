import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import { createSection } from './sectionActions';

// #264 item 6 RED — the explicit `_inheritrights: true` on section create
// (PO nod on mvox-app#264, 2026-09-06, WITH the mandatory spec-pin rider).
//
// WHY THIS PROPERTY EXISTS AND MUST NEVER BE "SIMPLIFIED" AWAY (the rider):
//
//   - Absence of `_inheritrights` is NOT inherit-by-default. At aggregate time
//     the rights cascade fires only on a strict `boolean === true` check
//     (entu-api aggregate.js:168) — ABSENT and explicit FALSE are behaviorally
//     identical. At propagation time (aggregate.js:512) an absent/false child
//     is silently skipped on every future parent-rights change — permanently,
//     with no self-healing.
//   - Live sections work today only because of entu-api's CREATE-TIME
//     AUTO-FILL (entity.js:296-325): it writes `_inheritrights: true` onto a
//     new entity when at least one `_parent` target carries `true` AT THAT
//     MOMENT. The mvox_crede db entity happens to be `true` (setupDatabase.js
//     bootstrap default) and sections happen to be created directly under it —
//     an UNASSERTED platform-bootstrap dependency. If either premise ever
//     breaks (a sub-section created under a not-yet-true parent, a db entity
//     without the bootstrap default), that section permanently and silently
//     loses the whole rights cascade.
//   - The explicit flag asserts the existing semantics (matches
//     inviteData.ts's member-create practice, :286-290) and changes NO live
//     behavior. Removing the "redundant" line would reopen the silent
//     dependency — which is exactly why this spec pins it with a FULL-shape
//     toEqual: the pin fails loudly on any body that drops it.

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
	resetTypeIdCache();
});

function makeFetchMock() {
	return vi.fn().mockImplementation((url: string) => {
		if (String(url).includes('_type.string=entity')) {
			return Promise.resolve(json({ entities: [{ _id: 'section-type-42' }] }));
		}
		if (String(url).includes('_type.string=database')) {
			return Promise.resolve(json({ entities: [{ _id: 'db-1' }] }));
		}
		return Promise.resolve(json({ _id: 'sec-new-1' }));
	});
}

function createBody(fetchImpl: ReturnType<typeof makeFetchMock>) {
	const calls = fetchImpl.mock.calls as Array<[string, RequestInit]>;
	const creates = calls.filter(
		([url]) =>
			!String(url).includes('_type.string=entity') && !String(url).includes('_type.string=database')
	);
	expect(creates, 'exactly one entity-create call').toHaveLength(1);
	return JSON.parse(String(creates[0][1].body)) as Array<{ type: string }>;
}

describe('createSection — explicit `_inheritrights: true` in the create body (#264 item 6, PO rider)', () => {
	it('sub-section create (parentId present): FULL body toEqual — _type + _parent + name + _sharing + `{ type: "_inheritrights", boolean: true }`, nothing else', async () => {
		const fetchImpl = makeFetchMock();
		await createSection(cfg, { name: 'Soprano 1', parentId: 'sec-sop' }, fetchImpl);

		const sorted = [...createBody(fetchImpl)].sort((a, b) => a.type.localeCompare(b.type));
		expect(sorted).toEqual(
			[
				{ type: '_type', reference: 'section-type-42' },
				{ type: '_parent', reference: 'sec-sop' },
				{ type: 'name', string: 'Soprano 1' },
				{ type: '_sharing', string: 'public' },
				{ type: '_inheritrights', boolean: true }
			].sort((a, b) => a.type.localeCompare(b.type))
		);
	});

	it('the flag is a BOOLEAN slot, exactly `boolean: true` — never `{ string: "true" }`, matching inviteData.ts member-create practice', async () => {
		const fetchImpl = makeFetchMock();
		await createSection(cfg, { name: 'Tenor', dbEntityId: 'db-1' }, fetchImpl);

		const flag = createBody(fetchImpl).find((p) => p.type === '_inheritrights');
		expect(flag).toEqual({ type: '_inheritrights', boolean: true });
	});
});

// (*MVOX:Tallis* — #264 item 6 RED, per the PO rider on the fold-in nod)
