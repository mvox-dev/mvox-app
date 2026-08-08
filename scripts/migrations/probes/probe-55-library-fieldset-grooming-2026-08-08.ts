// Read-only field-set grooming pass (#55 / T6.1, epic #54). Re-verifies live
// (not trusted from #41 memory) the prop-def _sharing state across
// work/edition/copy/lending, cross-referenced against the three settled
// rulings from Gama's dispatch:
//   1. Field set: title/composer (work), name/publisher (edition), number+location (copy)
//   2. Audience: all members (domain)
//   3. Borrower identity: DOMAIN-OPEN — lending's borrower ref + lent-date join domain
// No writes — output grounds T6.2's §8.6 widen scope.
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';

const PROPERTY_META_ID = '69bcfd8e9c031ab8e6ce8048';
const TYPES: Record<string, string> = {
	work: '69c7ea4c8489bfcb0e819f3e',
	edition: '69c7ea4e8489bfcb0e819f9c',
	copy: '6a0d2e8190c8df7a1cc7ddb0',
	lending: '6a0d2e8190c8df7a1cc7dde8'
};

async function main() {
	const cfg = await loadCfg();
	const result: Record<string, unknown> = {};

	for (const [typeName, typeId] of Object.entries(TYPES)) {
		const [typeRes, countRes, propDefRes] = await Promise.all([
			entuFetch(cfg.db, `entity/${typeId}?props=name,_sharing`, cfg.token),
			entuFetch(cfg.db, `entity?_type.reference=${typeId}&props=_id&limit=1000`, cfg.token),
			entuFetch(cfg.db, `entity?_type.reference=${PROPERTY_META_ID}&_parent.reference=${typeId}&props=name,_sharing,type&limit=200`, cfg.token)
		]);
		if (!typeRes.ok) throw new Error(`type entity fetch failed for ${typeName}: ${typeRes.status}`);
		if (!countRes.ok) throw new Error(`instance count fetch failed for ${typeName}: ${countRes.status}`);
		if (!propDefRes.ok) throw new Error(`propdef fetch failed for ${typeName}: ${propDefRes.status}`);

		const typeBody = (await typeRes.json()) as { entity?: { name?: Array<{ string: string }>; _sharing?: Array<{ string: string }> } };
		if (typeBody.entity?.name?.[0]?.string !== typeName) {
			throw new Error(`type id mismatch for ${typeName}: got name=${JSON.stringify(typeBody.entity?.name?.[0]?.string)}`);
		}
		const countBody = (await countRes.json()) as { count: number };
		const propDefBody = (await propDefRes.json()) as {
			entities: Array<{ _id: string; name?: Array<{ string: string }>; _sharing?: Array<{ string: string }>; type?: Array<{ string: string }> }>;
		};

		result[typeName] = {
			typeId,
			ownSharing: typeBody.entity?._sharing?.[0]?.string ?? '(absent)',
			liveInstanceCount: countBody.count,
			propDefs: propDefBody.entities.map((e) => ({
				id: e._id,
				name: e.name?.[0]?.string ?? '(unnamed)',
				propType: e.type?.[0]?.string ?? '(untyped)',
				currentSharing: e._sharing?.[0]?.string ?? '(absent)'
			}))
		};
	}

	console.log(JSON.stringify({ issue: '#55 (T6.1, epic #54) — library field-set grooming pass, live re-verification', readOnly: true, types: result }, null, 2));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
