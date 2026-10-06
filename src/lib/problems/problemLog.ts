// The failures reportProblem received, kept on the device per (db, personId) until they are
// sent with a feedback (#684). Nothing here reaches Entu, and nothing is cleared at sign-out.
import { get, type Readable } from 'svelte/store';
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
	add(db: string, personId: string, problem: Omit<SentProblem, 'time'>): Promise<void>;
	list(db: string, personId: string): Promise<LoggedProblem[]>;
	remove(db: string, personId: string, ids: string[]): Promise<void>;
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
		db: string,
		personId: string,
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
		add(db, personId, problem) {
			const row = { id: crypto.randomUUID(), ...problem, time: new Date().toISOString() };
			return update(db, personId, (rows) => [...rows, row].slice(-KEPT_PROBLEMS));
		},

		async list(db, personId) {
			const database = await getDb();
			const rows = await reqToPromise(
				database.transaction(STORE, 'readonly').objectStore(STORE).get(JSON.stringify([db, personId]))
			);
			return (rows as LoggedProblem[] | undefined) ?? [];
		},

		remove(db, personId, ids) {
			const gone = new Set(ids);
			return update(db, personId, (rows) => rows.filter((row) => !gone.has(row.id)));
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

export function keepProblem(area: string, action: string, error: unknown): void {
	const identity = owner && get(owner);
	const log = getProblemLog();
	if (!identity || !log) return;
	log
		.add(identity.db, identity.personId, { area, action, detail: redactError(error) })
		.catch((e) => console.error('keeping a failure for feedback failed', e));
}

// (*MVOX:Josquin*)
