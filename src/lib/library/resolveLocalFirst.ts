import { getToken } from '$lib/auth/storage';
import type { Copy, Lending } from '$lib/library/libraryData';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

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
export function resolveLocalFirst<T>(o: LocalFirst<T>): void {
	if (o.loans.length === 0) {
		o.apply(new Map());
		return;
	}
	const current = o.selected();
	if (!current) {
		o.apply(new Map());
		return;
	}
	const token = getToken();
	if (!token) return;
	const local = new Map<string, T>();
	const unresolved: string[] = [];
	const copies = o.allCopies();
	for (const id of o.loans.map((l) => l.copyId)) {
		const cached = copies.find((c) => c.id === id);
		if (cached) {
			local.set(id, o.local(cached));
		} else {
			unresolved.push(id);
		}
	}
	if (unresolved.length === 0) {
		if (!o.isCurrent()) return;
		o.apply(local);
		return;
	}
	o.fetch({ db: current.db, token }, unresolved)
		.then((resolved) => {
			if (!o.isCurrent()) return;
			for (const [id, value] of local) resolved.set(id, value);
			o.apply(resolved);
		})
		.catch((e) => {
			console.error(`library: copy ${o.what} resolution failed`, e);
		});
}
