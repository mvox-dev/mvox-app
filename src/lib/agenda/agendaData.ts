import { get } from 'svelte/store';
import { getToken } from '$lib/auth/storage';
import { selectedDbStore } from '$lib/collectives/store';
import { listSeasons, listRehearsals, type EntuCfg } from '$lib/seasons/entuSeasons';
import type { AgendaItem } from './types';

/**
 * The collective's upcoming agenda: every ongoing season's rehearsal events,
 * flattened → filtered to `startDatetime >= now` → sorted ascending.
 *
 * DE-FANNED from the old multi-org agenda: single-collective reads ONE collective's
 * seasons directly (no org fan-out, no per-org `orgId`/`orgLabel` stamping, no
 * per-org error partitioning). Ongoing-season pre-filter (`endDate >= today`) is
 * kept — it avoids fetching events for already-finished seasons.
 */
export async function listAgenda(
	cfg: EntuCfg,
	now: Date,
	fetchImpl: typeof fetch = fetch
): Promise<AgendaItem[]> {
	const today = now.toISOString().slice(0, 10);
	const nowIso = now.toISOString();

	const seasons = await listSeasons(cfg, fetchImpl);
	// An empty endDate means the season is open-ended (no end_date set yet) — the
	// common case for the collective's current season. Treat it as ongoing; otherwise
	// `'' >= today` is false and the open-ended season (and its rehearsals) vanish.
	const ongoing = seasons.filter((s) => s.endDate === '' || s.endDate >= today);
	const lists = await Promise.all(ongoing.map((s) => listRehearsals(cfg, s.id, fetchImpl)));

	return lists
		.flat()
		.filter((r) => r.startDatetime >= nowIso)
		.sort((a, b) => a.startDatetime.localeCompare(b.startDatetime));
}

/**
 * Convenience for callers (Byrd's route): resolve the runtime db from T4's
 * `selectedDbStore` and the token from storage, then load. Returns [] when there's
 * no selected collective or no token (nothing to read yet).
 */
export async function loadAgenda(
	now: Date = new Date(),
	fetchImpl: typeof fetch = fetch
): Promise<AgendaItem[]> {
	const db = get(selectedDbStore);
	const token = getToken();
	if (!db || !token) return [];
	return listAgenda({ db, token }, now, fetchImpl);
}

// (*MVOX:Josquin*)
