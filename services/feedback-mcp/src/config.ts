// The server's db list: one JSON file, never env vars, since sshd's forced command gets no env.
import { readFileSync } from 'node:fs';

export type DbEntry = { db: string; label: string; key: string };

const isEntry = (x: unknown): x is DbEntry => {
	if (typeof x !== 'object' || x === null) return false;
	const e = x as Record<string, unknown>;
	return [e.db, e.label, e.key].every((v) => typeof v === 'string' && v !== '');
};

export function loadConfig(
	path: string,
	read: (p: string) => string = (p) => readFileSync(p, 'utf8')
): DbEntry[] {
	const parsed = JSON.parse(read(path)) as { dbs?: unknown };
	if (!Array.isArray(parsed.dbs) || parsed.dbs.length === 0) {
		throw new Error(`loadConfig: ${path} lists no dbs`);
	}
	const seen = new Set<string>();
	return parsed.dbs.map((entry, i) => {
		if (!isEntry(entry)) throw new Error(`loadConfig: bad db entry at index ${i}`);
		if (seen.has(entry.db)) throw new Error(`loadConfig: duplicate db ${entry.db}`);
		seen.add(entry.db);
		return { db: entry.db, label: entry.label, key: entry.key };
	});
}
