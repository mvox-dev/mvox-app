// T4.10 (#30, epic #21) core: move real persons' name/email values into `profile` entities.

// Creates go through the real profileData helpers, never a hand-rolled POST; the funnel
// spec proves it at runtime.

import { entuFetch } from '$lib/entu/request';
import { type EntuCfg } from '$lib/entu/cfg';
import { createProfile, saveProfileFields, listMyProfiles } from '$lib/profile/profileData';

/** Drift tripwire, not the source of truth: enumerateTargets HALTs if the live set differs. */
export const EXPECTED_TARGET_IDS: readonly string[] = [
	'6a2fc05e4cd971291c5d5ddc',
	'6a097dcc90c8df7a1cc7d6dd'
];

/** Non-public but out of scope (db-root/PO, Mihkel's ruling); a stale exclusion HALTs. */
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

/** One profile create: a person's fields bound for the same target tier. */
export type MigrationGroup = {
	personId: string;
	tier: 'domain' | 'private';
	fields: { name?: string; email?: string };
	/** The `_owner` grant — always `[personId]` (the member owns her own profile). */
	ownerIds: string[];
	sourceTier?: 'domain' | 'private';
};

export type Phase = 'create' | 'write-value' | 'verify-profile' | 'delete-person' | 'readback-person';

/** `moved` is proven on both sides; `failed` left the person intact; `duplicate-hazard`
 * means the value sits on both person and profile after a failed person delete. */
export type RecordStatus = 'moved' | 'failed' | 'duplicate-hazard';

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

/** Read-only enumeration. HALTs on a truncated page, a stale exclusion, or id-set drift.
 * Reads values off `props=`, since the name/email prop-defs no longer exist. */
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

// Drop exclusions before the drift check, or they would trip it; a stale exclusion HALTs.
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

// The engine copies only value[0] but deletes every value, so a multi-valued field would
// lose data while reading `moved`: HALT instead.
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

/** PURE. name always goes to domain (the completion gate reads only that); email keeps
 * its source tier so a private email is never re-exposed. One group per target tier. */
export function buildPlan(targets: TargetPerson[]): MigrationGroup[] {
	const groups: MigrationGroup[] = [];
	for (const t of targets) {
		const perTier = new Map<'domain' | 'private', { name?: string; email?: string }>();
		const add = (tier: 'domain' | 'private', field: 'name' | 'email', value: string) => {
			const bucket = perTier.get(tier) ?? {};
			bucket[field] = value;
			perTier.set(tier, bucket);
		};
		if (t.name != null && t.name !== '') add('domain', 'name', t.name);
		if (t.email != null && t.email !== '') add(t.sourceTier, 'email', t.email);

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

/** Never throws per record. Create, populate, prove on the profile, and only then delete
 * from the person and prove it gone: no DELETE follows an unproven write. */
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

	const entries: LedgerEntry[] = [];
	for (const field of fields) {
		const expected = group.fields[field]!;

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

/** Not saveProfileFields, which re-adds after deleting. Throws PersonFieldDeleteError on a
 * non-2xx, naming field and id. */
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
// enumerateTargets HALTs on multi-value, but the set is re-read here: refuse to delete
// values that were never copied.
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

/** Resolves true iff `profileId` holds `field` equal to `expected`. */
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

/** PURE dry-run render, emails masked: the operator's per-run verify surface. */
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

/** Reports every record; any entry not `moved` prints MIGRATION INCOMPLETE, never a bare done. */
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
