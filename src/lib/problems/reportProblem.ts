// The one problem-handler (#683, #1049): every failure the app reports is kept here, silently.
import { isAuthExpiredError } from '$lib/entu/auth-expired';
import { keepProblem, redactError, redactText } from './problemLog';

/** A failure with its thrown error, or with a reason (a status, a partial result) if none. */
export type Problem = { area: string; action: string } & ({ error: unknown } | { reason: string });

export function reportProblem(problem: Problem): boolean {
	const { area, action } = problem;
	if ('error' in problem) {
		if (isAuthExpiredError(problem.error)) return false;
		console.error(`${area}: ${action} failed`, problem.error);
		return keepProblem(area, action, redactError(problem.error));
	}
	console.error(`${area}: ${action} failed`, problem.reason);
	return keepProblem(area, action, redactText(problem.reason));
}

export function alreadyReported(): void {}

// (*MVOX:Josquin*)
