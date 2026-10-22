import { firstById } from '$lib/collections/firstById';
import { getToken } from '$lib/auth/storage';
import type { Copy, Lending, SettledReads } from '$lib/library/libraryData';
import { cfgFor, type EntuCfg } from '$lib/entu/cfg';
import { reportProblem } from '$lib/problems/reportProblem';
import { isAuthExpiredError } from '$lib/entu/auth-expired';

export interface LocalFirst<T> {
	loans: Lending[];
	selected: () => { db: string } | null;
	allCopies: () => Copy[];
	local: (copy: Copy) => T;
	fetch: (cfg: EntuCfg, unresolvedIds: string[]) => Promise<SettledReads<T>>;
	isCurrent: () => boolean;
	apply: (resolved: Map<string, T>) => void;
	what: string;
	// Answers already read, per db: a re-run reads only the copies not in here.
	known: Map<string, Map<string, T>>;
}

// Getters, not values: run inside an effect, each branch tracks only what it reads.
export function resolveLocalFirst<T>(o: LocalFirst<T>): Promise<void> {
	if (o.loans.length === 0) {
		o.apply(new Map());
		return Promise.resolve();
	}
	const current = o.selected();
	if (!current) {
		o.apply(new Map());
		return Promise.resolve();
	}
	if (!getToken()) {
		o.known.clear();
		o.apply(new Map());
		return Promise.resolve();
	}
	const known = o.known.get(current.db) ?? new Map<string, T>();
	o.known.set(current.db, known);
	const local = new Map<string, T>();
	const unresolved: string[] = [];
	const copies = firstById(o.allCopies());
	for (const id of o.loans.map((l) => l.copyId)) {
		const held = copies.get(id);
		if (held) {
			local.set(id, o.local(held));
		} else if (known.has(id)) {
			local.set(id, known.get(id)!);
		} else {
			unresolved.push(id);
		}
	}
	// Applied before the read too, so labels from another db never wait on this answer.
	o.apply(local);
	if (unresolved.length === 0) return Promise.resolve();
	return o.fetch(cfgFor(current.db), unresolved)
		.then(({ resolved, failed }) => {
			for (const [id, value] of resolved) known.set(id, value);
			if (!o.isCurrent()) return;
			for (const [id, value] of local) resolved.set(id, value);
			o.apply(resolved);
			if (failed.length > 0) report(o.what, oneError(failed));
		})
		.catch((e) => {
			if (!o.isCurrent()) return;
			report(o.what, e);
		});
}

function report(what: string, error: unknown): void {
	reportProblem({ area: 'library', action: `resolving the copy ${what}`, error });
}

// One report per batch; an expired session stays recognisable so it is not filed.
function oneError(failed: unknown[]): unknown {
	if (failed.length === 1) return failed[0];
	return failed.find(isAuthExpiredError) ?? new AggregateError(failed, `${failed.length} loaned copies not fully read`);
}
