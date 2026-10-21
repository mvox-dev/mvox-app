import { firstById } from '$lib/collections/firstById';
import { getToken } from '$lib/auth/storage';
import type { Copy, Lending } from '$lib/library/libraryData';
import { cfgFor, type EntuCfg } from '$lib/entu/cfg';
import { reportProblem } from '$lib/problems/reportProblem';

export interface LocalFirst<T> {
	loans: Lending[];
	selected: () => { db: string } | null;
	allCopies: () => Copy[];
	local: (copy: Copy) => T;
	fetch: (cfg: EntuCfg, unresolvedIds: string[]) => Promise<Map<string, T>>;
	isCurrent: () => boolean;
	apply: (resolved: Map<string, T>) => void;
	what: string;
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
	const token = getToken();
	if (!token) return Promise.resolve();
	const local = new Map<string, T>();
	const unresolved: string[] = [];
	const copies = firstById(o.allCopies());
	for (const id of o.loans.map((l) => l.copyId)) {
		const cached = copies.get(id);
		if (cached) {
			local.set(id, o.local(cached));
		} else {
			unresolved.push(id);
		}
	}
	if (unresolved.length === 0) {
		o.apply(local);
		return Promise.resolve();
	}
	return o.fetch(cfgFor(current.db), unresolved)
		.then((resolved) => {
			if (!o.isCurrent()) return;
			for (const [id, value] of local) resolved.set(id, value);
			o.apply(resolved);
		})
		.catch((e) => {
			if (!o.isCurrent()) return;
			reportProblem({ area: 'library', action: `resolving the copy ${o.what}`, error: e });
		});
}
