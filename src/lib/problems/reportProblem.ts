// The one problem-handler (#683) for failed reads; the browser console stands in for now.
export interface Problem {
	area: string;
	action: string;
	error: unknown;
}

export function reportProblem({ area, action, error }: Problem): void {
	console.error(`${area}: ${action} failed`, error);
}

// (*MVOX:Josquin*)
