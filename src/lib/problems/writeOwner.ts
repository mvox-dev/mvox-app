// Whose log a failed write files under: the collective it was sent to, taken as it starts.
import { get } from 'svelte/store';
import { authStore } from '$lib/auth/session';
import type { CollectiveIdentity } from '$lib/collectives/store';
import type { EntuCfg } from '$lib/entu/cfg';
import { problemOwnerNow } from './problemLog';

export function writeOwner(cfg: EntuCfg): CollectiveIdentity | null {
	const auth = get(authStore);
	const personId = auth.status === 'authenticated' ? auth.personIdByDb[cfg.db] : undefined;
	return personId ? { db: cfg.db, personId } : problemOwnerNow();
}

// (*MVOX:Josquin*)
