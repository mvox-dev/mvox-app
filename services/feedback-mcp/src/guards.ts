// Tool args come from a model reading untrusted text, so nothing unchecked reaches a URL.
import type { DbEntry } from './config';

const ENTU_ID = /^[0-9a-f]{24}$/;

export function assertDb(dbs: DbEntry[], db: string): DbEntry {
	const entry = dbs.find((d) => d.db === db);
	if (!entry) throw new Error(`unknown db: ${JSON.stringify(db)}`);
	return entry;
}

export function assertId(id: string): string {
	if (!ENTU_ID.test(id)) throw new Error(`bad id: ${JSON.stringify(id)}`);
	return id;
}
