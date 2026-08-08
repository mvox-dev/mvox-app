// Read-only inventory (#48 / #37-P3.6, Phase 1). Which types + prop-defs lack
// a `description`, and what does the `member` type's list rendering look
// like today (no `name` prop-def since T3.1 bundle 3). No mutations.
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';

const PROPERTY_META_ID = '69bcfd8e9c031ab8e6ce8048';
const ENTITY_META_ID = '69bcfd8e9c031ab8e6ce8034';
const SYSTEM_TYPE_NAMES = new Set(['database', 'entity', 'menu', 'plugin', 'property']);

async function main() {
	const cfg = await loadCfg();

	// 1. Full live type registry (post #45 deletions).
	const typesRes = await entuFetch(cfg.db, `entity?_type.reference=${ENTITY_META_ID}&props=name,description&limit=100`, cfg.token);
	const typesBody = (await typesRes.json()) as {
		count: number;
		entities: Array<{ _id: string; name?: Array<{ string: string }>; description?: Array<{ string: string }> }>;
	};
	const contentTypes = typesBody.entities.filter((e) => !SYSTEM_TYPE_NAMES.has(e.name?.[0]?.string ?? ''));

	console.log(`=== Type registry: ${typesBody.count} total, ${contentTypes.length} content types (excl. 5 system types) ===`);
	const typeResults: Array<{ id: string; name: string; hasDescription: boolean; description: string | null }> = [];
	for (const t of contentTypes) {
		const name = t.name?.[0]?.string ?? '(unnamed)';
		const desc = t.description?.[0]?.string ?? null;
		typeResults.push({ id: t._id, name, hasDescription: !!desc && desc.trim().length > 0, description: desc });
	}
	typeResults.sort((a, b) => a.name.localeCompare(b.name));
	for (const t of typeResults) {
		console.log(`${t.name.padEnd(18)} hasDescription=${t.hasDescription} id=${t.id}${t.description ? ` desc="${t.description.slice(0, 50)}"` : ''}`);
	}

	// 2. Per-type prop-def description counts.
	console.log('\n=== Prop-def description counts per type ===');
	const propDefResults: Array<{ type: string; total: number; withDescription: number; withoutDescription: number; missingNames: string[] }> = [];
	for (const t of contentTypes) {
		const name = t.name?.[0]?.string ?? '(unnamed)';
		const pdRes = await entuFetch(cfg.db, `entity?_type.reference=${PROPERTY_META_ID}&_parent.reference=${t._id}&props=name,description&limit=200`, cfg.token);
		const pdBody = (await pdRes.json()) as { entities: Array<{ name?: Array<{ string: string }>; description?: Array<{ string: string }> }> };
		const total = pdBody.entities.length;
		const withDescription = pdBody.entities.filter((p) => (p.description?.[0]?.string ?? '').trim().length > 0).length;
		const missingNames = pdBody.entities.filter((p) => (p.description?.[0]?.string ?? '').trim().length === 0).map((p) => p.name?.[0]?.string ?? '?');
		propDefResults.push({ type: name, total, withDescription, withoutDescription: total - withDescription, missingNames });
	}
	propDefResults.sort((a, b) => b.withoutDescription - a.withoutDescription);
	let totalPropDefs = 0;
	let totalMissing = 0;
	for (const r of propDefResults) {
		totalPropDefs += r.total;
		totalMissing += r.withoutDescription;
		console.log(`${r.type.padEnd(18)} total=${r.total.toString().padStart(3)} withDesc=${r.withDescription.toString().padStart(3)} missing=${r.withoutDescription.toString().padStart(3)}${r.withoutDescription === r.total && r.total > 0 ? ' <-- ALL MISSING' : ''}`);
	}
	console.log(`\nTotals: ${totalPropDefs} prop-defs across ${contentTypes.length} types, ${totalMissing} missing description.`);

	// 3. Member type display config investigation.
	console.log('\n=== member type + prop-defs (display config check) ===');
	const memberType = contentTypes.find((t) => t.name?.[0]?.string === 'member');
	if (memberType) {
		const fullRes = await entuFetch(cfg.db, `entity/${memberType._id}`, cfg.token);
		const fullBody = await fullRes.json();
		console.log('member TYPE full entity:', JSON.stringify(fullBody, null, 2));
	}

	console.log(JSON.stringify({ typeResults, propDefResults: propDefResults.map((r) => ({ ...r, missingNames: undefined })), totalPropDefs, totalMissing }, null, 2));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
