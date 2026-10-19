// Kept failures go to Entu by themselves (#948): moved into the saved-feedback queue as one
// feedback with no screenshot, then sent by sendSavedFeedback like any saved feedback.
import { capturePage } from '$lib/feedback/pageMetadata';
import type { CollectiveIdentity } from '$lib/collectives/store';
import type { SavedFeedbackStore } from '$lib/feedback/savedFeedback';
import { setProblemKept, type ProblemLog, type SentProblem } from './problemLog';

export const REPORT_DELAY_MS = 2_000;

const ERROR_NAME = /^(\w+): /;

function clause({ action, detail }: SentProblem): string {
	const name = detail.match(ERROR_NAME)?.[1];
	return name ? `${action} failed (${name})` : `${action} failed`;
}

// Data for whoever reads the feedback in Entu, not a message: English, never translated.
export function describeProblems(problems: SentProblem[]): string {
	const count = problems.length === 1 ? '1 problem' : `${problems.length} problems`;
	return `Automatic problem report: ${count} — ${problems.map(clause).join('; ')}.`;
}

// Runs under the send lock. The put comes before the remove, so a row a crash left in the log
// is already queued, and the next run drops it instead of queueing it twice.
export async function queueKeptProblems(
	identity: CollectiveIdentity,
	store: SavedFeedbackStore,
	log: ProblemLog
): Promise<void> {
	const { db, personId } = identity;
	const kept = await log.list(identity);
	if (kept.length === 0) return;
	const queued = new Set((await store.list(identity)).flatMap((item) => item.reportIds ?? []));
	const fresh = kept.filter((row) => !queued.has(row.id));
	if (fresh.length > 0) {
		const pagePath = window.location.pathname;
		await store.put({
			id: crypto.randomUUID(),
			db,
			personId,
			description: describeProblems(fresh),
			pagePath,
			page: capturePage(pagePath),
			problems: fresh.map(({ area, action, time, detail }) => ({ area, action, time, detail })),
			reportIds: fresh.map((row) => row.id)
		});
	}
	await log.remove(identity, kept.map((row) => row.id));
}

// A burst of failures, such as several parts failing to preload, waits out the delay as one.
export function whenProblemsKept(send: () => void): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	setProblemKept(() => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			send();
		}, REPORT_DELAY_MS);
	});
	return () => {
		if (timer) clearTimeout(timer);
		setProblemKept(null);
	};
}

// (*MVOX:Josquin*)
