// The collective's link list, read verbatim: the page normalises URLs once, at save.
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { byDisplayOrder } from '$lib/collections/displayOrder';

export interface LinkRow {
	id: string;
	name: string;
	url: string;
	description: string | null;
	displayOrder: number | null;
}

interface RawLink {
	_id: string;
	name?: Array<{ string?: string }>;
	url?: Array<{ string?: string }>;
	description?: Array<{ string?: string }>;
	display_order?: Array<{ number?: number }>;
}

export async function listLinks(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<LinkRow[]> {
	const { resolveDatabaseEntityId } = await import('$lib/collective/databaseEntity');
	const dbEntityId = await resolveDatabaseEntityId(cfg, fetchImpl);
	if (!dbEntityId) return [];

	// A hand-curated menu never nears 200, so the cap is a guard, not a silent prefix.
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=link&_parent.reference=${encodeURIComponent(dbEntityId)}&props=name,url,description,display_order&limit=200`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listLinks failed: HTTP ${res.status}`);

	const body = (await res.json()) as { entities?: RawLink[] };
	const rows = (body.entities ?? []).map(
		(raw): LinkRow => ({
			id: raw._id,
			name: raw.name?.[0]?.string ?? '',
			url: raw.url?.[0]?.string ?? '',
			description: raw.description?.[0]?.string || null,
			displayOrder: raw.display_order?.[0]?.number ?? null
		})
	);

	return rows.sort(byDisplayOrder);
}

// (*MVOX:Josquin*)
