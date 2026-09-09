// mvox-app#256 — read-only premise check before defining the `link` extension
// type. Two questions, established empirically rather than assumed (per the
// mvox-app#265 lesson: "same as the sibling" and "inherits the parent" are
// different questions that only look interchangeable until checked):
//
//   1. Is `organization` still live, or was it fully retired by #161 (org ->
//      database-entity migration, 2026-08)? `admin_member_record` (#265) hit
//      this exact trap — its shape review approved `organization` as parent,
//      but neither db had that type-def live; the collective root is the
//      `database` entity on both. The #256 issue thread's own prose says
//      "organization-parented" / "parented by the collective" throughout —
//      checking whether that resolves to a live type-def or needs the same
//      correction admin_member_record needed.
//   2. What `_sharing` do the `section` and `repertoire_item` type-defs
//      actually carry live? The #256 ruling says link "mirrors repertoire_item
//      and section" for the `display_order` precedent — this checks whether
//      that mirroring extends to the type-level sharing tier too, rather than
//      assuming it does.
//
// No writes. No fixtures. Nothing to tear down.

import { loadCfg } from '../lib/creds';
import { loadCredeCfg } from '../lib/script-runner';
import { resolveMetaTypeIds } from '../lib/ensure-schema-type';
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

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
