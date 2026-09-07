// mvox-app#275 — LIVE ENVELOPE DIAGNOSTIC, polyphony only, authorized by
// team-lead 2026-09-08 after probe-275-file-upload-wire-smoke-2026-09-08.ts
// threw on `properties.file[0]` while a `file` property WAS actually
// created server-side (confirmed by a read-only follow-up GET) — a phantom
// on the SMOKE-275 fixture edition. This diagnostic exists to answer ONE
// question with the actual bytes, not a doc reading: what does Entu's
// step-1 response body ACTUALLY look like for an append-to-an-EXISTING-
// entity POST, single-file and multi-file?
//
// entu-www's own docs disagree with each other on this exact point:
// - quickstart/index.md's worked example is for `POST /entity` (CREATING a
//   brand-new entity) and shows `{_id, properties: {typeName: [...] }}`.
//   editionFiles.ts's header cites THIS shape (quickstart:57-67) for its
//   step-1 parsing (`body.properties?.file?.[0]`).
// - files/index.md's own step-1 worked example — which IS the append-to-
//   existing-entity case editionFiles.ts actually calls
//   (`POST entity/{editionId}`) — shows a FLAT object instead:
//   `{_id, type, filename, filesize, filetype, upload}`, not wrapped in
//   `properties` at all.
// If files/index.md's shape is what Entu actually returns for an append,
// editionFiles.ts's step-1 parsing is broken against real Entu — a bug a
// mock-based test suite cannot see, exactly the class this smoke exists
// to catch.
//
// SCOPE: two POSTs, metadata only, NO bytes ever PUT (this diagnostic
// probes the envelope, not the S3 leg) — one single-file, one two-file
// (docs claim "each gets its own upload object" but never show a
// multi-file example; this settles whether that's a flat array, several
// top-level keys, or something else). Every property either POST creates
// is a phantom by construction (metadata only, no bytes) and gets DELETEd
// in the same run, along with the pre-existing phantom from the prior
// smoke attempt. Final read-only GET verifies zero `file` properties
// remain on the fixture edition.
//
// Fixtures (work + edition) are NOT touched — they stay, per team-lead's
// ruling, as the target for the human browser round.

import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';
import { readDryRun } from '../lib/script-runner';
import { writeLedger } from '../lib/ledger-writer';

const DRY_RUN = readDryRun();
const EDITION_ID = '6a9f440dca67df980f417d78'; // SMOKE-275 Test Edition
const PRIOR_PHANTOM_ID = '6a9f440dca67df980f417d80'; // from the earlier wire-smoke attempt

/** Best-effort extraction of every file-property `_id` this diagnostic may
 * have created, regardless of which envelope shape the real response turns
 * out to use — walks the raw body looking for `_id` values under any key
 * whose sibling `filename`/`filesize`/`filetype` match what we sent, so a
 * shape we didn't anticipate still gets its phantoms found and cleaned. */
function extractCreatedIds(raw: unknown, sentFilenames: Set<string>): string[] {
	const found: string[] = [];
	function walk(node: unknown): void {
		if (Array.isArray(node)) {
			for (const item of node) walk(item);
			return;
		}
		if (node && typeof node === 'object') {
			const obj = node as Record<string, unknown>;
			if (typeof obj._id === 'string' && typeof obj.filename === 'string' && sentFilenames.has(obj.filename)) {
				found.push(obj._id);
			}
			for (const value of Object.values(obj)) walk(value);
		}
	}
	walk(raw);
	return found;
}

async function postMetadata(db: string, token: string, files: Array<{ filename: string; filesize: number; filetype: string }>) {
	const res = await entuFetch(db, `entity/${EDITION_ID}`, token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(files.map((f) => ({ type: 'file', ...f })))
	});
	const status = res.status;
	let raw: unknown;
	try {
		raw = await res.json();
	} catch {
		raw = await res.text().catch(() => '(unreadable body)');
	}
	return { status, raw };
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE ENVELOPE DIAGNOSTIC'} — db=${cfg.db}\n`);

	if (DRY_RUN) {
		console.log(`Would POST one-file metadata to entity/${EDITION_ID}, capture the complete raw response.`);
		console.log(`Would POST two-file metadata to entity/${EDITION_ID}, capture the complete raw response.`);
		console.log('Would DELETE every phantom file property created (both probes) plus the prior phantom, then verify zero remain.');
		console.log('No mutation in dry-run mode — this diagnostic was authorized as a single explicit live scope; DRY_RUN=false is required to run it.');
		return;
	}

	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const fileA = { filename: `probe-275-envelope-a-${stamp}.txt`, filesize: 11, filetype: 'text/plain' };
	const fileB1 = { filename: `probe-275-envelope-b1-${stamp}.txt`, filesize: 12, filetype: 'text/plain' };
	const fileB2 = { filename: `probe-275-envelope-b2-${stamp}.txt`, filesize: 13, filetype: 'text/plain' };

	// PROBE 1 — single file.
	const single = await postMetadata(cfg.db, cfg.token, [fileA]);
	console.log('=== PROBE 1: single-file POST — RAW RESPONSE ===');
	console.log(`status: ${single.status}`);
	console.log(JSON.stringify(single.raw, null, 2));

	// PROBE 2 — two files in one POST.
	const multi = await postMetadata(cfg.db, cfg.token, [fileB1, fileB2]);
	console.log('\n=== PROBE 2: two-file POST — RAW RESPONSE ===');
	console.log(`status: ${multi.status}`);
	console.log(JSON.stringify(multi.raw, null, 2));

	const sentFilenames = new Set([fileA.filename, fileB1.filename, fileB2.filename]);
	const idsFromResponses = new Set<string>([
		...extractCreatedIds(single.raw, sentFilenames),
		...extractCreatedIds(multi.raw, sentFilenames)
	]);
	console.log(`\nProperty ids extracted from the raw responses: ${[...idsFromResponses].join(', ') || '(none found — envelope shape hid them, falling back to a read-only GET)'}`);

	// Fallback / cross-check: read the edition itself for the AUTHORITATIVE
	// current file list, regardless of what the POST responses' shape hid.
	const editionRes = await entuFetch(cfg.db, `entity/${EDITION_ID}?props=file`, cfg.token);
	const editionBody = (await editionRes.json()) as { entity?: { file?: Array<{ _id: string; filename: string }> } };
	const liveFileProps = editionBody.entity?.file ?? [];
	console.log(`\nLive file properties on the edition right now: ${JSON.stringify(liveFileProps)}`);

	const idsToDelete = new Set<string>([PRIOR_PHANTOM_ID, ...idsFromResponses, ...liveFileProps.map((f) => f._id)]);

	// CLEANUP — every phantom, the original from the prior smoke attempt
	// plus whatever these two probes created. Observed-tier note: DELETE
	// outcomes are this script's own API key's rights, not extrapolated.
	const deletions: Record<string, unknown>[] = [];
	for (const id of idsToDelete) {
		const delRes = await entuFetch(cfg.db, `property/${id}`, cfg.token, { method: 'DELETE' });
		deletions.push({ propertyId: id, outcome: delRes.ok ? 'deleted' : 'delete-failed', status: delRes.status });
		console.log(`DELETE property/${id}: ${delRes.ok ? 'OK' : 'FAILED'} (status ${delRes.status})`);
	}

	// VERIFY — final read-only GET, zero file properties expected.
	const verifyRes = await entuFetch(cfg.db, `entity/${EDITION_ID}?props=file`, cfg.token);
	const verifyBody = (await verifyRes.json()) as { entity?: { file?: unknown[] } };
	const remaining = verifyBody.entity?.file ?? [];
	console.log(`\nFinal verification GET — remaining file properties: ${remaining.length} (expect 0)`);
	if (remaining.length > 0) {
		console.error(`CLEANUP INCOMPLETE — ${remaining.length} file propert${remaining.length === 1 ? 'y' : 'ies'} still present: ${JSON.stringify(remaining)}`);
	}

	const artifactPath = writeLedger({
		scriptName: 'probe-275-envelope-diagnostic',
		dryRun: false,
		db: cfg.db,
		sensitive: false,
		payload: {
			purpose: 'settle the step-1 append-POST response envelope shape with actual bytes, per team-lead authorization 2026-09-08 — editionFiles.ts and the original wire-smoke assumed properties.file[] (quickstart/index.md, the NEW-entity shape); files/index.md\'s own append example shows a flat object instead. No bytes ever PUT — envelope probe only, both properties created are phantoms by construction.',
			editionId: EDITION_ID,
			priorPhantomId: PRIOR_PHANTOM_ID,
			probe1SingleFile: { sentFilename: fileA.filename, status: single.status, rawResponse: single.raw },
			probe2TwoFiles: { sentFilenames: [fileB1.filename, fileB2.filename], status: multi.status, rawResponse: multi.raw },
			idsExtractedFromResponses: [...idsFromResponses],
			liveFilePropsBeforeCleanup: liveFileProps,
			deletions,
			finalVerification: { remainingFileProps: remaining.length, remaining },
			cleanupComplete: remaining.length === 0
		}
	});
	console.log(`\nLedger: ${artifactPath}`);
}

main().catch((err) => {
	console.error('probe-275-envelope-diagnostic ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
