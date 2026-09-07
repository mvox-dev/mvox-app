// #275 — files on an edition: the app's FIRST upload path. GREEN.
//
// WIRE CONTRACT (doc-ruled — consult-and-believe, Mihkel 2026-09-06), pinned
// by editionFiles.spec.ts's header:
//   STEP 1: ONE `POST entity/{editionId}` (append idiom — sectionActions.ts
//   precedent: bare props array, no `_type`/`_parent`/`_sharing`, this is an
//   append to an EXISTING entity, not a create) carrying EVERY file's
//   `{ type: 'file', filename, filesize, filetype }`. entu-www
//   src/api/files/index.md:70 — "Multiple file properties can be created in
//   one POST — each gets its own `upload` object in the response" — so
//   several files ride ONE POST here, never N POSTs. The response envelope
//   (quickstart/index.md:57-67) carries the new property objects under
//   `properties.file`, each with its own `upload` object
//   `{ url, method: 'PUT', headers: { ACL, Content-Disposition,
//   Content-Length, Content-Type } }`.
//   STEP 2: PUT the bytes to `upload.url` "using the exact headers returned
//   in the response — all four are required" (files/index.md). This goes
//   through the injected `fetchImpl` DIRECTLY — never entuFetch, which
//   prepends ENTU_API_BASE (cannot address S3) and would smuggle
//   Authorization/Accept onto a signed URL whose signature covers exactly
//   those four headers.
//   PHANTOM CLEANUP (files/index.md:72-74 — "If the upload URL expires
//   before you complete the S3 PUT, delete the property and start over."):
//   step 1 creates the property BEFORE step 2 sends the bytes, so a failed
//   or interrupted PUT strands a file property pointing at nothing (the S3
//   bytes were never stored — the property is pure metadata with no object
//   behind it, not a soft-deletable file). The recovery is
//   `DELETE /property/{_id}`, and the docs rule that endpoint user-facing by
//   handing it to the uploading caller AS the recovery instruction
//   (files/index.md:72-74). properties/index.md:124-141 documents NO tier
//   restriction for ordinary properties: its Restrictions table reserves
//   `_owner` rights for the eight named SYSTEM properties only (the five
//   rights props `_owner`/`_editor`/`_expander`/`_viewer`/`_noaccess`, plus
//   `_sharing`, `_parent`, and the rights-inheritance flag — spelled out in
//   the spec header, not here, so this file stays clear of the
//   sole-create-path guard's needle), and `file` is none of them. (That
//   corrects the old team-memory claim of admin/teardown-only.) A failed cleanup
//   DELETE is reported as `cleanup: 'delete-failed'`, never silently
//   dropped or promoted to a normal upload — the phantom may still be
//   sitting server-side and the caller must say so.
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

/** One file that fully landed: property created AND bytes stored. Carries NO
 *  url — download URLs have a 60s TTL and are minted at click time by
 *  signFileUrl ($lib/repertoire/fileUrls). */
export interface UploadedEditionFile {
	propertyId: string;
	filename: string;
	filesize: number;
	filetype: string;
}

/** One file that did NOT land. `cleanup: 'deleted'` — the phantom property
 *  was removed; `'delete-failed'` — the DELETE itself failed, a broken
 *  attachment may remain server-side and the UI must say so; `'not-created'`
 *  — step 1 returned no property for this file at all, so nothing exists to
 *  delete and nothing landed ('deleted' would lie about a cleanup that never
 *  had a target). */
export type FailedEditionFile =
	| { propertyId: string; filename: string; cleanup: 'deleted' | 'delete-failed' }
	// Discriminated on `cleanup` so a 'not-created' entry's null id can never be
	// read as a property id: only this member carries null, and narrowing on the
	// cleanup state is what unlocks the other two's `string`.
	| { propertyId: null; filename: string; cleanup: 'not-created' };

export interface UploadEditionFilesResult {
	uploaded: UploadedEditionFile[];
	failed: FailedEditionFile[];
}

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

/**
 * Attaches `files` to the edition via Entu's two-step signed-S3 upload.
 * Throws when the step-1 POST fails (nothing created, nothing to clean);
 * per-file PUT failures are cleaned up and REPORTED, never thrown.
 */
export async function uploadEditionFiles(
	cfg: EntuCfg,
	editionId: string,
	files: File[],
	fetchImpl: typeof fetch = fetch
): Promise<UploadEditionFilesResult> {
	// STEP 1 — one POST, every file, append idiom (see module header).
	const props = files.map((f) => ({
		type: 'file',
		filename: f.name,
		filesize: f.size,
		filetype: f.type
	}));

	const postRes = await entuFetch(
		cfg.db,
		`entity/${editionId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(props)
		},
		fetchImpl
	);
	if (!postRes.ok) {
		throw new Error(`uploadEditionFiles: step-1 create failed: HTTP ${postRes.status}`);
	}
	const body = (await postRes.json()) as StepOneResponseBody;
	const entries = body.properties?.file ?? [];

	const uploaded: UploadedEditionFile[] = [];
	const failed: FailedEditionFile[] = [];

	// STEP 2 — one PUT per returned property. That entu returns the properties
	// in the order the props array was sent is an ASSUMPTION, not something
	// the docs guarantee, and the count is not guaranteed to match either — so
	// entries are RECONCILED against the local files by filename + filesize
	// instead of zipped by position, and position serves only as the tie-break
	// between two otherwise indistinguishable selections. Both leftovers are
	// LOUD (#253 says-exactly-what-landed): an entry no file answers is a
	// phantom whose bytes can never be sent (PUTting it would post an
	// `undefined` body, and a 2xx would promote a byte-less property into
	// `uploaded` — the exact phantom this cleanup exists to prevent), so it
	// gets the DELETE; a file no entry answers never became a property at all.
	//
	// STATED LIMITATION (considered and priced, not missed): filename + filesize
	// is not a unique key. Two files sharing both pair ambiguously — but in the
	// realistic cases (the same file picked twice, two scans of one part) an
	// arbitrary pairing between identical keys is indistinguishable in the
	// result, and a same-name-same-size-DIFFERENT-content collision is not
	// something a choir librarian produces. Airtightness would need a per-file
	// token round-tripped through the POST: a wire change declined for an edge
	// nobody will hit.
	const pool = files.map((file, index) => ({ file, index, taken: false }));

	function claimFileFor(entry: StepOnePropertyEntry, entryIndex: number): File | null {
		const candidates = pool.filter(
			(c) => !c.taken && c.file.name === entry.filename && c.file.size === entry.filesize
		);
		if (candidates.length === 0) return null;
		const chosen = candidates.find((c) => c.index === entryIndex) ?? candidates[0];
		chosen.taken = true;
		return chosen.file;
	}

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		const file = claimFileFor(entry, i);

		let putOk: boolean;
		if (file === null) {
			// Unpairable entry: skip step 2 entirely and fall through to cleanup.
			putOk = false;
		} else {
			try {
				const putRes = await fetchImpl(entry.upload.url, {
					method: entry.upload.method,
					// EXACTLY the four returned headers, verbatim — the signed URL's
					// signature covers precisely this set (files/index.md).
					headers: entry.upload.headers as HeadersInit,
					body: file
				});
				putOk = putRes.ok;
			} catch {
				// Network death mid-upload gets the same cleanup as a non-2xx.
				putOk = false;
			}
		}

		if (putOk) {
			uploaded.push({
				propertyId: entry._id,
				filename: entry.filename,
				filesize: entry.filesize,
				filetype: entry.filetype
			});
			continue;
		}

		// PHANTOM CLEANUP — files/index.md:72-74, user-facing per
		// properties/index.md:124-141 (see module header). The property-VALUE
		// endpoint (never entity/{id} — the wire-shape split), through
		// entuFetch (API base + auth).
		let cleanup: FailedEditionFile['cleanup'];
		try {
			const delRes = await entuFetch(
				cfg.db,
				`property/${entry._id}`,
				cfg.token,
				{ method: 'DELETE' },
				fetchImpl
			);
			cleanup = delRes.ok ? 'deleted' : 'delete-failed';
		} catch {
			cleanup = 'delete-failed';
		}

		failed.push({ propertyId: entry._id, filename: entry.filename, cleanup });
	}

	// Files no entry answered: step 1 created nothing for them, so there is no
	// phantom to delete — but they must never just vanish from the result.
	for (const leftover of pool) {
		if (leftover.taken) continue;
		failed.push({ propertyId: null, filename: leftover.file.name, cleanup: 'not-created' });
	}

	return { uploaded, failed };
}

/** Human filesize: bytes plain below 1 KB, 1024-based units with one decimal
 *  from KB up. Locale-independent (numeric/tabular text — #207 rule 7). */
export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes / 1024;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex++;
	}
	return `${value.toFixed(1)} ${units[unitIndex]}`;
}

// (*MVOX:Tallis* — #275 RED contract stub)
// (*MVOX:Palestrina* — #275 GREEN implementation)
