// Read-only probe for #256: is `organization` live, and what _sharing do the parent types carry?

import { loadCfg } from '../lib/creds';
import { loadCredeCfg } from '../lib/script-runner';
import { resolveMetaTypeIds } from '../lib/ensure-schema-type';
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/entu/cfg';

async function checkDb(label: string, cfg: EntuCfg): Promise<void> {
	console.log(`\n=== ${label} (db=${cfg.db}) ===`);
	const { entityMetaTypeId } = await resolveMetaTypeIds(cfg);
	for (const tname of ['organization', 'database', 'section', 'repertoire_item']) {
		const res = await entuFetch(
			cfg.db,
			`entity?_type.reference=${entityMetaTypeId}&name.string=${tname}&props=_id,_sharing&limit=1`,
			cfg.token,
			{},
			fetch
		);
		if (!res.ok) {
			console.log(`  ${tname}: GET failed ${res.status}`);
			continue;
		}
		const body = (await res.json()) as { entities?: Array<{ _id: string; _sharing?: Array<{ string?: string }> }> };
		const e = body.entities?.[0];
		console.log(`  ${tname}: ${e ? `id=${e._id} sharing=${e._sharing?.[0]?.string ?? '(absent)'}` : 'NOT FOUND'}`);
	}
}

async function main(): Promise<void> {
	const polyCfg = await loadCfg();
	await checkDb('polyphony', polyCfg);
	const credeCfg = await loadCredeCfg();
	await checkDb('mvox_crede', credeCfg);
}

main().catch((err) => {
	console.error('probe-256-link-premise-check ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
