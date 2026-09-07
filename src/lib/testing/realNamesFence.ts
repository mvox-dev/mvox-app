// src/lib/testing/realNamesFence.ts
//
// #269 review F1/F2 — the shared wire fixture behind the SCOPE FENCE specs.
//
// Henry's 2026-09-06 scope ruling fences the real-names overlay to the /roster
// page: "Every other place a member's name appears — pickers, chips, the agenda,
// event pages, the library — keeps profile names, and this slice must not
// quietly extend to them." Three production routes consume the SHARED
// `loadRoster` (the agenda, the event detail page and the admin roles page), so
// each needs a boundary spec proving it stays on profile names.
//
// The point of THIS module is that those specs are not vacuous. A fence test
// that simply forgets to stub `_type.string=database` proves nothing: with no
// visible database entity `resolveDatabaseEntityId` answers null,
// `readRosterNamesSetting` throws, and the overlay degrades to off all by
// itself — the test would pass on a tree that leaks. So this wire:
//
//   - RESOLVES the database entity (`_type.string=database` → DB_ENTITY_ID),
//   - answers the toggle read with `roster_show_real_names: true`,
//   - serves NAMED `admin_member_record`s for every member,
//
// i.e. it is the exact wire on which the overlay WOULD fire. A route that
// renders `PROFILE_NAMES` on it, and issues no `admin_member_record` request, is
// genuinely fenced.
import { vi } from 'vitest';

export const DB_ENTITY_ID = 'db-ent-fence';

/** memberId → the person id whose profile carries the displayed name. */
export const MEMBER_PERSON: Record<string, string> = {
	m1: 'person-p',
	m2: 'person-q'
};

/** What every out-of-scope surface MUST render. */
export const PROFILE_NAMES = {
	m1: 'Alice Alto',
	m2: 'Berta Bass'
} as const;

/** What the overlay would render if it leaked past /roster. Deliberately
 *  unlike the profile names in both spelling and sort order. */
export const REAL_NAMES = {
	m1: 'Zoe Zeta',
	m2: 'Aaron Aardvark'
} as const;

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

/**
 * Stub `globalThis.fetch` with the "overlay would fire" wire described above and
 * return the mock so a spec can assert on the request URLs. Call
 * `vi.unstubAllGlobals()` in `afterEach`.
 */
export function realNamesWire(): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);

		// The overlay's bulk read — served, so a leaking tree gets real names and
		// the fence assertion fails LOUDLY rather than on an empty response.
		if (url.includes('_type.string=admin_member_record')) {
			return json({
				entities: Object.entries(MEMBER_PERSON).map(([memberId, personId]) => ({
					_id: `rec-${memberId}`,
					person: [{ reference: personId }],
					name: [{ string: REAL_NAMES[memberId as keyof typeof REAL_NAMES] }]
				}))
			});
		}

		// The collective identity — resolved, so `readRosterNamesSetting` can
		// legitimately succeed (see module header: without this the fence is vacuous).
		if (url.includes('_type.string=database')) {
			return json({ entities: [{ _id: DB_ENTITY_ID }] });
		}
		if (url.includes(`entity/${DB_ENTITY_ID}`) && url.includes('roster_show_real_names')) {
			return json({
				entity: {
					_id: DB_ENTITY_ID,
					roster_show_real_names: [{ _id: 'v-toggle', boolean: true }]
				}
			});
		}

		if (url.includes('_type.string=member')) {
			return json({
				entities: Object.entries(MEMBER_PERSON).map(([memberId, personId]) => ({
					_id: memberId,
					person: [{ reference: personId }],
					_parent: [
						{
							_id: `pv-${memberId}`,
							reference: DB_ENTITY_ID,
							property_type: '_parent',
							string: 'Collective',
							entity_type: 'database'
						}
					]
				}))
			});
		}

		if (url.includes('_type.string=profile')) {
			const match = /_parent\.reference=([^&]+)/.exec(url);
			const personId = match ? decodeURIComponent(match[1]) : '';
			const memberId = Object.keys(MEMBER_PERSON).find((id) => MEMBER_PERSON[id] === personId);
			if (!memberId) return json({ entities: [] });
			return json({
				entities: [
					{
						_id: `prof-${memberId}`,
						name: [{ string: PROFILE_NAMES[memberId as keyof typeof PROFILE_NAMES] }],
						email: [{ string: `${memberId}@example.com` }],
						_sharing: [{ string: 'domain' }]
					}
				]
			});
		}

		return json({ entities: [] });
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

// (*MVOX:Palestrina* — #269 review F1/F2: scope-fence wire fixture)
