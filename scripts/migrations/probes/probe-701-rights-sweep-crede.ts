// #701: read-only rights sweep of a collective db; reports entity ids, types and counts only.

// Live read: source ~/.config/mvox/credentials.env; DRY_RUN=false AUTHORIZED_BY='<who, channel>'
// node --import tsx --import ./scripts/migrations/lib/register-loader.mjs <this file>
// The default, dry, prints the read plan and calls nothing.

import { pathToFileURL } from 'node:url';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { entuFetch } from '$lib/entu/request';
import { RIGHTS_WRITES_REGISTER } from '$lib/testing/rightsWrites';
import { loadCredeCfg, readAuthorizedBy, readDryRun } from '../lib/script-runner';
import { assertLiveRunAuthorized, writeLedger } from '../lib/ledger-writer';

const TIERS = ['_owner', '_editor', '_viewer', '_expander'] as const;
type Tier = (typeof TIERS)[number];
type Sharing = 'private' | 'domain' | 'public' | 'unrecognised';

const SHARING_RANK: Record<Sharing, number> = { private: 0, domain: 1, public: 2, unrecognised: 3 };
const ENTITY_PROPS = ['_inheritrights', '_sharing', ...TIERS].join(',');

/** Types that inherit rights from their parent (docs/create-inheritance.md); profile never. */
export const INHERITANCE_EXPECTED: Readonly<Record<string, boolean>> = {
	season: true,
	event_series: true,
	event: true,
	work: true,
	edition: true,
	profile: false
};

/** The entity types each register function grants a tier on (docs/rights-writes.md). */
export const REGISTER_TARGET_TYPES: Readonly<Record<string, readonly string[]>> = {
	grantRole: ['database', 'library'],
	createInvite: ['person'],
	createProfile: ['profile']
};

export const COMMITTED_ALLOW = [
	'countsByType',
	'inheritanceOutliers',
	'sharingOutliers',
	'unexplainedGrants',
	'library',
	'id',
	'type',
	'count',
	'expected',
	'actual',
	'sharing',
	'typeSharing',
	'tier',
	'reference',
	'inheritrights'
] as const;

interface RawValue {
	reference?: string;
	inherited?: boolean;
	boolean?: boolean;
	string?: string;
}

export interface RawEntity {
	_id: string;
	[prop: string]: RawValue[] | string | undefined;
}

export interface TypeDef {
	type: string;
	sharing: Sharing | 'unset';
}

export interface SweptEntity {
	id: string;
	type: string;
	inheritrights: boolean | null;
	sharing: Sharing | null;
	directTier: Map<string, Tier>;
}

export interface SweepReport {
	countsByType: Array<{ type: string; count: number }>;
	inheritanceOutliers: Array<{ id: string; type: string; expected: boolean; actual: boolean | null }>;
	sharingOutliers: Array<{ id: string; type: string; sharing: Sharing; typeSharing: TypeDef['sharing'] }>;
	unexplainedGrants: Array<{ id: string; type: string; tier: Tier; reference: string }>;
	library: Array<{ id: string; inheritrights: boolean | null }>;
}

const values = (raw: RawEntity, prop: string): RawValue[] => {
	const v = raw[prop];
	return Array.isArray(v) ? v : [];
};

function toSharing(value: string | undefined): Sharing {
	return value === 'private' || value === 'domain' || value === 'public' ? value : 'unrecognised';
}

export function extractTypeDef(raw: RawEntity): TypeDef {
	const level = values(raw, '_sharing')[0]?.string;
	return { type: values(raw, 'name')[0]?.string ?? raw._id, sharing: level === undefined ? 'unset' : toSharing(level) };
}

export function extractEntity(type: string, raw: RawEntity): SweptEntity {
	const flag = values(raw, '_inheritrights')[0]?.boolean;
	const level = values(raw, '_sharing')[0]?.string;
	const directTier = new Map<string, Tier>();
	for (const tier of TIERS) {
		for (const v of values(raw, tier)) {
			if (v.reference && !v.inherited && !directTier.has(v.reference)) directTier.set(v.reference, tier);
		}
	}
	return {
		id: raw._id,
		type,
		inheritrights: flag ?? null,
		sharing: level === undefined ? null : toSharing(level),
		directTier
	};
}

function explainedTiers(type: string): Set<Tier> {
	const tiers = new Set<Tier>(['_owner']);
	for (const row of RIGHTS_WRITES_REGISTER) {
		const tier = TIERS.find((t) => t === row.write);
		if (tier && REGISTER_TARGET_TYPES[row.fn]?.includes(type)) tiers.add(tier);
	}
	return tiers;
}

const byTypeThenId = <T extends { id: string; type?: string }>(a: T, b: T) =>
	(a.type ?? '').localeCompare(b.type ?? '') || a.id.localeCompare(b.id);

export function classifySweep(types: TypeDef[], entities: SweptEntity[]): SweepReport {
	const typeSharing = new Map(types.map((t) => [t.type, t.sharing]));
	const counts = new Map<string, number>();
	const report: SweepReport = {
		countsByType: [],
		inheritanceOutliers: [],
		sharingOutliers: [],
		unexplainedGrants: [],
		library: []
	};
	for (const e of entities) {
		counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
		const expected = INHERITANCE_EXPECTED[e.type];
		if (expected !== undefined && (e.inheritrights ?? false) !== expected) {
			report.inheritanceOutliers.push({ id: e.id, type: e.type, expected, actual: e.inheritrights });
		}
		const capOf = typeSharing.get(e.type) ?? 'unset';
		const cap = capOf === 'unset' ? 'private' : capOf;
		if (e.sharing && SHARING_RANK[e.sharing] > SHARING_RANK[cap]) {
			report.sharingOutliers.push({ id: e.id, type: e.type, sharing: e.sharing, typeSharing: capOf });
		}
		const explained = explainedTiers(e.type);
		for (const [reference, tier] of e.directTier) {
			if (!explained.has(tier)) report.unexplainedGrants.push({ id: e.id, type: e.type, tier, reference });
		}
		if (e.type === 'library') report.library.push({ id: e.id, inheritrights: e.inheritrights });
	}
	report.countsByType = [...counts].map(([type, count]) => ({ type, count })).sort((a, b) => a.type.localeCompare(b.type));
	report.inheritanceOutliers.sort(byTypeThenId);
	report.sharingOutliers.sort(byTypeThenId);
	report.unexplainedGrants.sort((a, b) => byTypeThenId(a, b) || a.tier.localeCompare(b.tier));
	report.library.sort(byTypeThenId);
	return report;
}

export function formatReport(report: SweepReport): string[] {
	const lines = ['COUNTS (entities this key reads)'];
	for (const c of report.countsByType) lines.push(`  ${c.type}: ${c.count}`);
	lines.push(`INHERITRIGHTS differs from the type's expectation: ${report.inheritanceOutliers.length}`);
	for (const o of report.inheritanceOutliers) {
		lines.push(`  ${o.type} ${o.id} expected=${o.expected} actual=${o.actual ?? 'absent'}`);
	}
	lines.push(`SHARING wider than the type's: ${report.sharingOutliers.length}`);
	for (const o of report.sharingOutliers) lines.push(`  ${o.type} ${o.id} ${o.sharing} > type ${o.typeSharing}`);
	lines.push(`DIRECT GRANTS no register row explains: ${report.unexplainedGrants.length}`);
	for (const o of report.unexplainedGrants) lines.push(`  ${o.type} ${o.id} ${o.tier} -> ${o.reference}`);
	lines.push(`LIBRARY _inheritrights (#695): ${report.library.length}`);
	for (const o of report.library) lines.push(`  library ${o.id} ${o.inheritrights ?? 'absent'}`);
	return lines;
}

async function readAll(cfg: EntuCfg, query: string, label: string, pageSize: number, fetchImpl: typeof fetch) {
	const out: RawEntity[] = [];
	for (let skip = 0; ; skip += pageSize) {
		const res = await entuFetch(cfg.db, `entity?${query}&limit=${pageSize}&skip=${skip}`, cfg.token, {}, fetchImpl);
		if (!res.ok) throw new Error(`${label}: read failed (${res.status})`);
		const body = (await res.json()) as { count: number; entities: RawEntity[] };
		out.push(...body.entities);
		if (out.length >= body.count) return out;
		if (body.entities.length === 0) throw new Error(`${label}: read ${out.length} of ${body.count}, then an empty page`);
	}
}

export async function runRightsSweep(cfg: EntuCfg, fetchImpl: typeof fetch = fetch, pageSize = 100): Promise<SweepReport> {
	const types = (await readAll(cfg, '_type.string=entity&props=name,_sharing', 'types', pageSize, fetchImpl)).map(extractTypeDef);
	const entities: SweptEntity[] = [];
	for (const { type } of types) {
		const raws = await readAll(cfg, `_type.string=${encodeURIComponent(type)}&props=${ENTITY_PROPS}`, type, pageSize, fetchImpl);
		entities.push(...raws.map((raw) => extractEntity(type, raw)));
	}
	return classifySweep(types, entities);
}

async function main(): Promise<void> {
	const dryRun = readDryRun();
	const authorizedBy = readAuthorizedBy();
	assertLiveRunAuthorized(dryRun, authorizedBy);
	if (dryRun) {
		console.log(`DRY_RUN: would read every type definition, then each type's ${ENTITY_PROPS}. Nothing called.`);
		return;
	}
	const cfg = await loadCredeCfg();
	console.log(`db=${cfg.db} READ-ONLY rights sweep\n`);
	const report = await runRightsSweep(cfg);
	for (const line of formatReport(report)) console.log(line);
	const path = writeLedger({
		scriptName: 'probe-701-rights-sweep-crede',
		dryRun,
		db: cfg.db,
		sensitive: true,
		authorizedBy,
		committed: { allow: COMMITTED_ALLOW },
		payload: { ...report }
	});
	console.log(`\nLedger: ${path}`);
}

const isMainModule = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
	main().catch((err) => {
		console.error('probe-701-rights-sweep-crede ABORTED:', err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}

// (*MVOX:Josquin*)
