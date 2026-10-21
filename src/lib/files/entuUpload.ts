// Shared Entu two-step-upload pieces (see editionFiles.ts for the full wire contract).
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/entu/cfg';

export interface UploadObject {
	url: string;
	method: string;
	headers: Record<string, string | number>;
}

export function putUploadBytes(
	upload: UploadObject,
	body: BodyInit,
	fetchImpl: typeof fetch
): Promise<Response> {
	return fetchImpl(upload.url, {
		method: upload.method,
		// Never entuFetch: the signature covers exactly these headers, verbatim (files/index.md).
		headers: upload.headers as HeadersInit,
		body
	});
}

// Never throws: a cleanup failure must not mask the caller's real error.
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

// (*MVOX:Palestrina*)
