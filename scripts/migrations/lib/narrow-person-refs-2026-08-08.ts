// #37-P3.2 (#44) — narrow the 18 person prop-defs identified by #41's inventory
// (`probe-epic37-phase1-inventory-2026-08-08.ts`, committed `d605f3e`) from
// `_sharing:'domain'` back to `_sharing:'private'`, then re-aggregate all 132
// person entities so their domain/public buckets actually drop these properties
// (buckets are write-time SNAPSHOTS, not read-time computed — a prop-def change
// alone does not retroactively fix any already-aggregated instance; same
// mechanic as the #20 widen, mirrored here in the opposite direction).
//
// Authorized by Gama on #37 (2026-08-08 06:56). Stated, authorized consequence:
// narrowing drops the 128 T3.1-synthetic singers' residual `name` values from
// their historical domain buckets — wait, `name` has no prop-def at all (T4.3
// removal) and was never part of THIS narrow's 18-prop-def target list; the
// actual stated consequence is about the in-app roster losing whatever display
// affordance depended on these 18 domain-tier person fields for the synthetic
// population until fixtures are regenerated. Real people (db-root, Mihkel's
// OAuth identity, Test User, fixture B) are the only persons whose OWN
// entity-level `_sharing` is not 'public' — narrowing affects all 132 uniformly
// at the prop-def/bucket level regardless of each instance's own tier.
//
// Two bundles, same separation as #20 (different blast radii; Bundle B gated on
// Bundle A landing for ALL 18, not just some):
//
//   Bundle A (schema, 18-entity blast radius): REPLACE (not create — these 18
//   prop-defs currently carry an explicit `_sharing:'domain'` value per #41) the
//   `_sharing` value on each of the 18 person prop-def ENTITIES to `'private'`.
//   Atomic replace-by-`_id` (same POST-with-existing-`_id` mechanic as #20's
//   touch-save) — no DELETE-then-POST needed, no multi-value risk.
//
//   Bundle B (data, 132-instance blast radius, GATED on Bundle A succeeding for
//   ALL 18 prop-defs): touch-save every person entity's own `_sharing` property
//   (atomic replace, same value, fresh `_id`) to force a real `aggregateEntity`
//   re-run. CANARY FIRST (Gama's dispatch, non-negotiable): person
//   `69bcfd8e9c031ab8e6ce8079` (db-root/PO — also the #43/#44 credential-exposure
//   subject) is touched alone first, followed by an EXTRA verification step this
//   run uniquely requires: the db-root ENTU_API_KEY must still authenticate a
//   trivial read AFTER its own entity has been re-aggregated. This is the run's
//   own credential proving itself alive — if it fails, every subsequent write in
//   this process (including the remaining 131 persons) would be unreachable
//   anyway, so it is a hard gate, not a per-record ledger entry.
//
// VERIFICATION CAVEAT (same as #20): every call here runs under ENTU_API_KEY
// (PO/db-root), which is `_owner` on effectively all these entities and
// therefore ALWAYS reads the private bucket regardless of prop-def sharing.
// "touched"/"narrowed" below means the write landed and rotated the property
// `_id` (proof a genuine write + fresh aggregation occurred) — NOT an
// empirically-confirmed absence from a non-owner domain reader's view. That
// last-mile confirmation needs a real non-omniscient read (Mihkel), same
// pattern as #20/#29.

import { entuFetch } from '$lib/entu/request';
import { type EntuCfg } from '$lib/seasons/entuSeasons';

export const PERSON_TYPE_ID = '69bcfd8e9c031ab8e6ce805f';
export const CANARY_PERSON_ID = '69bcfd8e9c031ab8e6ce8079'; // db-root/PO — the #43/#44 subject

export type PropDefTarget = { id: string; name: string };

/** The 18 person prop-defs at `_sharing:'domain'`, per #41's live inventory
 * (`seed-results/probe-epic37-phase1-inventory-2026-08-08T02-19-47-000Z.json`).
 * Treated as a claim to re-verify live (`verifyPropDefsCurrentlyDomain`), not
 * blindly trusted — matches the #20 template's discipline. */
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

/** Gate 2 of the 3-gate-AND: the `person` TYPE entity's own `_sharing`. Not
 * load-bearing for THIS narrow (narrowing gate 1 alone is sufficient to close
 * exposure regardless of gate 2/3), but read + recorded for the ledger per the
 * #20 template's discipline of recording observed values, not assumptions. */
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

/** Step-0 enumeration for Bundle A. HALTs if any of the 18 prop-defs is NOT
 * currently `_sharing:'domain'` (live state moved since #41's probe — re-verify
 * manually rather than blind-replacing an unexpected value) or if the wrong
 * entity id resolves (name mismatch). Returns each prop-def's CURRENT `_sharing`
 * value `_id` — required for the atomic replace-by-`_id` POST in Bundle A. */
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
	missingSharingIds: string[]; // persons with NO explicit _sharing value at all (absent = private by default) — cannot atomic-replace, need a plain create-POST instead
	tierBreakdown: Record<string, number>;
};

/** Step-0 enumeration for Bundle B. Reads ALL person entities (expected 132 —
 * HALTs on truncation or an unexpected total, matching #41's committed count so
 * a fresh drift is surfaced rather than silently absorbed). Every person is a
 * touch-save target regardless of its OWN `_sharing` tier — narrowing the 18
 * prop-defs affects the domain/public bucket contents for ALL 132 instances
 * uniformly, not just the ones currently domain/public-tier themselves. */
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

/** Per-property value-presence count across the 132 persons — answers "what
 * domain bucket values would actually be dropped" (a prop-def existing on the
 * TYPE doesn't mean every instance carries a value for it). Read-only, 18
 * queries (one per prop-def), each bounded to the 132-person population. */
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

/** Bundle A engine. Per prop-def: atomic replace-by-`_id` POST (existing
 * `_sharing` value `_id`, new string `'private'`), then read-back-PROVE it now
 * reads `_sharing==='private'` under a NEW property `_id` (proof the replace
 * actually rotated, not merely returned 200 — same apparent-success guard as
 * #20's `touchSaveDomainMembers`). */
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

/** Canary step — touch-save person `69bcfd8e9c031ab8e6ce8079` ALONE first, then
 * the run's own unique extra gate: verify the db-root ENTU_API_KEY can still
 * authenticate a trivial read (exchange the key for a JWT, GET a cheap known
 * entity). Throws (hard gate, not a ledger entry) on ANY failure — if the
 * canary or the credential self-test fails, the full 131-person sweep MUST NOT
 * run; every subsequent write in this process depends on this exact credential
 * staying valid. */
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

	// The run's own credential proving itself alive: re-exchange ENTU_API_KEY for
	// a fresh JWT and perform one trivial read, AFTER the canary (db-root's own
	// entity) has been re-aggregated. NOT OPTIONAL per Gama's dispatch.
	const freshCfg = await reAuthenticate();
	const selfTestRes = await entuFetch(freshCfg.db, `entity/${canaryTarget.personId}?props=_id`, freshCfg.token, {}, fetchImpl);
	if (!selfTestRes.ok) {
		throw new Error(
			`touchSaveCanaryAndSelfTest: CREDENTIAL SELF-TEST FAILED — db-root's own API key no longer authenticates a trivial read after the canary re-aggregation (GET returned ${selfTestRes.status}). HARD STOP. Do not proceed to the 131-person sweep; the executing credential itself may now be broken.`
		);
	}

	return entry;
}

/** Bundle B engine. Per person: atomic single-POST replace of `_sharing` (same
 * `_id`, same string) — a genuine write with zero multi-value risk, forcing a
 * fresh `aggregateEntity` run. Persons with NO existing `_sharing` value
 * (`sharingPropId === null`) cannot use the replace path — flagged as a
 * per-record failure rather than inventing a POST shape; #41's data did not
 * surface any such person, but this guards against live drift. */
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
