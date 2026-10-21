// Signs an edition file (`file` property id) at click time: the signed url lives 60 seconds.
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/entu/cfg';

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
