// Read-only probe (#20 follow-up): compare the `person` entity `_sharing` tier
// written by the #36 invite-creation path for a NEWLY created member vs the
// tier on the T3.1 bundle-2-converted 128 public-tier singers. No writes.
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';

async function main() {
	const cfg = await loadCfg();

	// 1. Reconfirm the 128 public-tier person population (fresh read, not memory).
	const personRes = await entuFetch(
		cfg.db,
		'entity?_type.string=person&props=_id,_sharing,_created&limit=1000',
		cfg.token
	);
	if (!personRes.ok) throw new Error(`person list failed: ${personRes.status}`);
	const personBody = (await personRes.json()) as {
		count: number;
		entities: Array<{ _id: string; _sharing?: Array<{ string: string }>; _created?: Array<{ datetime: string }> }>;
	};
	if (personBody.count !== personBody.entities.length) {
		throw new Error(`person list truncated: count=${personBody.count} entities=${personBody.entities.length}`);
	}
	const tierCounts: Record<string, number> = {};
	for (const p of personBody.entities) {
		const tier = p._sharing?.[0]?.string ?? '(absent)';
		tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
	}

	// 2. Fetch all member entities, classify each by tier + whether its `person` ref
	// points to a public-tier or domain-tier person.
	const memberRes = await entuFetch(
		cfg.db,
		'entity?_type.string=member&props=_id,_sharing,person,status,_created&limit=1000',
		cfg.token
	);
	if (!memberRes.ok) throw new Error(`member list failed: ${memberRes.status}`);
	const memberBody = (await memberRes.json()) as {
		count: number;
		entities: Array<{
			_id: string;
			_sharing?: Array<{ string: string }>;
			person?: Array<{ reference: string; string?: string }>;
			status?: Array<{ string: string }>;
			_created?: Array<{ datetime: string }>;
		}>;
	};
	if (memberBody.count !== memberBody.entities.length) {
		throw new Error(`member list truncated: count=${memberBody.count} entities=${memberBody.entities.length}`);
	}

	const personTierById = new Map<string, string>();
	for (const p of personBody.entities) personTierById.set(p._id, p._sharing?.[0]?.string ?? '(absent)');

	type Row = {
		memberId: string;
		memberSharing: string;
		personId: string | null;
		personSharing: string | null;
		memberCreated: string | null;
	};
	const domainMembersWithPersonRef: Row[] = [];
	for (const m of memberBody.entities) {
		const memberSharing = m._sharing?.[0]?.string ?? '(absent)';
		if (memberSharing !== 'domain') continue;
		const personRef = m.person?.[0]?.reference ?? null;
		domainMembersWithPersonRef.push({
			memberId: m._id,
			memberSharing,
			personId: personRef,
			personSharing: personRef ? (personTierById.get(personRef) ?? '(person not in list — cross-db or deleted?)') : null,
			memberCreated: m._created?.[0]?.datetime ?? null
		});
	}

	// 3. Split into: T3.1-128 population (person tier === public) vs everything else
	// (candidate #36-created members — person tier should be domain per source read
	// of src/lib/invite/inviteData.ts:213).
	const t3_1Population = domainMembersWithPersonRef.filter((r) => r.personSharing === 'public');
	const nonPublicPersonDomainMembers = domainMembersWithPersonRef.filter((r) => r.personSharing !== 'public');

	console.log(JSON.stringify({
		personTierCounts: tierCounts,
		totalMembers: memberBody.count,
		domainMembersTotal: domainMembersWithPersonRef.length,
		t3_1PopulationCount: t3_1Population.length,
		nonPublicPersonDomainMembers,
	}, null, 2));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
