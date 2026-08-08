// Read-only probe (urgent, team-lead dispatch): why does a member seat see
// NO library entries despite T6.2b's clean gate-3 close? Suspected mechanism:
// the `menu` TYPE's own prop-defs (name, query, ordinal, group, _sharing)
// carry no `_sharing` themselves — gate 1 of the 3-gate-AND for the MENU
// ENTITY's fields, distinct from the library entities' own gates (already
// closed by T6.1/T6.2/T6.2b). If menu prop-defs are absent/private, a menu
// entry's field VALUES (its name, its query string, its ordinal) never reach
// the domain bucket regardless of the menu ENTITY's own `_sharing:domain` —
// same aggregate.js cap mechanic diagnosed for member.person/section in #20.
// A domain reader would receive an entity shell with no readable fields, so
// the Entu frontend has nothing to render — the menu row effectively
// vanishes, independent of whether the type it points at is itself visible.
//
// No writes. Cannot obtain a raw member-seat bucket read (ENTU_ADMIN_KEY
// confirmed anonymous-floor in #44) — this probe instead reads gate 1 (the
// menu prop-defs' own _sharing) directly, which is definitive on its own:
// per the established 3-gate-AND mechanic, gate 1 absent caps EVERY instance
// of that property into the private bucket regardless of gates 2/3, so no
// member-seat read is needed to answer "does this field ever reach domain."
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';

const MENU_TYPE_ID = '69bcfd8e9c031ab8e6ce803c';
const PROPERTY_META_ID = '69bcfd8e9c031ab8e6ce8048';

async function main() {
	const cfg = await loadCfg();

	// 1. Menu TYPE's own _sharing (gate 2 for menu entities' fields).
	const typeRes = await entuFetch(cfg.db, `entity/${MENU_TYPE_ID}?props=name,_sharing`, cfg.token);
	const typeBody = (await typeRes.json()) as { entity?: { name?: Array<{ string: string }>; _sharing?: Array<{ string: string }> } };
	console.log('=== menu TYPE entity ===');
	console.log(`name=${typeBody.entity?.name?.[0]?.string} ownSharing=${typeBody.entity?._sharing?.[0]?.string ?? '(absent)'}`);

	// 2. Menu prop-defs (gate 1 for every menu entry's fields: name/query/ordinal/group/_sharing).
	const propDefRes = await entuFetch(cfg.db, `entity?_type.reference=${PROPERTY_META_ID}&_parent.reference=${MENU_TYPE_ID}&props=name,_sharing,type&limit=100`, cfg.token);
	const propDefBody = (await propDefRes.json()) as {
		entities: Array<{ _id: string; name?: Array<{ string: string }>; _sharing?: Array<{ string: string }>; type?: Array<{ string: string }> }>;
	};
	console.log('\n=== menu prop-defs (gate 1) ===');
	for (const pd of propDefBody.entities) {
		console.log(`${pd.name?.[0]?.string?.padEnd(12)} type=${pd.type?.[0]?.string?.padEnd(10)} sharing=${pd._sharing?.[0]?.string ?? '(absent)'} id=${pd._id}`);
	}

	// 3. Library-related menu entries: full read, own _sharing, sample field presence.
	const menuListRes = await entuFetch(cfg.db, `entity?_type.string=menu&props=name,query,_sharing&limit=100`, cfg.token);
	const menuListBody = (await menuListRes.json()) as {
		entities: Array<{ _id: string; name?: Array<{ string: string; language?: string }>; query?: Array<{ string: string }>; _sharing?: Array<{ string: string }> }>;
	};
	const libraryRelated = menuListBody.entities.filter((e) => {
		const q = e.query?.[0]?.string ?? '';
		return q.includes('_type.string=work') || q.includes('_type.string=edition') || q.includes('_type.string=copy') || q.includes('_type.string=lending') || q.includes('_type.string=library');
	});
	console.log('\n=== library-related menu entries (own entity state) ===');
	for (const e of libraryRelated) {
		console.log(`${(e.name?.find((n) => n.language === 'en')?.string ?? e.name?.[0]?.string ?? '?').padEnd(12)} id=${e._id} ownSharing=${e._sharing?.[0]?.string ?? '(absent)'} query=${e.query?.[0]?.string}`);
	}

	// 4. Read one specific entry (e.g. "Libraries") with a fully unfiltered GET — even as
	// db-root (always private-bucket-omniscient) this shows whether name/query/ordinal
	// round-trip at all (they should, for db-root) — establishes the field VALUES exist,
	// only their bucket placement is in question (answered definitively by step 2 above).
	const librariesEntry = libraryRelated.find((e) => (e.query?.[0]?.string ?? '').includes('_type.string=library'));
	if (librariesEntry) {
		const fullRes = await entuFetch(cfg.db, `entity/${librariesEntry._id}`, cfg.token);
		const fullBody = await fullRes.json();
		console.log('\n=== full unfiltered read of "Libraries" menu entry (db-root, always private-bucket-omniscient) ===');
		console.log(JSON.stringify(fullBody, null, 2));
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
