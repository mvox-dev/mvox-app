// Read-only, expedited pre-check (#43 / epic #37 D3 execution order 1). Does any
// person entity carry a live VALUE under entu_api_key or entu_passkey? Presence only —
// this script never reads, logs, or returns the `.string` value of either property
// (both are credential material: entu_api_key is a SHA-256 hash, entu_passkey is a
// WebAuthn credential blob). Only property _id (an opaque identifier, not a secret)
// and boolean presence are surfaced. No writes.
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';

const PERSON_TYPE_ID = '69bcfd8e9c031ab8e6ce805f';

async function main() {
	const cfg = await loadCfg();
	const res = await entuFetch(
		cfg.db,
		`entity?_type.reference=${PERSON_TYPE_ID}&props=name,entu_api_key,entu_passkey&limit=200`,
		cfg.token
	);
	if (!res.ok) throw new Error(`person list failed: ${res.status}`);
	type PersonRow = {
		_id: string;
		name?: Array<{ string: string }>;
		// Presence-only typing — deliberately no `.string` access anywhere below.
		entu_api_key?: Array<{ _id: string }>;
		entu_passkey?: Array<{ _id: string }>;
	};
	const body = (await res.json()) as { count: number; entities: PersonRow[] };
	if (body.count !== body.entities.length) {
		throw new Error(`person list truncated: count=${body.count} entities=${body.entities.length}`);
	}

	const affected: Array<{ personId: string; hasApiKey: boolean; hasPasskey: boolean; apiKeyPropId: string | null; passkeyPropId: string | null }> = [];
	for (const p of body.entities) {
		const hasApiKey = (p.entu_api_key?.length ?? 0) > 0;
		const hasPasskey = (p.entu_passkey?.length ?? 0) > 0;
		if (hasApiKey || hasPasskey) {
			affected.push({
				personId: p._id,
				hasApiKey,
				hasPasskey,
				apiKeyPropId: hasApiKey ? p.entu_api_key![0]._id : null,
				passkeyPropId: hasPasskey ? p.entu_passkey![0]._id : null
			});
		}
	}

	console.log(
		JSON.stringify(
			{
				issue: '#43 (epic #37 D3 execution order 1) — credential value pre-check on person entities',
				readOnly: true,
				valuesLogged: false,
				totalPersonsChecked: body.count,
				affectedPersonCount: affected.length,
				affected
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
