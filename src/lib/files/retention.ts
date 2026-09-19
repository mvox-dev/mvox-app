// #410 — the RETENTION SET: which cached parts the storage-pressure sweep
// must never evict ("the next event's parts", over every collective the
// signed-in person has joined — Gama's scope ruling 2026-09-18 (b)).
//
// This module owns the set for the whole SESSION, not for one page.
//
// #410 review F1 — it used to live inside `+page.svelte` (the agenda route).
// The byte store is a module singleton and FOUR routes put bytes through it
// (agenda, event detail, library, downloads); every put fires the
// after-every-put pressure sweep. A cold boot straight into /event/<id>,
// /library or /downloads never mounts the agenda page, so the set was never
// built and the store swept with the default-EMPTY protected set — evicting
// the very parts #410 exists to keep. Binding the build to the SESSION (the
// root layout drives `ensureRetentionSweep` off auth + the hydrated
// collectives) is what makes the guarantee hold on every entry point.
//
// #410 review F2 — the scope is the collectives she has JOINED, read from the
// hydrated collectives store, NOT `auth.personIdByDb` (every Entu db in her
// JWT). `discoverCollectives` already drops the dbs whose mvox marker is
// absent; sourcing the scope from the token re-admitted them and issued a
// `listFullAgenda` fan-out (listSeasons + events-per-season) against each of
// her non-mvox Entu apps on every app open, each landing in a console.error.
//
// The set is composite JSON-triple keys and nothing else: the byte store
// never learns what an agenda or an event is (`setProtectedKeys`), and this
// module never reads the byte store's rows (zero `get()`, zero recency
// movement — #367's trap).
import { listFullAgenda } from '$lib/agenda/agendaData';
import { loadWorksByEventId } from '$lib/repertoire/workRows';
import { nextEventFileIds } from '$lib/agenda/nextEventFileIds';
import { getAppByteStore } from '$lib/files/appByteStore';

/** A collective she has joined: which db, acting as which person. */
export type RetentionCollective = { db: string; personId: string };

/**
 * Per-db protected keys. Kept SPLIT BY DB rather than as one flat set so a
 * db's keys can be replaced (a fresher in-memory answer from the page) without
 * disturbing any other db's.
 */
const keysByDb = new Map<string, Set<string>>();

/** The once-per-session build. Non-null from the first `ensureRetentionSweep`. */
let sweep: Promise<void> | null = null;
/** True once that build has published its set and run `relieve()`. */
let sweepSettled = false;

/** The adapter's own collision-safe encoding, mirrored (byteStore.ts keyStr). */
function protectedKey(db: string, personId: string, fileId: string): string {
	return JSON.stringify([db, personId, fileId]);
}

/**
 * Hand the union of every db's keys to the store.
 *
 * NEVER THROWS. Reaching the store means constructing it, and on a device
 * with no IndexedDB at all (private-browsing modes, and every non-browser
 * test environment) that throws — a device holding no cached bytes has
 * nothing to protect, and retention is supplementary to every load it runs
 * beside. `seedRetentionKeys` is called from inside the agenda page's works
 * promise chain, where a synchronous throw would land in that chain's own
 * `catch` and blank the works it had just resolved.
 */
function publish(): void {
	const all = new Set<string>();
	for (const keys of keysByDb.values()) {
		for (const key of keys) all.add(key);
	}
	try {
		getAppByteStore().setProtectedKeys(all);
	} catch (e) {
		console.error('retention: handing the protected set over failed', e);
	}
}

/**
 * #410 review F1/F2 — the agenda page's shortcut, kept as a CONTRIBUTION to
 * the session set, never as its sole source: when the agenda route is the one
 * she opened into, the selected collective's next-event parts are already in
 * memory (the agenda + works load that just settled), so the session build
 * need not pay a second `listFullAgenda` + `loadWorksByEventId` fan-out for
 * that db. A db seeded before the build reaches it is skipped by the build; a
 * db seeded after the build finished is republished straight away.
 *
 * Calling this is always OPTIONAL. Nothing depends on it for correctness —
 * without it the session build reads that db like any other.
 */
export function seedRetentionKeys(db: string, personId: string, fileIds: string[]): void {
	keysByDb.set(db, new Set(fileIds.map((fileId) => protectedKey(db, personId, fileId))));
	if (sweepSettled) publish();
}

/**
 * #410 — build the retention set ONCE PER SESSION and relieve storage
 * pressure with it in place: ONE `listFullAgenda` per joined collective on her
 * own key, plus ONE `loadWorksByEventId` for that agenda's FIRST item (never
 * every event), then `setProtectedKeys` -> `relieve()`.
 *
 * Idempotent by construction: every later call returns the SAME promise, so
 * the root layout's effect may re-run freely and the agenda page can await the
 * same build before its own prefetch (the sweep frees room FOR the prefetch).
 *
 * NEVER REJECTS and never holds anything up for long: a per-db read that fails
 * protects nothing for that db and leaves the rest of the set intact.
 */
export function ensureRetentionSweep(input: {
	token: string;
	collectives: readonly RetentionCollective[];
	fetchImpl?: typeof fetch;
	now?: Date;
}): Promise<void> {
	if (sweep) return sweep;
	sweep = runRetentionSweep(input)
		.catch((e) => {
			console.error('retention: pressure sweep failed', e);
		})
		.finally(() => {
			sweepSettled = true;
		});
	return sweep;
}

async function runRetentionSweep({
	token,
	collectives,
	fetchImpl = fetch,
	now
}: {
	token: string;
	collectives: readonly RetentionCollective[];
	fetchImpl?: typeof fetch;
	now?: Date;
}): Promise<void> {
	for (const collective of collectives) {
		// Already supplied in memory (seedRetentionKeys) — do not pay for it twice.
		if (keysByDb.has(collective.db)) continue;
		const cfg = { db: collective.db, token };
		try {
			const agenda = await listFullAgenda(cfg, now ?? new Date(), fetchImpl);
			const next = agenda.upcoming[0];
			if (!next) {
				keysByDb.set(collective.db, new Set());
				continue;
			}
			const byEvent = await loadWorksByEventId(cfg, [next.id], agenda.seasonId, fetchImpl, {});
			keysByDb.set(
				collective.db,
				new Set(
					nextEventFileIds([next], byEvent).map((fileId) =>
						protectedKey(collective.db, collective.personId, fileId)
					)
				)
			);
		} catch (e) {
			console.error('retention: protected-set read failed', collective.db, e);
		}
	}
	publish();
	await getAppByteStore().relieve();
}

/** Test seam only: forget the session's set and its run-once latch. */
export function resetRetentionForTests(): void {
	keysByDb.clear();
	sweep = null;
	sweepSettled = false;
}

// (*MVOX:Josquin*)
