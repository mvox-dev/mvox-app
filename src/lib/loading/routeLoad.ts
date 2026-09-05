// #232 GREEN — the shared route-load state machine.
//
// profile/roster/library `+page.svelte` each hand-rolled the identical skeleton
// around their own fetch bodies: a 5-state `Status` union, a non-reactive
// `generation` counter guarding against a superseded load, and a
// `loadForSelected()` sequencing of reset → no-collective check → token check →
// 'loading' → the page's own fetch body → 4-branch error classification. This
// module is the ONE implementation; see routeLoad.spec.ts for the pinned
// contract and routeLoad.wiring.spec.ts for the "actually replaces, not sits
// beside" structural check.
//
// The pages' fetch BODIES stay page-owned and verbatim — this machine owns only
// the skeleton around them. It never invents 'ready': the body writes that
// itself, at whatever point in its own sequencing is correct for it (profile
// flips it mid-body, before its linked-identities tail).
//
// `machine.generation` / `machine.isCurrent(g)` are the EXTERNAL co-guard seam:
// #260's refreshCompletionGate and roster's several structural-write reconciles
// capture the generation WITHOUT bumping it, then compare later. Reading
// `generation` must never mutate — it is a plain getter.
import { getToken } from '$lib/auth/storage';
import { isAuthExpiredError } from '$lib/entu/auth-expired';

export const ROUTE_LOAD_STATUSES = [
	'loading',
	'no-collective',
	'load-error',
	'session-expired',
	'ready'
] as const;

export type RouteLoadStatus = (typeof ROUTE_LOAD_STATUSES)[number];

/** The context handed to the page's own `load` body. `cfg` is the {db, token}
 *  pair the machine has already confirmed exist; `g`/`isCurrent` replace the
 *  hand-rolled `if (g !== generation) return;` sites inside the body. */
export interface RouteLoadContext<TSelected> {
	cfg: { db: string; token: string };
	selected: TSelected;
	g: number;
	isCurrent: () => boolean;
}

export interface RouteLoadMachineOptions<TSelected extends { db: string }> {
	/** Used only in the two loud console.error messages below (`<name>: …`). */
	name: string;
	/** Read at call time — pages pass `() => selected` over their
	 *  `$derived($selectedCollectiveStore)`. */
	selected: () => TSelected | null;
	/** The page's reactive sink. The machine writes ONLY the four non-ready
	 *  states; the fetch body owns writing 'ready' itself. */
	setStatus: (status: RouteLoadStatus) => void;
	/** Page-specific synchronous reset, run FIRST on every load — before any
	 *  status write and before the body. `isSwitch` is #255's loadedDb
	 *  semantics: true on the first load and whenever the selected db (keyed
	 *  `db ?? null`) differs from the previous load's; false on a same-db
	 *  refresh. */
	reset?: (info: { isSwitch: boolean; selected: TSelected | null }) => void;
	/** Runs after the machine has written 'no-collective'. */
	onNoCollective?: () => void;
	/** Runs BEFORE the machine writes 'load-error' for the missing-token case
	 *  (roster drops its write-cfg before erroring). */
	onNoToken?: () => void;
	/** The page's fetch body. Only called once a collective and a token are
	 *  confirmed present; `ctx.cfg` carries both. May throw — an
	 *  AuthExpiredError-tagged rejection becomes 'session-expired' (no
	 *  console.error, a dead token is a named state, not a fault), anything
	 *  else becomes 'load-error' logged as `<name>: load failed`. A stale
	 *  (superseded) rejection is dropped entirely: no status write, no log. */
	load: (ctx: RouteLoadContext<TSelected>) => Promise<void>;
}

export interface RouteLoadMachine {
	/** Never rejects into the caller — every failure is classified into a
	 *  status write instead. */
	loadForSelected(): Promise<void>;
	/** Non-mutating read of the current generation counter. */
	readonly generation: number;
	/** True when `g` is still the newest generation. */
	isCurrent(g: number): boolean;
}

export function createRouteLoadMachine<TSelected extends { db: string }>(
	opts: RouteLoadMachineOptions<TSelected>
): RouteLoadMachine {
	let generation = 0;
	let hasLoadedOnce = false;
	let lastDb: string | null = null;

	function isCurrent(g: number): boolean {
		return g === generation;
	}

	async function loadForSelected(): Promise<void> {
		const current = opts.selected();
		const g = ++generation;

		const normalizedDb = current?.db ?? null;
		const isSwitch = !hasLoadedOnce || lastDb !== normalizedDb;
		hasLoadedOnce = true;
		lastDb = normalizedDb;

		opts.reset?.({ isSwitch, selected: current });

		if (!current) {
			opts.setStatus('no-collective');
			opts.onNoCollective?.();
			return;
		}

		const token = getToken();
		if (!token) {
			console.error(`${opts.name}: no auth token in storage on a protected route`);
			opts.onNoToken?.();
			opts.setStatus('load-error');
			return;
		}

		opts.setStatus('loading');
		const cfg = { db: current.db, token };
		try {
			await opts.load({ cfg, selected: current, g, isCurrent: () => isCurrent(g) });
		} catch (e) {
			if (!isCurrent(g)) return; // superseded — the newer load's outcome stands
			if (isAuthExpiredError(e)) {
				opts.setStatus('session-expired');
				return;
			}
			console.error(`${opts.name}: load failed`, e);
			opts.setStatus('load-error');
		}
	}

	return {
		loadForSelected,
		get generation() {
			return generation;
		},
		isCurrent
	};
}

// (*MVOX:Byrd*)
