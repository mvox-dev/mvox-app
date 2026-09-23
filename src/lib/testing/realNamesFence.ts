// src/lib/testing/realNamesFence.ts
//
// The shared wire fixture behind the real-names ROUTE specs.
//
// HISTORY, named not deleted: this wire was built for #269's scope-FENCE specs
// under Henry's 2026-09-06 roster-only ruling ("Every other place a member's
// name appears — pickers, chips, the agenda, event pages, the library — keeps
// profile names"). Mihkel's #469 word (2026-09-23: "all places we are showing
// member names ... must obey the admin setting") SUPERSEDES that ruling, so the
// same route specs now pin the CONDITIONAL contract instead: toggle on → real
// names, toggle off → profile names. The wire therefore serves BOTH toggle
// states (`realNamesWire({ toggle: false })` for the off side).
//
// The point of THIS module is unchanged: those specs must not be vacuous. A
// spec that simply forgets to stub `_type.string=database` proves nothing: with
// no visible database entity `resolveDatabaseEntityId` answers null,
// `readRosterNamesSetting` throws, and the overlay degrades to off all by
// itself — the off side would pass on a broken tree. So this wire:
//
//   - RESOLVES the database entity (`_type.string=database` → DB_ENTITY_ID),
//   - answers the toggle read with `roster_show_real_names` (true by default,
//     false on request — the key is always PRESENT, so "off" is a read answer,
//     never a degrade),
//   - serves NAMED `admin_member_record`s for every member in BOTH states (an
//     off-toggle tree that still fetched records would render them and fail
//     LOUDLY rather than pass on an empty response),
//   - answers the person join-state read (the linked-identities projection)
//     as readable-absent (both members uninvited), so InviteSurface's person
//     select renders over this wire and its option labels can be pinned too.
import { vi } from 'vitest';

export const DB_ENTITY_ID = 'db-ent-fence';

/** memberId → the person id whose profile carries the displayed name. */
export const MEMBER_PERSON: Record<string, string> = {
	m1: 'person-p',
	m2: 'person-q'
};

/** What every surface MUST render with the toggle OFF. */
export const PROFILE_NAMES = {
	m1: 'Alice Alto',
	m2: 'Berta Bass'
} as const;

/** What every surface MUST render with the toggle ON (#469). Deliberately
 *  unlike the profile names in both spelling and sort order, so sorting by the
 *  displayed name stays observable. */
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
 * Stub `globalThis.fetch` with the wire described above and return the mock so
 * a spec can assert on the request URLs. `toggle` picks the
 * `roster_show_real_names` answer (default true — the on side). Call
 * `vi.unstubAllGlobals()` in `afterEach`.
 */
export function realNamesWire(opts: { toggle?: boolean } = {}): ReturnType<typeof vi.fn> {
	const toggle = opts.toggle ?? true;
	const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);

		// The overlay's bulk read — served in both toggle states (see header).
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
		// legitimately succeed (see module header: without this the off side is vacuous).
		if (url.includes('_type.string=database')) {
			return json({ entities: [{ _id: DB_ENTITY_ID }] });
		}
		if (url.includes(`entity/${DB_ENTITY_ID}`) && url.includes('roster_show_real_names')) {
			return json({
				entity: {
					_id: DB_ENTITY_ID,
					roster_show_real_names: [{ _id: 'v-toggle', boolean: toggle }]
				}
			});
		}

		// The person join-state read (listLinkedIdentities projects the identity
		// property plus `_viewer`): readable (`_viewer` present) with no
		// identities and no pending invites (the identity key simply absent) →
		// 'absent' → InviteSurface counts her uninvited. Matched on the
		// `_viewer` projection — no other roster-adjacent read carries it — so
		// this helper never names the invite-mint literal
		// (singleInviteMechanism.spec.ts scans every non-spec src/ file for it).
		if (url.includes('props=') && url.includes('_viewer')) {
			return json({
				entity: {
					_viewer: [{ _id: 'gr-fence', reference: 'p-reader', property_type: '_owner' }]
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
// (*MVOX:Tallis* — #469 RED: both toggle states + the join-state read; fence flipped to the conditional contract)
