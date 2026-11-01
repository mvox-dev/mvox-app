// A real problem log for page specs: what reportProblem kept for the selected collective.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { selectedCollectiveIdentityStore } from '$lib/collectives/store';
import { resetReportedLinks } from '$lib/links/reportUnsafeLink';
import { getProblemLog, resetProblemLog, setProblemOwner } from '$lib/problems/problemLog';

// Puts back only the indexedDB it replaced, so a spec's own global stubs outlive each case.
export function useKeptProblems(): void {
	let before: PropertyDescriptor | undefined;
	beforeEach(() => {
		before = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
		Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true, writable: true });
		resetProblemLog();
		resetReportedLinks();
		setProblemOwner(selectedCollectiveIdentityStore);
	});
	afterEach(() => {
		resetProblemLog();
		setProblemOwner(null);
		if (before) Object.defineProperty(globalThis, 'indexedDB', before);
		else delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
	});
}

export async function keptProblems(
	identity = get(selectedCollectiveIdentityStore)
): Promise<{ area: string; action: string; detail: string }[]> {
	if (!identity) return [];
	const rows = await getProblemLog()!.list(identity);
	return rows.map(({ area, action, detail }) => ({ area, action, detail }));
}

// (*MVOX:Josquin*)
