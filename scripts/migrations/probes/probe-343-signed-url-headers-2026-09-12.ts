// mvox-app#343 — READ-ONLY signed-URL header characterization. Zero
// mutation, zero fixtures created/torn down — no authorization gate applies
// (the standing gate is scoped to LIVE MODE MUTATION; this script only
// performs GETs/HEADs). Team-lead dispatch, polyphony synthetic.
//
// Question: what validators does a signed S3/Spaces URL's response carry
// (ETag, Last-Modified), and is the ETag shaped like a raw MD5 (single-part
// upload — usable as a content-identity signal) or a multipart-upload
// composite (`<hex>-<N>`, NOT a content hash)? Also: is the ETag STABLE
// across two independently-minted signed URLs for the same underlying file
// property (confirms the ETag reflects the S3 OBJECT, not something the
// signing step manufactures per-mint)?
//
// Target: the "SMOKE-275 Test Edition" fixture (mvox-app#275,
// probe-275-file-upload-wire-smoke), which was deliberately left PERSISTED
// on success specifically so later work has a stable real uploaded file to
// read against — reused here read-only, nothing written or deleted.
//
// Run:
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/probe-343-signed-url-headers-2026-09-12.ts

import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';
import { writeLedger } from '../lib/ledger-writer';

// EXTENSION (2026-09-12, team-lead follow-up): #343 rewires file-opens from
// navigation-GET to fetch()-GET — the issue's own re-verify trigger names "a
// new HTTP method used against it". #275 verified PUT (upload) + navigation-
// GET (download) only; a `fetch()`-based read-through store is a THIRD wire
// pattern never exercised against this bucket, and fetch is subject to CORS
// in a way `<a>`/`window.open` navigation never was. This settles whether
// the fetch-through-store design works from the browser at all, or needs
// Argo-side CORS work first (as #275's upload leg needed browser-CORS
// clearance separately from the server-side PUT proof).

const WORK_NAME = 'SMOKE-275 Test Work';
const EDITION_NAME = 'SMOKE-275 Test Edition';

function headersToObject(h: Headers): Record<string, string> {
	const out: Record<string, string> = {};
	h.forEach((value, key) => { out[key] = value; });
	return out;
}

function looksLikeRawMd5Etag(etag: string | undefined): boolean {
	if (!etag) return false;
	const stripped = etag.replace(/^"|"$/g, '');
	return /^[a-f0-9]{32}$/i.test(stripped) && !stripped.includes('-');
}

async function mintAndHead(db: string, token: string, propertyId: string, label: string): Promise<{ label: string; signedUrl: string; headHeaders: Record<string, string>; headStatus: number }> {
	const signRes = await entuFetch(db, `property/${propertyId}`, token, {});
	if (!signRes.ok) throw new Error(`${label}: signing GET failed: ${signRes.status}`);
	const signBody = (await signRes.json()) as { url?: string };
	if (!signBody.url) throw new Error(`${label}: signing GET returned 2xx with no url — apparent-success trap`);
	// NOTE: HEAD returns 403 against this signed URL — the S3/Spaces signature
	// covers the HTTP method, and the URL is minted for GET only (matches the
	// app's own download flow, which always GETs). Use GET; the file is tiny
	// (a probe/smoke fixture), so downloading the body is cheap. We only need
	// the response headers, not the body content, for this probe.
	const getRes = await fetch(signBody.url, { method: 'GET' });
	await getRes.arrayBuffer().catch(() => undefined); // drain body, discard
	return { label, signedUrl: signBody.url, headHeaders: headersToObject(getRes.headers), headStatus: getRes.status };
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

	// Two INDEPENDENT mints of the signed URL for the SAME property _id.
	const mint1 = await mintAndHead(cfg.db, cfg.token, fileEntry._id, 'mint-1');
	console.log(`\nmint 1: HEAD status=${mint1.headStatus}`);
	console.log(`  ETag: ${mint1.headHeaders['etag'] ?? '(absent)'}`);
	console.log(`  Last-Modified: ${mint1.headHeaders['last-modified'] ?? '(absent)'}`);
	console.log(`  Content-Length: ${mint1.headHeaders['content-length'] ?? '(absent)'}`);
	console.log(`  Content-Type: ${mint1.headHeaders['content-type'] ?? '(absent)'}`);
	console.log(`  Cache-Control: ${mint1.headHeaders['cache-control'] ?? '(absent)'}`);

	const mint2 = await mintAndHead(cfg.db, cfg.token, fileEntry._id, 'mint-2');
	console.log(`\nmint 2 (independent signed URL, same property _id): HEAD status=${mint2.headStatus}`);
	console.log(`  ETag: ${mint2.headHeaders['etag'] ?? '(absent)'}`);
	console.log(`  Last-Modified: ${mint2.headHeaders['last-modified'] ?? '(absent)'}`);

	const etag1 = mint1.headHeaders['etag'];
	const etag2 = mint2.headHeaders['etag'];
	const etagStableAcrossMints = !!etag1 && etag1 === etag2;
	const etagIsRawMd5 = looksLikeRawMd5Etag(etag1);

	console.log(`\nETag present: ${!!etag1}`);
	console.log(`ETag stable across two independent mints: ${etagStableAcrossMints}`);
	console.log(`ETag shape looks like raw single-part MD5 (usable as content hash): ${etagIsRawMd5}`);
	console.log(`Last-Modified present: ${!!mint1.headHeaders['last-modified']}`);

	ledger.push({
		step: 'header-comparison',
		mint1: { status: mint1.headStatus, headers: mint1.headHeaders },
		mint2: { status: mint2.headStatus, headers: mint2.headHeaders },
		etagPresent: !!etag1,
		etagStableAcrossMints,
		etagIsRawMd5,
		lastModifiedPresent: !!mint1.headHeaders['last-modified']
	});

	// ─── CORS check — fetch()-GET with an Origin header ──────────────────
	// A real browser fetch() always sends Origin cross-origin and refuses to
	// let JS read the response at all unless Access-Control-Allow-Origin
	// admits it; separately, even an ADMITTED response only exposes headers
	// (like ETag) to JS if Access-Control-Expose-Headers lists them. Node's
	// fetch does not enforce CORS client-side (same asymmetry #275 already
	// established for Content-Length) — so this probe reads the RAW response
	// headers regardless of what a browser would ultimately let JS see, and
	// reports what Access-Control-Allow-Origin / Access-Control-Expose-Headers
	// the bucket ITSELF sends, which is the server-side half a browser's
	// CORS enforcement would check against.
	console.log('\n=== CORS check — fresh signed URL, GET with an Origin header ===');
	const corsOrigins = ['https://mvox.eu', 'https://example.com'];
	const corsResults: Array<{ origin: string; status: number; allowOrigin: string | undefined; exposeHeaders: string | undefined; etagPresent: boolean }> = [];
	for (const origin of corsOrigins) {
		const signRes = await entuFetch(cfg.db, `property/${fileEntry._id}`, cfg.token, {});
		if (!signRes.ok) throw new Error(`CORS check (${origin}): signing GET failed: ${signRes.status}`);
		const signBody = (await signRes.json()) as { url?: string };
		if (!signBody.url) throw new Error(`CORS check (${origin}): signing GET returned 2xx with no url`);
		const res = await fetch(signBody.url, { method: 'GET', headers: { Origin: origin } });
		await res.arrayBuffer().catch(() => undefined); // drain, discard
		const h = headersToObject(res.headers);
		const allowOrigin = h['access-control-allow-origin'];
		const exposeHeaders = h['access-control-expose-headers'];
		console.log(`Origin: ${origin.padEnd(28)} status=${res.status}  Access-Control-Allow-Origin=${allowOrigin ?? '(absent)'}  Access-Control-Expose-Headers=${exposeHeaders ?? '(absent)'}`);
		corsResults.push({ origin, status: res.status, allowOrigin, exposeHeaders, etagPresent: !!h['etag'] });
	}
	// Classify against the actual shapes a bucket CORS config can take:
	// - allowlisted-specific: mvox.eu admitted, unexpected origin gets NO
	//   Access-Control-Allow-Origin at all (this bucket's actual shape)
	// - echo-arbitrary: any origin sent comes back verbatim (permissive, no
	//   real allowlist — a security-relevant finding if seen)
	// - none: no CORS headers at all, any origin, admitted or not
	const mvoxResult = corsResults.find((r) => r.origin === 'https://mvox.eu');
	const unexpectedResult = corsResults.find((r) => r.origin === 'https://example.com');
	const mvoxAdmitted = mvoxResult?.allowOrigin === 'https://mvox.eu';
	const unexpectedAdmitted = !!unexpectedResult?.allowOrigin;
	const etagExposedToFetch = (exposeHeaders: string | undefined): boolean =>
		exposeHeaders === '*' || (exposeHeaders ?? '').toLowerCase().split(',').map((s) => s.trim()).includes('etag');
	const mvoxEtagExposed = etagExposedToFetch(mvoxResult?.exposeHeaders);

	const corsShape = !mvoxAdmitted && !unexpectedAdmitted
		? 'none'
		: mvoxAdmitted && !unexpectedAdmitted
			? 'allowlisted-specific'
			: unexpectedAdmitted && unexpectedResult?.allowOrigin === 'https://example.com'
				? 'echo-arbitrary'
				: 'other';

	const corsVerdict =
		corsShape === 'none'
			? 'NO Access-Control-Allow-Origin AT ALL, either origin — a browser fetch() against this signed URL will be BLOCKED by CORS regardless of origin; the fetch-through-store design needs Argo-side CORS configuration on the bucket before it can work from mvox.eu, same class of gap as #275\'s upload-PUT browser leg.'
			: corsShape === 'allowlisted-specific'
				? `ALLOWLISTED TO mvox.eu SPECIFICALLY — https://mvox.eu is admitted (Access-Control-Allow-Origin echoes it back exactly), the unexpected https://example.com gets NO CORS header at all (a browser would block that origin). This is the GOOD case for #343: fetch()-GET against this bucket works from mvox.eu today, no Argo-side change needed for the read leg. BUT Access-Control-Expose-Headers is ${mvoxResult?.exposeHeaders ?? 'ABSENT'} even for the admitted origin — ETag exposed to fetch() JS: ${mvoxEtagExposed}. If the read-through design wants to compare ETag client-side (e.g. \`response.headers.get('etag')\`), that call returns null today; the byte-store must NOT depend on reading ETag from a browser fetch() response unless Argo adds \`Access-Control-Expose-Headers: ETag\` (or \`*\`) to the bucket CORS config. The file-property _id path (probe 1's structural-identity finding) does not need this — it never touches CORS-exposed headers at all.`
				: corsShape === 'echo-arbitrary'
					? 'Access-Control-Allow-Origin ECHOES BACK WHATEVER ORIGIN IS SENT (including an unexpected https://example.com) — permissive, no real allowlist. A security-relevant finding worth flagging on its own, separate from #343\'s design question.'
					: 'OTHER/MIXED shape not matching the expected patterns — read corsResults directly.';
	console.log(`\nCORS VERDICT: ${corsVerdict}`);

	ledger.push({ step: 'cors-check-fetch-get-with-origin', corsResults, corsShape, mvoxAdmitted, unexpectedAdmitted, mvoxEtagExposed, corsVerdict });

	const verdict = !etag1
		? 'NO ETag AT ALL — no server-side content validator available; a byte-store cannot use ETag for staleness detection on this target and must rely purely on the file-property _id (structural identity) or filesize/filename comparison.'
		: !etagStableAcrossMints
			? 'ETag PRESENT BUT UNSTABLE across mints — surprising, would need re-investigation before trusting it as a content signal.'
			: etagIsRawMd5
				? 'ETag PRESENT, STABLE, RAW-MD5-SHAPED — usable as a genuine content-identity validator independent of the file-property _id; a byte-store COULD key/validate on ETag as a belt-and-suspenders check even if _id changes.'
				: 'ETag PRESENT, STABLE, but NOT raw-MD5-shaped (likely multipart-upload composite, e.g. "<hex>-<N>") — stable per-object but NOT a portable content hash; still usable as an opaque staleness signal (same ETag = same object) even though it cannot be recomputed independently.';
	console.log(`\nVERDICT: ${verdict}`);

	const artifactPath = writeLedger({
		scriptName: 'probe-343-signed-url-headers',
		dryRun: false,
		db: cfg.db,
		sensitive: false,
		payload: {
			purpose: 'mvox-app#343 — read-only characterization of signed-URL response headers (ETag/Last-Modified) on a real uploaded file property, to settle whether a server-side validator exists independent of the file-property _id for the offline byte-store staleness design.',
			targetEditionId: edition._id,
			targetPropertyId: fileEntry._id,
			verdict,
			corsVerdict,
			ledger
		}
	});
	console.log(`\nLedger: ${artifactPath}`);
}

main().catch((err) => {
	console.error('probe-343-signed-url-headers ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
