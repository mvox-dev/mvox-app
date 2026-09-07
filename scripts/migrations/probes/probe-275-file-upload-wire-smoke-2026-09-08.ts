// mvox-app#275 — LIVE WIRE SMOKE, polyphony only. GREEN's editionFiles.ts
// exercises Entu's two-step signed-S3 upload against MOCKS; nothing in the
// test suite calls the real S3 leg. This probe drives the real wire, end
// to end. Extended 2026-09-08 (team-lead ruling): polyphony had ZERO
// `edition` entities to attach to, so this script now ALSO creates the
// fixture it targets — and that fixture doubles as the target for the
// human browser smoke that closes #275 (the browser-CORS-preflight half
// this script cannot answer).
//
// SCOPE, STATED SO IT ISN'T OVER-READ:
// - This does NOT answer the browser-CORS-preflight question. Node's
//   fetch/undici lets a caller set Content-Length manually; browser fetch
//   FORBIDS it (a forbidden request header) — so a PUT that succeeds here
//   proves the four-header contract is internally consistent and that
//   POLYPHONY's S3 bucket accepts it from a server-side caller, but says
//   NOTHING about whether a real browser will be allowed to send the same
//   PUT. That half stays a human-in-a-real-browser gate. Recorded in the
//   ledger as `browserCorsAnswered: false`, not silently omitted.
// - This ALSO empirically answers what rights tier `DELETE /property/{id}`
//   needs for a file property (on the failure path only — see below),
//   since this script's API key's rights are already known (polyphony
//   db-root key) — the ledger records the OBSERVED outcome and does not
//   extrapolate to what a lesser-privileged librarian key would see.
//
// FIXTURES (work + edition) — created, not reused, and PERSIST:
// Mirrors src/lib/entity/entityCreate.ts's createWork/createEdition wire
// shape exactly (read before writing this): `_type` + one-element
// `_parent` + domain props, NO `_sharing`, NO `_inheritrights` — the
// library-subtree rights policy (#132 decision), rights propagate down
// from the library entity. Parented under the existing "Polyphony
// Library" entity -> a "SMOKE-275 Test Work" work -> a "SMOKE-275 Test
// Edition" edition. Names are unmistakably labeled so nobody mistakes them
// for real content. Idempotent check-then-create (by name.string under the
// expected parent), so a repeat dry-run/live invocation reuses the same
// fixtures rather than multiplying them.
//
// PERSISTENCE, DELIBERATE: unlike the original single-shot version of this
// script, the fixtures are NOT torn down — they are the target the human
// browser round needs (team-lead ruling, 2026-09-08). On a SUCCESSFUL
// upload, the smoke's own file is ALSO left attached (cleanup DELETE
// skipped) so Mihkel's browser round has something to click "Open" on —
// recorded in the ledger as `filePersistedOnSuccess: true`. The cleanup
// DELETE remains exactly the app's own failure-path behavior: it only
// fires when the PUT (or the download round-trip) did NOT succeed, same
// as editionFiles.ts's phantom-cleanup path.
//
// Mirrors src/lib/library/editionFiles.ts's own wire contract exactly —
// re-read at the merged deee271 (the #275 fix round, grounded on THIS
// script's own envelope diagnostic:
// scripts/migrations/seed-results/probe-275-envelope-diagnostic-live-
// 2026-09-07T23-13-25-163Z.json). STEP-1 PARSING CORRECTED: the real
// response is `{_id, properties: [...]}`, a FLAT ARRAY of property
// objects — matching NEITHER doc example (not quickstart.md's
// object-keyed-by-type shape, not files/index.md's bare single object).
// The original version of this script (and editionFiles.ts pre-fix) read
// `body.properties?.file?.[0]`, which is always undefined against an
// array — that mismatch is exactly what threw "no properties.file[0]" on
// the first live run. Now: `body.properties` is typed `unknown` until an
// `Array.isArray` check, then filtered by `isFileEntry` (type==='file' +
// string _id), same predicate as editionFiles.ts's fix. Everything else
// unchanged: step 1 is ONE POST entity/{editionId} carrying `{type:'file',
// filename, filesize, filetype}` (append idiom, no _type/_parent/_sharing
// — an append to an EXISTING entity); step 2 PUTs bytes to the returned
// upload.url using EXACTLY the four returned headers, through raw fetch
// (never entuFetch, which would prepend ENTU_API_BASE and smuggle
// Authorization/Accept onto a signed URL whose signature covers exactly
// those four); step 3 GETs property/{id} for a fresh (60s-TTL) download
// URL and round-trips the bytes; step 4 is cleanup on the FAILURE path
// only — DELETE property/{id}, same as the app's own phantom-cleanup path.
//
// Synthetic db, routine-ops pre-authorized — but per the standing
// two-step gate, live mutation here STILL waits for team-lead's explicit
// "I authorize this run", covering the whole sequence (create work ->
// create edition -> upload -> download round-trip -> success-path file
// persists).
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

const WORK_NAME = 'SMOKE-275 Test Work';
const EDITION_NAME = 'SMOKE-275 Test Edition';

interface UploadObject {
	url: string;
	method: string;
	headers: Record<string, string | number>;
}
// mvox-app#275 — mirrors editionFiles.ts's corrected contract at deee271
// exactly (fix-round, grounded on THIS script's own live-captured envelope,
// scripts/migrations/seed-results/probe-275-envelope-diagnostic-live-
// 2026-09-07T23-13-25-163Z.json): `properties` is a FLAT ARRAY, typed
// `unknown` until checked — matches neither doc example, that was the bug.
interface StepOnePropertyEntry {
	_id: string;
	type: string;
	filename?: string;
	filesize?: number;
	filetype?: string;
	upload?: UploadObject;
}
interface StepOneResponseBody {
	_id?: string;
	properties?: unknown;
}
function isFileEntry(value: unknown): value is StepOnePropertyEntry {
	if (typeof value !== 'object' || value === null) return false;
	const entry = value as Partial<StepOnePropertyEntry>;
	return entry.type === 'file' && typeof entry._id === 'string';
}

/** Resolve a type-def id by name, under the "entity" meta-type (v4E canonical
 * types live here, not the mvox-schema-extensions app-extension catalog). */
async function resolveTypeId(db: string, token: string, typeName: string): Promise<string> {
	const res = await entuFetch(db, `entity?_type.string=entity&name.string=${encodeURIComponent(typeName)}&props=_id&limit=1`, token);
	if (!res.ok) throw new Error(`resolveTypeId('${typeName}'): query failed: ${res.status}`);
	const body = (await res.json()) as { entities?: Array<{ _id: string }> };
	const id = body.entities?.[0]?._id;
	if (!id) throw new Error(`resolveTypeId('${typeName}'): type-def not found on ${db}`);
	return id;
}

/** Idempotent check-then-create: find an entity of `typeId` named `name`
 * under `parentId`, or create it (no _sharing/_inheritrights — #132 library-
 * subtree rights policy, rights propagate down from the library entity). */
async function ensureEntity(
	db: string,
	token: string,
	typeId: string,
	typeName: string,
	parentId: string,
	name: string,
	dryRun: boolean,
	ledger: Record<string, unknown>[]
): Promise<string | null> {
	const existing = await entuFetch(db, `entity?_type.reference=${typeId}&_parent.reference=${parentId}&name.string=${encodeURIComponent(name)}&props=_id&limit=1`, token);
	if (!existing.ok) throw new Error(`ensureEntity('${name}'): existence check failed: ${existing.status}`);
	const existingBody = (await existing.json()) as { entities?: Array<{ _id: string }> };
	const existingId = existingBody.entities?.[0]?._id;
	// Ledger key is `entityName`, deliberately NOT `name` — `name` is a
	// DEFAULT_REDACT_FIELDS member (since #278) and would render this
	// non-sensitive, already-labeled fixture name as [REDACTED], defeating
	// the point of an auditable ledger for a smoke test. `entityName`
	// carries the exact same string; only the KEY differs.
	if (existingId) {
		ledger.push({ step: `ensure-${typeName}`, outcome: 'found', id: existingId, entityName: name });
		return existingId;
	}

	if (dryRun) {
		ledger.push({ step: `ensure-${typeName}`, outcome: 'dry-run-would-create', entityName: name, parentId });
		return null;
	}

	const res = await entuFetch(db, 'entity', token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify([
			{ type: '_type', reference: typeId },
			{ type: '_parent', reference: parentId },
			{ type: 'name', string: name }
		])
	});
	if (!res.ok) throw new Error(`ensureEntity('${name}'): create failed: ${res.status}`);
	const body = (await res.json()) as { _id?: string };
	if (!body._id) throw new Error(`ensureEntity('${name}'): create returned 2xx without _id — apparent-success trap`);
	ledger.push({ step: `ensure-${typeName}`, outcome: 'created', id: body._id, entityName: name, parentId });
	return body._id;
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const ledger: Record<string, unknown>[] = [];

	// Resolve the existing "Polyphony Library" entity — read-only, never created here.
	const libRes = await entuFetch(cfg.db, `entity?_type.string=library&props=_id,name&limit=1`, cfg.token);
	if (!libRes.ok) throw new Error(`library resolve failed: ${libRes.status}`);
	const libBody = (await libRes.json()) as { count: number; entities: Array<{ _id: string; name?: Array<{ string: string }> }> };
	if (libBody.count === 0) throw new Error('no `library` entity found on polyphony — cannot anchor the SMOKE-275 fixtures');
	const libraryId = libBody.entities[0]._id;
	console.log(`Library entity: ${libraryId} (${libBody.entities[0].name?.[0]?.string ?? '(unnamed)'})`);

	const workTypeId = await resolveTypeId(cfg.db, cfg.token, 'work');
	const editionTypeId = await resolveTypeId(cfg.db, cfg.token, 'edition');

	const workId = await ensureEntity(cfg.db, cfg.token, workTypeId, 'work', libraryId, WORK_NAME, DRY_RUN, ledger);
	console.log(`${WORK_NAME}: ${workId ?? '(would create — dry-run)'}`);

	let editionId: string | null = null;
	if (workId) {
		editionId = await ensureEntity(cfg.db, cfg.token, editionTypeId, 'edition', workId, EDITION_NAME, DRY_RUN, ledger);
		console.log(`${EDITION_NAME}: ${editionId ?? '(would create — dry-run)'}`);
	} else {
		console.log(`${EDITION_NAME}: skipped (dry-run, work not yet resolved)`);
		ledger.push({ step: 'ensure-edition', outcome: 'skipped', reason: 'dry-run: work not yet created' });
	}

	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const filename = `probe-275-wire-smoke-${stamp}.txt`;
	const bytes = new TextEncoder().encode(`mvox-app#275 wire smoke — ${stamp}\n`);
	const filesize = bytes.byteLength;
	const filetype = 'text/plain';

	if (DRY_RUN || !editionId) {
		console.log(`\nWould POST entity/${editionId ?? '<edition-not-yet-created>'} [{type:'file', filename:'${filename}', filesize:${filesize}, filetype:'${filetype}'}]`);
		console.log('Would PUT bytes to the returned upload.url with exactly the four returned headers.');
		console.log('Would GET property/{id} for a fresh download URL and round-trip the bytes.');
		console.log('On success: file property PERSISTS (no cleanup DELETE) — it is the browser smoke\'s target. On failure: DELETE property/{id} exactly as the app\'s own phantom-cleanup path.');
		ledger.push({ step: 'dry-run-upload', wouldTargetEdition: editionId, wouldFilename: filename, wouldFilesize: filesize });
	} else {
		// STEP 1 — metadata POST, append idiom, exactly editionFiles.ts's shape.
		const postRes = await entuFetch(cfg.db, `entity/${editionId}`, cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: 'file', filename, filesize, filetype }])
		});
		if (!postRes.ok) throw new Error(`step-1 metadata POST failed: ${postRes.status}`);
		const postBody = (await postRes.json()) as StepOneResponseBody;
		if (!Array.isArray(postBody.properties)) {
			throw new Error(`step-1 POST returned 2xx but properties is not an array — apparent-success trap; raw: ${JSON.stringify(postBody)}`);
		}
		const entry = postBody.properties.filter(isFileEntry)[0];
		if (!entry || !entry.upload) throw new Error(`step-1 POST returned 2xx but no usable file entry with upload — apparent-success trap; raw: ${JSON.stringify(postBody)}`);
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

		// STEP 4 — SUCCESS path PERSISTS the file (team-lead ruling, 2026-09-08):
		// the browser smoke that closes #275 needs something to click "Open" on.
		// FAILURE path (PUT failed, or the round-trip didn't match) still gets
		// the app's own phantom-cleanup DELETE, and this is where the
		// delete-rights observation lives — OBSERVED outcome only, with THIS
		// key's known rights, not extrapolated to any other identity.
		const uploadSucceeded = putOk && roundTripOk === true;
		if (uploadSucceeded) {
			console.log(`step 4: SKIPPED cleanup — upload succeeded, file PERSISTS on ${editionId} for the browser smoke (filePersistedOnSuccess: true)`);
			ledger.push({ step: 'step-4-cleanup-delete', outcome: 'skipped-persisted-on-success', propertyId: entry._id });
		} else {
			const delRes = await entuFetch(cfg.db, `property/${entry._id}`, cfg.token, { method: 'DELETE' });
			const cleanupOk = delRes.ok;
			console.log(`step 4: DELETE property/${entry._id} ${cleanupOk ? 'OK' : 'FAILED'} (status ${delRes.status}) — observed delete-rights outcome for THIS key only, not extrapolated`);
			ledger.push({ step: 'step-4-cleanup-delete', outcome: cleanupOk ? 'deleted' : 'delete-failed', status: delRes.status, note: 'observed with this script\'s own API key rights only, not extrapolated to other identities' });
			if (!cleanupOk) {
				console.error(`\nCLEANUP FAILED — a phantom/orphan file property (${entry._id}) may remain on ${editionId}. Reporting, not retrying silently.`);
			}
		}
	}

	const artifactPath = writeLedger({
		scriptName: 'probe-275-file-upload-wire-smoke',
		dryRun: DRY_RUN,
		db: cfg.db,
		sensitive: false,
		payload: {
			purpose: 'live wire smoke for mvox-app#275 — Entu two-step signed-S3 upload, real bytes, real round-trip. Mocks in the test suite cannot verify the S3 leg; this does. Fixtures (work+edition) also serve as the target for the human browser smoke that closes #275.',
			libraryId,
			workName: WORK_NAME,
			editionName: EDITION_NAME,
			workId,
			editionId,
			fixturesPersist: true,
			filePersistedOnSuccess: true,
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
