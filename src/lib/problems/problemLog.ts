// The failures reportProblem received, kept on the device per (db, personId) until they are
// sent with a feedback (#684). Nothing here reaches Entu, and nothing is cleared at sign-out.
import { get, type Readable } from 'svelte/store';
import type { CollectiveIdentity } from '$lib/collectives/store';
import { lazyDb, reqToPromise } from '$lib/files/idb';

export const KEPT_PROBLEMS = 50;

/** What a feedback carries for each failure sent with it. */
export interface SentProblem {
	area: string;
	action: string;
	time: string;
	detail: string;
}

export interface LoggedProblem extends SentProblem {
	id: string;
}

export interface ProblemLog {
	add(identity: CollectiveIdentity, problem: Omit<SentProblem, 'time'>): Promise<void>;
	list(identity: CollectiveIdentity): Promise<LoggedProblem[]>;
	remove(identity: CollectiveIdentity, ids: string[]): Promise<void>;
}

const DB_NAME = 'mvox-problem-log';
const DB_VERSION = 1;
const STORE = 'people';

const EMAIL = /[^\s"'<>(),;:]+@[^\s"'<>(),;:]+\.[^\s"'<>(),;:]+/g;
const REFERENCE_STRING = /"string"\s*:\s*"(?:[^"\\]|\\.)*"/g;

// Only an Error's name and message are kept, with every reference .string and email cut (ER-26).
export function redactError(error: unknown): string {
	if (!(error instanceof Error)) return `not an Error (${typeof error})`;
	return `${error.name}: ${error.message}`
		.replace(REFERENCE_STRING, '"string":"[redacted]"')
		.replace(EMAIL, '[email]');
}

export function createProblemLog(factory?: IDBFactory): ProblemLog {
	const getDb = lazyDb(factory ?? indexedDB, DB_NAME, DB_VERSION, (database) => {
		database.createObjectStore(STORE);
	});

	// The read and the write share one transaction, so two tabs adding at once lose nothing.
	async function update(
		{ db, personId }: CollectiveIdentity,
		change: (rows: LoggedProblem[]) => LoggedProblem[]
	): Promise<void> {
		const database = await getDb();
		await new Promise<void>((resolve, reject) => {
			const tx = database.transaction(STORE, 'readwrite');
			const store = tx.objectStore(STORE);
			const key = JSON.stringify([db, personId]);
			const req = store.get(key);
			req.onsuccess = () => store.put(change((req.result as LoggedProblem[] | undefined) ?? []), key);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error);
		});
	}

	return {
		add(identity, problem) {
			const row = { id: crypto.randomUUID(), ...problem, time: new Date().toISOString() };
			return update(identity, (rows) => [...rows, row].slice(-KEPT_PROBLEMS));
		},

		async list({ db, personId }) {
			const database = await getDb();
			const rows = await reqToPromise(
				database.transaction(STORE, 'readonly').objectStore(STORE).get(JSON.stringify([db, personId]))
			);
			return (rows as LoggedProblem[] | undefined) ?? [];
		},

		remove(identity, ids) {
			const gone = new Set(ids);
			return update(identity, (rows) => rows.filter((row) => !gone.has(row.id)));
		}
	};
}

let instance: ProblemLog | null = null;

/** Null on a device with no IndexedDB: failures there go to the console only. */
export function getProblemLog(): ProblemLog | null {
	if (typeof indexedDB === 'undefined') return null;
	instance ??= createProblemLog();
	return instance;
}

export function resetProblemLog(): void {
	instance = null;
}

let owner: Readable<{ db: string; personId: string } | null> | null = null;

// The root layout names the selected collective's person: importing the collectives store
// here would load the Entu client into every module that reports a problem.
export function setProblemOwner(store: typeof owner): void {
	owner = store;
}

let kept: (() => void) | null = null;

/** Called after each failure is kept; #948's auto-sender listens here. */
export function setProblemKept(listener: typeof kept): void {
	kept = listener;
}

/** False when nothing was kept: no one is selected, or there is no log on this device. */
export function keepProblem(area: string, action: string, error: unknown): boolean {
	const identity = owner && get(owner);
	const log = getProblemLog();
	if (!identity || !log) return false;
	void log
		.add(identity, { area, action, detail: redactError(error) })
		.then(() => kept?.())
		.catch((e) => console.error('keeping a failure for feedback failed', e));
	return true;
}

// (*MVOX:Josquin*)
