// Read-only discovery probe (#41 / epic #37 Phase 1 prep): full list of the 27
// "entity"-typed rows (type-definitions + system meta-types) so the main inventory
// probe can separate the ~22 content types from system types (entity/menu/plugin/
// property/database/search/datatype). No writes.
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';

async function main() {
	const cfg = await loadCfg();
	const r = await entuFetch(cfg.db, `entity?_type.string=entity&props=name&limit=100`, cfg.token);
	if (!r.ok) throw new Error(`entity-typed list failed: ${r.status}`);
	const body = (await r.json()) as {
		count: number;
		entities: Array<{ _id: string; name?: Array<{ string: string }> }>;
	};
	const list = body.entities.map((e) => ({ id: e._id, name: e.name?.[0]?.string ?? '(unnamed)' }));
	console.log(JSON.stringify({ count: body.count, list }, null, 2));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
