// #353 — offline identity derivation, PURE and zero-network.
//
// With no network `hydrateCollectives` -> `checkCollectiveMarker` is a
// network call per db, so `collectiveState` settles on 'error' and
// `selectedCollectiveIdentityStore` is NULL on every page. But the identity
// is fully derivable with zero network: `hydrateAuth` decodes the
// localStorage JWT locally and publishes `personIdByDb` straight off the
// `accounts` claim. This module is that derivation, pinned in isolation from
// any page (see offlineIdentity.spec.ts for the three-case contract, spike
// 3a).
export interface OfflineIdentity {
	db: string;
	personId: string;
}

/**
 * `personIdByDb` is `authStore`'s decoded-JWT map; `persistedDb` is the
 * `'mvox.selected_collective'` localStorage value (or null).
 *
 *   (a) a persisted pick present AND present in the map -> use it, alone;
 *   (b) else exactly one entry -> use it (the single-collective singer never
 *       has the localStorage key at all — the picker only renders at 2+);
 *   (c) else several -> ALL of the map's (db, personId) pairs. One token
 *       proves every one of these person-ids is the same human, so #343's
 *       partition law (one human's bytes never reach another) holds.
 *
 * An empty map yields no identities — never a synthetic/anonymous partition
 * key.
 */
export function deriveOfflineIdentities(
	personIdByDb: Record<string, string>,
	persistedDb: string | null
): OfflineIdentity[] {
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
