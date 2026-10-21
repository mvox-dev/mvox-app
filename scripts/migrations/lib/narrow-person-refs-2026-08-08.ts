// Narrows 18 person prop-defs from domain to private (#44), then touch-saves all 132 persons:
// buckets are write-time snapshots, so the prop-def change alone fixes no instance.
// Runs as db-root, which always reads the private bucket; a non-owner read must confirm.

// Authorized by Gama on #37 (2026-08-08 06:56). Canary first, per Gama's dispatch: db-root's
// own person 69bcfd8e9c031ab8e6ce8079, then the key must still authenticate a read.

import { entuFetch } from '$lib/entu/request';
import { type EntuCfg } from '$lib/entu/cfg';

export const PERSON_TYPE_ID = '69bcfd8e9c031ab8e6ce805f';
export const CANARY_PERSON_ID = '69bcfd8e9c031ab8e6ce8079'; // db-root/PO — the #43/#44 subject

export type PropDefTarget = { id: string; name: string };

/** The 18 domain-tier person prop-defs from #41's inventory; re-verified live before use. */
export const PROPDEF_TARGETS: PropDefTarget[] = [
	{ id: '69bcfd8e9c031ab8e6ce8060', name: 'address' },
	{ id: '69bcfd8e9c031ab8e6ce8061', name: 'birthdate' },
	{ id: '69bcfd8e9c031ab8e6ce8062', name: 'county' },
	{ id: '69bcfd8e9c031ab8e6ce8064', name: 'entu_user' },
	{ id: '69bcfd8e9c031ab8e6ce8066', name: 'idcode' },
	{ id: '69bcfd8e9c031ab8e6ce8067', name: 'entu_api_key' },
	{ id: '69bcfd8e9c031ab8e6ce806a', name: 'phone' },
	{ id: '69bcfd8e9c031ab8e6ce806c', name: 'postalcode' },
	{ id: '69bcfd8e9c031ab8e6ce806e', name: 'town' },
	{ id: '69bcfd8e9c031ab8e6ce806f', name: 'entu_passkey' },
	{ id: '69c7ea5a8489bfcb0e81a1ac', name: 'voice' },
	{ id: '69c7ea5a8489bfcb0e81a1bf', name: 'language' },
	{ id: '69c7ea5b8489bfcb0e81a1cb', name: 'locale' },
	{ id: '69c7ea5b8489bfcb0e81a1d7', name: 'timezone' },
	{ id: '6a0d2e8690c8df7a1cc7df71', name: 'bio' },
	{ id: '6a0d2e8690c8df7a1cc7df7b', name: 'preferred_contact_email' },
	{ id: '6a0d2e8690c8df7a1cc7df85', name: 'preferences' },
	{ id: '6a0d709890c8df7a1cc7e12e', name: 'photo' }
];

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

// ── Step-0 enumeration (READ-ONLY) ──────────────────────────────────────────────

/** The `person` type's own `_sharing`, recorded for the ledger; narrowing prop-defs
 * closes the exposure whatever it holds. */
export async function verifyPersonTypeSharing(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<string> {
	const res = await entuFetch(cfg.db, `entity/${PERSON_TYPE_ID}?props=_sharing,name`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`verifyPersonTypeSharing: GET ${PERSON_TYPE_ID} failed: ${res.status}`);
	const body = (await res.json()) as { entity?: { _sharing?: Array<{ string: string }>; name?: Array<{ string: string }> } };
	const name = body.entity?.name?.[0]?.string;
	if (name !== 'person') {
		throw new Error(`verifyPersonTypeSharing: ${PERSON_TYPE_ID} has name=${JSON.stringify(name)}, expected 'person' — wrong entity id, refuse to proceed`);
	}
	return body.entity?._sharing?.[0]?.string ?? '(absent)';
}

export type PropDefObserved = { id: string; name: string; sharingValueId: string; sharingValue: string };

/** HALTs if any of the 18 prop-defs is not domain-tier now or resolves to the wrong name.
 * Returns each current `_sharing` value `_id`, which the replace POST needs. */
export async function verifyPropDefsCurrentlyDomain(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<PropDefObserved[]> {
	const observed: PropDefObserved[] = [];
	for (const t of PROPDEF_TARGETS) {
		const res = await entuFetch(cfg.db, `entity/${t.id}?props=_sharing,name`, cfg.token, {}, fetchImpl);
		if (!res.ok) throw new Error(`verifyPropDefsCurrentlyDomain: GET ${t.id} (${t.name}) failed: ${res.status}`);
		const body = (await res.json()) as { entity?: { _sharing?: Array<{ _id: string; string: string }>; name?: Array<{ string: string }> } };
		const name = body.entity?.name?.[0]?.string;
		if (name !== t.name) {
			throw new Error(`verifyPropDefsCurrentlyDomain: ${t.id} has name=${JSON.stringify(name)}, expected ${JSON.stringify(t.name)} — wrong entity id, refuse to proceed`);
		}
		const sharing = body.entity?._sharing?.[0];
		if (!sharing?._id || sharing.string !== 'domain') {
			throw new Error(
				`verifyPropDefsCurrentlyDomain: person.${t.name} prop-def ${t.id} has _sharing=${JSON.stringify(sharing?.string ?? null)} (expected 'domain' with a readable _id) — live state has moved since #41's probe, refuse to proceed, re-verify manually`
			);
		}
		observed.push({ id: t.id, name: t.name, sharingValueId: sharing._id, sharingValue: sharing.string });
	}
	return observed;
}

export type PersonTarget = { personId: string; sharingPropId: string | null; sharingValue: string | null };

export type PersonEnumerationResult = {
	targets: PersonTarget[];
	total: number;
	missingSharingIds: string[]; // no _sharing value: cannot atomic-replace, needs a create-POST
	tierBreakdown: Record<string, number>;
};

/** Reads all persons, HALTing on truncation or a total other than 132. Every person is a
 * target: the narrow changes bucket contents whatever each instance's own tier. */
export async function enumeratePersons(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<PersonEnumerationResult> {
	const res = await entuFetch(cfg.db, `entity?_type.reference=${PERSON_TYPE_ID}&props=_id,_sharing&limit=200`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`enumeratePersons: person census GET failed: ${res.status}`);
	const body = (await res.json()) as {
		count?: number;
		entities?: Array<{ _id: string; _sharing?: Array<{ _id: string; string: string }> }>;
	};
	const all = body.entities ?? [];
	if (typeof body.count === 'number' && body.count !== all.length) {
		throw new Error(`enumeratePersons: person census page truncated — server count=${body.count} but entities.length=${all.length}; refuse a partial page`);
	}
	if (all.length !== 132) {
		throw new Error(
			`enumeratePersons: live person count is ${all.length}, expected 132 (per #41's committed inventory) — population has drifted since the #41 probe, refuse to proceed, re-verify manually before re-running`
		);
	}

	const targets: PersonTarget[] = [];
	const missingSharingIds: string[] = [];
	const tierBreakdown: Record<string, number> = {};
	for (const p of all) {
		const sharing = p._sharing?.[0];
		const tier = sharing?.string ?? '(absent)';
		tierBreakdown[tier] = (tierBreakdown[tier] ?? 0) + 1;
		if (!sharing?._id) {
			missingSharingIds.push(p._id);
			targets.push({ personId: p._id, sharingPropId: null, sharingValue: null });
		} else {
			targets.push({ personId: p._id, sharingPropId: sharing._id, sharingValue: sharing.string });
		}
	}

	return { targets, total: all.length, missingSharingIds, tierBreakdown };
}

export type PropertyPresenceCount = { name: string; personsCarryingValue: number };

/** Counts which persons carry a value per prop-def: a prop-def on the type does not mean
 * every instance holds a value that the narrow would drop. */
export async function countPropertyPresence(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<PropertyPresenceCount[]> {
	const results: PropertyPresenceCount[] = [];
	for (const t of PROPDEF_TARGETS) {
		const res = await entuFetch(cfg.db, `entity?_type.reference=${PERSON_TYPE_ID}&props=${t.name}&limit=200`, cfg.token, {}, fetchImpl);
		if (!res.ok) throw new Error(`countPropertyPresence: GET for ${t.name} failed: ${res.status}`);
		const body = (await res.json()) as { entities?: Array<Record<string, Array<unknown> | undefined>> };
		const entities = body.entities ?? [];
		const withValue = entities.filter((e) => Array.isArray(e[t.name]) && (e[t.name] as Array<unknown>).length > 0).length;
		results.push({ name: t.name, personsCarryingValue: withValue });
	}
	return results;
}

// ── Bundle A: prop-def _sharing replace (domain → private) ────────────────────

export type PropDefLedgerEntry = { propDefId: string; name: string; status: 'narrowed' | 'failed'; message?: string };

/** Replaces each prop-def's `_sharing` with 'private' and reads back a NEW value `_id`,
 * proving the replace rotated rather than merely returning 200. */
export async function narrowPropDefs(cfg: EntuCfg, observed: PropDefObserved[], fetchImpl: typeof fetch = fetch): Promise<PropDefLedgerEntry[]> {
	const entries: PropDefLedgerEntry[] = [];
	for (const t of observed) {
		try {
			const res = await entuFetch(
				cfg.db,
				`entity/${t.id}`,
				cfg.token,
				{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ _id: t.sharingValueId, type: '_sharing', string: 'private' }]) },
				fetchImpl
			);
			if (!res.ok) {
				entries.push({ propDefId: t.id, name: t.name, status: 'failed', message: `POST failed: ${res.status}` });
				continue;
			}
			const body = (await res.json()) as { properties?: Array<{ _id: string; type: string }> };
			const newSharingProp = (body.properties ?? []).find((p) => p.type === '_sharing');
			if (!newSharingProp?._id) {
				entries.push({ propDefId: t.id, name: t.name, status: 'failed', message: 'POST returned 2xx but no _sharing property in response (apparent-success trap)' });
				continue;
			}
			if (newSharingProp._id === t.sharingValueId) {
				entries.push({ propDefId: t.id, name: t.name, status: 'failed', message: `POST returned the SAME property _id (${t.sharingValueId}) — the replace did not actually rotate` });
				continue;
			}
		} catch (err) {
			entries.push({ propDefId: t.id, name: t.name, status: 'failed', message: errMsg(err) });
			continue;
		}

		try {
			const getRes = await entuFetch(cfg.db, `entity/${t.id}?props=_sharing`, cfg.token, {}, fetchImpl);
			if (!getRes.ok) {
				entries.push({ propDefId: t.id, name: t.name, status: 'failed', message: `read-back GET failed: ${getRes.status} — POST may have succeeded, verify by API` });
				continue;
			}
			const body = (await getRes.json()) as { entity?: { _sharing?: Array<{ string: string }> } };
			const now = body.entity?._sharing?.[0]?.string;
			if (now !== 'private') {
				entries.push({ propDefId: t.id, name: t.name, status: 'failed', message: `read-back shows _sharing=${JSON.stringify(now)}, expected 'private'` });
				continue;
			}
		} catch (err) {
			entries.push({ propDefId: t.id, name: t.name, status: 'failed', message: errMsg(err) });
			continue;
		}

		entries.push({ propDefId: t.id, name: t.name, status: 'narrowed' });
	}
	return entries;
}

// ── Bundle B: touch-save re-aggregation sweep ──────────────────────────────────

export type TouchSaveLedgerEntry = { personId: string; status: 'touched' | 'failed'; newSharingPropId?: string; message?: string };

/** Touch-saves db-root's own person alone, then re-exchanges ENTU_API_KEY and does one read.
 * Throws on any failure: every later write depends on that key staying valid. */
export async function touchSaveCanaryAndSelfTest(
	cfg: EntuCfg,
	canaryTarget: PersonTarget,
	reAuthenticate: () => Promise<EntuCfg>,
	fetchImpl: typeof fetch = fetch
): Promise<TouchSaveLedgerEntry> {
	const [entry] = await touchSavePersons(cfg, [canaryTarget], fetchImpl);
	if (entry.status !== 'touched') {
		throw new Error(`touchSaveCanaryAndSelfTest: canary person ${canaryTarget.personId} FAILED — ${entry.message}. Refuse to run the full 131-person sweep on an unproven mechanic.`);
	}

	const getRes = await entuFetch(cfg.db, `entity/${canaryTarget.personId}?props=_sharing`, cfg.token, {}, fetchImpl);
	if (!getRes.ok) throw new Error(`touchSaveCanaryAndSelfTest: post-touch read-back GET failed: ${getRes.status}`);
	const body = (await getRes.json()) as { entity?: { _sharing?: Array<{ _id: string; string: string }> } };
	const sharingValues = body.entity?._sharing ?? [];
	if (sharingValues.length !== 1) {
		throw new Error(
			`touchSaveCanaryAndSelfTest: canary person ${canaryTarget.personId} now carries ${sharingValues.length} _sharing values (expected exactly 1) — the atomic replace did not cleanly soft-delete the old value. Refuse to run the full sweep; needs manual repair first.`
		);
	}

	const freshCfg = await reAuthenticate();
	const selfTestRes = await entuFetch(freshCfg.db, `entity/${canaryTarget.personId}?props=_id`, freshCfg.token, {}, fetchImpl);
	if (!selfTestRes.ok) {
		throw new Error(
			`touchSaveCanaryAndSelfTest: CREDENTIAL SELF-TEST FAILED — db-root's own API key no longer authenticates a trivial read after the canary re-aggregation (GET returned ${selfTestRes.status}). HARD STOP. Do not proceed to the 131-person sweep; the executing credential itself may now be broken.`
		);
	}

	return entry;
}

/** Replaces each person's `_sharing` with the same value to force re-aggregation.
 * A person with no `_sharing` value is a per-record failure; no POST shape is invented. */
export async function touchSavePersons(cfg: EntuCfg, targets: PersonTarget[], fetchImpl: typeof fetch = fetch): Promise<TouchSaveLedgerEntry[]> {
	const entries: TouchSaveLedgerEntry[] = [];
	for (const t of targets) {
		if (!t.sharingPropId || !t.sharingValue) {
			entries.push({ personId: t.personId, status: 'failed', message: 'person has no existing _sharing value to atomically replace — needs a plain create-POST path, not implemented here (no such person observed in #41 data; investigate manually)' });
			continue;
		}
		try {
			const res = await entuFetch(
				cfg.db,
				`entity/${t.personId}`,
				cfg.token,
				{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ _id: t.sharingPropId, type: '_sharing', string: t.sharingValue }]) },
				fetchImpl
			);
			if (!res.ok) {
				entries.push({ personId: t.personId, status: 'failed', message: `touch-save POST failed: ${res.status}` });
				continue;
			}
			const body = (await res.json()) as { properties?: Array<{ _id: string; type: string }> };
			const newSharingProp = (body.properties ?? []).find((p) => p.type === '_sharing');
			if (!newSharingProp?._id) {
				entries.push({ personId: t.personId, status: 'failed', message: 'touch-save POST returned 2xx but no _sharing property in response (apparent-success trap)' });
				continue;
			}
			if (newSharingProp._id === t.sharingPropId) {
				entries.push({ personId: t.personId, status: 'failed', message: `touch-save POST returned the SAME property _id (${t.sharingPropId}) — the replace did not actually rotate, no fresh write occurred` });
				continue;
			}
			entries.push({ personId: t.personId, status: 'touched', newSharingPropId: newSharingProp._id });
		} catch (err) {
			entries.push({ personId: t.personId, status: 'failed', message: errMsg(err) });
		}
	}
	return entries;
}

// ── Dry-run render + ledger ─────────────────────────────────────────────────────

export function renderPlan(
	observedTypeSharing: string,
	propDefsObserved: PropDefObserved[],
	personEnumeration: PersonEnumerationResult,
	propertyPresence: PropertyPresenceCount[]
): string {
	const lines: string[] = [];
	lines.push('#44 (#37-P3.2) — narrow person prop-defs + re-aggregate DRY-RUN plan (NO writes issued)');
	lines.push('');
	lines.push(`── Pre-check: person TYPE entity's own _sharing observed live = '${observedTypeSharing}' (gate 2 — recorded, not load-bearing for this narrow)`);
	lines.push('');
	lines.push(`── Bundle A: WOULD REPLACE _sharing domain→private on ${propDefsObserved.length} person prop-defs (all currently confirmed 'domain' live, not assumed from #41 memory)`);
	for (const t of propDefsObserved) {
		const presence = propertyPresence.find((p) => p.name === t.name);
		lines.push(`   person.${t.name} prop-def ${t.id}: WOULD POST replace _sharing:'private' (current value _id ${t.sharingValueId}) — ${presence?.personsCarryingValue ?? '?'}/132 persons carry a value here today (that many domain-bucket entries would be dropped for this property).`);
	}
	lines.push('');
	lines.push('── Bundle B: WOULD TOUCH-SAVE all 132 persons to re-trigger aggregation (GATED on Bundle A succeeding for ALL 18 prop-defs)');
	lines.push(`   Population: ${personEnumeration.total} persons total (matches #41's committed inventory count).`);
	lines.push(`   Own-_sharing tier breakdown: ${JSON.stringify(personEnumeration.tierBreakdown)}`);
	if (personEnumeration.missingSharingIds.length > 0) {
		lines.push(`   WARNING: ${personEnumeration.missingSharingIds.length} person(s) have NO explicit _sharing value (cannot atomic-replace, would fail as a per-record ledger entry): ${personEnumeration.missingSharingIds.join(', ')}`);
	} else {
		lines.push('   All 132 persons carry an explicit _sharing value — the atomic-replace touch-save mechanic applies uniformly.');
	}
	lines.push(`   CANARY FIRST (non-negotiable, Gama's dispatch): person ${CANARY_PERSON_ID} (db-root/PO) touched ALONE first.`);
	lines.push('     After the canary touch-save, the db-root ENTU_API_KEY is re-exchanged for a fresh JWT and used for ONE trivial read (GET the canary entity by _id). This is the run\'s own credential proving itself alive. NOT OPTIONAL. A failure here HARD-STOPS before any of the remaining 131 persons are touched.');
	lines.push(`   Remaining sweep: ${personEnumeration.total - 1} persons (all persons except the canary), same atomic-replace mechanic as #20's touch-save.`);
	lines.push('');
	lines.push('STATED CONSEQUENCE (authorized, Gama #37 2026-08-08 06:56): the in-app roster loses display affordances that depended on these 18 domain-tier person fields for the 128 T3.1-synthetic singers until fixtures are regenerated. Real people (db-root, Mihkel\'s OAuth identity, Test User, fixture B) are unaffected in practice — their own entity-level _sharing already caps most of this data to private/self regardless (db-root confirmed private in #44; the narrow makes the OTHER 128 match that same private-at-this-property-set posture).');
	lines.push('');
	lines.push('AWARE-ONLY, no action this task: entu_api_key on the canary person carries 3 stacked historical values (#44 finding) — narrowing its prop-def does not touch value count, only bucket placement.');
	lines.push('');
	lines.push(`Totals: ${propDefsObserved.length} prop-def replace-writes planned, ${personEnumeration.total} person touch-saves planned (1 canary + credential self-test, then ${personEnumeration.total - 1} more). Writes issued this run: 0.`);
	return lines.join('\n');
}

export class NarrowLedger {
	private propDefEntries: PropDefLedgerEntry[] = [];
	private touchEntries: TouchSaveLedgerEntry[] = [];

	recordPropDef(entries: PropDefLedgerEntry[]): void {
		this.propDefEntries.push(...entries);
	}
	recordTouch(entries: TouchSaveLedgerEntry[]): void {
		this.touchEntries.push(...entries);
	}
	propDefFailures(): PropDefLedgerEntry[] {
		return this.propDefEntries.filter((e) => e.status !== 'narrowed');
	}
	touchFailures(): TouchSaveLedgerEntry[] {
		return this.touchEntries.filter((e) => e.status !== 'touched');
	}
	hasFailures(): boolean {
		return this.propDefFailures().length > 0 || this.touchFailures().length > 0;
	}
	toJSON() {
		return {
			propDefEntries: this.propDefEntries,
			touchEntries: this.touchEntries,
			propDefFailureCount: this.propDefFailures().length,
			touchFailureCount: this.touchFailures().length
		};
	}
	printReport(): void {
		console.log(`\n── Bundle A (prop-defs): ${this.propDefEntries.length} attempted`);
		for (const e of this.propDefEntries) {
			const line = `${e.status.toUpperCase()} person.${e.name} (${e.propDefId})${e.message ? ` — ${e.message}` : ''}`;
			if (e.status === 'narrowed') console.log(line);
			else console.error(line);
		}
		if (this.touchEntries.length > 0) {
			console.log(`\n── Bundle B (touch-save sweep): ${this.touchEntries.length} attempted`);
			const failures = this.touchFailures();
			for (const e of failures) console.error(`${e.status.toUpperCase()} person=${e.personId} — ${e.message}`);
			console.log(`${this.touchEntries.length - failures.length}/${this.touchEntries.length} touched cleanly.`);
		}
		const pFail = this.propDefFailures();
		const tFail = this.touchFailures();
		if (pFail.length > 0 || tFail.length > 0) {
			console.error('');
			console.error(`NARROW INCOMPLETE — ${pFail.length} prop-def failure(s), ${tFail.length} touch-save failure(s) need operator repair.`);
			console.error('Non-zero exit: this run did NOT complete. Do not claim success.');
		}
	}
}
