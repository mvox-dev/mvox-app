// Shared Entu two-step-upload primitives — extracted from
// $lib/library/editionFiles.ts (#275, the app's first upload path) so a
// SECOND property-type upload path (#395's `feedback.screenshot`) composes
// on the same wire contract instead of re-deriving it by copy. See
// editionFiles.ts's module header for the full doc-ruled contract
// (files/index.md) and the live-captured envelope shape; this module holds
// only the pieces more than one upload path needs:
//
//   - `UploadObject`: the signed-upload shape Entu hands back per property
//     (`{ url, method: 'PUT', headers: { ACL, Content-Disposition,
//     Content-Length, Content-Type } }`).
//   - `putUploadBytes`: STEP 2 — PUT the bytes to `upload.url`, through the
//     injected `fetchImpl` DIRECTLY (never entuFetch: entuFetch prepends
//     ENTU_API_BASE, cannot address S3, and would smuggle
//     Authorization/Accept onto a signed URL whose signature covers exactly
//     the four returned headers) — EXACTLY `upload.headers`, verbatim.
//   - `deletePhantomProperty`: the documented recovery when the PUT never
//     lands (files/index.md:72-74 — "delete the property and start over"),
//     the property-VALUE endpoint (`DELETE /property/{id}`, never
//     `/entity/{id}` — the wire-shape split), swallowing its own failure so
//     the caller's real error is never masked by a cleanup error.
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

export interface UploadObject {
	url: string;
	method: string;
	headers: Record<string, string | number>;
}

/** STEP 2 of the two-step upload — see module header. */
export function putUploadBytes(
	upload: UploadObject,
	body: BodyInit,
	fetchImpl: typeof fetch
): Promise<Response> {
	return fetchImpl(upload.url, {
		method: upload.method,
		// EXACTLY the four returned headers, verbatim — the signed URL's
		// signature covers precisely this set (files/index.md).
		headers: upload.headers as HeadersInit,
		body
	});
}

/** The documented phantom-property recovery — never throws; a cleanup
 *  failure is reported (`false`) rather than masking the caller's real
 *  error. */
export async function deletePhantomProperty(
	cfg: EntuCfg,
	propertyId: string,
	fetchImpl: typeof fetch
): Promise<boolean> {
	try {
		const res = await entuFetch(cfg.db, `property/${propertyId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
		return res.ok;
	} catch {
		return false;
	}
}

// (*MVOX:Palestrina* — #395 slice 2/2: extracted from editionFiles.ts)
