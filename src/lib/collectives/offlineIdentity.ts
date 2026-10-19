// Offline, the identity comes from the JWT's decoded accounts claim: no network call settles it.
import type { CollectiveIdentity } from './store';

export function deriveOfflineIdentities(
	personIdByDb: Record<string, string>,
	persistedDb: string | null
): CollectiveIdentity[] {
	const entries = Object.entries(personIdByDb);
	if (entries.length === 0) return [];

	if (persistedDb !== null) { // (a) a persisted pick present in the map wins, alone
		const personId = personIdByDb[persistedDb];
		if (personId !== undefined) return [{ db: persistedDb, personId }];
	}

	if (entries.length === 1) { // (b) a one-collective singer has no pick: the picker shows at 2+
		const [db, personId] = entries[0];
		return [{ db, personId }];
	}

	// (c) all pairs: one token proves they are one human, so #343's partition law holds
	return entries.map(([db, personId]) => ({ db, personId }));
}

// (*MVOX:Josquin* — #353 GREEN)
