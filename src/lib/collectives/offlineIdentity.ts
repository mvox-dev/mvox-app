// Offline, the identity comes from the JWT's decoded accounts claim: no network call settles it.
import type { CollectiveIdentity } from './store';

// One token proves several pairs are one human, so #343's partition law holds; empty map, none.
export function deriveOfflineIdentities(
	personIdByDb: Record<string, string>,
	persistedDb: string | null
): CollectiveIdentity[] {
	const entries = Object.entries(personIdByDb);
	if (entries.length === 0) return [];

	if (persistedDb !== null) {
		const personId = personIdByDb[persistedDb];
		if (personId !== undefined) return [{ db: persistedDb, personId }];
	}

	if (entries.length === 1) {
		const [db, personId] = entries[0];
		return [{ db, personId }];
	}

	return entries.map(([db, personId]) => ({ db, personId }));
}

// (*MVOX:Josquin* — #353 GREEN)
