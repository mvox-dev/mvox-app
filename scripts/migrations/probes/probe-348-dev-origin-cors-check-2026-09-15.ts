// mvox-app#348 — deferred verification, boxes 3+4. READ-ONLY, zero mutation,
// no fixtures created/torn down — reuses the persisted "SMOKE-275 Test
// Edition" fixture (mvox-app#275) the same way probe-343-signed-url-headers
// already did.
//
// Question: does a fetch()-GET against the bucket's signed URL, sent with
// `Origin: https://dev.mvox.eu`, get admitted (Access-Control-Allow-Origin
// echoes it back)? #343's own probe (2026-09-12) found the bucket allowlisted
// ONLY `https://mvox.eu` — #347 is reported to have extended that allowlist
// to cover `dev.mvox.eu`. This settles it empirically:
//   - box 3 (#348 done-when): a byte fetch from dev.mvox.eu reaches the
//     bucket without a CORS failure.
//   - box 4 (#348 done-when): openFileBytes.ts's `fallback-navigation` path
//     fires ONLY on a fetch() rejection (CORS TypeError) or a network error
//     (see openFileBytes.ts lines 204-215) — an admitted origin means that
//     catch never triggers, so the fallback is quiescent on this origin.
//
// Run:
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/probe-348-dev-origin-cors-check-2026-09-15.ts

import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';
import { writeLedger } from '../lib/ledger-writer';

const WORK_NAME = 'SMOKE-275 Test Work';
const EDITION_NAME = 'SMOKE-275 Test Edition';

function headersToObject(h: Headers): Record<string, string> {
	const out: Record<string, string> = {};
	h.forEach((value, key) => { out[key] = value; });
	return out;
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`db=${cfg.db} (READ-ONLY — no mutation possible in this script)\n`);

	const ledger: Record<string, unknown>[] = [];

	const libRes = await entuFetch(cfg.db, `entity?_type.string=library&props=_id&limit=1`, cfg.token);
	if (!libRes.ok) throw new Error(`library resolve failed: ${libRes.status}`);
	const libBody = (await libRes.json()) as { count: number; entities: Array<{ _id: string }> };
	if (libBody.count === 0) throw new Error('no `library` entity found on polyphony');
	const libraryId = libBody.entities[0]._id;

	const workRes = await entuFetch(cfg.db, `entity?_parent.reference=${libraryId}&name.string=${encodeURIComponent(WORK_NAME)}&props=_id&limit=1`, cfg.token);
	const workBody = (await workRes.json()) as { entities?: Array<{ _id: string }> };
	const workId = workBody.entities?.[0]?._id;
	if (!workId) throw new Error(`'${WORK_NAME}' not found under library ${libraryId} — has the #275 fixture been removed?`);

	const editionRes = await entuFetch(cfg.db, `entity?_parent.reference=${workId}&name.string=${encodeURIComponent(EDITION_NAME)}&props=_id,file&limit=1`, cfg.token);
	const editionBody = (await editionRes.json()) as { entities?: Array<{ _id: string; file?: Array<{ _id: string; filename?: string; filesize?: number }> }> };
	const edition = editionBody.entities?.[0];
	if (!edition) throw new Error(`'${EDITION_NAME}' not found under work ${workId}`);
	const fileEntry = edition.file?.[0];
	if (!fileEntry) throw new Error(`'${EDITION_NAME}' (${edition._id}) has no 'file' property — has the #275 fixture's upload been deleted?`);

	console.log(`Target: edition ${edition._id}, file property ${fileEntry._id} (${fileEntry.filename}, ${fileEntry.filesize} bytes)`);
	ledger.push({ step: 'resolve-target', editionId: edition._id, propertyId: fileEntry._id, filename: fileEntry.filename, filesize: fileEntry.filesize });

	console.log('\n=== CORS check — fresh signed URL, GET with Origin: https://dev.mvox.eu ===');
	const origins = ['https://dev.mvox.eu', 'https://mvox.eu', 'https://example.com'];
	const results: Array<{ origin: string; status: number; allowOrigin: string | undefined; ok: boolean }> = [];
	for (const origin of origins) {
		const signRes = await entuFetch(cfg.db, `property/${fileEntry._id}`, cfg.token, {});
		if (!signRes.ok) throw new Error(`CORS check (${origin}): signing GET failed: ${signRes.status}`);
		const signBody = (await signRes.json()) as { url?: string };
		if (!signBody.url) throw new Error(`CORS check (${origin}): signing GET returned 2xx with no url`);
		const res = await fetch(signBody.url, { method: 'GET', headers: { Origin: origin } });
		await res.arrayBuffer().catch(() => undefined); // drain body, discard
		const h = headersToObject(res.headers);
		const allowOrigin = h['access-control-allow-origin'];
		console.log(`Origin: ${origin.padEnd(28)} status=${res.status}  Access-Control-Allow-Origin=${allowOrigin ?? '(absent)'}`);
		results.push({ origin, status: res.status, allowOrigin, ok: res.ok });
	}

	const devResult = results.find((r) => r.origin === 'https://dev.mvox.eu');
	const devAdmitted = devResult?.allowOrigin === 'https://dev.mvox.eu';
	const exampleResult = results.find((r) => r.origin === 'https://example.com');
	const exampleAdmitted = !!exampleResult?.allowOrigin;

	console.log(`\ndev.mvox.eu admitted (echoes back exactly): ${devAdmitted}`);
	console.log(`example.com admitted (should be false — not a real allowlist otherwise): ${exampleAdmitted}`);
	console.log(`\nBox 3 (#348) — byte fetch from dev.mvox.eu reaches bucket without CORS failure: ${devAdmitted ? 'CONFIRMED' : 'NOT CONFIRMED'}`);
	console.log(`Box 4 (#348) — openFileBytes 'fallback-navigation' catch would NOT fire on this origin (fetch resolves, not rejects): ${devAdmitted ? 'CONFIRMED QUIESCENT' : 'STILL FIRES — fallback needed'}`);

	ledger.push({
		step: 'cors-check-dev-origin',
		results,
		devAdmitted,
		exampleAdmitted,
		box3Confirmed: devAdmitted,
		box4Confirmed: devAdmitted
	});

	writeLedger({
		scriptName: 'probe-348-dev-origin-cors-check',
		dryRun: false,
		db: cfg.db,
		sensitive: false,
		payload: {
			purpose: 'mvox-app#348 boxes 3+4 — does dev.mvox.eu get CORS-admitted on the bucket, quiescing the #343 fallback-navigation path?',
			ledger
		}
	});
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

// (*MVOX:Perotin*)
