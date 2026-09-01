// #178 — seed mvox_crede with 20 Crede choir members from the polyphony.uk
// dump snapshot. Authorized by team-lead 2026-08-27 (Mihkel-provided API key
// for mvox_crede). DRY_RUN default. Per-record fail-loud (log, continue).
// Idempotent: skips a snapshot record if a profile with the expected name
// already exists under the target db.
//
// Run:
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-178-crede-members-2026-08-27.ts        # DRY_RUN=true default
//   DRY_RUN=false node --import tsx ... same-file                      # live, AFTER authorization

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { entuFetch } from '$lib/entu/request';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

const DB = process.env.MVOX_CREDE_DB ?? 'mvox_crede';
const CREDE_API_KEY = process.env.MVOX_CREDE_API_KEY;
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

async function getToken(): Promise<string> {
	if (!CREDE_API_KEY) throw new Error('getToken: MVOX_CREDE_API_KEY is not set — source ~/.config/mvox/credentials.env first');
	const res = await fetch(`https://api.entu.app/auth?db=${DB}`, {
		headers: { Authorization: `Bearer ${CREDE_API_KEY}`, Accept: 'application/json' }
	});
	if (!res.ok) throw new Error(`auth exchange failed: ${res.status}`);
	const body = (await res.json()) as { token?: string; accounts?: unknown[] };
	if (!body.token) throw new Error('auth exchange returned no token (apparent-success trap)');
	return body.token;
}

async function alreadyExists(token: string, displayName: string): Promise<boolean> {
	const res = await entuFetch(DB, `entity?_type.reference=${PROFILE_TYPE_ID}&name.string=${encodeURIComponent(displayName)}&limit=1`, token);
	if (!res.ok) throw new Error(`existence check failed: ${res.status}`);
	const body = (await res.json()) as { count: number };
	return body.count > 0;
}

async function createEntity(token: string, props: Prop[]): Promise<string> {
	const res = await entuFetch(DB, 'entity', token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(props)
	});
	if (!res.ok) throw new Error(`create failed: ${res.status}`);
	const body = (await res.json()) as { _id?: string };
	if (!body._id) throw new Error('create returned 2xx without _id (apparent-success trap)');
	return body._id;
}

async function processRecord(token: string, record: SourceRecord, ledger: LedgerEntry[]): Promise<void> {
	const displayName = record.nickname?.trim() || record.name.trim();
	const email = record.email_id?.trim() || record.email_contact?.trim() || null;

	try {
		if (await alreadyExists(token, displayName)) {
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
		personId = await createEntity(token, [
			{ type: '_type', reference: PERSON_TYPE_ID },
			{ type: '_parent', reference: DB_ENTITY_ID },
			{ type: '_inheritrights', boolean: true }
		]);

		memberId = await createEntity(token, [
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
		const profileId = await createEntity(token, profileProps);

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

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

async function main() {
	const records = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as SourceRecord[];
	console.error(`Loaded ${records.length} records from snapshot.`);

	const token = await getToken();
	const ledger: LedgerEntry[] = [];

	for (const record of records) {
		await processRecord(token, record, ledger);
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

	const dir = join('scripts', 'migrations', 'seed-results');
	mkdirSync(dir, { recursive: true });
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const filePath = join(dir, `seed-178-crede-members-${DRY_RUN ? 'dry' : 'live'}-${timestamp}.json`);
	writeFileSync(filePath, JSON.stringify({ dryRun: DRY_RUN, byStatus, ledger }, null, 2));
	console.log(`\nLedger artifact: ${filePath}`);

	process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('#178 Crede member seed ABORTED:', errMsg(err));
	process.exit(1);
});
