// The session's retention set (#410): each joined collective's next-event parts, never evicted.
import { listFullAgenda } from '$lib/agenda/agendaData';
import { loadWorksByEventId } from '$lib/repertoire/workRows';
import { nextEventFileIds } from '$lib/agenda/nextEventFileIds';
import type { CollectiveIdentity } from '$lib/collectives/store';
import type { FileKey } from '$lib/files/idb';
import { getAppByteStore } from '$lib/files/appByteStore';
import { reportProblem } from '$lib/problems/reportProblem';

export type RetentionCollective = CollectiveIdentity;

// Split by db so a fresher in-memory answer replaces one db's keys alone.
const keysByDb = new Map<string, Set<string>>();

let sweep: Promise<void> | null = null;
let sweepSettled = false;

function protectedKey(key: FileKey): string {
	return JSON.stringify([key.db, key.personId, key.fileId]);
}

// Never throws: with no IndexedDB there is nothing to protect, and a throw blanks the works.
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

// Optional: the agenda's in-memory answer for one db saves the build reading it again.
export function seedRetentionKeys(identity: CollectiveIdentity, fileIds: string[]): void {
	keysByDb.set(identity.db, new Set(fileIds.map((fileId) => protectedKey({ ...identity, fileId }))));
	if (sweepSettled) publish();
}

// Once per session over the joined collectives (not every db in the token); never rejects.
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
						protectedKey({ ...collective, fileId })
					)
				)
			);
		} catch (e) {
			reportProblem({ area: 'retention', action: 'reading the protected set', error: e });
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
