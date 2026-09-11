// #268 GREEN — the admin_member_record data layer.
//
// Contract (#268 body + release comment, both rulings folded in):
//
//   READ — `loadMemberRecord` issues ONE query
//     entity?_type.string=admin_member_record&person.reference={personId}
//       &props=name,phone,email,birthdate&limit=10
//   against cfg.db. Db-scoped per call: the record's required `database` parent
//   plus the single-collective-per-db invariant make a `_parent` filter
//   redundant — the same reasoning `listActiveMembers` documents for its own
//   unscoped query. 0 results → the create path; 1 → the update path; >1 is
//   DAMAGED DATA (#264): surface loudly, refuse to guess, write NOTHING,
//   self-repair NOTHING.
//
//   CREATE — lazy, on first save (Mihkel ruling 2026-09-06). SHARING MECHANICS,
//   stated precisely so "sharing explicit on every property" reads correctly:
//   the per-PROPERTY tiers (name→domain; phone/email/birthdate→private) are
//   SCHEMA-LEVEL prop-def buckets, provisioned once in #265 — an instance write
//   does not carry them and must not try to. What THIS layer asserts explicitly
//   is the record's own entity-level `_sharing: 'domain'` in the create POST —
//   never omitted, never left to inherit (Mihkel's standing instruction).
//   Optional fields ride along ONLY when non-empty.
//
//   UPDATE — `replaceEntityProperty` per changed field (atomic overwrite,
//   #264): never a bare POST append, never a property DELETE on the normal
//   path. Fields are written in the FIXED order name → phone → email →
//   birthdate so a partial failure is deterministic to describe.
//
//   BIRTHDATE — the property is `datetime` (no date-only wire type in this
//   schema) but the MEANING is a calendar date. Write: the date input's
//   YYYY-MM-DD becomes `<date>T00:00:00.000Z` (UTC-midnight anchor). Read:
//   the stored string's date part via split('T')[0] — NEVER `new Date()` +
//   local-time getters (the #207 no-day-shift idiom; a date of birth reading a
//   day early in another timezone is a real defect, not cosmetic).
//
//   CLEARING (#268 review F1) — clearing a `string` field (name/phone/email)
//   is an overwrite to '' : '' is a legal string, so the atomic path holds.
//   Clearing BIRTHDATE is not: a `datetime` slot has no empty value, and
//   `datetime: ''` would be stored verbatim as a JS string (entu-api's
//   coercion is guarded by a falsy check and its validator only demands SOME
//   non-meta key, so the POST answers 200 on type-invalid data). A cleared
//   date of birth therefore goes through `clearEntityProperty` — the
//   documented REMOVAL path — and never through an overwrite.
//
//   PRIVACY — real member PII on a live pilot (crede). Thrown messages and any
//   logging carry STATIC strings + status codes ONLY, never a field value.

import { entuFetch } from '$lib/entu/request';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';
import { replaceEntityProperty, clearEntityProperty } from '$lib/entu/replaceProperty';

/** One member's admin_member_record as read back for the editor. `birthdate`
 *  is the DATE PART only (YYYY-MM-DD, '' when unset) — split('T')[0] of the
 *  stored datetime, never a Date-object round-trip. */
export interface MemberRecord {
	_id: string;
	name: string;
	phone: string;
	email: string;
	birthdate: string;
	/** #285 — Estonian isikukood. Plain string on the wire (like phone — NOT
	 *  birthdate's datetime anchor); '' when unset. Private-tier prop-def
	 *  (#282, ordinal 6, in DEFAULT_REDACT_FIELDS). */
	id_code: string;
}

/** Check-then-create/load result. 'damaged' = more than one record found —
 *  #264: surface loudly, never guess, never self-repair. */
export type MemberRecordLookup =
	| { state: 'none' }
	| { state: 'one'; record: MemberRecord }
	| { state: 'damaged'; count: number };

export interface CreateMemberRecordInput {
	/** The collective's database entity id — the record's required `_parent`. */
	dbEntityId: string;
	personId: string;
	name: string;
	/** Optional fields: sent ONLY when non-empty. `birthdate` is YYYY-MM-DD. */
	phone?: string;
	email?: string;
	birthdate?: string;
	/** #285 — isikukood, checksum-validated by the PAGE before it ever reaches
	 *  this layer (idCode.ts); rides along only when non-empty, like the rest. */
	id_code?: string;
}

/**
 * A save that did not fully land. `landedFields` names what WAS written before
 * the failure ([] when nothing landed), `failedField` the one that failed —
 * so the page can say exactly what landed (#253 lying-banner class). The
 * message is STATIC: field NAMES may appear, field VALUES never.
 */
export class MemberRecordPartialSaveError extends Error {
	landedFields: string[];
	failedField: string;
	constructor(landedFields: string[], failedField: string) {
		super('member record save incomplete');
		this.name = 'MemberRecordPartialSaveError';
		this.landedFields = landedFields;
		this.failedField = failedField;
	}
}

/** YYYY-MM-DD → the UTC-midnight-anchored wire datetime. Pure string work — no
 *  `Date` object ever constructed, so no local-timezone getter can shift the
 *  day (#207). */
export function birthdateToWire(date: string): string {
	return `${date}T00:00:00.000Z`;
}

/** Wire datetime → YYYY-MM-DD via split('T')[0]. Pure string work — no Date. */
export function birthdateFromWire(wire: string): string {
	return wire.split('T')[0];
}

export async function loadMemberRecord(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<MemberRecordLookup> {
	// #321 — scoped by person.reference, not _parent: admin_member_record's
	// required `database` parent plus the single-collective-per-db invariant
	// make a _parent filter redundant (same reasoning listActiveMembers
	// documents for its own unscoped query). A person has at most one
	// admin_member_record; limit=10 is an explicit, ample bound.
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=admin_member_record&person.reference=${encodeURIComponent(personId)}&props=name,phone,email,birthdate,id_code&limit=10`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`loadMemberRecord failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{
			_id: string;
			name?: Array<{ string: string }>;
			phone?: Array<{ string: string }>;
			email?: Array<{ string: string }>;
			birthdate?: Array<{ datetime: string }>;
			id_code?: Array<{ string: string }>;
		}>;
	};
	const entities = body.entities ?? [];
	if (entities.length === 0) return { state: 'none' };
	// #264 — damaged data: surface loudly, refuse to guess. NO write, NO
	// self-repair — this branch returns before anything below ever runs.
	if (entities.length > 1) return { state: 'damaged', count: entities.length };
	const raw = entities[0];
	const wireBirthdate = raw.birthdate?.[0]?.datetime;
	return {
		state: 'one',
		record: {
			_id: raw._id,
			name: raw.name?.[0]?.string ?? '',
			phone: raw.phone?.[0]?.string ?? '',
			email: raw.email?.[0]?.string ?? '',
			birthdate: wireBirthdate ? birthdateFromWire(wireBirthdate) : '',
			// #285 — string shape, like phone: mapped directly, no wire transform.
			id_code: raw.id_code?.[0]?.string ?? ''
		}
	};
}

export async function createMemberRecord(
	cfg: EntuCfg,
	input: CreateMemberRecordInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const typeId = await resolveTypeId(cfg, 'admin_member_record', fetchImpl);

	// SHARING MECHANICS (module header): the per-property tiers are schema-level
	// prop-defs (#265) — this write asserts only the record's own entity-level
	// `_sharing`, explicitly, never omitted.
	const props: Array<{ type: string; reference?: string; string?: string; datetime?: string }> = [
		{ type: '_type', reference: typeId },
		{ type: '_parent', reference: input.dbEntityId },
		{ type: '_sharing', string: 'domain' },
		{ type: 'person', reference: input.personId },
		{ type: 'name', string: input.name }
	];
	// Optional fields ride along ONLY when non-empty.
	if (input.phone) props.push({ type: 'phone', string: input.phone });
	if (input.email) props.push({ type: 'email', string: input.email });
	if (input.birthdate) props.push({ type: 'birthdate', datetime: birthdateToWire(input.birthdate) });
	// #285 — id_code rides LAST (FIELD_ORDER parity: a deterministic
	// partial-failure order needs a deterministic payload order too).
	if (input.id_code) props.push({ type: 'id_code', string: input.id_code });

	const res = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(props) },
		fetchImpl
	);
	if (!res.ok) throw new Error(`createMemberRecord failed: ${res.status}`);

	const body = (await res.json()) as { _id?: string };
	if (!body._id) {
		throw new Error('createMemberRecord: create response carried no _id (apparent-success trap)');
	}
	return body._id;
}

/** Fixed write order (module header): a partial failure is then always
 *  described the same deterministic way regardless of the caller's object key
 *  order. */
const FIELD_ORDER: Array<keyof Pick<MemberRecord, 'name' | 'phone' | 'email' | 'birthdate' | 'id_code'>> = [
	'name',
	'phone',
	'email',
	'birthdate',
	// #285 — string shape (like phone/email/name), LAST in the fixed order:
	// a deterministic partial-failure order needs id_code to land after every
	// pre-existing field, matching the create payload's own ordering.
	'id_code'
];

export async function updateMemberRecord(
	cfg: EntuCfg,
	recordId: string,
	changes: Partial<Pick<MemberRecord, 'name' | 'phone' | 'email' | 'birthdate' | 'id_code'>>,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const landed: string[] = [];
	for (const field of FIELD_ORDER) {
		if (!(field in changes)) continue;
		const value = changes[field] as string;
		try {
			if (field === 'birthdate') {
				// #268 review F1 — a CLEARED date of birth is a REMOVAL, never an
				// overwrite-to-empty. `datetime: ''` would land VERBATIM as a JS
				// string in a datetime slot (entu-api skips its `new Date()` coercion
				// on a falsy value and still answers 200), poisoning every later
				// formula / range-filter read of it — see clearEntityProperty's header
				// for the mechanism. The `string` fields below have no such problem:
				// '' is a legal string, so clearing one stays an overwrite.
				if (value === '') {
					await clearEntityProperty(cfg, recordId, 'birthdate', fetchImpl, 'updateMemberRecord');
				} else {
					await replaceEntityProperty(
						cfg,
						recordId,
						{ type: 'birthdate', datetime: birthdateToWire(value) },
						fetchImpl,
						'updateMemberRecord'
					);
				}
			} else {
				await replaceEntityProperty(
					cfg,
					recordId,
					{ type: field, string: value },
					fetchImpl,
					'updateMemberRecord'
				);
			}
			landed.push(field);
		} catch {
			// PRIVACY (module header): the thrown message names the FIELD only,
			// never the value being written.
			throw new MemberRecordPartialSaveError(landed, field);
		}
	}
}

// (*MVOX:Tallis* — #268 RED stubs + interface)
// (*MVOX:Josquin* — #268 GREEN implementation)
// (*MVOX:Tallis* — #285 RED interface extension: id_code)
// (*MVOX:Josquin* — #285 GREEN: id_code joins the projection, create payload
//  (last), FIELD_ORDER (last) — string wire shape like phone throughout)
