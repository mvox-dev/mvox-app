// Read-only corrected comparison (#46 follow-up, Gama ruling 2026-08-08 07:27
// on #37). The original Phase A/B comparison read `member.section` /
// `member.current_section` PROPERTIES on the twin side — both are 0/131
// live (confirmed in the #46 dry-run). Gama's correction: the canonical v4E
// shape carries section membership as a `_parent` REFERENCE on the member
// entity (member is multi-parent under org + section(s) — confirmed live on
// member `...172` during #20: parents include an `organization`-typed ref AND
// a `section`-typed ref, distinguished by each `_parent` array entry's own
// `entity_type`). This script re-derives section-consistency using THAT
// signal instead. No writes — output only grounds a future §8.6 delete task
// if any row corroborates.
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';
import { enumerateAll, computeDispositions } from '../lib/orphan-115-disposition-2026-08-08';

async function main() {
	const cfg = await loadCfg();
	const data = await enumerateAll(cfg);
	const rows = computeDispositions(data);
	const exactMatches = rows.filter((r) => r.matchType === 'exact' && r.twinMemberIds.length === 1);

	type ParentRef = { reference: string; string: string; entity_type: string };
	const results: Array<{
		orphanId: string;
		orphanName: string;
		orphanSectionRef: string | null;
		orphanSectionName: string | null;
		twinPersonId: string;
		twinMemberId: string;
		twinParentSectionRef: string | null;
		twinParentSectionName: string | null;
		twinParentOrgRefs: Array<{ reference: string; name: string }>;
		match: 'yes' | 'no' | 'n-a';
	}> = [];

	// Fetch orphan section names too (enumerateAll only kept the reference id).
	const orphanMemberRes = await entuFetch(cfg.db, `entity?_type.string=member&props=_id,section&limit=1000`, cfg.token);
	const orphanMemberBody = (await orphanMemberRes.json()) as { entities: Array<{ _id: string; section?: Array<{ reference: string; string: string }> }> };
	const orphanSectionNameById = new Map(orphanMemberBody.entities.map((m) => [m._id, m.section?.[0]?.string ?? null]));

	for (const r of exactMatches) {
		const twinMemberId = r.twinMemberIds[0];
		const twinRes = await entuFetch(cfg.db, `entity/${twinMemberId}?props=_parent`, cfg.token);
		if (!twinRes.ok) throw new Error(`GET twin member ${twinMemberId} failed: ${twinRes.status}`);
		const twinBody = (await twinRes.json()) as { entity?: { _parent?: ParentRef[] } };
		const parents = twinBody.entity?._parent ?? [];
		const sectionParents = parents.filter((p) => p.entity_type === 'section');
		const orgParents = parents.filter((p) => p.entity_type === 'organization');

		const twinParentSectionRef = sectionParents.length === 1 ? sectionParents[0].reference : null;
		const twinParentSectionName = sectionParents.length === 1 ? sectionParents[0].string : null;

		let match: 'yes' | 'no' | 'n-a';
		if (!r.orphanSectionRef || sectionParents.length !== 1) {
			match = 'n-a';
		} else if (r.orphanSectionRef === twinParentSectionRef) {
			match = 'yes';
		} else {
			match = 'no';
		}

		results.push({
			orphanId: r.orphanId,
			orphanName: r.orphanName,
			orphanSectionRef: r.orphanSectionRef,
			orphanSectionName: orphanSectionNameById.get(r.orphanId) ?? null,
			twinPersonId: r.twinPersonIds[0],
			twinMemberId,
			twinParentSectionRef,
			twinParentSectionName,
			twinParentOrgRefs: orgParents.map((p) => ({ reference: p.reference, name: p.string })),
			match
		});
	}

	const corroborated = results.filter((r) => r.match === 'yes');
	console.log(
		JSON.stringify(
			{
				issue: '#46 follow-up — corrected twin-section comparison via _parent refs (Gama ruling 2026-08-08 07:27)',
				readOnly: true,
				lesson: 'a corroboration criterion binds to a SIGNAL, not a storage location — resolved section from the canonical _parent-reference shape, not the legacy section/current_section property (0/131 populated there)',
				exactMatchCount: exactMatches.length,
				results,
				corroboratedCount: corroborated.length,
				corroboratedOrphanIds: corroborated.map((r) => r.orphanId)
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
