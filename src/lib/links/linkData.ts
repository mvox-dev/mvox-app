// #256 GREEN — Lingikogu (link collection) READ layer.
//
// Model: listSeasons' database-entity scoping (#161 — the collective is the
// DATABASE entity, not organization) + sectionData's missing-display_order-
// sorts-last convention. See linkData.spec.ts for the pinned contract.
//
// #374/#375 note: this READ layer stays verbatim — whatever a link's `url`
// property holds is returned as-is, no re-normalising on read. The
// normalisation (schemeless → https://, own-host → relative) happens once,
// at SAVE time, at the page layer (src/routes/links/+page.svelte via
// normalizeUrl.ts); it supersedes #256's "stored as given" wording only for
// what gets WRITTEN, not for this read path.
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

/** One link of the collective's link collection (the `link` entity). */
export interface LinkRow {
	id: string;
	name: string;
	/**
	 * Returned VERBATIM by this read layer — never normalised, never
	 * scheme-guessed here (#256 ruling). The write side normalises once at
	 * the page layer (#374/#375, normalizeUrl.ts), so a stored value may
	 * already be `https://…` or an own-host relative path starting with '/'.
	 */
	url: string;
	/** null when the link has no description (absent OR empty-string property). */
	description: string | null;
	/** null when the entity carries no display_order value. */
	displayOrder: number | null;
}

interface RawLink {
	_id: string;
	name?: Array<{ string?: string }>;
	url?: Array<{ string?: string }>;
	description?: Array<{ string?: string }>;
	display_order?: Array<{ number?: number }>;
}

/**
 * List the collective's links, scoped to the DATABASE entity (collective root,
 * #161), sorted into the STABLE order members read (#256): display_order
 * ascending, missing display_order last, ties broken by name. See
 * linkData.spec.ts.
 */
export async function listLinks(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<LinkRow[]> {
	const { resolveDatabaseEntityId } = await import('$lib/collective/databaseEntity');
	const dbEntityId = await resolveDatabaseEntityId(cfg, fetchImpl);
	// No visible database entity: the same "nothing visible" answer
	// resolveDatabaseEntityId documents — an answer, not an error. No link
	// query is fired.
	if (!dbEntityId) return [];

	// #321 class (1) — the collective's OWN curated link list, `_parent`-scoped to
	// the single database entity resolved above. An admin maintains it by hand and
	// the surface is one flat list (#256: display_order ascending, no grouping, no
	// per-member rows); nothing accumulates here over the collective's life.
	// limit=200 is an explicit, ample bound — a hand-curated menu cannot reach it
	// — so this cap is a guard, not a silent prefix.
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
			// VERBATIM on read — no normalising, no scheme-guessing here (#256
			// ruling); normalisation is the page layer's, at save (#374/#375).
			url: raw.url?.[0]?.string ?? '',
			// Absent OR empty-string maps to null: the page must be able to
			// render NO description node at all (#256 done-when 3).
			description: raw.description?.[0]?.string || null,
			displayOrder: raw.display_order?.[0]?.number ?? null
		})
	);

	return rows.sort((a, b) => {
		if (a.displayOrder === null && b.displayOrder === null) return a.name.localeCompare(b.name);
		if (a.displayOrder === null) return 1;
		if (b.displayOrder === null) return -1;
		if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
		return a.name.localeCompare(b.name);
	});
}

// (*MVOX:Palestrina* — #256 GREEN)
