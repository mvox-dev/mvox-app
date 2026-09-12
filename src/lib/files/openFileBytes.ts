// #343 — read-through open: serve stored bytes, else sign + fetch + store.
//
// The identity is an EXPLICIT argument captured by the caller at
// request-issue time — this module never consults a store/global for
// "current" identity, so a fetch that settles after the app switched
// identity still resolves and stores under the identity it was ISSUED under.
// The consumer-side half (suppressing a stale tab navigation) lives in the
// page wiring, not here.
//
// OBJECT-URL OWNERSHIP (#343 review). Every open mints a `blob:` URL, and a
// live object URL pins a full copy of the score in page memory for as long as
// the mapping exists — on top of the stored copy. The pre-#343 delivery leg
// handed the tab a plain https URL and pinned nothing, so this module owns
// the disposal policy that replaces it. Two rules, both enforced here:
//
//   1. ONE LIVE URL PER fileId. Minting for a fileId revokes the URL the
//      previous open of that same fileId returned, so opening parts
//      repeatedly through a rehearsal leaves one live blob per DISTINCT file
//      rather than one per click. Revoking only drops the mapping — a tab
//      that already loaded the document is unaffected — so the single
//      exposed edge is a re-open of the SAME file issued before the earlier
//      tab finished loading: a rare reload traded for a bounded footprint.
//   2. A URL NOBODY WILL CONSUME IS RELEASED BY ITS CALLER. Every open
//      returns `release()` beside the URL. A caller that decides not to hand
//      the URL to anything — the pages' late-settle suppression, where the
//      identity on screen changed while the open was in flight — MUST call
//      it, or the bytes stay pinned behind a URL unreachable by construction.
//
// DELIVERY REPORTING (#343 fix-round, Gama's 1(b) ruling condition 1). Every
// open reports which of four paths delivered, via `reason`:
//   - 'cache'               — served from the store, no network touched.
//   - 'network-stored'      — signed + fetched + stored; served as a blob.
//   - 'network-uncached'    — bytes reached this open (or were never
//     buffered at all) but were NOT stored: the cap check below skipped the
//     fetch before buffering, or the digest could not be computed, or the
//     store's own put() rejected the buffered bytes after the fact.
//   - 'fallback-navigation' — no bytes reached this open: the byte fetch
//     rejected (CORS TypeError, network), or the body read rejected
//     mid-stream. The caller gets a signed URL, the pre-#343 delivery path,
//     not a blob (see PASSTHROUGH FRESHNESS for which signed URL).
// The distinction matters downstream: #334's availability child reads this
// reason, and nothing may mistake a fallback or an uncached delivery for a
// cache hit — the offline promise is built on that not happening. A
// 'fallback-navigation' or 'network-uncached' open leaves nothing in the
// store: the file opened, but this device gained no offline copy from it.
//
// THE CACHE IS NEVER A GATE (#343 second review round). The rule in Gama's
// ruling is stronger than "cache POLICY must not block an open" — the cache
// INFRASTRUCTURE must not either. Every cache-side step here is therefore
// inside a catch, and only a genuine delivery failure (no identity, a non-OK
// byte response) propagates:
//   - the store READ (a blocked-site-data setting, an absent/null
//     `indexedDB` in an embedded webview, a VersionError from a DB left
//     above DB_VERSION by a rollback) degrades to a MISS — sign + fetch, the
//     exact pre-#343 path. A store that is dead for reads is dead for writes
//     too, so the put below throws in turn and the open lands truthfully on
//     'network-uncached'.
//   - the DIGEST is store metadata (#333's hash-pin hook), never needed to
//     deliver, and `crypto.subtle` exists only in a secure context — on a
//     plain-http LAN/tailnet origin it is undefined. A digest failure costs
//     the store its row and nothing else.
//   - the BODY READ can reject on a mid-stream drop, and a signed URL is
//     still obtainable: hand one over rather than discard a working delivery.
//
// PASSTHROUGH FRESHNESS (#343 third review round, finding 2). Three paths hand
// the caller the signed URL instead of a blob. That URL lives 60 SECONDS
// (entu-www `src/api/files/index.md`), and how much of that window is left when
// a passthrough fires is NOT knowable in advance: `fetch` has no default
// timeout, so the rehearsal-hall stalled connection this epic exists for can
// leave `fetchImpl(url)` or `res.arrayBuffer()` pending well past 60s before
// rejecting. Handing over an EXPIRED URL is the worst outcome available — the
// open RESOLVES, so the caller's error surface never fires, and the tab lands
// on S3's raw AccessDenied XML. So the remaining window is MEASURED, not
// assumed: the sign time is recorded and a passthrough whose URL has burned
// most of it re-signs first. The re-sign is one extra `signFileUrl` (not
// CORS-subject — it is the pre-#343 call) on an already-degraded path only; if
// IT rejects, that is a genuine signing failure and propagates loudly, which
// is the honest surface for "we cannot produce a URL that works".

import { signFileUrl } from '$lib/repertoire/fileUrls';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { CollectiveIdentity } from '$lib/collectives/store';
import { BYTE_STORE_CAP_BYTES, type ByteStore } from './byteStore';

/** Which path delivered the bytes — see DELIVERY REPORTING above. */
export type FileBytesDeliveryReason =
	| 'cache'
	| 'network-stored'
	| 'network-uncached'
	| 'fallback-navigation';

/** A minted object URL together with the handle that disposes of it. */
export interface OpenedFileBytes {
	/** The `blob:` URL to navigate to — or, on a fallback/cap-skip path, a
	 *  signed URL known to still be inside its 60s window (see `reason` and
	 *  PASSTHROUGH FRESHNESS). */
	url: string;
	/** Revoke `url` now — for a caller that will not hand it to anything.
	 *  A no-op for a non-blob `url` (nothing was minted to revoke). */
	release: () => void;
	/** Which path delivered — see DELIVERY REPORTING above. */
	reason: FileBytesDeliveryReason;
}

// fileId → the URL the most recent open of that file returned (rule 1).
const liveUrlByFileId = new Map<string, string>();

/**
 * How much of a signed URL's 60s life may already be spent and it is still
 * worth handing to the tab. Below the remainder, a passthrough re-signs — see
 * PASSTHROUGH FRESHNESS above. Short of 60s on purpose: the tab still has to
 * ISSUE the request after we hand the URL over.
 */
const SIGNED_URL_REUSE_BUDGET_MS = 45_000;

function mint(fileId: string, blob: Blob, reason: FileBytesDeliveryReason): OpenedFileBytes {
	const previous = liveUrlByFileId.get(fileId);
	if (previous !== undefined) URL.revokeObjectURL(previous);
	const url = URL.createObjectURL(blob);
	liveUrlByFileId.set(fileId, url);
	return {
		url,
		reason,
		release() {
			// Clear the latch only if it still points at THIS url: a newer open
			// of the same file owns the entry by then and must not lose it.
			if (liveUrlByFileId.get(fileId) === url) liveUrlByFileId.delete(fileId);
			URL.revokeObjectURL(url);
		}
	};
}

/** The non-blob paths (fallback, cap-skip): nothing was minted, so nothing
 *  needs revoking — the URL handed back is the signed URL itself. */
function passthrough(url: string, reason: FileBytesDeliveryReason): OpenedFileBytes {
	return { url, release: () => {}, reason };
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/** The store read, degraded to a MISS on any failure of the store itself —
 *  see THE CACHE IS NEVER A GATE above for what can fail and why a throw here
 *  must not reach the caller. */
async function readStored(store: ByteStore, identity: CollectiveIdentity, fileId: string) {
	try {
		return await store.get(identity, fileId);
	} catch {
		return undefined;
	}
}

/**
 * Returns a `blob:` object URL for the file's bytes, with its `release`
 * handle and a `reason` naming which path delivered. On a store hit no
 * network is touched; on a miss the 60s URL is minted at call time, the
 * bytes fetched and stored under `identity`, and the signed URL discarded.
 * The cap is checked from content-length BEFORE buffering, and a byte fetch
 * that rejects falls back to a signed URL — re-signed first if the window has
 * burned (PASSTHROUGH FRESHNESS above). See DELIVERY REPORTING above for all
 * four paths, and OBJECT-URL OWNERSHIP above for who disposes of a minted
 * URL, and when. Nothing on the cache side can make this throw — not a dead
 * store, not a missing `crypto.subtle`, not an over-cap file, not a dropped
 * body read (see THE CACHE IS NEVER A GATE above). What propagates is only a
 * missing identity, a non-OK byte response, and a signing call that fails
 * (either the first one or a passthrough re-sign) — no URL at all is a
 * delivery failure, not a cache one.
 */
export async function openFileBytes(
	cfg: EntuCfg,
	identity: CollectiveIdentity | null,
	fileId: string,
	store: ByteStore,
	fetchImpl: typeof fetch = fetch
): Promise<OpenedFileBytes> {
	if (identity === null) {
		throw new Error('openFileBytes: no identity — anonymous access has no partition key');
	}

	const hit = await readStored(store, identity, fileId);
	if (hit) {
		return mint(fileId, new Blob([hit.bytes], { type: hit.filetype }), 'cache');
	}

	const url = await signFileUrl(cfg, fileId, fetchImpl);
	const signedAtMs = Date.now();

	/** A passthrough delivery with a URL known to still be in its window —
	 *  re-signed when this open has already burned the budget waiting on a
	 *  fetch that has no timeout (PASSTHROUGH FRESHNESS above). */
	const fresh = async (reason: FileBytesDeliveryReason): Promise<OpenedFileBytes> =>
		Date.now() - signedAtMs <= SIGNED_URL_REUSE_BUDGET_MS
			? passthrough(url, reason)
			: passthrough(await signFileUrl(cfg, fileId, fetchImpl), reason);

	let res: Response;
	try {
		res = await fetchImpl(url);
	} catch {
		// #343 fix-round (Gama's 1(b) ruling) — a DEGRADATION, not a design.
		// The byte fetch itself rejected: a CORS TypeError (dev and preview
		// origins are not on the bucket's GET allowlist — issue #343 finding
		// 1(a); re-verify trigger: a new origin FAMILY, bucket, storage
		// provider, or HTTP method against it) or a plain network failure.
		// Nothing was stored — this open gains the device no offline copy —
		// so hand the caller the exact pre-#343 path: a signed URL, which is
		// not CORS-subject (re-signed if this rejection took long enough to
		// burn the window — PASSTHROUGH FRESHNESS above). This fallback does
		// NOT discharge finding 1(a); the infra ask (allowlist dev + preview)
		// stands regardless of whether it fires.
		return fresh('fallback-navigation');
	}
	if (!res.ok) {
		throw new Error(`openFileBytes: file ${fileId} byte fetch failed: ${res.status}`);
	}

	// Finding 2 + Gama's stated preference: decide BEFORE buffering. Reading
	// arrayBuffer() first and only then checking the cap costs up to ~3x the
	// file's size in transient memory just to discover it must be refused —
	// on a phone, for a 200MB cap, that is up to ~600MB. A response whose
	// declared size already exceeds the cap is never buffered at all: the
	// caller gets the signed URL directly, exactly the fallback path above,
	// but reported distinctly (`network-uncached`, not `fallback-navigation`)
	// so a cap-skip is never mistaken for a fetch failure downstream.
	const contentLength = res.headers.get('content-length');
	if (contentLength !== null && Number(contentLength) > BYTE_STORE_CAP_BYTES) {
		return fresh('network-uncached');
	}

	let bytes: ArrayBuffer;
	try {
		bytes = await res.arrayBuffer();
	} catch {
		// The body read dropped mid-stream. There are no bytes to blob or to
		// store, but a signed URL is still obtainable — the same degradation
		// the fetch-reject catch above names, so it reports the same way
		// rather than discarding a working delivery. This is the slowest of
		// the three passthroughs (headers arrived, then the stream stalled),
		// so it is the likeliest to need the re-sign `fresh` does.
		return fresh('fallback-navigation');
	}
	const filetype = res.headers.get('content-type') ?? 'application/octet-stream';

	// Belt: content-length was absent or understated the true size. The
	// store's own cap check (byteStore.ts) throws rather than silently
	// truncating — correct policy, but the cache must never be able to
	// prevent a file from opening (Gama's ruling). So a rejected put() still
	// delivers the blob from the bytes already in hand; only the reason
	// changes, from stored to uncached. The digest sits INSIDE this try for
	// the same reason: it is store metadata (#333's hash-pin hook), and
	// `crypto.subtle` is undefined on a non-secure origin — losing it must
	// cost the store its row, not the singer their score.
	let stored = true;
	try {
		const sha256 = await sha256Hex(bytes);
		await store.put(identity, fileId, { bytes, filetype, sha256 });
	} catch {
		stored = false;
	}
	return mint(
		fileId,
		new Blob([bytes], { type: filetype }),
		stored ? 'network-stored' : 'network-uncached'
	);
}

// (*MVOX:Josquin*)
