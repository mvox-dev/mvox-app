// mvox-app#275 — LIVE WIRE SMOKE, polyphony only. GREEN's editionFiles.ts
// exercises Entu's two-step signed-S3 upload against MOCKS; nothing in the
// test suite calls the real S3 leg. This probe drives the real wire, end
// to end, against a single existing edition, then cleans up after itself.
//
// SCOPE, STATED SO IT ISN'T OVER-READ:
// - This does NOT answer the browser-CORS-preflight question. Node's
//   fetch/undici lets a caller set Content-Length manually; browser fetch
//   FORBIDS it (a forbidden request header) — so a PUT that succeeds here
//   proves the four-header contract is internally consistent and that
//   POLYPHONY's S3 bucket accepts it from a server-side caller, but says
//   NOTHING about whether a real browser will be allowed to send the same
//   PUT. That half stays a human-in-a-real-browser gate, per team-lead's
//   framing. Recorded in the ledger as `browserCorsAnswered: false`, not
//   silently omitted.
// - This ALSO empirically answers what rights tier `DELETE /property/{id}`
//   needs for a file property, since this script's API key's rights are
//   already known (polyphony db-root key, per the existing credential
//   convention) — the ledger records the OBSERVED outcome (succeeded/
//   failed with this key) and does not extrapolate to what a lesser-
//   privileged librarian key would see.
//
// Mirrors src/lib/library/editionFiles.ts's own wire contract exactly —
// re-read at the merged 93f0b15 (fix round changed the reconciliation
// internals only: returned properties are now matched to local files by
// filename+filesize instead of zipped by position, because entu-www never
// guarantees ordering or count; irrelevant to this smoke's single file,
// where positional and reconciled matching are the same thing). Wire shape
// itself unchanged: step 1 is ONE POST entity/{editionId} carrying
// `{type:'file', filename, filesize, filetype}` (append idiom, no
// _type/_parent/_sharing — an append to an EXISTING entity); step 2 PUTs
// bytes to the returned upload.url using EXACTLY the four returned
// headers, through raw fetch (never entuFetch, which would prepend
// ENTU_API_BASE and smuggle Authorization/Accept onto a signed URL whose
// signature covers exactly those four); step 3 GETs property/{id} for a
// fresh (60s-TTL) download URL and round-trips the bytes; step 4 is
// cleanup — DELETE property/{id}, same as the app's own phantom-cleanup
// path, except here it runs on a SUCCESSFUL upload (the smoke's own file,
// not a real attachment) rather than a failed one.
//
// Target edition: EDITION_ID env override, or the first live `edition`
// entity found on polyphony (read-only resolve). Synthetic db, routine-ops
// pre-authorized — but per the standing two-step gate, live mutation here
// STILL waits for team-lead's explicit "I authorize this run".
//
// Run (standalone node, outside Vite -- needs the $env shim via loader.mjs):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/probe-275-file-upload-wire-smoke-2026-09-08.ts   # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/probe-275-file-upload-wire-smoke-2026-09-08.ts   # ONLY after team-lead's explicit authorization

import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';
import { readDryRun } from '../lib/script-runner';
import { writeLedger } from '../lib/ledger-writer';

const DRY_RUN = readDryRun();

interface UploadObject {
	url: string;
	method: string;
	headers: Record<string, string | number>;
}
interface StepOnePropertyEntry {
	_id: string;
	filename: string;
	filesize: number;
	filetype: string;
	upload: UploadObject;
}
interface StepOneResponseBody {
	properties?: { file?: StepOnePropertyEntry[] };
}

async function resolveTargetEditionId(db: string, token: string): Promise<{ id: string; name: string }> {
	const override = process.env.EDITION_ID;
	if (override) return { id: override, name: '(env override, not read)' };

	const res = await entuFetch(db, `entity?_type.string=edition&props=name&limit=1`, token);
	if (!res.ok) throw new Error(`resolveTargetEditionId: query failed: ${res.status}`);
	const body = (await res.json()) as { count: number; entities: Array<{ _id: string; name?: Array<{ string: string }> }> };
	if (body.count === 0) throw new Error('resolveTargetEditionId: no live `edition` entity found on polyphony — set EDITION_ID to target one explicitly');
	const entity = body.entities[0];
	return { id: entity._id, name: entity.name?.[0]?.string ?? '(unnamed)' };
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const target = await resolveTargetEditionId(cfg.db, cfg.token);
	console.log(`Target edition: ${target.id} (${target.name})`);

	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const filename = `probe-275-wire-smoke-${stamp}.txt`;
	const bytes = new TextEncoder().encode(`mvox-app#275 wire smoke — ${stamp}\n`);
	const filesize = bytes.byteLength;
	const filetype = 'text/plain';

	const ledger: Record<string, unknown>[] = [];

	if (DRY_RUN) {
		console.log(`Would POST entity/${target.id} [{type:'file', filename:'${filename}', filesize:${filesize}, filetype:'${filetype}'}]`);
		console.log('Would PUT bytes to the returned upload.url with exactly the four returned headers.');
		console.log('Would GET property/{id} for a fresh download URL and round-trip the bytes.');
		console.log('Would DELETE property/{id} to clean up (also records the observed delete-rights outcome).');
		ledger.push({ step: 'dry-run', wouldTarget: target.id, wouldFilename: filename, wouldFilesize: filesize });
	} else {
		// STEP 1 — metadata POST, append idiom, exactly editionFiles.ts's shape.
		const postRes = await entuFetch(cfg.db, `entity/${target.id}`, cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: 'file', filename, filesize, filetype }])
		});
		if (!postRes.ok) throw new Error(`step-1 metadata POST failed: ${postRes.status}`);
		const postBody = (await postRes.json()) as StepOneResponseBody;
		const entry = postBody.properties?.file?.[0];
		if (!entry) throw new Error('step-1 POST returned 2xx with no properties.file[0] — apparent-success trap');
		console.log(`step 1 OK: property ${entry._id}, upload.url minted, method=${entry.upload.method}, headers=${JSON.stringify(Object.keys(entry.upload.headers))}`);
		ledger.push({ step: 'step-1-metadata-post', outcome: 'created', propertyId: entry._id, uploadMethod: entry.upload.method, uploadHeaderKeys: Object.keys(entry.upload.headers) });

		// STEP 2 — raw PUT, exactly the four returned headers, RAW fetch (never
		// entuFetch — see module header). browserCorsAnswered: false, always —
		// Node can set Content-Length; a browser cannot.
		let putOk = false;
		let putStatus: number | null = null;
		try {
			const putRes = await fetch(entry.upload.url, {
				method: entry.upload.method,
				headers: entry.upload.headers as HeadersInit,
				body: bytes
			});
			putOk = putRes.ok;
			putStatus = putRes.status;
		} catch (err) {
			console.error(`step 2 PUT threw: ${err instanceof Error ? err.message : String(err)}`);
		}
		console.log(`step 2: PUT ${putOk ? 'OK' : 'FAILED'} (status ${putStatus ?? 'network error'}) — browserCorsAnswered: false (Node sets Content-Length; a browser forbids it — this smoke cannot speak to that half)`);
		ledger.push({ step: 'step-2-s3-put', outcome: putOk ? 'ok' : 'failed', status: putStatus, browserCorsAnswered: false });

		let roundTripOk: boolean | null = null;
		if (putOk) {
			// STEP 3 — fresh signed download URL (60s TTL, never cache), fetch it,
			// compare bytes.
			const signRes = await entuFetch(cfg.db, `property/${entry._id}`, cfg.token, {});
			if (!signRes.ok) throw new Error(`step-3 signing GET failed: ${signRes.status}`);
			const signBody = (await signRes.json()) as { url?: string };
			if (!signBody.url) throw new Error('step-3 signing GET returned 2xx with no url — apparent-success trap');

			const downloadRes = await fetch(signBody.url);
			const downloaded = new Uint8Array(await downloadRes.arrayBuffer());
			roundTripOk = downloadRes.ok && downloaded.length === bytes.length && downloaded.every((b, i) => b === bytes[i]);
			console.log(`step 3: download ${downloadRes.ok ? 'OK' : 'FAILED'} (status ${downloadRes.status}), byte-for-byte round-trip: ${roundTripOk ? 'MATCH' : 'MISMATCH'}`);
			ledger.push({ step: 'step-3-download-roundtrip', outcome: downloadRes.ok ? 'ok' : 'failed', status: downloadRes.status, roundTripMatch: roundTripOk });
		} else {
			console.log('step 3: skipped (step 2 did not succeed)');
			ledger.push({ step: 'step-3-download-roundtrip', outcome: 'skipped', reason: 'step-2 did not succeed' });
		}

		// STEP 4 — cleanup, always attempted regardless of upload outcome (this
		// is OUR smoke file either way, never a real attachment). Also the
		// delete-rights observation team-lead asked for: OBSERVED outcome only,
		// with THIS key's known rights — not extrapolated to any other identity.
		const delRes = await entuFetch(cfg.db, `property/${entry._id}`, cfg.token, { method: 'DELETE' });
		const cleanupOk = delRes.ok;
		console.log(`step 4: DELETE property/${entry._id} ${cleanupOk ? 'OK' : 'FAILED'} (status ${delRes.status}) — observed delete-rights outcome for THIS key only, not extrapolated`);
		ledger.push({ step: 'step-4-cleanup-delete', outcome: cleanupOk ? 'deleted' : 'delete-failed', status: delRes.status, note: 'observed with this script\'s own API key rights only, not extrapolated to other identities' });

		if (!cleanupOk) {
			console.error(`\nCLEANUP FAILED — a phantom/orphan file property (${entry._id}) may remain on ${target.id}. Reporting, not retrying silently.`);
		}
	}

	const artifactPath = writeLedger({
		scriptName: 'probe-275-file-upload-wire-smoke',
		dryRun: DRY_RUN,
		db: cfg.db,
		sensitive: false,
		payload: {
			purpose: 'live wire smoke for mvox-app#275 — Entu two-step signed-S3 upload, real bytes, real round-trip, real cleanup. Mocks in the test suite cannot verify the S3 leg; this does.',
			targetEditionId: target.id,
			scopeNote: 'browserCorsAnswered is always false — Node can set Content-Length manually, a browser forbids it as a request header. This smoke proves the four-header contract and polyphony S3 acceptance from a server-side caller only, never the browser leg.',
			ledger
		}
	});
	console.log(`\nLedger: ${artifactPath}`);
}

main().catch((err) => {
	console.error('probe-275-file-upload-wire-smoke ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
