// Read-only ownership pre-check (#46 / epic #37 D1, requested by Gama). Before
// #46's dry-run (Phase B deletes corroborated-twin orphan members; Phase C
// narrows the remainder's `_sharing` to private), determine which of the 115
// orphan member entities db-root actually holds `_owner` on — DELETE /entity
// and any rightType-property write (`_sharing`) both require `_owner`, not
// just `_editor`. #44 and #45 both hit 403s from the SAME underlying gap
// (entities created by/under Mihkel's real OAuth identity, not db-root). This
// grounds a one-time mechanism call for the whole 115-row batch instead of
// discovering it 403-by-403 mid-run. No writes.
import { readFileSync } from 'node:fs';
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';

const MEMBER_TYPE_ID = '69c7ea4a8489bfcb0e819edd';
const DB_ROOT_PERSON_ID = '69bcfd8e9c031ab8e6ce8079';
const MIHKEL_OAUTH_PERSON_ID = '6a2fc05e4cd971291c5d5ddc'; // the id behind #44's + #45's 403s

// Baseline loaded from #41's own committed artifact at runtime (not
// hand-transcribed — avoids transcription risk on a 115-entry id list).
const BASELINE_ARTIFACT_PATH = 'scripts/migrations/seed-results/probe-epic37-phase1-inventory-2026-08-08T02-19-47-000Z.json';

type BaselineArtifact = {
	item2_orphanSingerPartition: {
		withTwin: Array<{ orphanId: string }>;
		withoutTwin: Array<{ orphanId: string }>;
	};
};

function loadOrphan115Baseline(): string[] {
	const raw = readFileSync(BASELINE_ARTIFACT_PATH, 'utf-8');
	const artifact = JSON.parse(raw) as BaselineArtifact;
	const ids = [
		...artifact.item2_orphanSingerPartition.withTwin.map((e) => e.orphanId),
		...artifact.item2_orphanSingerPartition.withoutTwin.map((e) => e.orphanId)
	];
	if (ids.length !== 115) {
		throw new Error(`loadOrphan115Baseline: expected 115 ids from ${BASELINE_ARTIFACT_PATH}, got ${ids.length} — #41 artifact may have changed`);
	}
	return ids;
}

async function main() {
	const cfg = await loadCfg();
	const baseline = loadOrphan115Baseline();

	const res = await entuFetch(cfg.db, `entity?_type.reference=${MEMBER_TYPE_ID}&props=_id,person,_owner&limit=1000`, cfg.token);
	if (!res.ok) throw new Error(`member census GET failed: ${res.status}`);
	type Row = { _id: string; person?: Array<{ reference: string }>; _owner?: Array<{ reference: string; string: string; entity_type: string; inherited?: boolean }> };
	const body = (await res.json()) as { count: number; entities: Row[] };
	if (body.count !== body.entities.length) {
		throw new Error(`member census truncated: count=${body.count} entities=${body.entities.length}`);
	}

	const orphans = body.entities.filter((m) => !(m.person && m.person.length > 0));
	const liveOrphanIds = orphans.map((m) => m._id).sort();
	const expected = [...new Set(baseline)].sort();
	const missingFromBaseline = expected.filter((id) => !liveOrphanIds.includes(id));
	const newSinceBaseline = liveOrphanIds.filter((id) => !expected.includes(id));

	type Classification = 'db-root-owned' | 'mihkel-oauth-owned' | 'other';
	const histogram: Record<Classification, number> = { 'db-root-owned': 0, 'mihkel-oauth-owned': 0, other: 0 };
	const nonDbRootOwned: Array<{ id: string; classification: Classification; ownerRefs: Array<{ reference: string; entity_type: string; string: string }> }> = [];

	for (const m of orphans) {
		const owners = m._owner ?? [];
		const ownerRefs = owners.map((o) => ({ reference: o.reference, entity_type: o.entity_type, string: o.string }));
		const isDbRootOwned = owners.some((o) => o.reference === DB_ROOT_PERSON_ID);
		const isMihkelOauthOwned = owners.some((o) => o.reference === MIHKEL_OAUTH_PERSON_ID);
		let classification: Classification;
		if (isDbRootOwned) classification = 'db-root-owned';
		else if (isMihkelOauthOwned) classification = 'mihkel-oauth-owned';
		else classification = 'other';
		histogram[classification]++;
		if (classification !== 'db-root-owned') {
			nonDbRootOwned.push({ id: m._id, classification, ownerRefs });
		}
	}

	console.log(
		JSON.stringify(
			{
				issue: '#46 (#37-P3.4) — orphan-115 _owner pre-check, requested by Gama before dry-run',
				readOnly: true,
				baselineSource: BASELINE_ARTIFACT_PATH,
				populationCheck: {
					liveOrphanCount: orphans.length,
					baselineCount: expected.length,
					missingFromBaseline,
					newSinceBaseline
				},
				ownershipHistogram: histogram,
				nonDbRootOwnedTargets: nonDbRootOwned,
				nonDbRootOwnedCount: nonDbRootOwned.length
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
