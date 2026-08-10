// Probe: check _sharing on junction-type prop-defs (repertoire_item, program_item).
// Read-only — no mutations.
//
// Run:
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/probe-junction-propdef-sharing-2026-08-10.ts

import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';

const PROPERTY_META_ID = '69bcfd8e9c031ab8e6ce8048';

const JUNCTION_TYPE_IDS: Record<string, string> = {
	repertoire_item: '69c7ea538489bfcb0e81a06e',
	program_item: '69c7ea568489bfcb0e81a103'
};

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log('=== Probe: junction-type prop-def _sharing ===\n');

	for (const [typeName, typeId] of Object.entries(JUNCTION_TYPE_IDS)) {
		console.log(`--- ${typeName} (${typeId}) ---`);

		// Read the type entity itself.
		const typeRes = await entuFetch(cfg.db, `entity/${typeId}?props=name,_sharing`, cfg.token);
		if (!typeRes.ok) throw new Error(`GET type ${typeId} failed: ${typeRes.status}`);
		const typeBody = (await typeRes.json()) as {
			entity?: {
				name?: Array<{ string: string }>;
				_sharing?: Array<{ _id: string; string: string }>;
			};
		};
		const typeSharingVal = typeBody.entity?._sharing?.[0]?.string ?? '(absent/private)';
		const typeSharingPropId = typeBody.entity?._sharing?.[0]?._id ?? null;
		console.log(`  Type _sharing: ${typeSharingVal} (prop _id: ${typeSharingPropId})`);

		// List prop-defs.
		const res = await entuFetch(
			cfg.db,
			`entity?_type.reference=${PROPERTY_META_ID}&_parent.reference=${typeId}&props=name,type,_sharing,formula,list&limit=200`,
			cfg.token
		);
		if (!res.ok) throw new Error(`listPropDefs(${typeId}) failed: ${res.status}`);
		const body = (await res.json()) as {
			entities: Array<{
				_id: string;
				name?: Array<{ string: string }>;
				type?: Array<{ string: string }>;
				_sharing?: Array<{ _id: string; string: string }>;
				formula?: Array<{ string: string }>;
				list?: Array<{ boolean: boolean }>;
			}>;
		};

		console.log(`  Prop-defs (${body.entities.length}):`);
		for (const e of body.entities) {
			const name = e.name?.[0]?.string ?? '(unnamed)';
			const type = e.type?.[0]?.string ?? '(no-type)';
			const sharing = e._sharing?.[0]?.string ?? '(absent/private)';
			const sharingPropId = e._sharing?.[0]?._id ?? null;
			const formula = e.formula?.[0]?.string;
			const list = e.list?.[0]?.boolean;
			console.log(`    ${name} (${e._id}): type=${type}, _sharing=${sharing} (prop _id: ${sharingPropId})${formula ? `, formula=${formula}` : ''}${list ? `, list=true` : ''}`);
		}
		console.log('');
	}
}

main().catch((err) => {
	console.error('PROBE FAILED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Palestrina*)
