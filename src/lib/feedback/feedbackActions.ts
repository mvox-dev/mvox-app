// createFeedback: one feedback entity plus its screenshot; any failed step deletes it and rejects.
import { entuFetch } from '$lib/entu/request';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';
import { serialize, type StrokeData } from '$lib/strokes/strokes';
import { deletePhantomProperty, putUploadBytes, type UploadObject } from '$lib/files/entuUpload';

export interface CreateFeedbackInput {
	screenshot: Blob;
	strokes: StrokeData;
	description: string;
	pagePath: string;
	metadata: string;
}

type CreateProp =
	| { type: '_type'; reference: string }
	| { type: '_parent'; reference: string }
	| { type: 'name'; string: string }
	| { type: 'description'; string: string }
	| { type: 'doodle_layer'; string: string }
	| { type: 'metadata'; string: string };

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

async function deleteFeedbackEntity(
	cfg: EntuCfg,
	feedbackId: string,
	fetchImpl: typeof fetch
): Promise<void> {
	try {
		await entuFetch(cfg.db, `entity/${feedbackId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	} catch {
		// Ignored: a cleanup error must never mask the caller's own error.
	}
}

// Resolves on success or when the feedback is already gone; anything else rejects.
export async function discardFeedback(
	cfg: EntuCfg,
	feedbackId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const res = await entuFetch(cfg.db, `entity/${feedbackId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	if (!res.ok && res.status !== 404) {
		throw new Error(`discardFeedback: delete failed for '${feedbackId}': HTTP ${res.status}`);
	}
}

export async function createFeedback(
	cfg: EntuCfg,
	memberId: string,
	input: CreateFeedbackInput,
	fetchImpl: typeof fetch = fetch,
	onCreated?: (feedbackId: string) => void | Promise<void>
): Promise<string> {
	const typeId = await resolveTypeId(cfg, 'feedback', fetchImpl);

	const submissionDate = new Date().toISOString().slice(0, 10);
	const name = `${input.pagePath} ${submissionDate}`;

	const props: CreateProp[] = [
		{ type: '_type', reference: typeId },
		{ type: '_parent', reference: memberId },
		{ type: 'name', string: name },
		...(input.description ? [{ type: 'description' as const, string: input.description }] : []),
		{ type: 'doodle_layer', string: serialize(input.strokes) },
		{ type: 'metadata', string: input.metadata }
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
	await onCreated?.(feedbackId);

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

	let putOk: boolean;
	let putError: unknown = null;
	try {
		const putRes = await putUploadBytes(entry.upload, input.screenshot, fetchImpl);
		putOk = putRes.ok;
	} catch (e) {
		putOk = false;
		putError = e;
	}
	if (!putOk) {
		await deletePhantomProperty(cfg, entry._id, fetchImpl);
		await deleteFeedbackEntity(cfg, feedbackId, fetchImpl);
		if (putError instanceof TypeError) throw putError;
		throw new Error(`createFeedback: screenshot upload failed for '${feedbackId}'`);
	}

	return feedbackId;
}

// (*MVOX:Palestrina*)
