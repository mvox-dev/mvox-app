// #188 Phase 3b — recreate 7 section entities in mvox_crede + assign each of
// the 20 Crede members to their section via a second _parent reference.
// Same shape/mapping as #182, cross-referenced through both #178 ledgers
// (old member id -> sourceId -> new member id) since Phase 1/2/3 minted a
// fresh section type id and fresh member entity ids. Authorized by
// team-lead 2026-08-28 (#188 full-run authorization, Phase 3b explicit).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { entuFetch } from '$lib/entu/request';

const DB = process.env.MVOX_CREDE_DB ?? 'mvox_crede';
const DB_ENTITY_ID = process.env.MVOX_CREDE_DB_ENTITY_ID ?? '6a8f471a5eb2498f434e5112';
const SECTION_TYPE_ID = '6a92a325ca67df980f414ea3';

type SectionDef = { name: string; voice: string; displayOrder: number; memberIds: string[] };

const SECTIONS: SectionDef[] = [
	{ name: 'Soprano I', voice: 'soprano', displayOrder: 2, memberIds: ['6a92a3f1ca67df980f4154aa', '6a92a3f2ca67df980f4154c4', '6a92a3f3ca67df980f4154de', '6a92a3f4ca67df980f4154f8', '6a92a3f5ca67df980f415512'] },
	{ name: 'Soprano II', voice: 'soprano', displayOrder: 3, memberIds: ['6a92a3f5ca67df980f41552c', '6a92a3f6ca67df980f415546', '6a92a3f7ca67df980f415560', '6a92a3f7ca67df980f41557a'] },
	{ name: 'Alto I', voice: 'alto', displayOrder: 5, memberIds: ['6a92a3f8ca67df980f415594', '6a92a3f9ca67df980f4155ae', '6a92a3f9ca67df980f4155c8', '6a92a3faca67df980f4155e2'] },
	{ name: 'Alto II', voice: 'alto', displayOrder: 6, memberIds: ['6a92a3fbca67df980f4155fc', '6a92a3fbca67df980f415616', '6a92a3fcca67df980f415630'] },
	{ name: 'Tenor', voice: 'tenor', displayOrder: 7, memberIds: ['6a92a3fdca67df980f41564a'] },
	{ name: 'Baritone', voice: 'baritone', displayOrder: 10, memberIds: ['6a92a3fdca67df980f415664', '6a92a3feca67df980f41567e'] },
	{ name: 'Conductor', voice: '', displayOrder: 12, memberIds: ['6a92a3f1ca67df980f415490'] }
];

type LedgerEntry = { section: string; sectionId?: string; memberId: string; status: 'created' | 'failed'; message?: string };

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

async function getToken(): Promise<string> {
	const key = process.env.MVOX_CREDE_API_KEY;
	if (!key) throw new Error('MVOX_CREDE_API_KEY is not set');
	const res = await fetch(`https://api.entu.app/auth?db=${DB}`, {
		headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }
	});
	if (!res.ok) throw new Error(`auth exchange failed: ${res.status}`);
	const body = (await res.json()) as { token?: string };
	if (!body.token) throw new Error('no token');
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
	if (!body._id) throw new Error('section create returned 2xx without _id');
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

	for (const section of SECTIONS) {
		let sectionId: string;
		try {
			sectionId = await createSection(token, section);
		} catch (err) {
			for (const memberId of section.memberIds) ledger.push({ section: section.name, memberId, status: 'failed', message: `section create: ${errMsg(err)}` });
			continue;
		}
		for (const memberId of section.memberIds) {
			try {
				await appendSectionParent(token, memberId, sectionId);
				ledger.push({ section: section.name, sectionId, memberId, status: 'created' });
			} catch (err) {
				ledger.push({ section: section.name, sectionId, memberId, status: 'failed', message: errMsg(err) });
			}
		}
	}

	const byStatus = { created: 0, failed: 0 };
	for (const e of ledger) byStatus[e.status]++;
	const failures = ledger.filter((e) => e.status === 'failed');

	console.log(`\n── #188 Phase 3b Crede sections — summary ──`);
	console.log(`Total: ${ledger.length}  created: ${byStatus.created}  failed: ${byStatus.failed}`);
	if (failures.length > 0) {
		console.log('Failures:');
		for (const f of failures) console.log(`  ${f.section} / ${f.memberId} — ${f.message}`);
	}

	const dir = join('scripts', 'migrations', 'seed-results');
	mkdirSync(dir, { recursive: true });
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const filePath = join(dir, `seed-188-phase3b-crede-sections-${timestamp}.json`);
	writeFileSync(filePath, JSON.stringify({ byStatus, ledger }, null, 2));
	console.log(`\nLedger artifact: ${filePath}`);

	process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('#188 Phase 3b ABORTED:', errMsg(err));
	process.exit(1);
});
