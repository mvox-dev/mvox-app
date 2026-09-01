// #182 — create 7 section entities in mvox_crede + assign each of the 20
// Crede members to their section via a second _parent reference. Authorized
// by team-lead 2026-08-27. Section→member mapping derived from the
// polyphony.uk dump's member_sections table (21 rows, is_primary=1 on all,
// exactly one section per member) and cross-referenced against #178's
// live ledger for the actual mvox_crede person/member entity ids.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { entuFetch } from '$lib/entu/request';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

const DB = process.env.MVOX_CREDE_DB ?? 'mvox_crede';
const DB_ENTITY_ID = process.env.MVOX_CREDE_DB_ENTITY_ID ?? '6a8f471a5eb2498f434e5112';
const SECTION_TYPE_ID = '6a8f91145eb2498f434e57bc';

type SectionDef = { name: string; abbreviation: string; displayOrder: number; voice: string; memberIds: string[] };

// memberIds are the mvox_crede `member` entity ids from #178's live ledger
// (seed-results/seed-178-crede-members-live-2026-08-27T01-46-36-991Z.json).
const SECTIONS: SectionDef[] = [
	{ name: 'Soprano I', abbreviation: 'S1', displayOrder: 2, voice: 'soprano', memberIds: [
		'6a8f96ef5eb2498f434e5d03', '6a8f96f05eb2498f434e5d1c', '6a8f96f15eb2498f434e5d35', '6a8f96f25eb2498f434e5d4e', '6a8f96f35eb2498f434e5d67'
	] },
	{ name: 'Soprano II', abbreviation: 'S2', displayOrder: 3, voice: 'soprano', memberIds: [
		'6a8f96f35eb2498f434e5d80', '6a8f96f45eb2498f434e5d99', '6a8f96f45eb2498f434e5db2', '6a8f96f55eb2498f434e5dcb'
	] },
	{ name: 'Alto I', abbreviation: 'A1', displayOrder: 5, voice: 'alto', memberIds: [
		'6a8f96f65eb2498f434e5de4', '6a8f96f75eb2498f434e5dfd', '6a8f96f75eb2498f434e5e16', '6a8f96f85eb2498f434e5e2f'
	] },
	{ name: 'Alto II', abbreviation: 'A2', displayOrder: 6, voice: 'alto', memberIds: [
		'6a8f96f95eb2498f434e5e48', '6a8f96f95eb2498f434e5e61', '6a8f96fa5eb2498f434e5e7a'
	] },
	{ name: 'Tenor', abbreviation: 'T', displayOrder: 7, voice: 'tenor', memberIds: [
		'6a8f96fa5eb2498f434e5e93'
	] },
	{ name: 'Baritone', abbreviation: 'Bar', displayOrder: 10, voice: 'baritone', memberIds: [
		'6a8f96fb5eb2498f434e5eac', '6a8f96fc5eb2498f434e5ec6'
	] },
	{ name: 'Conductor', abbreviation: 'C', displayOrder: 12, voice: '', memberIds: [
		'6a8f96fc5eb2498f434e5edf'
	] }
];

type LedgerEntry = { section: string; sectionId?: string; memberId: string; status: 'created' | 'would-create' | 'failed'; message?: string };

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

async function getToken(): Promise<string> {
	const key = process.env.MVOX_CREDE_API_KEY;
	if (!key) throw new Error('getToken: MVOX_CREDE_API_KEY is not set — source ~/.config/mvox/credentials.env first');
	const res = await fetch(`https://api.entu.app/auth?db=${DB}`, {
		headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }
	});
	if (!res.ok) throw new Error(`auth exchange failed: ${res.status}`);
	const body = (await res.json()) as { token?: string };
	if (!body.token) throw new Error('auth exchange returned no token');
	return body.token;
}

async function createSection(token: string, section: SectionDef): Promise<string> {
	const props: Array<{ type: string; reference?: string; string?: string; boolean?: boolean; number?: number }> = [
		{ type: '_type', reference: SECTION_TYPE_ID },
		{ type: '_parent', reference: DB_ENTITY_ID },
		{ type: '_inheritrights', boolean: true },
		{ type: '_sharing', string: 'domain' },
		{ type: 'name', string: section.name },
		{ type: 'display_order', number: section.displayOrder }
	];
	if (section.voice) props.push({ type: 'voice', string: section.voice });
	const res = await entuFetch(DB, 'entity', token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(props)
	});
	if (!res.ok) throw new Error(`section create failed: ${res.status}`);
	const body = (await res.json()) as { _id?: string };
	if (!body._id) throw new Error('section create returned 2xx without _id (apparent-success trap)');
	return body._id;
}

async function appendSectionParent(token: string, memberId: string, sectionId: string): Promise<void> {
	const res = await entuFetch(DB, `entity/${memberId}`, token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify([{ type: '_parent', reference: sectionId }])
	});
	if (!res.ok) throw new Error(`member _parent append failed: ${res.status}`);
}

async function main() {
	const token = await getToken();
	const ledger: LedgerEntry[] = [];
	const snapshotMapping: Array<{ section: string; sectionId: string | null; memberIds: string[] }> = [];

	for (const section of SECTIONS) {
		if (DRY_RUN) {
			for (const memberId of section.memberIds) {
				ledger.push({ section: section.name, memberId, status: 'would-create' });
			}
			snapshotMapping.push({ section: section.name, sectionId: null, memberIds: section.memberIds });
			continue;
		}

		let sectionId: string;
		try {
			sectionId = await createSection(token, section);
		} catch (err) {
			for (const memberId of section.memberIds) {
				ledger.push({ section: section.name, memberId, status: 'failed', message: `section create: ${errMsg(err)}` });
			}
			continue;
		}
		snapshotMapping.push({ section: section.name, sectionId, memberIds: section.memberIds });

		for (const memberId of section.memberIds) {
			try {
				await appendSectionParent(token, memberId, sectionId);
				ledger.push({ section: section.name, sectionId, memberId, status: 'created' });
			} catch (err) {
				ledger.push({ section: section.name, sectionId, memberId, status: 'failed', message: errMsg(err) });
			}
		}
	}

	const byStatus = { created: 0, 'would-create': 0, failed: 0 };
	for (const e of ledger) byStatus[e.status]++;
	const failures = ledger.filter((e) => e.status === 'failed');

	console.log(`\n── #182 Crede sections — summary ──`);
	console.log(`DRY_RUN=${DRY_RUN}`);
	console.log(`Total: ${ledger.length}  created: ${byStatus.created}  would-create: ${byStatus['would-create']}  failed: ${byStatus.failed}`);
	if (failures.length > 0) {
		console.log('Failures:');
		for (const f of failures) console.log(`  ${f.section} / ${f.memberId} — ${f.message}`);
	}

	const dir = join('scripts', 'migrations', 'seed-results');
	mkdirSync(dir, { recursive: true });
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const filePath = join(dir, `seed-182-crede-sections-${DRY_RUN ? 'dry' : 'live'}-${timestamp}.json`);
	writeFileSync(filePath, JSON.stringify({ dryRun: DRY_RUN, byStatus, ledger }, null, 2));
	console.log(`\nLedger artifact: ${filePath}`);

	if (!DRY_RUN && failures.length === 0) {
		const snapshotDir = join('scripts', 'migrations', 'snapshots');
		mkdirSync(snapshotDir, { recursive: true });
		const snapshotPath = join(snapshotDir, 'crede-sections-mapping-2026-08-27.json');
		writeFileSync(snapshotPath, JSON.stringify(snapshotMapping, null, 2));
		console.log(`Section mapping snapshot: ${snapshotPath}`);
	}

	process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('#182 Crede sections ABORTED:', errMsg(err));
	process.exit(1);
});
