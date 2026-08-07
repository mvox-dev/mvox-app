// T4.10 migration — move `name`/`email` VALUES off real persons into `profile`
// entities (issue mvox-dev/mvox-app#30, epic #21). This is the TESTED CORE: pure
// planning + a per-record move engine + a fail-loud ledger. The thin entrypoint
// (token exchange, DRY_RUN switch, invocation) lives one dir up and is NOT the
// unit-test surface.
//
// It imports the REAL data layer — `createProfile`/`saveProfileFields`/
// `listMyProfiles` from `$lib/profile/profileData` — so the `_inheritrights:false`
// literal + `resolveTypeId(cfg,'profile')` stay SOLE to profileData.ts (YELLOW-
// T4.4.1). The sole-create-path guard scans only `src/`, so a script under
// `scripts/` is outside it — the funnel is a human rule here, honored by construction
// (direct import, never a hand-rolled create) and PROVEN at runtime by the
// `t4-10-plan.spec.ts` funnel test (a `resolveTypeId` GET precedes the create POST).

import { entuFetch } from '$lib/entu/request';
import { type EntuCfg } from '$lib/seasons/entuSeasons';
import { createProfile, saveProfileFields, listMyProfiles } from '$lib/profile/profileData';

/**
 * The real (non-synthetic) persons IN MIGRATION SCOPE, frozen at build time as a
 * DRIFT TRIPWIRE — NOT the authoritative source. The live `_sharing !== 'public'`
 * filter (minus `EXCLUDED_TARGET_IDS`) is authoritative; `enumerateTargets` HALTs
 * loudly if the live-filtered-and-included id-set does not exactly equal this list
 * (a new real person, or a synthetic drifted off `public`). Ids: Mihkel's OAuth
 * person (domain), Test User (domain). The db-root/PO person is EXCLUDED — see
 * `EXCLUDED_TARGET_IDS`. See RECON A §1-2.
 */
export const EXPECTED_TARGET_IDS: readonly string[] = [
	'6a2fc05e4cd971291c5d5ddc',
	'6a097dcc90c8df7a1cc7d6dd'
];

/**
 * Persons that pass the `_sharing !== 'public'` selector but are deliberately OUT
 * of migration scope (#30). The db-root/PO person is private and structurally
 * different from a real member; Mihkel ruled to leave its name/email in place.
 * `enumerateTargets` filters these out BEFORE the drift check (so an excluded
 * non-public person is dropped, not flagged as drift) and HALTs if the exclusion
 * has gone stale — the id absent from the live non-public set, or no longer private.
 */
export const EXCLUDED_TARGET_IDS: readonly string[] = [
	'69bcfd8e9c031ab8e6ce8079' // db-root/PO
];

/** A real person selected for migration, with its raw field values + own tier. */
export type TargetPerson = {
	personId: string;
	name?: string;
	email?: string;
	/** The person entity's OWN `_sharing` — the source tier (never `public`; those are excluded). */
	sourceTier: 'domain' | 'private';
};

/**
 * One profile create = the fields of a person destined for the SAME target tier.
 * A person whose values land at two different tiers yields two groups (two profiles).
 */
export type MigrationGroup = {
	personId: string;
	tier: 'domain' | 'private';
	fields: { name?: string; email?: string };
	/** The `_owner` grant — always `[personId]` (the member owns her own profile). */
	ownerIds: string[];
	/**
	 * The source person's own `_sharing` — carried through only so the ledger can
	 * surface each field's source→target tier (e.g. the R1 private→domain name
	 * promotion). Optional so a hand-built group (tests) need not supply it.
	 */
	sourceTier?: 'domain' | 'private';
};

/** The per-record move phases, in execution order. */
export type Phase = 'create' | 'write-value' | 'verify-profile' | 'delete-person' | 'readback-person';

/**
 * `moved` = proven by BOTH a profile-present read-back AND a person-absent read-back.
 * `failed` = a per-record failure before any person delete (value still intact on person).
 * `duplicate-hazard` = create+populate+verify OK but the person delete failed → the value
 * now lives in BOTH person and profile (the T4.7 bulk hazard), operator-repairable.
 */
export type RecordStatus = 'moved' | 'failed' | 'duplicate-hazard';

/** One ledger entry per `(personId, field)` — the read-back granularity the ACs demand. */
export type LedgerEntry = {
	personId: string;
	field: 'name' | 'email';
	sourceTier: 'domain' | 'private';
	targetTier: 'domain' | 'private';
	profileId?: string;
	valueId?: string;
	status: RecordStatus;
	phase?: Phase;
	repairHint?: string;
	message?: string;
};

/** Error thrown by `deletePersonField` on a non-2xx DELETE — carries the value ids so
 * the caller can surface the exact duplicate-hazard value id per record. */
class PersonFieldDeleteError extends Error {
	constructor(
		message: string,
		readonly valueIds: string[],
		readonly failedId: string
	) {
		super(message);
		this.name = 'PersonFieldDeleteError';
	}
}

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * Step-0 enumeration (READ-ONLY). One-page GET of every person projecting
 * `_id,name,email,_sharing`; HALT if `count !== entities.length` (a truncated page
 * would silently drop targets); keep only `_sharing?.[0]?.string !== 'public'` (the
 * SOLE discriminator — excludes the 128 synthetic public-tier singers); drop the
 * `EXCLUDED_TARGET_IDS` (db-root/PO) BEFORE the drift check, HALTing if that
 * exclusion is stale; HALT if the remaining filtered id-set ≠ `EXPECTED_TARGET_IDS`
 * (drift tripwire, with the exact set diff).
 * Reads values off the entity `props=` projection, never a `?name.string=` filter
 * (the name/email prop-defs were deleted in T4.3 — only the raw values survive).
 */
export async function enumerateTargets(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<TargetPerson[]> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=person&props=_id,name,email,_sharing&limit=1000',
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`enumerateTargets: person census GET failed: ${res.status}`);
	const body = (await res.json()) as {
		count?: number;
		entities?: Array<{
			_id: string;
			name?: Array<{ string: string }>;
			email?: Array<{ string: string }>;
			_sharing?: Array<{ string: string }>;
		}>;
	};
	const entities = body.entities ?? [];

	// One-page HALT: a truncated page would silently drop in-scope targets.
	if (typeof body.count === 'number' && body.count !== entities.length) {
		throw new Error(
			`enumerateTargets: person census page truncated — server count=${body.count} but entities.length=${entities.length}; refuse to migrate a partial page`
		);
	}

	// Sole discriminator: exclude the 128 synthetic public-tier singers.
	const nonPublic = entities.filter((e) => e._sharing?.[0]?.string !== 'public');

	// #30 EXCLUSION (BEFORE the drift check): the db-root/PO person passes the
	// `_sharing !== 'public'` selector but is deliberately out of scope. Filter the
	// excluded ids out of the working set FIRST — otherwise an excluded-but-non-public
	// person would trip the drift tripwire as "unexpected" and HALT the whole run.
	// Guard the exclusion's premise fail-loud: each excluded id must still be present
	// AND still private, or the exclusion is stale and proceeding could migrate/skip
	// the wrong record.
	for (const id of EXCLUDED_TARGET_IDS) {
		const present = nonPublic.find((e) => e._id === id);
		if (!present) {
			throw new Error(
				`enumerateTargets: STALE EXCLUSION — excluded id ${id} is absent from the live non-public set; ` +
					`the account it was written for is gone or changed tier. Refuse to migrate until the exclusion list is re-verified.`
			);
		}
		const excludedTier = present._sharing?.[0]?.string;
		if (excludedTier !== 'private') {
			throw new Error(
				`enumerateTargets: STALE EXCLUSION — excluded id ${id} is present but its _sharing is ${JSON.stringify(excludedTier)}, not 'private'; ` +
					`the excluded account changed shape. Refuse to migrate until the exclusion is re-verified.`
			);
		}
	}
	const excludedSet = new Set(EXCLUDED_TARGET_IDS);
	const reals = nonPublic.filter((e) => !excludedSet.has(e._id));

	// Drift tripwire: the live-filtered-and-included id-set MUST exactly equal EXPECTED_TARGET_IDS.
	const filteredIds = reals.map((e) => e._id);
	const filteredSet = new Set(filteredIds);
	const expectedSet = new Set(EXPECTED_TARGET_IDS);
	const missing = EXPECTED_TARGET_IDS.filter((id) => !filteredSet.has(id));
	const unexpected = filteredIds.filter((id) => !expectedSet.has(id));
	if (missing.length > 0 || unexpected.length > 0) {
		throw new Error(
			`enumerateTargets: target-set DRIFT — refuse to migrate. ` +
				`expected [${EXPECTED_TARGET_IDS.join(', ')}]; ` +
				`got [${filteredIds.join(', ')}]; ` +
				`missing [${missing.join(', ')}]; unexpected [${unexpected.join(', ')}]`
		);
	}

	// Multi-value tripwire (HALT, zero writes): the engine captures only value[0]
	// (below) but `deletePersonField` deletes EVERY value-id of the field. A field
	// carrying >1 value would copy one value to the profile yet delete all of them,
	// SILENTLY destroying the uncopied values while the record still reads `moved`.
	// Refuse to migrate a multi-valued name/email — self-halt like the drift tripwire.
	for (const e of reals) {
		for (const field of ['name', 'email'] as const) {
			const count = e[field]?.length ?? 0;
			if (count > 1) {
				throw new Error(
					`enumerateTargets: person ${e._id} carries ${count} \`${field}\` values — refuse to migrate. ` +
						`The engine copies only value[0] into the profile but would DELETE every value-id from the person, ` +
						`silently destroying the uncopied value(s). Multi-valued name/email is not supported; resolve manually first.`
				);
			}
		}
	}

	return reals.map((e) => {
		const tier = e._sharing?.[0]?.string;
		if (tier !== 'domain' && tier !== 'private') {
			throw new Error(
				`enumerateTargets: person ${e._id} has non-migratable source tier ${JSON.stringify(tier)} (expected domain|private)`
			);
		}
		const name = e.name?.[0]?.string;
		const email = e.email?.[0]?.string;
		const t: TargetPerson = { personId: e._id, sourceTier: tier };
		if (name != null && name !== '') t.name = name;
		if (email != null && email !== '') t.email = email;
		return t;
	});
}

/**
 * PURE. Per person compute each field's target tier (name→'domain' ALWAYS — the
 * T4.8 completion gate reads only the domain-`_sharing` profile; email→sourceTier —
 * move-not-copy must never silently re-expose a private email), then group fields
 * destined for the SAME tier into one group (one profile). `ownerIds` is always
 * `[personId]`.
 */
export function buildPlan(targets: TargetPerson[]): MigrationGroup[] {
	const groups: MigrationGroup[] = [];
	for (const t of targets) {
		// Each present field → its target tier. name is ALWAYS domain; email preserves
		// the source tier.
		const perTier = new Map<'domain' | 'private', { name?: string; email?: string }>();
		const add = (tier: 'domain' | 'private', field: 'name' | 'email', value: string) => {
			const bucket = perTier.get(tier) ?? {};
			bucket[field] = value;
			perTier.set(tier, bucket);
		};
		if (t.name != null && t.name !== '') add('domain', 'name', t.name);
		if (t.email != null && t.email !== '') add(t.sourceTier, 'email', t.email);

		// Deterministic order: domain group before private group.
		for (const tier of ['domain', 'private'] as const) {
			const fields = perTier.get(tier);
			if (!fields) continue;
			groups.push({
				personId: t.personId,
				tier,
				fields,
				ownerIds: [t.personId],
				sourceTier: t.sourceTier
			});
		}
	}
	return groups;
}

/**
 * The per-record move engine. NEVER throws for a per-record failure — captures and
 * RETURNS one `LedgerEntry` per field in the group. Ordering invariant
 * (create-before-delete, AC4): create shell → populate values → read-back-PROVE the
 * profile holds each value → ONLY THEN delete each value from the person → read-back-
 * PROVE it is absent from the person. No DELETE is ever issued against an unproven
 * write. A create-ok/delete-fail is surfaced per-record as `duplicate-hazard`, named,
 * never aggregated.
 */
export async function migrateOneGroup(
	cfg: EntuCfg,
	group: MigrationGroup,
	fetchImpl: typeof fetch = fetch
): Promise<LedgerEntry[]> {
	const fields = (['name', 'email'] as const).filter(
		(f) => group.fields[f] != null && group.fields[f] !== ''
	);
	const sourceTier = group.sourceTier ?? group.tier;
	const base = (field: 'name' | 'email', extra: Partial<LedgerEntry>): LedgerEntry => ({
		personId: group.personId,
		field,
		sourceTier,
		targetTier: group.tier,
		...extra
	} as LedgerEntry);

	// 1) Create the profile SHELL via the sole-path createProfile (never hand-rolled).
	let profileId: string;
	try {
		profileId = await createProfile(
			cfg,
			{
				personId: group.personId,
				_inheritrights: false,
				_sharing: group.tier,
				ownerIds: group.ownerIds
			},
			fetchImpl
		);
	} catch (err) {
		// No profile created → person value fully intact → NO person DELETE.
		return fields.map((field) =>
			base(field, {
				status: 'failed',
				phase: 'create',
				message: errMsg(err),
				repairHint: 'no profile created; person value intact — retry'
			})
		);
	}

	// 2) Populate the shell with name/email (fresh shell → internal DELETE no-ops → pure add).
	try {
		await saveProfileFields(
			cfg,
			profileId,
			{ name: group.fields.name ?? '', email: group.fields.email ?? '' },
			fetchImpl
		);
	} catch (err) {
		// Orphan empty shell created, but the person value is still intact → NO DELETE.
		return fields.map((field) =>
			base(field, {
				status: 'failed',
				phase: 'write-value',
				profileId,
				message: errMsg(err),
				repairHint: `empty profile ${profileId} created; person value intact — retry populate or delete the empty shell`
			})
		);
	}

	// 3-5) Per field: verify-profile → delete-person → readback-person.
	const entries: LedgerEntry[] = [];
	for (const field of fields) {
		const expected = group.fields[field]!;

		// 3) Verify the profile HOLDS the value BEFORE any delete. Never delete against
		//    an unproven write.
		let present: boolean;
		try {
			present = await readbackProfileFieldPresent(cfg, group.personId, profileId, field, expected, fetchImpl);
		} catch (err) {
			entries.push(
				base(field, {
					status: 'failed',
					phase: 'verify-profile',
					profileId,
					message: errMsg(err),
					repairHint: `profile ${profileId} read-back GET failed; person value intact — verify by API`
				})
			);
			continue;
		}
		if (!present) {
			entries.push(
				base(field, {
					status: 'failed',
					phase: 'verify-profile',
					profileId,
					repairHint: `profile ${profileId} does not hold ${field}; person value intact — never delete against an unproven write`
				})
			);
			continue;
		}

		// 4) Delete the value from the person.
		let deletedIds: string[];
		try {
			deletedIds = await deletePersonField(cfg, group.personId, field, fetchImpl);
		} catch (err) {
			const valueId =
				err instanceof PersonFieldDeleteError ? err.failedId : undefined;
			entries.push(
				base(field, {
					status: 'duplicate-hazard',
					phase: 'delete-person',
					profileId,
					valueId,
					message: errMsg(err),
					repairHint: `DUPLICATE — ${field} value now in BOTH profile ${profileId} and person ${group.personId}; operator: DELETE property/${valueId ?? '<unknown>'} from person ${group.personId}`
				})
			);
			continue;
		}

		// 5) Read-back PROVE the value is now absent from the person (AC1).
		let absent: boolean;
		try {
			absent = await readbackPersonFieldAbsent(cfg, group.personId, field, fetchImpl);
		} catch (err) {
			entries.push(
				base(field, {
					status: 'failed',
					phase: 'readback-person',
					profileId,
					valueId: deletedIds[0],
					message: errMsg(err),
					repairHint: `person read-back GET failed after delete; verify ${field} on person ${group.personId} by API`
				})
			);
			continue;
		}
		if (!absent) {
			entries.push(
				base(field, {
					status: 'failed',
					phase: 'readback-person',
					profileId,
					valueId: deletedIds[0],
					repairHint: `delete acknowledged but ${field} still on person ${group.personId}; verify by API`
				})
			);
			continue;
		}

		entries.push(
			base(field, { status: 'moved', phase: 'readback-person', profileId, valueId: deletedIds[0] })
		);
	}
	return entries;
}

/**
 * Delete `field`'s value(s) from a PERSON — the migration's own delete helper, NOT
 * `saveProfileFields` (which re-adds after deleting). GETs the person's value-ids off
 * the entity `props=` projection, DELETEs each `property/{id}`, returns the deleted
 * ids. Fails loud (throws `PersonFieldDeleteError` naming field+id) on any non-2xx.
 */
export async function deletePersonField(
	cfg: EntuCfg,
	personId: string,
	field: 'name' | 'email',
	fetchImpl: typeof fetch = fetch
): Promise<string[]> {
	const ids = await getPersonFieldValueIds(cfg, personId, field, fetchImpl);
	const deleted: string[] = [];
	for (const id of ids) {
		const delRes = await entuFetch(cfg.db, `property/${id}`, cfg.token, { method: 'DELETE' }, fetchImpl);
		if (!delRes.ok) {
			throw new PersonFieldDeleteError(
				`deletePersonField: DELETE ${field} value ${id} on person ${personId} failed: ${delRes.status}`,
				ids,
				id
			);
		}
		deleted.push(id);
	}
	return deleted;
}

/** GET the raw value-ids of `field` off the person entity projection (no prop-def filter). */
async function getPersonFieldValueIds(
	cfg: EntuCfg,
	personId: string,
	field: 'name' | 'email',
	fetchImpl: typeof fetch = fetch
): Promise<string[]> {
	const res = await entuFetch(cfg.db, `entity/${personId}?props=name,email`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`getPersonFieldValueIds: GET person ${personId} failed: ${res.status}`);
	const body = (await res.json()) as {
		entity?: { name?: Array<{ _id: string }>; email?: Array<{ _id: string }> };
	};
	const ids = (body.entity?.[field] ?? []).map((v) => v._id);
	// Belt for the live re-derivation (enumerateTargets HALTs on multi-value up front,
	// but the value set is re-read here at delete time): only value[0] was copied to the
	// profile, so deleting >1 value-id would destroy the uncopied value(s). Refuse loudly
	// rather than delete unmigrated values — the caller surfaces it per-record.
	if (ids.length > 1) {
		throw new Error(
			`getPersonFieldValueIds: person ${personId} carries ${ids.length} \`${field}\` value-ids [${ids.join(', ')}] — ` +
				`refuse to delete: only value[0] was copied to the profile; deleting all would destroy the uncopied value(s)`
		);
	}
	return ids;
}

/** Re-GET the person; resolves `true` iff `field` is now absent/empty (AC1 read-back). */
export async function readbackPersonFieldAbsent(
	cfg: EntuCfg,
	personId: string,
	field: 'name' | 'email',
	fetchImpl: typeof fetch = fetch
): Promise<boolean> {
	const ids = await getPersonFieldValueIds(cfg, personId, field, fetchImpl);
	return ids.length === 0;
}

/** Via `listMyProfiles`; resolves `true` iff `profileId` holds a non-empty `field` === `expected`. */
export async function readbackProfileFieldPresent(
	cfg: EntuCfg,
	personId: string,
	profileId: string,
	field: 'name' | 'email',
	expected: string,
	fetchImpl: typeof fetch = fetch
): Promise<boolean> {
	const profiles = await listMyProfiles(cfg, personId, fetchImpl);
	const created = profiles.find((p) => p._id === profileId);
	if (!created) return false;
	const value = created[field];
	return value !== '' && value === expected;
}

/** Mask an email so the raw local-part never prints in the dry-run plan. */
function maskEmail(email: string): string {
	const at = email.indexOf('@');
	if (at <= 0) return '***';
	return `${email[0]}***${email.slice(at)}`;
}

/**
 * PURE dry-run render (no I/O). One human-readable block per group: WOULD CREATE
 * profile `_sharing=<tier> _parent=<personId> ownerIds=[<personId>]`; WOULD POPULATE
 * `{name?, email(masked)?}`; WOULD DELETE from person `<field(s)>`; WOULD READ-BACK
 * both sides — plus each field's source→target tier (surfacing the R1 private→domain
 * name promotion). Email is masked. This printout IS the operator's per-run verify surface.
 */
export function renderPlan(groups: MigrationGroup[]): string {
	const lines: string[] = [];
	lines.push('T4.10 migration DRY-RUN plan — name/email VALUES → profile entities (NO writes issued)');
	lines.push(`${groups.length} profile create(s) planned:`);
	lines.push('');
	for (const g of groups) {
		const src = g.sourceTier ?? g.tier;
		lines.push(`── person ${g.personId}`);
		lines.push(`   WOULD CREATE profile _sharing=${g.tier} _parent=${g.personId} ownerIds=[${g.ownerIds.join(', ')}]`);
		const populated: string[] = [];
		if (g.fields.name != null && g.fields.name !== '') {
			populated.push(`name="${g.fields.name}"`);
			lines.push(`   field name: source ${src} → target ${g.tier}${src !== g.tier ? '  ⚠ VISIBILITY CHANGE' : ''}`);
		}
		if (g.fields.email != null && g.fields.email !== '') {
			populated.push(`email=${maskEmail(g.fields.email)}`);
			lines.push(`   field email: source ${src} → target ${g.tier}${src !== g.tier ? '  ⚠ VISIBILITY CHANGE' : ''}`);
		}
		lines.push(`   WOULD POPULATE {${populated.join(', ')}}`);
		lines.push(`   WOULD DELETE from person ${g.personId}: ${Object.keys(g.fields).join(', ')} (value ids resolved live)`);
		lines.push(`   WOULD READ-BACK both sides (profile-present + person-absent) per field`);
		lines.push('');
	}
	return lines.join('\n');
}

/**
 * Collects per-record outcomes and reports them LOUDLY, per-record — NO aggregate
 * "done" ever substitutes. `printReport` prints one line per `(person,field)`; if any
 * entry is not `moved` it prints a MIGRATION INCOMPLETE block listing each id+field+
 * phase+repairHint. `hasFailures()` is true iff any entry's status !== 'moved'.
 */
export class MigrationLedger {
	private entries: LedgerEntry[] = [];

	record(entry: LedgerEntry): void {
		this.entries.push(entry);
	}

	all(): readonly LedgerEntry[] {
		return this.entries;
	}

	hasFailures(): boolean {
		return this.entries.some((e) => e.status !== 'moved');
	}

	printReport(): void {
		// One line per record — never an aggregate "done" that masks a per-record failure.
		for (const e of this.entries) {
			const line =
				`${e.status.toUpperCase()} ${e.personId}.${e.field} ` +
				`${e.sourceTier}→${e.targetTier}` +
				(e.phase ? ` [${e.phase}]` : '') +
				(e.profileId ? ` profile=${e.profileId}` : '') +
				(e.valueId ? ` valueId=${e.valueId}` : '') +
				(e.repairHint ? ` — ${e.repairHint}` : '');
			if (e.status === 'moved') console.log(line);
			else console.error(line);
		}

		const failures = this.entries.filter((e) => e.status !== 'moved');
		if (failures.length > 0) {
			console.error('');
			console.error(`MIGRATION INCOMPLETE — ${failures.length} record(s) need operator repair:`);
			for (const e of failures) {
				console.error(
					`  • ${e.personId}.${e.field} [${e.status}${e.phase ? '/' + e.phase : ''}]` +
						(e.valueId ? ` valueId=${e.valueId}` : '') +
						(e.repairHint ? ` — ${e.repairHint}` : '')
				);
			}
			console.error('Non-zero exit: this run did NOT complete. Do not claim success.');
		}
	}
}
