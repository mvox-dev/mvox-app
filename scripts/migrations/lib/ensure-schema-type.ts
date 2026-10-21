// Idempotent check-then-create of type-defs and prop-defs on a live Entu db (#246).

// Meta-type ids are resolved per db, never hardcoded: each db has its own generated ids.

import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/entu/cfg';
import type { MvoxEntityDef, PropertySpec, Sharing } from './mvox-schema-extensions';

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export type EnsureOutcome = { id: string; outcome: 'found' | 'created' };

/** List GET per meta-type by name; fails loud if a db lacks either, instead of a downstream 400. */
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

/** Resolve an existing type-def by name; fails loud, as a parent type must already exist. */
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

/** Check-then-create the type-def; `dryRun` only reports what a live run would do. */
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

/** Check-then-create one prop-def; `prop.sharing` overrides the type's. `_sharing` is always
 * written, as an omitted one inherits the PARENT's tier (#265). */
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
	const effectiveSharing = prop.sharing ?? sharing;
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
		ledger.push({ action: 'ensure-propdef', target: label, outcome: 'dry-run', after: { type: prop.type, sharing: effectiveSharing, mandatory: prop.required ?? false } });
		return null;
	}

	const props: Array<Record<string, unknown>> = [
		{ type: '_type', reference: propertyMetaTypeId },
		{ type: '_parent', reference: parentTypeId },
		{ type: 'name', string: prop.name },
		{ type: 'type', string: prop.type },
		{ type: '_sharing', string: effectiveSharing },
		{ type: 'description', language: 'en', string: prop.descriptionEn },
		{ type: 'description', language: 'et', string: prop.descriptionEt }
	];
	if (prop.required) props.push({ type: 'mandatory', boolean: true });
	if (prop.ordinal !== undefined) props.push({ type: 'ordinal', number: prop.ordinal });
	if (prop.table) props.push({ type: 'table', boolean: true });
	if (prop.search) props.push({ type: 'search', boolean: true });
	if (prop.list) props.push({ type: 'list', boolean: true });

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
	ledger.push({ action: 'ensure-propdef', target: label, id: body._id, outcome: 'created', after: { type: prop.type, sharing: effectiveSharing, mandatory: prop.required ?? false } });
	return body._id;
}

/** Read back a prop-def's `_sharing`, throw on mismatch: a landed write may differ (#265). */
export async function assertPropDefSharing(
	cfg: EntuCfg,
	propDefId: string,
	label: string,
	expectedSharing: Sharing,
	ledger: LedgerStep[],
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const res = await entuFetch(cfg.db, `entity/${propDefId}?props=_sharing`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`assertPropDefSharing('${label}'): read-back GET failed: ${res.status}`);
	const body = (await res.json()) as { entity?: { _sharing?: Array<{ string?: string }> } };
	const actualSharing = body.entity?._sharing?.at(0)?.string;

	if (actualSharing !== expectedSharing) {
		const msg = `assertPropDefSharing('${label}'): READ-BACK MISMATCH — expected '${expectedSharing}', got '${actualSharing ?? '(absent)'}'. This is exactly the mvox-app#265 inherit-from-parent trap; do not proceed.`;
		ledger.push({ action: 'ensure-propdef', target: `${label}.sharing-readback`, outcome: 'failed', error: msg });
		throw new Error(msg);
	}

	ledger.push({ action: 'ensure-propdef', target: `${label}.sharing-readback`, id: propDefId, outcome: 'found', after: { sharing: actualSharing } });
}

/** Wire `add_from` on a type-def to another's id; idempotent, leaves a different target. */
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
