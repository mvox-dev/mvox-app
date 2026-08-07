// T3.1 (#17) Bundle 3 — schema mutation: remove the `name` prop-def from the
// `member` type on polyphony. Authorized on #17 (§8.6 chain, sequenced after
// #36 merging — main @ 7177f85 confirmed to no longer write `member.name`, see
// `inviteData.ts:288-295`). Owner: Pérotin.
//
// Single schema-level DELETE, not a bulk data write — no per-record engine
// needed. Precondition already verified twice before this script runs at all:
// (1) source read of inviteData.ts on main, (2) this script's own live
// re-check immediately before the DELETE. Deleting a prop-def does NOT purge
// existing property VALUES (T4.3 precedent, RECON-confirmed): the 115 legacy
// orphan `member` rows that still carry a raw `name` string keep it — this
// mutation only removes the prop-def (the schema declaration), not those
// values. Their disposition was explicitly ruled OUT of this task's scope on
// #17 ("surfaced separately for a PO decision, not an AC here").
//
// Run:
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   pnpm run migrate:t3-1-bundle3:dry     # DRY_RUN=true  (read-only precheck only)
//   pnpm run migrate:t3-1-bundle3:live    # DRY_RUN=false (ONLY after #17 §8.6 authorization)

import { loadCfg } from './lib/creds';
import { entuFetch } from '$lib/entu/request';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

/** The `member` type entity — resolved live below by name, not hardcoded, so a
 * drift in the type id itself would surface rather than silently miss. */
const MEMBER_TYPE_NAME = 'member';
const PROP_DEF_NAME = 'name';

type PropDefRow = { _id: string; name?: Array<{ string: string }> };

async function findMemberTypeId(cfg: Awaited<ReturnType<typeof loadCfg>>): Promise<string> {
	const res = await entuFetch(cfg.db, `entity?_type.string=entity&name.string=${MEMBER_TYPE_NAME}&props=_id,name`, cfg.token, {});
	if (!res.ok) throw new Error(`findMemberTypeId: GET failed: ${res.status}`);
	const body = (await res.json()) as { entities?: Array<{ _id: string }> };
	const entities = body.entities ?? [];
	if (entities.length !== 1) {
		throw new Error(`findMemberTypeId: expected exactly 1 '${MEMBER_TYPE_NAME}' type entity, found ${entities.length} — refuse to proceed`);
	}
	return entities[0]._id;
}

async function findNamePropDef(cfg: Awaited<ReturnType<typeof loadCfg>>, memberTypeId: string): Promise<PropDefRow> {
	const res = await entuFetch(cfg.db, `entity?_parent.reference=${memberTypeId}&props=_id,name&limit=100`, cfg.token, {});
	if (!res.ok) throw new Error(`findNamePropDef: GET failed: ${res.status}`);
	const body = (await res.json()) as { count?: number; entities?: PropDefRow[] };
	const entities = body.entities ?? [];
	if (typeof body.count === 'number' && body.count !== entities.length) {
		throw new Error(`findNamePropDef: prop-def page truncated — count=${body.count} entities.length=${entities.length}`);
	}
	const nameProps = entities.filter((e) => e.name?.[0]?.string === PROP_DEF_NAME);
	if (nameProps.length !== 1) {
		throw new Error(
			`findNamePropDef: expected exactly 1 '${PROP_DEF_NAME}' prop-def on member type, found ${nameProps.length} ` +
				`(${nameProps.map((e) => e._id).join(', ')}) — refuse to proceed`
		);
	}
	return nameProps[0];
}

async function main(): Promise<void> {
	const cfg = await loadCfg();

	// Step-0 (READ-ONLY): resolve the member type, find its `name` prop-def,
	// HALT if the shape isn't exactly what's expected.
	const memberTypeId = await findMemberTypeId(cfg);
	const nameProp = await findNamePropDef(cfg, memberTypeId);

	console.log(`member type: ${memberTypeId}`);
	console.log(`'name' prop-def to delete: ${nameProp._id}`);

	if (DRY_RUN) {
		console.log(`WOULD DELETE entity/${nameProp._id} (the 'name' prop-def on 'member').`);
		console.log('WOULD READ-BACK the member type\'s prop-def list and confirm \'name\' is absent.');
		console.log('DRY_RUN=true — no writes issued. Set DRY_RUN=false to execute (gated).');
		process.exit(0);
	}

	// Execute: single DELETE (prop-defs are entities, NOT DELETE /property/{id} —
	// the T4.3 precedent).
	const delRes = await entuFetch(cfg.db, `entity/${nameProp._id}`, cfg.token, { method: 'DELETE' });
	if (!delRes.ok) {
		console.error(`DELETE entity/${nameProp._id} failed: ${delRes.status} — schema mutation did NOT complete.`);
		process.exit(1);
	}

	// Read-back-PROVE: re-fetch the member type's prop-defs; 'name' must be absent.
	const after = await findMemberTypeId(cfg).then((id) =>
		entuFetch(cfg.db, `entity?_parent.reference=${id}&props=_id,name&limit=100`, cfg.token, {})
	);
	if (!after.ok) {
		console.error(`read-back GET failed: ${after.status} — DELETE may have succeeded, verify by API`);
		process.exit(1);
	}
	const afterBody = (await after.json()) as { entities?: PropDefRow[] };
	const stillHasName = (afterBody.entities ?? []).some((e) => e.name?.[0]?.string === PROP_DEF_NAME);
	if (stillHasName) {
		console.error(`read-back shows 'name' STILL present on member type prop-defs — DELETE did not take effect. Do not claim success.`);
		process.exit(1);
	}

	console.log(`CONFIRMED: 'name' prop-def ${nameProp._id} deleted from member type ${memberTypeId}; read-back shows it absent.`);
	process.exit(0);
}

main().catch((err) => {
	console.error('T3.1 Bundle 3 schema mutation ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
