// The one problem-handler (#683, #1049): every failure the app reports is kept here, silently.
import { isAuthExpiredError } from '$lib/entu/auth-expired';
import type { CollectiveIdentity } from '$lib/collectives/store';
import { keepProblem, redactError, redactText } from './problemLog';

/** A failure with its thrown error, or a reason if none; owner names whose log it goes to. */
export type Problem = { area: string; action: string; owner?: CollectiveIdentity | null } & (
	| { error: unknown }
	| { reason: string }
);

export function reportProblem(problem: Problem): boolean {
	const { area, action, owner } = problem;
	if ('error' in problem) {
		if (isAuthExpiredError(problem.error)) return false;
		console.error(`${area}: ${action} failed`, problem.error);
		return keepProblem(area, action, redactError(problem.error), owner);
	}
	console.error(`${area}: ${action} failed`, problem.reason);
	return keepProblem(area, action, redactText(problem.reason), owner);
}

export function alreadyReported(): void {}

// (*MVOX:Josquin*)
