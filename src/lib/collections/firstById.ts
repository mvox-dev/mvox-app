// An id lookup that answers as `.find` did: the first item with an id wins.
export function firstById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
	const byId = new Map<string, T>();
	for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
	return byId;
}
