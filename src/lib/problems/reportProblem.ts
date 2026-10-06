// The one problem-handler (#683) for failed reads; an expired session is not one (it redirects).
import { isAuthExpiredError } from '$lib/entu/auth-expired';

export interface Problem {
	area: string;
	action: string;
	error: unknown;
}

export function reportProblem({ area, action, error }: Problem): void {
	if (isAuthExpiredError(error)) return;
	console.error(`${area}: ${action} failed`, error);
}

export function alreadyReported(): void {}

// (*MVOX:Josquin*)
