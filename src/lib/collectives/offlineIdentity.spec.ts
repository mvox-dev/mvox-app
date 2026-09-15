// #353 RED — offline identity derivation, PURE and zero-network.
//
// The spike's central finding (3): with no network, `hydrateCollectives` →
// `checkCollectiveMarker` is a network call per db, so `collectiveState`
// settles on 'error' and `selectedCollectiveIdentityStore` is NULL ON EVERY
// PAGE. Every handler opening with `if (!identity) return;` is dead offline.
// But the identity is fully derivable with zero network: `hydrateAuth`
// decodes the localStorage JWT locally and publishes `personIdByDb` straight
// off the `accounts` claim.
//
// This module (src/lib/collectives/offlineIdentity.ts) is that derivation as
// a pure function, so it can be pinned here rather than asserted through a
// page. Three cases (spike 3a — verified against every write site of
// 'mvox.selected_collective'):
//   (a) a persisted pick present AND present in the JWT's map → use it, alone;
//   (b) else exactly one entry → use it (THE COMMON CASE: the single-
//       collective singer NEVER has the localStorage key — the default-to-
//       first branch does not persist, and the picker only renders with 2+);
//   (c) else several → ALL of the JWT's own (db, personId) pairs. One token
//       proves every one of these person-ids is the same human, so #343's
//       partition law (one HUMAN's bytes never reach another) is untouched.
import { describe, expect, it } from 'vitest';
import { deriveOfflineIdentities } from './offlineIdentity';

describe('#353 — deriveOfflineIdentities (pure, zero network)', () => {
	it('(a) persisted pick present and in the map → exactly that identity', () => {
		expect(
			deriveOfflineIdentities({ polyphony: 'person-1', crede: 'person-2' }, 'polyphony')
		).toEqual([{ db: 'polyphony', personId: 'person-1' }]);
	});

	it('(b) single entry, NO persisted key — the common single-collective case never writes localStorage', () => {
		expect(deriveOfflineIdentities({ polyphony: 'person-1' }, null)).toEqual([
			{ db: 'polyphony', personId: 'person-1' }
		]);
	});

	it('(c) several entries, no persisted pick → every (db, personId) pair the token proves', () => {
		expect(
			deriveOfflineIdentities({ polyphony: 'person-1', crede: 'person-2' }, null)
		).toEqual([
			{ db: 'polyphony', personId: 'person-1' },
			{ db: 'crede', personId: 'person-2' }
		]);
	});

	it('a persisted pick NOT in the map is stale — falls through, never invents a partition', () => {
		// e.g. the member left that collective; the key survives in localStorage.
		expect(deriveOfflineIdentities({ polyphony: 'person-1' }, 'esmuuseum')).toEqual([
			{ db: 'polyphony', personId: 'person-1' }
		]);
		expect(
			deriveOfflineIdentities({ polyphony: 'person-1', crede: 'person-2' }, 'esmuuseum')
		).toEqual([
			{ db: 'polyphony', personId: 'person-1' },
			{ db: 'crede', personId: 'person-2' }
		]);
	});

	it('an empty map yields no identities — never a synthetic/anonymous partition key (#343 law)', () => {
		expect(deriveOfflineIdentities({}, null)).toEqual([]);
		expect(deriveOfflineIdentities({}, 'polyphony')).toEqual([]);
	});
});

// (*MVOX:Tallis* — #353 RED)
