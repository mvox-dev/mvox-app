import { get } from 'svelte/store';
import { getToken } from '$lib/auth/storage';
import { selectedDbStore } from '$lib/collectives/store';
import { listSeasons, listRehearsals, type EntuCfg } from '$lib/seasons/entuSeasons';
import type { AgendaItem } from './types';

/**
 * The collective's upcoming agenda: every season's rehearsal events, flattened →
 * filtered to `startDatetime >= now` → sorted ascending.
 *
 * DE-FANNED from the old multi-org agenda: single-collective reads ONE collective's
 * seasons directly (no org fan-out, no per-org `orgId`/`orgLabel` stamping, no
 * per-org error partitioning).
 *
 * We fetch rehearsals for ALL seasons — NO season pre-filter. `season.end_date` is
 * an UNRELIABLE bound on event dates: a season whose end_date is past (or unset) can
 * still own real upcoming rehearsals — e.g. "Fila hooaeg" (end_date 2026-07-28) owns
 * ~20 events in Sept–Dec 2026. Pre-filtering seasons by end_date silently dropped
 * those. The event-level `startDatetime >= now` filter below is the ONLY correct
 * gate. (This also subsumes the old open-ended `endDate === ''` special case — an
 * open-ended season is just one more season we fetch.)
 *
 * Perf: this queries events for every season on each load. Fine for single-collective
 * slice-1. A future optimization is a single direct upcoming-events query, but ONLY
 * if Entu supports a datetime range filter on the event query — probe the API before
 * assuming it does.
 */
export async function listAgenda(
	cfg: EntuCfg,
	now: Date,
	fetchImpl: typeof fetch = fetch
): Promise<AgendaItem[]> {
	const nowIso = now.toISOString();

	const seasons = await listSeasons(cfg, fetchImpl);
	const lists = await Promise.all(seasons.map((s) => listRehearsals(cfg, s.id, fetchImpl)));

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
