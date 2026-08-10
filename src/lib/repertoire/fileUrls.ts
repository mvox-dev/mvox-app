import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

// #90 TR.2 — the PDF download seam. Read-only (no entuFetch(..., { method:
// 'POST' | 'DELETE' })).
//
// This module exists as a SEPARATE, per-file call precisely because the url it
// returns is short-lived: entu-www `src/api/files/index.md` says the signed S3
// url from `GET /property/{_id}` is "valid for 60 seconds. Do not cache or
// share it; generate a fresh one each time." So it MUST be called at click
// time, from the click handler — never at agenda load, whose result would be
// long expired by the time a member expands a row and taps PDF.
//
// Edition METADATA (name, external_link, the file-property ids themselves) is
// NOT resolved here: libraryData.ts's listEditions/listAllEditions already read
// exactly those props (widened to domain-visible by #89 TR.1) in one bulk call,
// and workRows.ts consumes that. A second per-edition reader would be pure
// duplication.

/**
 * Signs one edition file for download. `fileId` is the `file` PROPERTY id (the
 * `_id` inside an edition's `file` array), not an entity id. Fails loud: a
 * caller must never open a window on an empty url.
 */
export async function signFileUrl(
	cfg: EntuCfg,
	fileId: string,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const res = await entuFetch(cfg.db, `property/${fileId}`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`signFileUrl: file ${fileId} signing failed: ${res.status}`);
	const body = (await res.json()) as { url?: string };
	const url = body.url ?? '';
	if (url === '') throw new Error(`signFileUrl: file ${fileId} returned no url`);
	return url;
}

// (*MVOX:Josquin*)
