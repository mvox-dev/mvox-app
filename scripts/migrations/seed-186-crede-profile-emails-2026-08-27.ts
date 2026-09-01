// Add emails to Crede profiles from the live (corrected) snapshot. Matched
// by original source id via the #178 ledger → personId → profile (_parent),
// not by name (avoids diacritics/typo ambiguity). Skips a target whose
// profile already carries the exact same email (Joosep, from #178).
// Authorized by team-lead 2026-08-27.
// DRY_RUN default (safe by default, explicit opt-in for live writes) — added
// during PII redaction (2026-09-01): TARGETS moved out of source (real
// names + real emails) into a gitignored snapshot, matching the seed-178
// read pattern; this script never had a DRY_RUN guard, unlike its siblings.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { entuFetch } from '$lib/entu/request';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

const DB = process.env.MVOX_CREDE_DB ?? 'mvox_crede';
const PROFILE_TYPE_ID = '6a8f91355eb2498f434e5c40';

const SNAPSHOT_PATH = join('scripts', 'migrations', 'snapshots', 'crede-profile-emails-2026-08-27.json');

type Target = { personId: string; name: string; email: string };

const TARGETS: Target[] = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8'));

type LedgerEntry = { personId: string; name: string; email: string; profileId?: string; status: 'set' | 'would-set' | 'skipped-already-set' | 'failed'; message?: string };

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

async function getToken(): Promise<string> {
	const key = process.env.MVOX_CREDE_API_KEY;
	if (!key) throw new Error('MVOX_CREDE_API_KEY is not set — source ~/.config/mvox/credentials.env first');
	const res = await fetch(`https://api.entu.app/auth?db=${DB}`, {
		headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }
	});
	if (!res.ok) throw new Error(`auth exchange failed: ${res.status}`);
	const body = (await res.json()) as { token?: string };
	if (!body.token) throw new Error('auth exchange returned no token');
	return body.token;
}

async function processTarget(token: string, target: Target, ledger: LedgerEntry[]): Promise<void> {
	try {
		const profRes = await entuFetch(DB, `entity?_type.reference=${PROFILE_TYPE_ID}&_parent.reference=${target.personId}&props=email&limit=5`, token);
		const profBody = (await profRes.json()) as { count: number; entities: Array<{ _id: string; email?: Array<{ string: string }> }> };
		if (profBody.count !== 1) throw new Error(`expected exactly 1 profile, found ${profBody.count}`);
		const profile = profBody.entities[0];
		const currentEmail = profile.email?.[0]?.string;

		if (currentEmail === target.email) {
			ledger.push({ personId: target.personId, name: target.name, email: target.email, profileId: profile._id, status: 'skipped-already-set' });
			return;
		}

		if (DRY_RUN) {
			ledger.push({ personId: target.personId, name: target.name, email: target.email, profileId: profile._id, status: 'would-set' });
			return;
		}

		const postRes = await entuFetch(DB, `entity/${profile._id}`, token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: 'email', string: target.email }])
		});
		if (!postRes.ok) throw new Error(`POST failed: ${postRes.status}`);

		const verifyRes = await entuFetch(DB, `entity/${profile._id}?props=email`, token);
		const verifyBody = await verifyRes.json();
		const emails: string[] = (verifyBody.entity?.email ?? []).map((e: { string: string }) => e.string);
		if (!emails.includes(target.email)) throw new Error(`verify: expected ${target.email} among ${JSON.stringify(emails)}`);

		ledger.push({ personId: target.personId, name: target.name, email: target.email, profileId: profile._id, status: 'set' });
	} catch (err) {
		ledger.push({ personId: target.personId, name: target.name, email: target.email, status: 'failed', message: errMsg(err) });
	}
}

async function main() {
	const token = await getToken();
	const ledger: LedgerEntry[] = [];
	for (const target of TARGETS) await processTarget(token, target, ledger);

	const byStatus = { set: 0, 'would-set': 0, 'skipped-already-set': 0, failed: 0 };
	for (const e of ledger) byStatus[e.status]++;
	const failures = ledger.filter((e) => e.status === 'failed');

	console.log(`\n── Crede profile email seed — summary ──`);
	console.log(`DRY_RUN=${DRY_RUN}`);
	console.log(`Total: ${ledger.length}  set: ${byStatus.set}  would-set: ${byStatus['would-set']}  skipped-already-set: ${byStatus['skipped-already-set']}  failed: ${byStatus.failed}`);
	if (failures.length > 0) {
		console.log('Failures:');
		for (const f of failures) console.log(`  ${f.name} (${f.personId}) — ${f.message}`);
	}

	const dir = join('scripts', 'migrations', 'seed-results');
	mkdirSync(dir, { recursive: true });
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const filePath = join(dir, `seed-186-crede-profile-emails-${DRY_RUN ? 'dry' : 'live'}-${timestamp}.json`);
	writeFileSync(filePath, JSON.stringify({ dryRun: DRY_RUN, byStatus, ledger }, null, 2));
	console.log(`\nLedger artifact: ${filePath}`);

	process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('Crede profile email seed ABORTED:', errMsg(err));
	process.exit(1);
});
