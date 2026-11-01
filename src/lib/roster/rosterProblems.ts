// Where a failed roster or section write files its report, and why it could not write.
import { get } from 'svelte/store';
import { authStore } from '$lib/auth/session';
import type { CollectiveIdentity } from '$lib/collectives/store';
import type { EntuCfg } from '$lib/entu/cfg';
import type { DbRight } from '$lib/nav/dbRights';
import { problemOwnerNow } from '$lib/problems/problemLog';
import { reportProblem } from '$lib/problems/reportProblem';

export const NO_CFG = 'the page has no usable Entu cfg for this collective';

// The collective the write goes to: an edit committed by a switch is sent to the old one.
export function writeOwner(cfg: EntuCfg): CollectiveIdentity | null {
	const auth = get(authStore);
	const personId = auth.status === 'authenticated' ? auth.personIdByDb[cfg.db] : undefined;
	return personId ? { db: cfg.db, personId } : problemOwnerNow();
}

export function settledDbRight(result: PromiseSettledResult<DbRight>): DbRight {
	if (result.status === 'fulfilled') return result.value;
	reportProblem({ area: 'roster', action: 'reading your rights on the collective', error: result.reason });
	return 'error';
}

// (*MVOX:Josquin*)
