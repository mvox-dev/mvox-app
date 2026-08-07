// Read-only follow-up: what _sharing tier do the person type's REMAINING prop-defs
// carry (post-T4.3 name/email/notes removal)? And member.person's own prop-def tier?
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';

const META_TYPE_ENTITY_ID = '69bcfd8e9c031ab8e6ce8034';

async function propDefsForType(cfg: { db: string; token: string }, typeId: string) {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.reference=${META_TYPE_ENTITY_ID}&_parent.reference=${typeId}&props=name,_sharing,type&limit=200`,
		cfg.token
	);
	if (!res.ok) throw new Error(`propdef list failed for ${typeId}: ${res.status}`);
	const body = (await res.json()) as {
		count: number;
		entities: Array<{
			_id: string;
			name?: Array<{ string: string }>;
			_sharing?: Array<{ string: string }>;
			type?: Array<{ string: string }>;
		}>;
	};
	return body.entities.map((e) => ({
		id: e._id,
		name: e.name?.[0]?.string ?? '(unnamed)',
		sharing: e._sharing?.[0]?.string ?? '(absent)',
		type: e.type?.[0]?.string ?? '(untyped)'
	}));
}

async function main() {
	const cfg = await loadCfg();
	const personTypeId = '69bcfd8e9c031ab8e6ce805f'; // person type entity (T4.3 finding doc)
	const memberTypeId = '69c7ea4a8489bfcb0e819edd'; // member type entity
	const profileTypeId = '6a74933f36c951d9114ec817'; // profile type entity (T4.3)

	const [personDefs, memberDefs, profileDefs] = await Promise.all([
		propDefsForType(cfg, personTypeId),
		propDefsForType(cfg, memberTypeId),
		propDefsForType(cfg, profileTypeId)
	]);

	// Also read the TYPE entities' own _sharing (the cap).
	const [personTypeRes, memberTypeRes, profileTypeRes] = await Promise.all([
		entuFetch(cfg.db, `entity/${personTypeId}?props=_sharing,name`, cfg.token),
		entuFetch(cfg.db, `entity/${memberTypeId}?props=_sharing,name`, cfg.token),
		entuFetch(cfg.db, `entity/${profileTypeId}?props=_sharing,name`, cfg.token)
	]);
	const typeEntitySharing = async (res: Response) => {
		if (!res.ok) throw new Error(`type entity fetch failed: ${res.status}`);
		const body = (await res.json()) as { entity: { _sharing?: Array<{ string: string }> } };
		return body.entity._sharing?.[0]?.string ?? '(absent)';
	};

	console.log(JSON.stringify({
		personType: { id: personTypeId, ownSharing: await typeEntitySharing(personTypeRes), propDefs: personDefs },
		memberType: { id: memberTypeId, ownSharing: await typeEntitySharing(memberTypeRes), propDefs: memberDefs },
		profileType: { id: profileTypeId, ownSharing: await typeEntitySharing(profileTypeRes), propDefs: profileDefs }
	}, null, 2));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
