// Where a failed roster or section write files its report, and why it could not write.
import type { DbRight } from '$lib/nav/dbRights';
import { reportProblem } from '$lib/problems/reportProblem';

export { writeOwner } from '$lib/problems/writeOwner';

export const NO_CFG = 'the page has no usable Entu cfg for this collective';

export function settledDbRight(result: PromiseSettledResult<DbRight>): DbRight {
	if (result.status === 'fulfilled') return result.value;
	reportProblem({ area: 'roster', action: 'reading your rights on the collective', error: result.reason });
	return 'error';
}

// (*MVOX:Josquin*)
