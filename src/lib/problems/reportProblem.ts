// The one problem-handler (#683) for failed reads; an expired session is not one (it redirects).
import { isAuthExpiredError } from '$lib/entu/auth-expired';
import { keepProblem } from './problemLog';

export interface Problem {
	area: string;
	action: string;
	error: unknown;
}

export function reportProblem({ area, action, error }: Problem): void {
	if (isAuthExpiredError(error)) return;
	console.error(`${area}: ${action} failed`, error);
	keepProblem(area, action, error);
}

export function alreadyReported(): void {}

// (*MVOX:Josquin*)
