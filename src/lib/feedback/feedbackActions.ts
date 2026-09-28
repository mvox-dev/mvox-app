// #395 slice 2/2 GREEN — createFeedback: the ONE create path for a
// `feedback`. See feedbackActions.spec.ts's header for the full pinned
// contract; the shape in short:
//
//   1. resolveTypeId(cfg, 'feedback') — `_type` as a REFERENCE, never a
//      string (create wire-shape, #10).
//   2. POST entity — the create: `_type` ref, `_parent` = the member,
//      EXPLICIT `_sharing: 'domain'` (#395 body, Gama 2026-09-28 — a type's
//      `_sharing` is a ceiling, not a default, ER-1; a child copies its
//      parent's `_sharing` only when the parent is non-private, ER-13, so a
//      feedback under a still-private member would otherwise stay private),
//      `name` = `${pagePath} ${UTC submission date}` (NAME RULING, #395
//      body, Gama 2026-09-29 — never a member name or description text, no
//      prop-def), `description`, `doodle_layer` = serialize(strokes) (#394
//      format). No rights-inheritance flag on this POST — inheritance left
//      natural (Mihkel #390). Created with the member's OWN token
//      (CreatorRule kind 'self') — cfg.token IS that token; nothing else is
//      used.
//   3. POST entity/{newId} — the screenshot's file metadata, one property
//      named `screenshot`, the two-step upload's step 1 (generalized from
//      $lib/library/editionFiles.ts into $lib/files/entuUpload).
//   4. PUT the bytes to the returned signed url — step 2, same shared
//      primitive.
//
// FAIL LOUDLY throughout: unlike editionFiles.ts's tolerant per-file
// reporting (many files, partial success is a real outcome), a `feedback`
// is ONE create with ONE screenshot — any failed step rejects the whole
// call, no partial success is ever reported as success. A failed PUT also
// DELETEs the phantom `screenshot` property it just created (the documented
// recovery, files/index.md) and still rejects.
//
// REVIEW ROUND (#395):
//   F2 fail-loudly covers the DATABASE too, not just the returned promise:
//      every failure path AFTER the entity POST already landed deletes the
//      new feedback ENTITY before rejecting. A feedback with no screenshot is
//      exactly what loadFeedback rejects, so leaving one behind produced a
//      permanently unviewable record that nothing ever cleaned up, and the
//      member's retry added a second one. The creator holds `_owner` from
//      create, so `DELETE entity/{id}` (the app's own call —
//      repertoireActions.ts, sectionActions.ts) is within rights.
//   F3 `description` is OPTIONAL on the type, so an empty one is OMITTED from
//      the create body rather than posted as an empty value — the
//      absent-property case is the one this writer produces, and it is the
//      case loadFeedback reads as ''.
import { entuFetch } from '$lib/entu/request';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';
import { serialize, type StrokeData } from '$lib/strokes/strokes';
import { deletePhantomProperty, putUploadBytes, type UploadObject } from '$lib/files/entuUpload';

export interface CreateFeedbackInput {
	screenshot: Blob;
	strokes: StrokeData;
	description: string;
	/** The page path the member was on — the name is built from this plus
	 *  the UTC submission date, never a member name or the description text
	 *  (NAME RULING, #395 body, Gama 2026-09-29). */
	pagePath: string;
}

type CreateProp =
	| { type: '_type'; reference: string }
	| { type: '_parent'; reference: string }
	| { type: '_sharing'; string: string }
	| { type: 'name'; string: string }
	| { type: 'description'; string: string }
	| { type: 'doodle_layer'; string: string };

/** One created property value, as the live envelope returns it — only the
 *  pieces this single-file path acts on. */
interface StepOnePropertyEntry {
	_id: string;
	type: string;
	upload?: UploadObject;
}

function isFeedbackScreenshotEntry(value: unknown): value is StepOnePropertyEntry {
	if (typeof value !== 'object' || value === null) return false;
	const entry = value as Partial<StepOnePropertyEntry>;
	return entry.type === 'screenshot' && typeof entry._id === 'string';
}

function hasUsableUpload(entry: StepOnePropertyEntry): entry is StepOnePropertyEntry & { upload: UploadObject } {
	return typeof entry.upload?.url === 'string';
}

/** Roll the create back: the entity POST landed but a later step did not, so
 *  the half-built feedback (no screenshot — the state loadFeedback rejects)
 *  must not survive. Swallows its own failure, exactly as
 *  deletePhantomProperty does, so a cleanup error never masks the real one
 *  (#395 review F2). */
async function deleteFeedbackEntity(
	cfg: EntuCfg,
	feedbackId: string,
	fetchImpl: typeof fetch
): Promise<void> {
	try {
		await entuFetch(cfg.db, `entity/${feedbackId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	} catch {
		// Deliberately ignored — the caller's own error is the one that matters.
	}
}

export async function createFeedback(
	cfg: EntuCfg,
	memberId: string,
	input: CreateFeedbackInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const typeId = await resolveTypeId(cfg, 'feedback', fetchImpl);

	// UTC submission date — `new Date().toISOString()` is always UTC.
	const submissionDate = new Date().toISOString().slice(0, 10);
	const name = `${input.pagePath} ${submissionDate}`;

	const props: CreateProp[] = [
		{ type: '_type', reference: typeId },
		{ type: '_parent', reference: memberId },
		{ type: '_sharing', string: 'domain' },
		{ type: 'name', string: name },
		// OPTIONAL on the type: no words means NO property, never an empty
		// value (#395 review F3) — that is the shape loadFeedback reads as ''.
		...(input.description ? [{ type: 'description' as const, string: input.description }] : []),
		{ type: 'doodle_layer', string: serialize(input.strokes) }
	];

	const createRes = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(props)
		},
		fetchImpl
	);
	if (!createRes.ok) {
		throw new Error(`createFeedback: create failed: HTTP ${createRes.status}`);
	}
	const createBody = (await createRes.json()) as { _id?: string };
	const feedbackId = createBody._id;
	if (!feedbackId) {
		throw new Error('createFeedback: create returned 2xx without _id (apparent-success trap)');
	}

	// STEP 1 of the upload — the screenshot's file metadata, one property.
	const metaRes = await entuFetch(
		cfg.db,
		`entity/${feedbackId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([
				{
					type: 'screenshot',
					filename: 'screenshot.png',
					filesize: input.screenshot.size,
					filetype: input.screenshot.type
				}
			])
		},
		fetchImpl
	);
	if (!metaRes.ok) {
		await deleteFeedbackEntity(cfg, feedbackId, fetchImpl);
		throw new Error(`createFeedback: screenshot metadata POST failed: HTTP ${metaRes.status}`);
	}
	const metaBody = (await metaRes.json()) as { properties?: unknown };
	const entry = Array.isArray(metaBody.properties)
		? metaBody.properties.find(isFeedbackScreenshotEntry)
		: undefined;
	if (!entry || !hasUsableUpload(entry)) {
		await deleteFeedbackEntity(cfg, feedbackId, fetchImpl);
		throw new Error(
			`createFeedback: screenshot metadata response carried no usable upload object for '${feedbackId}'`
		);
	}

	// STEP 2 — PUT the bytes. Any failure (non-2xx or network) DELETEs the
	// phantom property it just created AND the half-built feedback entity, then
	// still rejects (fail loudly, no partial success — in the database as well
	// as in the returned promise, #395 review F2).
	let putOk: boolean;
	try {
		const putRes = await putUploadBytes(entry.upload, input.screenshot, fetchImpl);
		putOk = putRes.ok;
	} catch {
		putOk = false;
	}
	if (!putOk) {
		await deletePhantomProperty(cfg, entry._id, fetchImpl);
		await deleteFeedbackEntity(cfg, feedbackId, fetchImpl);
		throw new Error(`createFeedback: screenshot upload failed for '${feedbackId}'`);
	}

	return feedbackId;
}

// (*MVOX:Palestrina* — #395 slice 2/2 GREEN)
