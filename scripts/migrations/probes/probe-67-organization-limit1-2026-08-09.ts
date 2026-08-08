// One-read rider for #67 (requested alongside #68 Phase 1). #67's closed-out
// fix moves the invite picker off `organization`-entity enumeration onto
// database enumeration — this checks which `organization` entity a naive
// `_type.string=organization&limit=1` query would have returned (EFK, the
// one real collective, or one of the 5 unreferenced v4E-era ghosts from the
// #41 inventory), closing the QUALIFIED residual on whether the old path's
// default pick was ever accidentally correct. No writes.
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';

async function main() {
	const cfg = await loadCfg();
	const res = await entuFetch(cfg.db, `entity?_type.string=organization&props=name,_id&limit=1`, cfg.token);
	if (!res.ok) throw new Error(`GET failed: ${res.status}`);
	const body = await res.json();
	console.log(JSON.stringify(body, null, 2));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
