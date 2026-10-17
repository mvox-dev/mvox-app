// Read-through open of a file's bytes: the stored copy, else sign, fetch and store (#343).

import { signFileUrl } from '$lib/repertoire/fileUrls';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { CollectiveIdentity } from '$lib/collectives/store';
import { reportProblem } from '$lib/problems/reportProblem';
import { BYTE_STORE_CAP_BYTES, type ByteStore } from './byteStore';

/** Only 'cache' and 'network-stored' mean this device holds an offline copy. */
export type FileBytesDeliveryReason =
	| 'cache'
	| 'network-stored'
	| 'network-uncached'
	| 'fallback-navigation';

/** Why a fetched part was not stored; `error` is the thrown one, when there was one. */
export interface NotStoredCause {
	kind: 'over-cap' | 'no-digest' | 'save-failed' | 'fetch-threw' | 'read-threw';
	error?: unknown;
}

export interface OpenedFileBytes {
	// A blob URL, or on a passthrough a signed URL still inside its window. A caller that does
	// not hand the URL on must call release, or the bytes stay pinned in page memory.
	url: string;
	release: () => void;
	reason: FileBytesDeliveryReason;
	cause?: NotStoredCause;
}

// One live blob URL per fileId: each pins a full copy of the score in page memory.
const liveUrlByFileId = new Map<string, string>();

// A signed URL lives 60s and fetch has no timeout: past 45s a passthrough re-signs first.
const SIGNED_URL_REUSE_BUDGET_MS = 45_000;

function mint(
	fileId: string,
	blob: Blob,
	reason: FileBytesDeliveryReason,
	cause?: NotStoredCause
): OpenedFileBytes {
	const previous = liveUrlByFileId.get(fileId);
	if (previous !== undefined) URL.revokeObjectURL(previous);
	const url = URL.createObjectURL(blob);
	liveUrlByFileId.set(fileId, url);
	return {
		url,
		reason,
		...(cause && { cause }),
		release() {
			// A newer open of the same file may own the entry by now.
			if (liveUrlByFileId.get(fileId) === url) liveUrlByFileId.delete(fileId);
			URL.revokeObjectURL(url);
		}
	};
}

function passthrough(
	url: string,
	reason: FileBytesDeliveryReason,
	cause: NotStoredCause
): OpenedFileBytes {
	return { url, release: () => {}, reason, cause };
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

async function readStored(store: ByteStore, identity: CollectiveIdentity, fileId: string) {
	try {
		return await store.get(identity, fileId);
	} catch {
		return undefined;
	}
}

// `identity` is captured when the request is issued, never read from a global.
/** The cache is never a gate: only no identity, a non-OK response or a failed sign throws. */
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

	const fresh = async (
		reason: FileBytesDeliveryReason,
		cause: NotStoredCause
	): Promise<OpenedFileBytes> =>
		Date.now() - signedAtMs <= SIGNED_URL_REUSE_BUDGET_MS
			? passthrough(url, reason, cause)
			: passthrough(await signFileUrl(cfg, fileId, fetchImpl), reason, cause);

	let res: Response;
	try {
		res = await fetchImpl(url);
	} catch (error) {
		// CORS (an origin off the bucket's GET allowlist) or network: the signed URL still works.
		return fresh('fallback-navigation', { kind: 'fetch-threw', error });
	}
	if (!res.ok) {
		throw new Error(`openFileBytes: file ${fileId} byte fetch failed: ${res.status}`);
	}

	// Over the cap by content-length: skip before buffering, which costs up to 3x the size.
	const contentLength = res.headers.get('content-length');
	if (contentLength !== null && Number(contentLength) > BYTE_STORE_CAP_BYTES) {
		return fresh('network-uncached', { kind: 'over-cap' });
	}

	let bytes: ArrayBuffer;
	try {
		bytes = await res.arrayBuffer();
	} catch (error) {
		return fresh('fallback-navigation', { kind: 'read-threw', error });
	}
	const filetype = res.headers.get('content-type') ?? 'application/octet-stream';

	// A failed digest or put costs the row, not the score. Only the put reports: a digest fails
	// on every open from a plain-http origin, where crypto.subtle does not exist.
	const sha256 = await sha256Hex(bytes).catch(() => null);
	let cause: NotStoredCause | undefined = sha256 === null ? { kind: 'no-digest' } : undefined;
	if (sha256 !== null) {
		try {
			await store.put(identity, fileId, { bytes, filetype, sha256 });
		} catch (error) {
			reportProblem({ area: 'files', action: 'saving a part on this device', error });
			cause = { kind: 'save-failed', error };
		}
	}
	const blob = new Blob([bytes], { type: filetype });
	return mint(fileId, blob, cause ? 'network-uncached' : 'network-stored', cause);
}

// (*MVOX:Josquin*)
