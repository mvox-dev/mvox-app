// Shared Entu two-step-upload pieces (see editionFiles.ts for the full wire contract).
import { isAuthExpiredError } from '$lib/entu/auth-expired';
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

export function thrownText(e: unknown): string {
	return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

// Never throws: a cleanup failure must not mask the caller's real error. Null once it is gone.
export async function deletePhantomProperty(
	cfg: EntuCfg,
	propertyId: string,
	fetchImpl: typeof fetch
): Promise<string | null> {
	try {
		const res = await entuFetch(cfg.db, `property/${propertyId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
		return res.ok ? null : `the cleanup DELETE answered HTTP ${res.status}`;
	} catch (e) {
		if (isAuthExpiredError(e)) return 'the cleanup DELETE could not run: the session expired';
		return `the cleanup DELETE threw ${thrownText(e)}`;
	}
}

// (*MVOX:Palestrina*) (*MVOX:Josquin*)
