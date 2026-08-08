// Read-only inventory probe — #41 (epic #37 Phase 1). Six-item scope per the issue +
// Gama's grooming comment on #37: (1) member counts/tiers, (2) orphan/singer name-set
// partition, (3) per-type prop-def _sharing pass, (4) menu inventory, (5) type registry
// with instance counts, (6) plugins list. No writes anywhere in this script.
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';

// "property" meta-type (verified live 2026-08-08 — NOT the "entity" meta-type id
// 69bcfd8e9c031ab8e6ce8034, which the 2026-08-07 probe-person-propdef-sharing.ts
// script mistakenly used and silently returned zero prop-defs for every type).
const META_PROPERTY_TYPE_ID = '69bcfd8e9c031ab8e6ce8048';

// The 22 content types (system meta-types entity/menu/plugin/property/database excluded).
const CONTENT_TYPES: Record<string, string> = {
	person: '69bcfd8e9c031ab8e6ce805f',
	organization: '69c7ea478489bfcb0e819e3d',
	section: '69c7ea498489bfcb0e819ea3',
	member: '69c7ea4a8489bfcb0e819edd',
	work: '69c7ea4c8489bfcb0e819f3e',
	edition: '69c7ea4e8489bfcb0e819f9c',
	season: '69c7ea528489bfcb0e81a044',
	repertoire_item: '69c7ea538489bfcb0e81a06e',
	event: '69c7ea548489bfcb0e81a0a2',
	program_item: '69c7ea568489bfcb0e81a103',
	voice: '6a0d2e8090c8df7a1cc7dd6a',
	library: '6a0d2e8090c8df7a1cc7dd9d',
	copy: '6a0d2e8190c8df7a1cc7ddb0',
	lending: '6a0d2e8190c8df7a1cc7dde8',
	invitation: '6a0d2e8290c8df7a1cc7de3e',
	application: '6a0d2e8390c8df7a1cc7de81',
	event_series: '6a0d2e8490c8df7a1cc7deb1',
	rsvp: '6a0d2e8590c8df7a1cc7df1b',
	attendance: '6a0d2e8690c8df7a1cc7df4b',
	_probe_bulletin: '6a320169487a9c1f02f70ad6',
	mvox_collective: '6a73880336c951d9114ec63d',
	profile: '6a74933f36c951d9114ec817'
};

type Cfg = { db: string; token: string };

async function typeEntitySharing(cfg: Cfg, typeId: string): Promise<{ name: string; sharing: string; count: number }> {
	const [nameRes, countRes] = await Promise.all([
		entuFetch(cfg.db, `entity/${typeId}?props=name,_sharing`, cfg.token),
		entuFetch(cfg.db, `entity?_type.reference=${typeId}&limit=1`, cfg.token)
	]);
	if (!nameRes.ok) throw new Error(`type entity fetch failed for ${typeId}: ${nameRes.status}`);
	if (!countRes.ok) throw new Error(`type instance count failed for ${typeId}: ${countRes.status}`);
	const nameBody = (await nameRes.json()) as {
		entity: { name?: Array<{ string: string }>; _sharing?: Array<{ string: string }> };
	};
	const countBody = (await countRes.json()) as { count: number };
	return {
		name: nameBody.entity.name?.[0]?.string ?? '(unnamed)',
		sharing: nameBody.entity._sharing?.[0]?.string ?? '(absent)',
		count: countBody.count
	};
}

async function propDefsForType(cfg: Cfg, typeId: string) {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.reference=${META_PROPERTY_TYPE_ID}&_parent.reference=${typeId}&props=name,_sharing,type&limit=200`,
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

async function item1And2Members(cfg: Cfg) {
	const memberTypeId = CONTENT_TYPES.member;
	const personTypeId = CONTENT_TYPES.person;

	const [memberRes, personRes] = await Promise.all([
		entuFetch(
			cfg.db,
			`entity?_type.reference=${memberTypeId}&props=name,person,section,current_section,status,_sharing,_created&limit=500`,
			cfg.token
		),
		entuFetch(cfg.db, `entity?_type.reference=${personTypeId}&props=name,_sharing,_created&limit=500`, cfg.token)
	]);
	if (!memberRes.ok) throw new Error(`member list failed: ${memberRes.status}`);
	if (!personRes.ok) throw new Error(`person list failed: ${personRes.status}`);

	type MemberRow = {
		_id: string;
		name?: Array<{ string: string }>;
		person?: Array<{ reference: string }>;
		section?: Array<{ reference: string }>;
		current_section?: Array<{ reference: string }>;
		status?: Array<{ string: string }>;
		_sharing?: Array<{ string: string }>;
	};
	type PersonRow = {
		_id: string;
		name?: Array<{ string: string }>;
		_sharing?: Array<{ string: string }>;
	};

	const memberBody = (await memberRes.json()) as { count: number; entities: MemberRow[] };
	const personBody = (await personRes.json()) as { count: number; entities: PersonRow[] };

	if (memberBody.count !== memberBody.entities.length) {
		throw new Error(`member list truncated: count=${memberBody.count} entities=${memberBody.entities.length}`);
	}
	if (personBody.count !== personBody.entities.length) {
		throw new Error(`person list truncated: count=${personBody.count} entities=${personBody.entities.length}`);
	}

	const tierCounts: Record<string, number> = {};
	const orphans: Array<{ id: string; name: string; sharing: string }> = [];
	const linked: Array<{ id: string; name: string | null; personId: string; sharing: string }> = [];

	for (const m of memberBody.entities) {
		const sharing = m._sharing?.[0]?.string ?? '(absent)';
		tierCounts[sharing] = (tierCounts[sharing] ?? 0) + 1;
		const hasPerson = m.person && m.person.length > 0;
		const rawName = m.name?.[0]?.string ?? null;
		if (!hasPerson) {
			orphans.push({ id: m._id, name: rawName ?? '(no residual name value)', sharing });
		} else {
			linked.push({ id: m._id, name: rawName, personId: m.person![0].reference, sharing });
		}
	}

	// person-side residual names (T4.3 removed name/email/notes prop-defs from person type;
	// this checks whether stored values still round-trip on a props=name query).
	const personResidualByName = new Map<string, Array<{ id: string; sharing: string }>>();
	for (const p of personBody.entities) {
		const n = p.name?.[0]?.string;
		if (!n) continue;
		const sharing = p._sharing?.[0]?.string ?? '(absent)';
		const arr = personResidualByName.get(n) ?? [];
		arr.push({ id: p._id, sharing });
		personResidualByName.set(n, arr);
	}

	// Partition: orphan member.name residuals vs the linked-singers' person residual names.
	const withTwin: Array<{ orphanId: string; orphanName: string; twinPersonIds: string[] }> = [];
	const withoutTwin: Array<{ orphanId: string; orphanName: string }> = [];
	for (const o of orphans) {
		if (o.name === '(no residual name value)') {
			withoutTwin.push({ orphanId: o.id, orphanName: o.name });
			continue;
		}
		const twins = personResidualByName.get(o.name);
		if (twins && twins.length > 0) {
			withTwin.push({ orphanId: o.id, orphanName: o.name, twinPersonIds: twins.map((t) => t.id) });
		} else {
			withoutTwin.push({ orphanId: o.id, orphanName: o.name });
		}
	}

	return {
		item1_memberCounts: {
			totalMembers: memberBody.count,
			tierBreakdown: tierCounts,
			orphanCount: orphans.length,
			linkedCount: linked.length,
			memberNameResidualStillReadable: orphans.some((o) => o.name !== '(no residual name value)'),
			personNameResidualStillReadable: personBody.entities.some((p) => (p.name?.length ?? 0) > 0),
			personTotalCount: personBody.count
		},
		item2_orphanSingerPartition: {
			orphanTotal: orphans.length,
			linkedSingerPersonTotal: personBody.count,
			withTwinCount: withTwin.length,
			withoutTwinCount: withoutTwin.length,
			withTwin,
			withoutTwin
		}
	};
}

async function item3PropDefPass(cfg: Cfg) {
	const results: Record<string, { ownSharing: string; instanceCount: number; propDefs: Awaited<ReturnType<typeof propDefsForType>> }> = {};
	for (const [typeName, typeId] of Object.entries(CONTENT_TYPES)) {
		const [typeInfo, propDefs] = await Promise.all([typeEntitySharing(cfg, typeId), propDefsForType(cfg, typeId)]);
		results[typeName] = { ownSharing: typeInfo.sharing, instanceCount: typeInfo.count, propDefs };
	}
	const personDeferredDomain = (results.person?.propDefs ?? []).filter((p) => p.sharing === 'domain');
	return { perType: results, personDeferredDomainPropDefs: personDeferredDomain, personDeferredDomainCount: personDeferredDomain.length };
}

async function item4Menu(cfg: Cfg) {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=menu&props=name,group,ordinal,query,_sharing&limit=100`,
		cfg.token
	);
	if (!res.ok) throw new Error(`menu list failed: ${res.status}`);
	type MenuRow = {
		_id: string;
		name?: Array<{ string: string; language?: string }>;
		group?: Array<{ string: string }>;
		ordinal?: Array<{ number: number }>;
		query?: Array<{ string: string }>;
		_sharing?: Array<{ string: string }>;
	};
	const body = (await res.json()) as { count: number; entities: MenuRow[] };
	const entries = body.entities.map((e) => {
		const query = e.query?.[0]?.string ?? '';
		const referencedTypeMatch = /_type\.string=(\w+)/.exec(query);
		const referencedType = referencedTypeMatch?.[1] ?? null;
		const instanceCount = referencedType ? (CONTENT_TYPES[referencedType] ? 'see item5' : 'unknown-type') : 'no-type-filter-in-query';
		return {
			id: e._id,
			nameEn: e.name?.find((n) => n.language === 'en')?.string ?? e.name?.[0]?.string ?? '(unnamed)',
			group: e.group?.[0]?.string ?? '(none)',
			ordinal: e.ordinal?.[0]?.number ?? null,
			query,
			sharing: e._sharing?.[0]?.string ?? '(absent)',
			referencedType,
			instanceCountRef: instanceCount
		};
	});
	return { count: body.count, entries };
}

async function item6Plugins(cfg: Cfg) {
	const res = await entuFetch(cfg.db, `entity?_type.string=plugin&props=name,_sharing&limit=20`, cfg.token);
	if (!res.ok) throw new Error(`plugin list failed: ${res.status}`);
	type PluginRow = { _id: string; name?: Array<{ string: string; language?: string }>; _sharing?: Array<{ string: string }> };
	const body = (await res.json()) as { count: number; entities: PluginRow[] };
	return {
		count: body.count,
		entries: body.entities.map((e) => ({
			id: e._id,
			nameEn: e.name?.find((n) => n.language === 'en')?.string ?? e.name?.[0]?.string ?? '(unnamed)',
			sharing: e._sharing?.[0]?.string ?? '(absent)'
		}))
	};
}

async function item5TypeRegistry(cfg: Cfg, propDefPass: Awaited<ReturnType<typeof item3PropDefPass>>) {
	const perType = Object.entries(propDefPass.perType).map(([name, info]) => ({
		type: name,
		instanceCount: info.instanceCount,
		ownSharing: info.ownSharing
	}));
	const probeBulletin = perType.find((t) => t.type === '_probe_bulletin');
	return { types: perType, probeBulletinInventory: probeBulletin };
}

async function main() {
	const cfg = await loadCfg();

	const membersResult = await item1And2Members(cfg);
	const propDefPass = await item3PropDefPass(cfg);
	const menu = await item4Menu(cfg);
	const plugins = await item6Plugins(cfg);
	const typeRegistry = await item5TypeRegistry(cfg, propDefPass);

	console.log(
		JSON.stringify(
			{
				issue: '#41 (epic #37 Phase 1) — read-only Entu frontend inventory',
				readOnly: true,
				...membersResult,
				item3_propDefPass: propDefPass,
				item4_menu: menu,
				item5_typeRegistry: typeRegistry,
				item6_plugins: plugins
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
