// New primitive (mvox-app#246): idempotent, check-then-create type-def +
// prop-def CREATE against a live Entu db. This is NEW WORK, not an extension of
// an existing lib — no prior Pérotin script in workspace-app does full type-def
// creation (the one prior tool that did, `lib/v4e-translator.ts`, only ever
// existed in the legacy `~/workspace` repo and was never migrated). The nearest
// precedent is entu-research's `setup-entity-types.ts` (foreign repo, foreign
// team) — this reproduces its proven wire-shape (meta-type refs, check-then-
// create, add_from wiring) as a small workspace-app-owned primitive, per the
// #246 settle's approval of "the new type+prop-def CREATE primitive... as new
// work." First use: schedule_item, on polyphony and mvox_crede.
//
// Per Pérotin's own standing toolkit-extraction discipline: this stays local to
// scripts/migrations/lib/ (not proposed into Josquin's `$lib/entu/*`) until a
// SECOND app-extension type needs it — one use does not earn a foundation change.
//
// Meta-type ids (the "entity" and "property" type-definitions themselves) are
// RESOLVED PER-DB, never hardcoded: each Entu database is a distinct collection
// with its own auto-generated ids, so a constant proven on polyphony would be
// silently wrong on mvox_crede. This mirrors setup-entity-types.ts's own Step 1.

import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { MvoxEntityDef, PropertySpec, Sharing } from './mvox-schema-extensions';

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export type EnsureOutcome = { id: string; outcome: 'found' | 'created' };

/** One list GET per meta-type, by name — same lookup shape as
 * entu-research's Step 1, so a db that genuinely lacks either meta-type
 * (should never happen — they are Entu platform bootstrap fixtures) fails
 * loud with a clear message instead of a confusing downstream 400. */
export async function resolveMetaTypeIds(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<{ entityMetaTypeId: string; propertyMetaTypeId: string }> {
	const entityRes = await entuFetch(
		cfg.db,
		`entity?_type.string=entity&name.string=entity&props=_id&limit=1`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!entityRes.ok) throw new Error(`resolveMetaTypeIds: "entity" meta-type GET failed: ${entityRes.status}`);
	const entityBody = (await entityRes.json()) as { entities?: Array<{ _id: string }> };
	const entityMetaTypeId = entityBody.entities?.[0]?._id;
	if (!entityMetaTypeId) throw new Error(`resolveMetaTypeIds: "entity" meta-type not found in db '${cfg.db}'`);

	const propertyRes = await entuFetch(
		cfg.db,
		`entity?_type.string=entity&name.string=property&props=_id&limit=1`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!propertyRes.ok) throw new Error(`resolveMetaTypeIds: "property" meta-type GET failed: ${propertyRes.status}`);
	const propertyBody = (await propertyRes.json()) as { entities?: Array<{ _id: string }> };
	const propertyMetaTypeId = propertyBody.entities?.[0]?._id;
	if (!propertyMetaTypeId) throw new Error(`resolveMetaTypeIds: "property" meta-type not found in db '${cfg.db}'`);

	return { entityMetaTypeId, propertyMetaTypeId };
}

/** Resolve any existing type-def (canonical or extension) by name — used to
 * find `event`'s type-def id for the `parents`/`add_from` wiring without
 * hardcoding a per-db id. Fails loud: an app-extension type's parent MUST
 * already exist (schema-mutation-in-flight check, common-prompt discipline). */
export async function resolveTypeIdByName(
	cfg: EntuCfg,
	entityMetaTypeId: string,
	typeName: string,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.reference=${entityMetaTypeId}&name.string=${encodeURIComponent(typeName)}&props=_id&limit=1`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`resolveTypeIdByName('${typeName}'): GET failed: ${res.status}`);
	const body = (await res.json()) as { entities?: Array<{ _id: string }> };
	const id = body.entities?.[0]?._id;
	if (!id) throw new Error(`resolveTypeIdByName: type '${typeName}' not found in db '${cfg.db}' — cannot wire an extension type against a parent that does not exist`);
	return id;
}

export type LedgerStep = {
	action: 'ensure-type' | 'ensure-propdef' | 'ensure-add-from';
	target: string;
	id?: string;
	outcome: 'found' | 'created' | 'dry-run' | 'already-wired' | 'failed';
	before?: unknown;
	after?: unknown;
	error?: string;
};

/**
 * Check-then-create the type-def. `dryRun=true` never writes — it resolves
 * whether the type already exists and reports what a live run would do.
 */
export async function ensureEntityType(
	cfg: EntuCfg,
	entityMetaTypeId: string,
	def: Pick<MvoxEntityDef, 'name' | 'sharing' | 'inheritsRights'> & {
		labelEn: string;
		labelEt: string;
		descriptionEn: string;
		descriptionEt: string;
	},
	dryRun: boolean,
	ledger: LedgerStep[],
	fetchImpl: typeof fetch = fetch
): Promise<string | null> {
	const existing = await entuFetch(
		cfg.db,
		`entity?_type.reference=${entityMetaTypeId}&name.string=${encodeURIComponent(def.name)}&props=_id&limit=1`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!existing.ok) throw new Error(`ensureEntityType('${def.name}'): existence GET failed: ${existing.status}`);
	const existingBody = (await existing.json()) as { entities?: Array<{ _id: string }> };
	const existingId = existingBody.entities?.[0]?._id;
	if (existingId) {
		ledger.push({ action: 'ensure-type', target: def.name, id: existingId, outcome: 'found' });
		return existingId;
	}

	if (dryRun) {
		ledger.push({ action: 'ensure-type', target: def.name, outcome: 'dry-run', after: { sharing: def.sharing, inheritsRights: def.inheritsRights } });
		return null;
	}

	const res = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([
				{ type: '_type', reference: entityMetaTypeId },
				{ type: 'name', string: def.name },
				{ type: 'label', language: 'en', string: def.labelEn },
				{ type: 'label', language: 'et', string: def.labelEt },
				{ type: 'description', language: 'en', string: def.descriptionEn },
				{ type: 'description', language: 'et', string: def.descriptionEt },
				{ type: '_inheritrights', boolean: def.inheritsRights },
				{ type: '_sharing', string: def.sharing }
			])
		},
		fetchImpl
	);
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		const msg = `ensureEntityType('${def.name}'): CREATE failed: ${res.status}${body ? ` — ${body.slice(0, 300)}` : ''}`;
		ledger.push({ action: 'ensure-type', target: def.name, outcome: 'failed', error: msg });
		throw new Error(msg);
	}
	const body = (await res.json()) as { _id?: string };
	if (!body._id) {
		const msg = `ensureEntityType('${def.name}'): CREATE returned ${res.status} with no _id — apparent-success trap`;
		ledger.push({ action: 'ensure-type', target: def.name, outcome: 'failed', error: msg });
		throw new Error(msg);
	}
	ledger.push({ action: 'ensure-type', target: def.name, id: body._id, outcome: 'created', after: { sharing: def.sharing, inheritsRights: def.inheritsRights } });
	return body._id;
}

/** Check-then-create one prop-def under an existing type-def. */
export async function ensurePropDef(
	cfg: EntuCfg,
	propertyMetaTypeId: string,
	parentTypeId: string,
	typeName: string,
	sharing: Sharing,
	prop: PropertySpec,
	dryRun: boolean,
	ledger: LedgerStep[],
	fetchImpl: typeof fetch = fetch
): Promise<string | null> {
	const label = `${typeName}.${prop.name}`;
	const existing = await entuFetch(
		cfg.db,
		`entity?_type.reference=${propertyMetaTypeId}&_parent.reference=${parentTypeId}&name.string=${encodeURIComponent(prop.name)}&props=_id&limit=1`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!existing.ok) throw new Error(`ensurePropDef('${label}'): existence GET failed: ${existing.status}`);
	const existingBody = (await existing.json()) as { entities?: Array<{ _id: string }> };
	const existingId = existingBody.entities?.[0]?._id;
	if (existingId) {
		ledger.push({ action: 'ensure-propdef', target: label, id: existingId, outcome: 'found' });
		return existingId;
	}

	if (dryRun) {
		ledger.push({ action: 'ensure-propdef', target: label, outcome: 'dry-run', after: { type: prop.type, sharing, mandatory: prop.required ?? false } });
		return null;
	}

	const props: Array<Record<string, unknown>> = [
		{ type: '_type', reference: propertyMetaTypeId },
		{ type: '_parent', reference: parentTypeId },
		{ type: 'name', string: prop.name },
		{ type: 'type', string: prop.type },
		{ type: '_sharing', string: sharing },
		{ type: 'description', language: 'en', string: prop.descriptionEn },
		{ type: 'description', language: 'et', string: prop.descriptionEt }
	];
	if (prop.required) props.push({ type: 'mandatory', boolean: true });
	if (prop.ordinal !== undefined) props.push({ type: 'ordinal', number: prop.ordinal });
	if (prop.table) props.push({ type: 'table', boolean: true });
	if (prop.search) props.push({ type: 'search', boolean: true });

	const res = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(props) },
		fetchImpl
	);
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		const msg = `ensurePropDef('${label}'): CREATE failed: ${res.status}${body ? ` — ${body.slice(0, 300)}` : ''}`;
		ledger.push({ action: 'ensure-propdef', target: label, outcome: 'failed', error: msg });
		throw new Error(msg);
	}
	const body = (await res.json()) as { _id?: string };
	if (!body._id) {
		const msg = `ensurePropDef('${label}'): CREATE returned ${res.status} with no _id — apparent-success trap`;
		ledger.push({ action: 'ensure-propdef', target: label, outcome: 'failed', error: msg });
		throw new Error(msg);
	}
	ledger.push({ action: 'ensure-propdef', target: label, id: body._id, outcome: 'created', after: { type: prop.type, sharing, mandatory: prop.required ?? false } });
	return body._id;
}

/** Wire `add_from` on a type-def → another type-def's id, append-only and
 * idempotent (skip if already set to the same target; warn-and-leave if set
 * to something else — same caution as entu-research's `ensureAddFrom`). */
export async function ensureAddFrom(
	cfg: EntuCfg,
	typeId: string,
	typeName: string,
	addFromId: string,
	addFromName: string,
	dryRun: boolean,
	ledger: LedgerStep[],
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const label = `${typeName}.add_from`;
	const detail = await entuFetch(cfg.db, `entity/${typeId}?props=add_from`, cfg.token, {}, fetchImpl);
	if (!detail.ok) throw new Error(`ensureAddFrom('${label}'): GET failed: ${detail.status}`);
	const body = (await detail.json()) as { entity?: { add_from?: Array<{ reference?: string; string?: string }> } };
	const current = body.entity?.add_from ?? [];
	if (current.length > 0) {
		if (current.some((v) => v.reference === addFromId)) {
			ledger.push({ action: 'ensure-add-from', target: label, id: typeId, outcome: 'already-wired' });
			return;
		}
		const msg = `ensureAddFrom('${label}'): already wired to a DIFFERENT target (${current.map((v) => v.reference ?? v.string).join(', ')}), expected ${addFromName} (${addFromId}) — left untouched, needs a human look`;
		ledger.push({ action: 'ensure-add-from', target: label, id: typeId, outcome: 'failed', error: msg });
		throw new Error(msg);
	}

	if (dryRun) {
		ledger.push({ action: 'ensure-add-from', target: label, outcome: 'dry-run', after: addFromId });
		return;
	}

	const res = await entuFetch(
		cfg.db,
		`entity/${typeId}`,
		cfg.token,
		{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ type: 'add_from', reference: addFromId }]) },
		fetchImpl
	);
	if (!res.ok) {
		const errBody = await res.text().catch(() => '');
		const msg = `ensureAddFrom('${label}'): POST failed: ${res.status}${errBody ? ` — ${errBody.slice(0, 300)}` : ''}`;
		ledger.push({ action: 'ensure-add-from', target: label, outcome: 'failed', error: msg });
		throw new Error(msg);
	}
	ledger.push({ action: 'ensure-add-from', target: label, id: typeId, outcome: 'created', after: addFromId });
}

export { errMsg };

// (*MVOX:Perotin*)
