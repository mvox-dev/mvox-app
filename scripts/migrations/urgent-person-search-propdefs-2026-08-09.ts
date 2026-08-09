// URGENT — team-lead dispatch 2026-08-08, Mihkel authorized directly, no §8.6
// (schema prop-def addition, not a data mutation). Person type-def
// (69bcfd8e9c031ab8e6ce805f) has no `name`/`email` prop-def at all — person
// entities aren't searchable by name, breaking the Entu UI rights picker.
// Adds two new prop-def entities as children of the person type-def, shape
// copied from organization's `name` prop-def (69c7ea478489bfcb0e819e44),
// the one other type in the db that has `search: true`.
//
// CREATE, not a property-value write on an existing entity — no rights gate
// (Entu CREATE has no parent-rights check for anyone; also independently
// confirmed live that db-root directly owns the person type-def, unlike the
// #68-blocked schema/meta entities).

import { entuFetch } from '$lib/entu/request';
import { loadCfg } from './lib/creds';

const PERSON_TYPE_ID = '69bcfd8e9c031ab8e6ce805f';
const PROPERTY_META_ID = '69bcfd8e9c031ab8e6ce8048';

type NewPropDef = { name: string; label: string };
const TARGETS: NewPropDef[] = [
	{ name: 'name', label: 'Name' },
	{ name: 'email', label: 'Email' }
];

async function main() {
	const cfg = await loadCfg();

	// Pre-check: refuse if either prop-def already exists (idempotency).
	const existingRes = await entuFetch(cfg.db, `entity?_type.reference=${PROPERTY_META_ID}&_parent.reference=${PERSON_TYPE_ID}&props=name&limit=200`, cfg.token);
	if (!existingRes.ok) throw new Error(`pre-check GET failed: ${existingRes.status}`);
	const existingBody = (await existingRes.json()) as { entities: Array<{ name?: Array<{ string: string }> }> };
	const existingNames = new Set(existingBody.entities.map((e) => e.name?.[0]?.string).filter(Boolean));
	for (const t of TARGETS) {
		if (existingNames.has(t.name)) throw new Error(`ABORT: person already has a "${t.name}" prop-def — refuse to create a duplicate`);
	}

	const created: Array<{ name: string; id: string }> = [];
	for (const t of TARGETS) {
		const res = await entuFetch(
			cfg.db,
			'entity',
			cfg.token,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify([
					{ type: '_parent', reference: PERSON_TYPE_ID },
					{ type: '_type', reference: PROPERTY_META_ID },
					{ type: 'name', string: t.name },
					{ type: 'label', string: t.label },
					{ type: 'type', string: 'string' },
					{ type: 'search', boolean: true }
				])
			}
		);
		if (!res.ok) throw new Error(`CREATE failed for "${t.name}": ${res.status} — ${await res.text()}`);
		const body = (await res.json()) as { _id?: string; properties?: Array<{ type: string; _id: string }> };
		const newId = body._id;
		if (!newId) throw new Error(`CREATE for "${t.name}" returned 2xx but no _id in response (apparent-success trap): ${JSON.stringify(body)}`);
		created.push({ name: t.name, id: newId });
	}

	// Read-back verify: both new prop-defs exist as children of person, with
	// name/type/search matching what was requested.
	const verifyRes = await entuFetch(cfg.db, `entity?_type.reference=${PROPERTY_META_ID}&_parent.reference=${PERSON_TYPE_ID}&props=name,type,search&limit=200`, cfg.token);
	if (!verifyRes.ok) throw new Error(`verify GET failed: ${verifyRes.status}`);
	const verifyBody = (await verifyRes.json()) as {
		entities: Array<{ _id: string; name?: Array<{ string: string }>; type?: Array<{ string: string }>; search?: Array<{ boolean: boolean }> }>;
	};
	for (const c of created) {
		const found = verifyBody.entities.find((e) => e._id === c.id);
		if (!found) throw new Error(`read-back verify FAILED: created prop-def ${c.name} (${c.id}) not found in live person prop-def list`);
		const name = found.name?.[0]?.string;
		const type = found.type?.[0]?.string;
		const search = found.search?.[0]?.boolean;
		if (name !== c.name || type !== 'string' || search !== true) {
			throw new Error(`read-back verify FAILED for ${c.name} (${c.id}): name=${name} type=${type} search=${search}`);
		}
	}

	console.log(JSON.stringify({ created, verified: true }, null, 2));
}

main().catch((err) => {
	console.error('URGENT person-search-propdefs ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
