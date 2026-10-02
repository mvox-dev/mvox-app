// The library page's tree-node and librarian loads, over state the page owns.
import { getToken } from '$lib/auth/storage';
import type { Collective } from '$lib/collectives/types';
import { isAuthExpiredError } from '$lib/entu/request';
import type { RouteLoadStatus } from '$lib/loading/routeLoad';
import {
	loadLibraryEditions,
	loadLibraryCopies,
	loadLibrarianState,
	loadLibrarianPickers,
	loadLibrarianMemberNames
} from '$lib/library/libraryPageData';
import { librarianStore, resetLibrarian } from '$lib/library/librarianStore';
import { without } from '$lib/collections/immutable';
import type { LibraryState } from '$lib/library/libraryState';

export interface LibraryTreeContext {
	selected: () => Collective | null;
	lib: LibraryState;
	setStatus: (status: RouteLoadStatus) => void;
	markEditionsPartial: (workId: string, truncated: boolean) => void;
	markCopiesPartial: (editionId: string, truncated: boolean) => void;
}

export function createLibraryTreeLoads(ctx: LibraryTreeContext) {
	const { lib } = ctx;

	// Fetch only; the node stays expanded across a retry.
	async function loadEditionsFor(workId: string): Promise<void> {
		const current = ctx.selected();
		if (!current) return;
		const token = getToken();
		if (!token) return;
		lib.editionNodeStatus = new Map(lib.editionNodeStatus).set(workId, 'loading');
		try {
			const result = await loadLibraryEditions({ db: current.db, token }, workId);
			lib.editionsByWork = new Map(lib.editionsByWork).set(workId, result.items);
			ctx.markEditionsPartial(workId, result.truncated);
			lib.editionNodeStatus = new Map(lib.editionNodeStatus).set(workId, 'idle');
		} catch (e) {
			// #107 — an expired session on a node read shows the page's session notice.
			if (isAuthExpiredError(e)) {
				ctx.setStatus('session-expired');
				return;
			}
			console.error('library: editions load failed', workId, e);
			lib.editionNodeStatus = new Map(lib.editionNodeStatus).set(workId, 'error');
		}
	}

	function toggleWork(workId: string): void {
		if (lib.expandedWorks.has(workId)) {
			lib.expandedWorks = without(lib.expandedWorks, workId);
			return;
		}
		lib.expandedWorks = new Set(lib.expandedWorks).add(workId);
		if (lib.editionsByWork.has(workId)) return;
		void loadEditionsFor(workId);
	}

	async function loadCopiesFor(editionId: string): Promise<void> {
		const current = ctx.selected();
		if (!current) return;
		const token = getToken();
		if (!token) return;
		lib.copyNodeStatus = new Map(lib.copyNodeStatus).set(editionId, 'loading');
		try {
			const result = await loadLibraryCopies({ db: current.db, token }, editionId);
			lib.copiesByEdition = new Map(lib.copiesByEdition).set(editionId, result.items);
			ctx.markCopiesPartial(editionId, result.truncated);
			lib.copyNodeStatus = new Map(lib.copyNodeStatus).set(editionId, 'idle');
		} catch (e) {
			if (isAuthExpiredError(e)) {
				ctx.setStatus('session-expired');
				return;
			}
			console.error('library: copies load failed', editionId, e);
			lib.copyNodeStatus = new Map(lib.copyNodeStatus).set(editionId, 'error');
		}
	}

	function toggleEdition(editionId: string): void {
		if (lib.expandedEditions.has(editionId)) {
			lib.expandedEditions = without(lib.expandedEditions, editionId);
			return;
		}
		lib.expandedEditions = new Set(lib.expandedEditions).add(editionId);
		if (lib.copiesByEdition.has(editionId)) return;
		void loadCopiesFor(editionId);
	}

	return { loadEditionsFor, toggleWork, loadCopiesFor, toggleEdition };
}

// #72 — every selection goes back to 'loading', and a generation guard drops a stale
// collective's late answer. The pickers load before the tools show.
export function createLibrarianLoad(lib: LibraryState) {
	let librarianGen = 0;

	// #321 — a picker claim must never outlive the options it described.
	function resetLibrarianPickerPartial(): void {
		lib.optionsPartial = false;
		lib.membersPartial = false;
	}

	function select(current: { db: string; personId: string } | null): void {
		if (!current) {
			++librarianGen;
			resetLibrarian();
			resetLibrarianPickerPartial();
			return;
		}
		resetLibrarian();
		resetLibrarianPickerPartial();
		loadLibrarian(current);
	}

	function retryLibrarianLoad(current: { db: string; personId: string } | null): void {
		if (!current) return;
		resetLibrarianPickerPartial();
		loadLibrarian(current);
	}

	function loadLibrarian(current: { db: string; personId: string }): void {
		const g = ++librarianGen;
		const token = getToken();
		const cfg = { db: current.db, token: token ?? '' };
		loadLibrarianState(cfg, current.personId).then(async (result) => {
			if (g !== librarianGen) return;
			if (result.state === 'librarian') {
				try {
					const {
						editions: editionsRead,
						copies: copiesRead,
						members: membersRead
					} = await loadLibrarianPickers(cfg);
					if (g !== librarianGen) return;
					lib.allEditions = editionsRead.items;
					lib.allCopies = copiesRead.items;
					lib.allMembers = membersRead.items;
					lib.optionsPartial = editionsRead.truncated || copiesRead.truncated;
					lib.membersPartial = membersRead.truncated;
					const memberIdList = membersRead.items.map((mbr) => mbr.memberId);
					loadLibrarianMemberNames(cfg, memberIdList)
						.then((names) => {
							if (g === librarianGen) lib.memberNames = names;
						})
						.catch((e) => console.error('library: member name resolution failed', e));
				} catch (e) {
					console.error('library: checkout data load failed', e);
					if (g !== librarianGen) return;
					librarianStore.set('error');
					return;
				}
			}
			if (g !== librarianGen) return;
			librarianStore.set(result.state);
		});
	}

	return { select, retryLibrarianLoad };
}
