// #178 — seed mvox_crede with 20 Crede choir members from the polyphony.uk
// dump snapshot. Authorized by team-lead 2026-08-27 (Mihkel-provided API key
// for mvox_crede). DRY_RUN default. Per-record fail-loud (log, continue).
// Idempotent: skips a snapshot record if a profile with the expected name
// already exists under the target db.
//
// mvox-app#274 — migrated onto the shared script-runner + ledger-writer.
// The ledger entries carry real names and emails (`fullName`, `displayName`,
// `email`) by design — the shared writer's default redaction (email-content
// scrub always, `email`/`forename`/`surname`/`phone`/`birthdate` fields when
// `sensitive: true`) plus this script's explicit `redactFields: ['fullName',
// 'displayName']` cover every personal field this ledger shape carries.
//
// Run:
//   ./scripts/migrations/seed-178-crede-members-2026-08-27.ts        # DRY_RUN=true default
//   DRY_RUN=false ... same-file                                      # live, AFTER authorization

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { entuFetch } from '$lib/entu/request';
import { readDryRun, loadCredeCfg, runScript, errMsg } from './lib/script-runner';
import { writeLedger } from './lib/ledger-writer';

const DRY_RUN = readDryRun();
const DB_ENTITY_ID = process.env.MVOX_CREDE_DB_ENTITY_ID ?? '6a8f471a5eb2498f434e5112';
// Type ids updated 2026-08-29 (#188 clean-slate re-provision — Phase 2 minted
// fresh type entities for everything except the built-in `person` type).
const PERSON_TYPE_ID = '6a8f471a5eb2498f434e50f7';
const MEMBER_TYPE_ID = '6a92a327ca67df980f414ef4';
const PROFILE_TYPE_ID = '6a92a34cca67df980f415327';

// #188 Phase 3: use the LIVE-corrected snapshot (real emails from the D1
// pull) instead of the stale Feb dump, per team-lead's "same decisions...
// include emails from live D1" — avoids a second post-hoc email-fix pass.
const SNAPSHOT_PATH = join('scripts', 'migrations', 'snapshots', 'crede-members-live-2026-08-27.json');

type SourceRecord = {
	id: string;
	name: string;
	email_id: string | null;
	email_contact: string | null;
	invited_by: string | null;
	joined_at: string;
	nickname: string | null;
};

type Prop = { type: string; reference?: string; string?: string; boolean?: boolean };

type LedgerEntry = {
	sourceId: string;
	fullName: string;
	displayName: string;
	email: string | null;
	status: 'created' | 'skipped-exists' | 'would-create' | 'failed';
	personId?: string;
	memberId?: string;
	profileId?: string;
	message?: string;
};

async function alreadyExists(db: string, token: string, displayName: string): Promise<boolean> {
	const res = await entuFetch(db, `entity?_type.reference=${PROFILE_TYPE_ID}&name.string=${encodeURIComponent(displayName)}&limit=1`, token);
	if (!res.ok) throw new Error(`existence check failed: ${res.status}`);
	const body = (await res.json()) as { count: number };
	return body.count > 0;
}

async function createEntity(db: string, token: string, props: Prop[]): Promise<string> {
	const res = await entuFetch(db, 'entity', token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(props)
	});
	if (!res.ok) throw new Error(`create failed: ${res.status}`);
	const body = (await res.json()) as { _id?: string };
	if (!body._id) throw new Error('create returned 2xx without _id (apparent-success trap)');
	return body._id;
}

async function processRecord(db: string, token: string, record: SourceRecord, ledger: LedgerEntry[]): Promise<void> {
	const displayName = record.nickname?.trim() || record.name.trim();
	const email = record.email_id?.trim() || record.email_contact?.trim() || null;

	try {
		if (await alreadyExists(db, token, displayName)) {
			ledger.push({ sourceId: record.id, fullName: record.name, displayName, email, status: 'skipped-exists' });
			return;
		}
	} catch (err) {
		ledger.push({ sourceId: record.id, fullName: record.name, displayName, email, status: 'failed', message: `existence check: ${errMsg(err)}` });
		return;
	}

	if (DRY_RUN) {
		ledger.push({ sourceId: record.id, fullName: record.name, displayName, email, status: 'would-create' });
		return;
	}

	let personId: string | undefined;
	let memberId: string | undefined;
	try {
		personId = await createEntity(db, token, [
			{ type: '_type', reference: PERSON_TYPE_ID },
			{ type: '_parent', reference: DB_ENTITY_ID },
			{ type: '_inheritrights', boolean: true }
		]);

		memberId = await createEntity(db, token, [
			{ type: '_type', reference: MEMBER_TYPE_ID },
			{ type: '_parent', reference: DB_ENTITY_ID },
			{ type: 'person', reference: personId },
			{ type: 'status', string: 'active' },
			{ type: '_inheritrights', boolean: true }
		]);

		const profileProps: Prop[] = [
			{ type: '_type', reference: PROFILE_TYPE_ID },
			{ type: '_parent', reference: personId },
			{ type: '_inheritrights', boolean: false },
			{ type: '_sharing', string: 'domain' },
			{ type: '_owner', reference: personId },
			{ type: 'name', string: displayName }
		];
		if (email) profileProps.push({ type: 'email', string: email });
		const profileId = await createEntity(db, token, profileProps);

		ledger.push({ sourceId: record.id, fullName: record.name, displayName, email, status: 'created', personId, memberId, profileId });
	} catch (err) {
		ledger.push({
			sourceId: record.id,
			fullName: record.name,
			displayName,
			email,
			status: 'failed',
			message: `${errMsg(err)}${personId ? ` — person ${personId} may already exist orphaned` : ''}${memberId ? `, member ${memberId} may already exist orphaned` : ''}`
		});
	}
}

async function main(): Promise<boolean> {
	const records = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as SourceRecord[];
	console.error(`Loaded ${records.length} records from snapshot.`);

	const cfg = await loadCredeCfg();
	const ledger: LedgerEntry[] = [];

	for (const record of records) {
		await processRecord(cfg.db, cfg.token, record, ledger);
	}

	const byStatus = { created: 0, 'skipped-exists': 0, 'would-create': 0, failed: 0 };
	for (const e of ledger) byStatus[e.status]++;
	const failures = ledger.filter((e) => e.status === 'failed');

	console.log(`\n── #178 Crede member seed — summary ──`);
	console.log(`DRY_RUN=${DRY_RUN}`);
	console.log(`Total: ${ledger.length}  created: ${byStatus.created}  would-create: ${byStatus['would-create']}  skipped-exists: ${byStatus['skipped-exists']}  failed: ${byStatus.failed}`);
	if (failures.length > 0) {
		console.log('\nFailures:');
		for (const f of failures) console.log(`  ${f.sourceId} "${f.fullName}" — ${f.message}`);
	}

	const filePath = writeLedger({
		scriptName: 'seed-178-crede-members',
		dryRun: DRY_RUN,
		db: cfg.db,
		sensitive: true,
		redactFields: ['fullName', 'displayName'],
		payload: { byStatus, ledger }
	});
	console.log(`\nLedger artifact: ${filePath}`);

	return failures.length === 0;
}

runScript('#178 Crede member seed', main);

// (*MVOX:Perotin*)
