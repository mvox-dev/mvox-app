// The shared route-load machine (#232); routeLoad.spec.ts pins its contract.
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

export interface RouteLoadContext<TSelected> {
	cfg: { db: string; token: string };
	selected: TSelected;
	g: number;
	isCurrent: () => boolean;
}

export interface RouteLoadMachineOptions<TSelected extends { db: string }> {
	name: string;
	selected: () => TSelected | null;
	// The machine never writes 'ready': the page's load body does, where it fits.
	setStatus: (status: RouteLoadStatus) => void;
	// Runs first; `isSwitch` is true on the first load and whenever the db changes (#255).
	reset?: (info: { isSwitch: boolean; selected: TSelected | null }) => void;
	onNoCollective?: () => void;
	onNoToken?: () => void;
	load: (ctx: RouteLoadContext<TSelected>) => Promise<void>;
}

export interface RouteLoadMachine {
	loadForSelected(): Promise<void>;
	// A plain getter: co-guards outside the machine read it without bumping it.
	readonly generation: number;
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

	async function run(current: TSelected | null, g: number): Promise<void> {
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
		await opts.load({ cfg, selected: current, g, isCurrent: () => isCurrent(g) });
	}

	// One catch for the hooks and status writes as well as the body, so no page needs its own.
	async function loadForSelected(): Promise<void> {
		const current = opts.selected();
		const g = ++generation;
		try {
			await run(current, g);
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
