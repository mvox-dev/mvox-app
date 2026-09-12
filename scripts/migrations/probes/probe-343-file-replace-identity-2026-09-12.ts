// mvox-app#343 — the DECISIVE probe for the offline-byte-store staleness
// mechanism. Team-lead dispatch, polyphony synthetic, routine pre-authorized
// CLASS (file-prop replace on a throwaway `_probe_343_*` edition entity) —
// but per the standing authorization-gate discipline (perotin.md
// "Authorization gate — canonical statement"), the CLASS being routine does
// not itself satisfy the gate: LIVE mutation here still waits on team-lead's
// explicit "I authorize this run" for THIS script. DRY_RUN defaults true.
//
// Docs read first (entu-www api/files/index.md + api/properties/index.md):
// - "Each file property gets its own unique storage location identified by
//   its `_id`" (files doc) — supports file identity being STRUCTURAL.
// - "Overwriting a Property Value": POST with an existing `_id` "replaces
//   the value of that exact property object" — written generically for
//   string/number/etc; NEVER states whether this applies to `file`-typed
//   properties, and if it does, whether it mints a fresh `upload` slot
//   (same `_id`, new S3 write) or just patches the metadata fields
//   (filename/filesize/filetype) with no byte-level effect. THIS is the gap.
// - "Deleting a File Property": DELETE soft-deletes the property record;
//   "the underlying file in object storage is NOT removed — only the
//   property reference is deleted." Worth watching for: does a post-delete
//   GET /property/{id} still resolve (soft-delete visible to a direct-by-id
//   read) or 404 (excluded like an entity read)? Not directly asked by
//   team-lead but cheap to observe in the same sequence.
//
// THREE SUB-QUESTIONS (team-lead's exact framing):
//   (a) baseline — read current file[] on the test entity: _id, filename, filesize.
//   (b) documented replace route — DELETE /property/{old_id} + POST new file
//       metadata (fresh create, new upload flow) — does this yield a NEW _id?
//       (Expected structurally yes; confirms the baseline mechanic before
//       testing the ambiguous branch.)
//   (c) THE AMBIGUOUS BRANCH — POST with the EXISTING _id on a file property
//       (the generic "Overwriting a Property Value" shape) — does Entu:
//         - offer a fresh `upload` object under the SAME _id (in-place
//           overwrite, byte-store staleness NOT structural — same key,
//           different bytes, a stale cache entry would silently keep
//           serving old bytes under the winning key)?
//         - patch metadata only, no upload slot (renaming without byte
//           replacement — no staleness risk from THIS path, since bytes
//           never move)?
//         - reject the request (400/403 — file properties are exempt from
//           the generic overwrite-by-_id convention)?
//         - silently ignore the supplied _id and append a new value anyway
//           (contradicts the doc's own overwrite semantics for this
//           property type)?
//       If a fresh upload IS offered, this script PUTs new bytes to it and
//       downloads afterward to settle definitively whether the SAME _id can
//       serve DIFFERENT bytes after the round-trip (the actual staleness
//       mechanism #343 needs to design around).
//
// FIXTURE: a throwaway, fully disposable `edition` entity under a throwaway
// `work`, both named "_probe_343 ..." so nobody mistakes them for real
// content (mirrors probe-275's ensureEntity idempotent check-then-create,
// parented under the existing "Polyphony Library" entity — same #132
// library-subtree rights policy, no _sharing/_inheritrights override
// needed). UNLIKE probe-275's SMOKE-275 fixture (deliberately persisted for
// a browser smoke), THIS fixture is fully torn down at the end regardless
// of outcome — nothing here is meant to be clicked on later.
//
// Run (standalone node, outside Vite):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/probe-343-file-replace-identity-2026-09-12.ts   # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/probe-343-file-replace-identity-2026-09-12.ts   # ONLY after team-lead's explicit "I authorize this run"

import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';
import { readDryRun } from '../lib/script-runner';
import { writeLedger } from '../lib/ledger-writer';

const DRY_RUN = readDryRun();

const WORK_NAME = '_probe_343 Test Work';
const EDITION_NAME = '_probe_343 Test Edition';

interface UploadObject {
	url: string;
	method: string;
	headers: Record<string, string | number>;
}
interface FilePropertyEntry {
	_id: string;
	type: string;
	filename?: string;
	filesize?: number;
	filetype?: string;
	upload?: UploadObject;
}
interface PostResponseBody {
	_id?: string;
	properties?: unknown;
}
function isFileEntry(value: unknown): value is FilePropertyEntry {
	if (typeof value !== 'object' || value === null) return false;
	const entry = value as Partial<FilePropertyEntry>;
	return entry.type === 'file' && typeof entry._id === 'string';
}

async function resolveTypeId(db: string, token: string, typeName: string): Promise<string> {
	const res = await entuFetch(db, `entity?_type.string=entity&name.string=${encodeURIComponent(typeName)}&props=_id&limit=1`, token);
	if (!res.ok) throw new Error(`resolveTypeId('${typeName}'): query failed: ${res.status}`);
	const body = (await res.json()) as { entities?: Array<{ _id: string }> };
	const id = body.entities?.[0]?._id;
	if (!id) throw new Error(`resolveTypeId('${typeName}'): type-def not found on ${db}`);
	return id;
}

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

/** Step-1 metadata POST + step-2 raw S3 PUT, mirrors editionFiles.ts / probe-275 exactly. */
async function uploadFile(
	db: string,
	token: string,
	editionId: string,
	filename: string,
	filetype: string,
	bytes: Uint8Array
): Promise<{ propertyId: string; uploadHeaderKeys: string[]; putOk: boolean; putStatus: number | null }> {
	const postRes = await entuFetch(db, `entity/${editionId}`, token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify([{ type: 'file', filename, filesize: bytes.byteLength, filetype }])
	});
	if (!postRes.ok) throw new Error(`uploadFile('${filename}'): metadata POST failed: ${postRes.status}`);
	const postBody = (await postRes.json()) as PostResponseBody;
	if (!Array.isArray(postBody.properties)) throw new Error(`uploadFile('${filename}'): properties not an array — apparent-success trap; raw: ${JSON.stringify(postBody)}`);
	const entry = postBody.properties.filter(isFileEntry).find((e) => e.filename === filename) ?? postBody.properties.filter(isFileEntry).pop();
	if (!entry || !entry.upload) throw new Error(`uploadFile('${filename}'): no usable file entry with upload; raw: ${JSON.stringify(postBody)}`);
	const putRes = await fetch(entry.upload.url, { method: entry.upload.method, headers: entry.upload.headers as HeadersInit, body: bytes });
	return { propertyId: entry._id, uploadHeaderKeys: Object.keys(entry.upload.headers), putOk: putRes.ok, putStatus: putRes.status };
}

async function downloadFile(db: string, token: string, propertyId: string): Promise<Uint8Array | null> {
	const signRes = await entuFetch(db, `property/${propertyId}`, token, {});
	if (!signRes.ok) return null;
	const signBody = (await signRes.json()) as { url?: string };
	if (!signBody.url) return null;
	const downloadRes = await fetch(signBody.url);
	if (!downloadRes.ok) return null;
	return new Uint8Array(await downloadRes.arrayBuffer());
}

function bytesEqual(a: Uint8Array | null, b: Uint8Array): boolean {
	return !!a && a.length === b.length && a.every((v, i) => v === b[i]);
}

// CORRECTED post-live-run (found via a scratch read-only shape-check, see
// probe report to team-lead): a single-entity GET is wrapped as
// `{entity: {...}}` with properties KEYED by name (`entity.file`), NOT the
// flat `{properties: [...]}` array shape — that flat shape is specific to
// the POST create/append response (the #275 finding). The FIRST live run of
// this script used the wrong shape here, so its `readBack`/`finalReadBack`
// ledger fields are bogus ([] always) — the run's actual verdicts did not
// depend on this helper (they come from the POST response bodies + direct
// property GETs), but the ledger has a `caveats` note patched in explaining
// why those specific fields read empty.
async function readEditionFile(db: string, token: string, editionId: string): Promise<Array<{ _id: string; filename?: string; filesize?: number }>> {
	const res = await entuFetch(db, `entity/${editionId}?props=file`, token);
	if (!res.ok) throw new Error(`readEditionFile: GET failed: ${res.status}`);
	const body = (await res.json()) as { entity?: { file?: Array<{ _id: string; filename?: string; filesize?: number }> } };
	return body.entity?.file ?? [];
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const ledger: Record<string, unknown>[] = [];
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');

	const libRes = await entuFetch(cfg.db, `entity?_type.string=library&props=_id,name&limit=1`, cfg.token);
	if (!libRes.ok) throw new Error(`library resolve failed: ${libRes.status}`);
	const libBody = (await libRes.json()) as { count: number; entities: Array<{ _id: string }> };
	if (libBody.count === 0) throw new Error('no `library` entity found on polyphony');
	const libraryId = libBody.entities[0]._id;

	const workTypeId = await resolveTypeId(cfg.db, cfg.token, 'work');
	const editionTypeId = await resolveTypeId(cfg.db, cfg.token, 'edition');

	const workId = await ensureEntity(cfg.db, cfg.token, workTypeId, 'work', libraryId, WORK_NAME, DRY_RUN, ledger);
	const editionId = workId ? await ensureEntity(cfg.db, cfg.token, editionTypeId, 'edition', workId, EDITION_NAME, DRY_RUN, ledger) : null;
	console.log(`work=${workId ?? '(dry-run)'} edition=${editionId ?? '(dry-run)'}`);

	if (DRY_RUN || !editionId || !workId) {
		console.log('\nWould: (a) upload v1 baseline, (b) DELETE+POST replace to v2 (documented route), (c) POST-with-existing-_id to v3 (ambiguous branch, the decisive test), then read back + teardown.');
		ledger.push({ step: 'dry-run-plan', wouldTargetEdition: editionId, wouldTargetWork: workId });
	} else {
		const enc = new TextEncoder();
		const v1 = enc.encode(`probe-343 v1 baseline ${stamp}\n`);
		const v2 = enc.encode(`probe-343 v2 via-delete-then-post replace ${stamp} (longer than v1)\n`);
		const v3 = enc.encode(`probe-343 v3 via-existing-_id overwrite attempt ${stamp} (longer than v2 still)\n`);

		// (a) BASELINE
		console.log('=== (a) baseline upload (v1) ===');
		const up1 = await uploadFile(cfg.db, cfg.token, editionId, 'probe343-v1.txt', 'text/plain', v1);
		console.log(`v1: propertyId=${up1.propertyId} put=${up1.putOk}(${up1.putStatus})`);
		const readAfter1 = await readEditionFile(cfg.db, cfg.token, editionId);
		ledger.push({ step: 'a-baseline-upload', outcome: up1.putOk ? 'ok' : 'put-failed', propertyId: up1.propertyId, filesize: v1.byteLength, readBack: readAfter1 });

		// (b) DOCUMENTED REPLACE ROUTE — DELETE then POST fresh
		console.log('\n=== (b) documented replace: DELETE old + POST new (v2) ===');
		const delRes = await entuFetch(cfg.db, `property/${up1.propertyId}`, cfg.token, { method: 'DELETE' });
		const delOk = delRes.ok;
		// Observe soft-delete visibility: does a direct GET on the deleted property _id still resolve?
		const postDeleteGet = await entuFetch(cfg.db, `property/${up1.propertyId}`, cfg.token, {});
		console.log(`DELETE property/${up1.propertyId}: ${delOk} (${delRes.status}); post-delete direct GET status: ${postDeleteGet.status}`);
		const up2 = await uploadFile(cfg.db, cfg.token, editionId, 'probe343-v2.txt', 'text/plain', v2);
		console.log(`v2: propertyId=${up2.propertyId} put=${up2.putOk}(${up2.putStatus}) — new _id vs v1? ${up2.propertyId !== up1.propertyId}`);
		const readAfter2 = await readEditionFile(cfg.db, cfg.token, editionId);
		ledger.push({
			step: 'b-documented-replace-delete-then-post',
			outcome: delOk && up2.putOk && up2.propertyId !== up1.propertyId ? 'new-id-confirmed' : 'UNEXPECTED',
			deleteOk: delOk, deleteStatus: delRes.status, postDeleteDirectGetStatus: postDeleteGet.status,
			oldId: up1.propertyId, newId: up2.propertyId, idChanged: up2.propertyId !== up1.propertyId,
			readBack: readAfter2
		});

		// (c) THE AMBIGUOUS BRANCH — POST with EXISTING _id (v2's), new metadata (v3)
		console.log('\n=== (c) ambiguous branch: POST with EXISTING _id, different content (v3) ===');
		const overwriteRes = await entuFetch(cfg.db, `entity/${editionId}`, cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ _id: up2.propertyId, type: 'file', filename: 'probe343-v3.txt', filesize: v3.byteLength, filetype: 'text/plain' }])
		});
		const overwriteStatus = overwriteRes.status;
		const overwriteBody = (await overwriteRes.json().catch(() => null)) as PostResponseBody | null;
		console.log(`POST-with-existing-_id: status=${overwriteStatus}`);
		console.log(`raw response: ${JSON.stringify(overwriteBody)}`);

		const overwriteEntries = Array.isArray(overwriteBody?.properties) ? overwriteBody!.properties.filter(isFileEntry) : [];
		const sameIdEntry = overwriteEntries.find((e) => e._id === up2.propertyId);
		const newIdEntry = overwriteEntries.find((e) => e._id !== up2.propertyId);

		let branch: string;
		let putV3Ok: boolean | null = null;
		let putV3Status: number | null = null;
		let downloadedAfterOverwrite: Uint8Array | null = null;
		let sameIdServesNewBytes: boolean | null = null;

		if (!overwriteRes.ok) {
			branch = 'REJECTED — non-2xx, file properties are NOT overwritable by existing _id';
		} else if (sameIdEntry && sameIdEntry.upload) {
			branch = 'SAME-_ID-FRESH-UPLOAD-OFFERED — in-place overwrite path exists; PUTting new bytes and re-downloading to settle staleness';
			const putV3 = await fetch(sameIdEntry.upload.url, { method: sameIdEntry.upload.method, headers: sameIdEntry.upload.headers as HeadersInit, body: v3 });
			putV3Ok = putV3.ok;
			putV3Status = putV3.status;
			if (putV3Ok) {
				downloadedAfterOverwrite = await downloadFile(cfg.db, cfg.token, up2.propertyId);
				sameIdServesNewBytes = bytesEqual(downloadedAfterOverwrite, v3);
			}
		} else if (sameIdEntry && !sameIdEntry.upload) {
			branch = 'SAME-_ID-METADATA-ONLY — _id preserved, filename/filesize/filetype patched, NO fresh upload slot minted (bytes never move)';
			downloadedAfterOverwrite = await downloadFile(cfg.db, cfg.token, up2.propertyId);
			sameIdServesNewBytes = bytesEqual(downloadedAfterOverwrite, v3); // expected false — still v2 bytes
		} else if (newIdEntry) {
			branch = 'SUPPLIED-_ID-IGNORED — Entu appended a NEW property despite the existing _id in the payload (file properties exempt from generic overwrite-by-_id semantics)';
		} else {
			branch = 'UNEXPECTED — 2xx but no recognizable file entry in the response';
		}
		console.log(`\nBRANCH: ${branch}`);
		if (sameIdServesNewBytes !== null) console.log(`Same-_id-serves-new-bytes: ${sameIdServesNewBytes} (downloaded ${downloadedAfterOverwrite?.length ?? 'null'} bytes, expected v3=${v3.byteLength})`);

		const finalReadBack = await readEditionFile(cfg.db, cfg.token, editionId);
		ledger.push({
			step: 'c-ambiguous-branch-post-with-existing-id',
			outcome: branch,
			requestStatus: overwriteStatus,
			rawResponse: overwriteBody,
			putV3Ok, putV3Status,
			sameIdServesNewBytes,
			finalReadBack
		});

		// TEARDOWN — full, regardless of outcome. Delete whatever file property
		// _id(s) remain live, then the edition + work entities.
		console.log('\n=== teardown ===');
		const remaining = finalReadBack.map((p) => p._id);
		const deleteResults: Array<{ id: string; ok: boolean; status: number }> = [];
		for (const id of remaining) {
			const r = await entuFetch(cfg.db, `property/${id}`, cfg.token, { method: 'DELETE' });
			deleteResults.push({ id, ok: r.ok, status: r.status });
		}
		const delEdition = await entuFetch(cfg.db, `entity/${editionId}`, cfg.token, { method: 'DELETE' });
		const delWork = await entuFetch(cfg.db, `entity/${workId}`, cfg.token, { method: 'DELETE' });
		// Independent re-verification: fresh GETs, not trusting the delete calls' own self-report.
		const reverifyEdition = await entuFetch(cfg.db, `entity/${editionId}`, cfg.token, {});
		const reverifyWork = await entuFetch(cfg.db, `entity/${workId}`, cfg.token, {});
		console.log(`deleted ${deleteResults.length} residual file propert(y/ies): ${JSON.stringify(deleteResults)}`);
		console.log(`edition delete ok=${delEdition.ok}, re-verify GET status=${reverifyEdition.status} (expect 404)`);
		console.log(`work delete ok=${delWork.ok}, re-verify GET status=${reverifyWork.status} (expect 404)`);
		ledger.push({
			step: 'teardown',
			outcome: reverifyEdition.status === 404 && reverifyWork.status === 404 ? 'clean' : 'RESIDUE-SUSPECTED',
			deletedProperties: deleteResults,
			editionDeleteOk: delEdition.ok, editionReverifyStatus: reverifyEdition.status,
			workDeleteOk: delWork.ok, workReverifyStatus: reverifyWork.status
		});
	}

	const artifactPath = writeLedger({
		scriptName: 'probe-343-file-replace-identity',
		dryRun: DRY_RUN,
		db: cfg.db,
		sensitive: false,
		payload: {
			purpose: 'mvox-app#343 — does replacing a file-type property change its _id (structural staleness) or can the same _id come to serve different bytes (staleness NOT structural, needs a validator)? Fully disposable _probe_343_* fixture, torn down regardless of outcome.',
			docsChecked: [
				'~/projects/entu-www/src/api/files/index.md — "Each file property gets its own unique storage location identified by its _id"; "Deleting a File Property" — soft-delete, underlying object storage file NOT removed',
				'~/projects/entu-www/src/api/properties/index.md — "Overwriting a Property Value" — generic _id-in-payload replace semantics, silent on whether it applies to file-typed properties'
			],
			ledger
		}
	});
	console.log(`\nLedger: ${artifactPath}`);
}

main().catch((err) => {
	console.error('probe-343-file-replace-identity ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
