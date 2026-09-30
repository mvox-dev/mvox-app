// Copy-then-change helpers for Map and Set state: each returns a new instance.
export function without<K, V>(map: Map<K, V>, key: K): Map<K, V>;
export function without<T>(set: Set<T>, item: T): Set<T>;
export function without<K, V>(coll: Map<K, V> | Set<K>, key: K): Map<K, V> | Set<K> {
	const next = coll instanceof Map ? new Map(coll) : new Set(coll);
	next.delete(key);
	return next;
}

export function withItem<T>(set: Set<T>, item: T, on: boolean): Set<T> {
	const next = new Set(set);
	if (on) next.add(item);
	else next.delete(item);
	return next;
}

export function toggled<T>(set: Set<T>, item: T): Set<T> {
	const next = new Set(set);
	if (next.has(item)) next.delete(item);
	else next.add(item);
	return next;
}
