// Attaches files to an edition: one append POST creates every file property, then one S3 PUT each.
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/entu/cfg';
import { deletePhantomProperty, putUploadBytes, type UploadObject } from '$lib/files/entuUpload';

// No url: download urls live 60 seconds and are signed at click time by signFileUrl.
export interface UploadedEditionFile {
	propertyId: string;
	filename: string;
	filesize: number;
	filetype: string;
}

// 'delete-failed': a broken attachment may remain server-side and the UI must say so.
// 'not-created': step 1 returned no property for this file, so there is no id to delete.
export type FailedEditionFile =
	| { propertyId: string; filename: string; cleanup: 'deleted' | 'delete-failed' }
	| { propertyId: null; filename: string; cleanup: 'not-created' };

export interface UploadEditionFilesResult {
	uploaded: UploadedEditionFile[];
	failed: FailedEditionFile[];
}

// The live append response is `{ _id, properties: [{ _id, type: 'file', …, upload }] }`, a flat
// array matching neither doc example (live capture: scripts/migrations/seed-results/probe-275-*).
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

// Only a failed step-1 POST throws. After that every failure is reported per file, and a
// property whose bytes never landed is DELETEd, since Entu leaves it behind otherwise.
export async function uploadEditionFiles(
	cfg: EntuCfg,
	editionId: string,
	files: File[],
	fetchImpl: typeof fetch = fetch
): Promise<UploadEditionFilesResult> {
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

	const uploaded: UploadedEditionFile[] = [];
	const failed: FailedEditionFile[] = [];

	// No read-back GET: filename + filesize can't tell our new property from a real score attached
	// earlier, so cleanup deletes only the ids this response handed us.
	if (!Array.isArray(body.properties)) {
		return {
			uploaded,
			failed: files.map((f) => ({
				propertyId: null,
				filename: f.name,
				cleanup: 'not-created' as const
			}))
		};
	}
	const entries = body.properties.filter(isFileEntry);

	// Entu doesn't promise response order or count, so entries pair to files by filename + filesize,
	// position only breaking ties. An unpaired entry has no bytes to send and gets the DELETE.
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

		const upload = entry.upload;
		let putOk: boolean;
		if (file === null || !upload || typeof upload.url !== 'string') {
			putOk = false;
		} else {
			try {
				const putRes = await putUploadBytes(upload, file, fetchImpl);
				putOk = putRes.ok;
			} catch {
				putOk = false;
			}
		}

		if (putOk && file !== null) {
			uploaded.push({
				propertyId: entry._id,
				filename: file.name,
				filesize: file.size,
				filetype: entry.filetype ?? file.type
			});
			continue;
		}

		const cleanup: FailedEditionFile['cleanup'] = (await deletePhantomProperty(cfg, entry._id, fetchImpl))
			? 'deleted'
			: 'delete-failed';

		failed.push({
			propertyId: entry._id,
			filename: file?.name ?? entry.filename ?? entry._id,
			cleanup
		});
	}

	for (const leftover of pool) {
		if (leftover.taken) continue;
		failed.push({ propertyId: null, filename: leftover.file.name, cleanup: 'not-created' });
	}

	return { uploaded, failed };
}

export { formatFileSize } from '$lib/files/fileSize';

// (*MVOX:Tallis*) (*MVOX:Palestrina*)
