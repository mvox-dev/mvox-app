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
import type { LibraryState, NodeStatus } from '$lib/library/libraryState';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { ListRead } from '$lib/entu/listRead';

export interface LibraryTreeContext {
	selected: () => Collective | null;
	lib: LibraryState;
	setStatus: (status: RouteLoadStatus) => void;
	markEditionsPartial: (workId: string, truncated: boolean) => void;
	markCopiesPartial: (editionId: string, truncated: boolean) => void;
}

type Slot<V> = { get: () => V; set: (value: V) => void };

function slot<K extends keyof LibraryState>(lib: LibraryState, key: K): Slot<LibraryState[K]> {
	return {
		get: () => lib[key],
		set: (value) => {
			lib[key] = value;
		}
	};
}

interface NodeLoadSpec<T> {
	label: string;
	read: (cfg: EntuCfg, id: string) => Promise<ListRead<T>>;
	markPartial: (id: string, truncated: boolean) => void;
	status: Slot<Map<string, NodeStatus>>;
	items: Slot<Map<string, T[]>>;
	expanded: Slot<Set<string>>;
}

function createNodeLoad<T>(ctx: LibraryTreeContext, spec: NodeLoadSpec<T>) {
	const setNodeStatus = (id: string, status: NodeStatus) =>
		spec.status.set(new Map(spec.status.get()).set(id, status));

	// Fetch only; the node stays expanded across a retry.
	async function load(id: string): Promise<void> {
		const current = ctx.selected();
		if (!current) return;
		const token = getToken();
		if (!token) return;
		setNodeStatus(id, 'loading');
		try {
			const result = await spec.read({ db: current.db, token }, id);
			spec.items.set(new Map(spec.items.get()).set(id, result.items));
			spec.markPartial(id, result.truncated);
			setNodeStatus(id, 'idle');
		} catch (e) {
			// #107 — an expired session on a node read shows the page's session notice.
			if (isAuthExpiredError(e)) {
				ctx.setStatus('session-expired');
				return;
			}
			console.error(`library: ${spec.label} load failed`, id, e);
			setNodeStatus(id, 'error');
		}
	}

	function toggle(id: string): void {
		if (spec.expanded.get().has(id)) {
			spec.expanded.set(without(spec.expanded.get(), id));
			return;
		}
		spec.expanded.set(new Set(spec.expanded.get()).add(id));
		if (spec.items.get().has(id)) return;
		void load(id);
	}

	return { load, toggle };
}

export function createLibraryTreeLoads(ctx: LibraryTreeContext) {
	const { lib } = ctx;
	const editions = createNodeLoad(ctx, {
		label: 'editions',
		read: (cfg, workId) => loadLibraryEditions(cfg, workId),
		markPartial: (workId, truncated) => ctx.markEditionsPartial(workId, truncated),
		status: slot(lib, 'editionNodeStatus'),
		items: slot(lib, 'editionsByWork'),
		expanded: slot(lib, 'expandedWorks')
	});
	const copies = createNodeLoad(ctx, {
		label: 'copies',
		read: (cfg, editionId) => loadLibraryCopies(cfg, editionId),
		markPartial: (editionId, truncated) => ctx.markCopiesPartial(editionId, truncated),
		status: slot(lib, 'copyNodeStatus'),
		items: slot(lib, 'copiesByEdition'),
		expanded: slot(lib, 'expandedEditions')
	});
	return {
		loadEditionsFor: editions.load,
		toggleWork: editions.toggle,
		loadCopiesFor: copies.load,
		toggleEdition: copies.toggle
	};
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
