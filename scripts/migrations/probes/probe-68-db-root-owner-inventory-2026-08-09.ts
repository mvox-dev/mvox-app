// Read-only inventory (#68, epic #37, Phase 1). Enumerate EVERY entity in the
// db and report which ones db-root (person 69bcfd8e9c031ab8e6ce8079) does NOT
// hold `_owner` on. Governance: Mihkel's ruling on #68 — "all objects must be
// under dev team's control... this installation is sandbox now, but should
// transform to template at the finish line." No writes.
//
// Coverage strategy: the "entity" meta-type (ENTITY_META_ID) registers every
// type-def, INCLUDING the 5 system types (database/entity/menu/plugin/property)
// alongside the 20 content types (post-#45). Querying instances of EVERY
// registered type-def id therefore covers: content instances (person, member,
// organization, ...), prop-def entities (instances of "property"), type-def
// entities themselves (instances of "entity", self-referential), menu rows
// (instances of "menu"), plugin rows (instances of "plugin"), and the db-root
// entity itself (instance of "database") — one loop, full population, no
// entity kind left out.
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';

const ENTITY_META_ID = '69bcfd8e9c031ab8e6ce8034';
const DB_ROOT_PERSON_ID = '69bcfd8e9c031ab8e6ce8079';
const MIHKEL_OAUTH_PERSON_ID = '6a2fc05e4cd971291c5d5ddc';
const PAGE_LIMIT = 1000;

type OwnerRef = { reference: string; entity_type?: string; string?: string };
type Row = { _id: string; name?: Array<{ string: string }>; _owner?: OwnerRef[] };
type TypeRow = { _id: string; name?: Array<{ string: string }> };

async function fetchAllInstances(db: string, token: string, typeId: string): Promise<Row[]> {
	const all: Row[] = [];
	let skip = 0;
	for (;;) {
		const res = await entuFetch(db, `entity?_type.reference=${typeId}&props=name,_owner&limit=${PAGE_LIMIT}&skip=${skip}`, token);
		if (!res.ok) throw new Error(`instance GET failed for type ${typeId} at skip=${skip}: ${res.status}`);
		const body = (await res.json()) as { count: number; entities: Row[] };
		all.push(...body.entities);
		if (all.length >= body.count || body.entities.length === 0) {
			if (all.length !== body.count) {
				throw new Error(`fetchAllInstances: pagination mismatch for type ${typeId} — collected ${all.length}, count=${body.count}`);
			}
			return all;
		}
		skip += body.entities.length;
	}
}

async function main() {
	const cfg = await loadCfg();

	const typesRes = await entuFetch(cfg.db, `entity?_type.reference=${ENTITY_META_ID}&props=name&limit=100`, cfg.token);
	if (!typesRes.ok) throw new Error(`type registry GET failed: ${typesRes.status}`);
	const typesBody = (await typesRes.json()) as { count: number; entities: TypeRow[] };
	if (typesBody.count !== typesBody.entities.length) {
		throw new Error(`type registry truncated: count=${typesBody.count} entities=${typesBody.entities.length}`);
	}
	const types = typesBody.entities
		.map((t) => ({ id: t._id, name: t.name?.[0]?.string ?? '(unnamed)' }))
		.sort((a, b) => a.name.localeCompare(b.name));

	type Classification = 'db-root-owned' | 'mihkel-oauth-owned' | 'other-owned' | 'no-owner';
	type Flagged = { id: string; name: string; classification: Classification; ownerRefs: OwnerRef[] };

	const perType: Array<{ type: string; typeId: string; total: number; dbRootOwned: number; flagged: Flagged[] }> = [];
	let grandTotal = 0;
	let grandDbRootOwned = 0;
	const histogram: Record<Classification, number> = { 'db-root-owned': 0, 'mihkel-oauth-owned': 0, 'other-owned': 0, 'no-owner': 0 };

	for (const t of types) {
		const instances = await fetchAllInstances(cfg.db, cfg.token, t.id);
		const flagged: Flagged[] = [];
		let dbRootOwned = 0;
		for (const inst of instances) {
			const owners = inst._owner ?? [];
			const isDbRootOwned = owners.some((o) => o.reference === DB_ROOT_PERSON_ID);
			if (isDbRootOwned) {
				dbRootOwned++;
				continue;
			}
			const isMihkelOauthOwned = owners.some((o) => o.reference === MIHKEL_OAUTH_PERSON_ID);
			const classification: Classification = owners.length === 0 ? 'no-owner' : isMihkelOauthOwned ? 'mihkel-oauth-owned' : 'other-owned';
			histogram[classification]++;
			flagged.push({
				id: inst._id,
				name: inst.name?.[0]?.string ?? '(no name prop)',
				classification,
				ownerRefs: owners.map((o) => ({ reference: o.reference, entity_type: o.entity_type, string: o.string }))
			});
		}
		grandTotal += instances.length;
		grandDbRootOwned += dbRootOwned;
		perType.push({ type: t.name, typeId: t.id, total: instances.length, dbRootOwned, flagged });
		console.error(`${t.name.padEnd(18)} total=${instances.length.toString().padStart(4)} dbRootOwned=${dbRootOwned.toString().padStart(4)} flagged=${flagged.length}`);
	}

	const flaggedTotal = perType.reduce((sum, t) => sum + t.flagged.length, 0);

	console.log(
		JSON.stringify(
			{
				issue: '#68 (epic #37) — db-root _owner backfill, Phase 1 read-only inventory',
				readOnly: true,
				dbRootPersonId: DB_ROOT_PERSON_ID,
				mihkelOauthPersonId: MIHKEL_OAUTH_PERSON_ID,
				typeCount: types.length,
				grandTotalEntities: grandTotal,
				grandDbRootOwned,
				grandFlagged: flaggedTotal,
				histogram,
				perType: perType.map((t) => ({ type: t.type, typeId: t.typeId, total: t.total, dbRootOwned: t.dbRootOwned, flaggedCount: t.flagged.length })),
				flaggedByType: perType.filter((t) => t.flagged.length > 0).map((t) => ({ type: t.type, typeId: t.typeId, flagged: t.flagged }))
			},
			null,
			2
		)
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
