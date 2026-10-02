// Display lists report when they are partial: the server's `count` against the raw rows (#321).
import { entuFetch, type EntuFetchOptions } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

export interface ListRead<T> {
	items: T[];
	total: number;
	truncated: boolean;
}

// `count` is the caller-visible total, undocumented upstream; checked against the raw length by
// probe-321-list-count-semantics-live-2026-09-11T00-39-06-327Z and
// probe-321-authed-lesser-tier-subset-live-2026-09-11T00-42-57-032Z.
export function deriveListRead<T>(items: T[], rawLength: number, count: number | undefined): ListRead<T> {
	return {
		items,
		total: count ?? rawLength,
		truncated: count !== undefined && count > rawLength
	};
}

export function isTruncated(rawLength: number, count: number | undefined): boolean {
	return count !== undefined && count > rawLength;
}

export async function readList<R, T>(
	cfg: EntuCfg,
	fn: string,
	path: string,
	toItems: (raw: R[]) => T[],
	fetchImpl: typeof fetch,
	opts: EntuFetchOptions
): Promise<ListRead<T>> {
	const res = await entuFetch(cfg.db, path, cfg.token, {}, fetchImpl, opts);
	if (!res.ok) throw new Error(`${fn} failed: ${res.status}`);
	const body = (await res.json()) as { count?: number; entities?: R[] };
	const raw = body.entities ?? [];
	return deriveListRead(toItems(raw), raw.length, body.count);
}

// (*MVOX:Josquin*)
