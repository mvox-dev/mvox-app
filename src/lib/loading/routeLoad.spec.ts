// @vitest-environment happy-dom
//
// #232 RED — the shared route-load state machine.
//
// The page-load skeleton — 5-state `Status` union, non-reactive generation
// staleness guard, `loadForSelected()` sequencing (reset → no-collective →
// token check → 'loading' → page fetch body → 4-branch error classification)
// — is independently re-implemented in profile/roster/library `+page.svelte`,
// each commented as "mirroring" the others. This spec pins the ONE shared
// implementation they will all consume: `createRouteLoadMachine` in
// `src/lib/loading/routeLoad.ts`.
//
// Contract pinned here (the pages' fetch BODIES stay page-owned and verbatim —
// the machine owns only the skeleton around them):
//
//   createRouteLoadMachine({ name, selected, setStatus, reset?,
//                            onNoCollective?, onNoToken?, load })
//     → { loadForSelected(): Promise<void>;
//         readonly generation: number;
//         isCurrent(g: number): boolean }
//
//   • `selected: () => TSelected | null` — read at call time (the pages pass
//     `() => selected` over their $derived($selectedCollectiveStore)).
//   • `setStatus` — the page's reactive sink; the machine writes ONLY the four
//     non-ready states. It NEVER invents 'ready': the fetch body owns that
//     write (profile flips 'ready' mid-body before its linked-identities tail;
//     roster/library at their own points).
//   • `reset({ isSwitch, selected })` — page-specific synchronous reset, runs
//     FIRST on every load, before any status write and before the body.
//     `isSwitch` carries #255's loadedDb semantics (see below).
//   • `load(ctx)` — the page's fetch body. `ctx.isCurrent()` replaces the
//     hand-rolled `if (g !== generation) return;` sites inside it.
//   • machine.generation / machine.isCurrent(g) — the EXTERNAL co-guard seam:
//     #260's refreshCompletionGate captures the load generation WITHOUT
//     bumping it, and profile's queue factories pass `() => generation`.
//     Both convert to `machine.generation` — so reading it must never mutate.
//
// POST-DRIFT obligations this contract absorbs explicitly:
//   • #260 (profile completion-gate race): preserved by EXPOSING the counter —
//     `machine.generation` is a non-mutating read and `machine.isCurrent(g)`
//     the check, so refreshCompletionGate's capture-then-compare co-guard
//     converts 1:1 and page.profile-completion-gate-race.spec.ts stays green
//     untouched.
//   • #255 (roster loadedDb-scoped panel resets): ABSORBED — the machine
//     tracks the last loaded db across runs and reports `isSwitch` to the
//     reset hook, so roster's switch-scoped inactive-panel reset moves into
//     that hook while refresh-triggered reloads (same db) keep isSwitch=false
//     and do NOT slam the panel shut. Keys are normalized to `db ?? null` on
//     both sides (roster's `current?.db !== loadedDb` compared undefined to
//     null, making consecutive no-collective loads "switches" that re-reset
//     already-empty state — unobservable, not carried over).
//
// Real stores throughout: the REAL collectives store stack and the REAL auth
// storage feed the machine — only console.error is spied.
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// $lib/collectives/store pulls in discover.ts -> marker.ts -> entu/request ->
// entu-config -> $env/dynamic/public, which needs a real SvelteKit request
// context to resolve. Every other spec touching that chain outside a route
// mount mocks this the same way (request.auth-expired.spec.ts et al.).
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import {
	createRouteLoadMachine,
	ROUTE_LOAD_STATUSES,
	type RouteLoadStatus
} from '$lib/loading/routeLoad';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	selectedCollectiveStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── type-level contract: the InviteSurface superset pattern must COMPILE ─────
// InviteSurface's union is a strict superset (no-access/creating/done/
// create-error on top of the base 5). The shared type accommodates extension
// by plain union composition — pinned here at compile time so a narrowed or
// enum-shaped export can never ship.
type InviteStatus = RouteLoadStatus | 'no-access' | 'creating' | 'done' | 'create-error';
const _extends: InviteStatus = 'session-expired' satisfies RouteLoadStatus;
const _extra: InviteStatus = 'creating';
void _extends;
void _extra;

const POLYPHONY = { db: 'polyphony', name: 'Polyphony', personId: 'person-p' };
const BRAVURA = { db: 'bravura', name: 'Bravura', personId: 'person-b' };

function setCollectives(...collectives: (typeof POLYPHONY)[]) {
	collectiveState.set({ status: 'ready', collectives, erroredDbs: [] });
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(collectives[0]?.db ?? null);
}

function selectNone() {
	collectiveState.set({ status: 'ready', collectives: [], erroredDbs: [] });
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(null);
}

/** Duck-typed 401 rejection from the entuFetch layer (name-tag contract,
 *  request.auth-expired.spec.ts). */
function authExpiredError(): Error {
	const e = new Error('Entu returned 401 — session expired');
	e.name = 'AuthExpiredError';
	return e;
}

function deferred<T = void>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Harness: a machine wired to the REAL selected-collective store, recording
 *  every status write in order (full-sequence assertions, not spot checks). */
function harness(opts?: {
	load?: (ctx: {
		cfg: { db: string; token: string };
		selected: typeof POLYPHONY;
		g: number;
		isCurrent: () => boolean;
	}) => Promise<void>;
	reset?: (info: { isSwitch: boolean; selected: typeof POLYPHONY | null }) => void;
	onNoCollective?: () => void;
	onNoToken?: () => void;
	name?: string;
}) {
	const statuses: RouteLoadStatus[] = [];
	const events: string[] = [];
	const loadCalls: unknown[] = [];
	const machine = createRouteLoadMachine({
		name: opts?.name ?? 'test',
		selected: () => get(selectedCollectiveStore),
		setStatus: (s: RouteLoadStatus) => {
			statuses.push(s);
			events.push(`status:${s}`);
		},
		reset: (info: { isSwitch: boolean; selected: typeof POLYPHONY | null }) => {
			events.push(`reset:${info.isSwitch ? 'switch' : 'refresh'}`);
			opts?.reset?.(info);
		},
		onNoCollective: () => {
			events.push('no-collective-hook');
			opts?.onNoCollective?.();
		},
		onNoToken: () => {
			events.push('no-token-hook');
			opts?.onNoToken?.();
		},
		load: async (ctx: {
			cfg: { db: string; token: string };
			selected: typeof POLYPHONY;
			g: number;
			isCurrent: () => boolean;
		}) => {
			loadCalls.push(ctx);
			events.push('load');
			if (opts?.load) return opts.load(ctx);
			statuses.push('ready');
			events.push('status:ready');
		}
	});
	return { machine, statuses, events, loadCalls };
}

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
});

describe('routeLoad — exported status union', () => {
	it('ROUTE_LOAD_STATUSES is exactly the shared 5-state union, in canonical order', () => {
		expect(ROUTE_LOAD_STATUSES).toEqual([
			'loading',
			'no-collective',
			'load-error',
			'session-expired',
			'ready'
		]);
	});
});

describe('routeLoad — transitions', () => {
	it('no collective selected → exactly [no-collective]; the fetch body never runs; reset precedes the status write; the no-collective hook follows it', async () => {
		selectNone();
		const h = harness();

		await h.machine.loadForSelected();

		expect(h.statuses).toEqual(['no-collective']);
		expect(h.loadCalls).toEqual([]);
		expect(h.events).toEqual(['reset:switch', 'status:no-collective', 'no-collective-hook']);
	});

	it('collective selected but no token → exactly [load-error], loud console.error, body never runs; the no-token hook precedes the status write (roster drops currentCfg BEFORE erroring)', async () => {
		setCollectives(POLYPHONY);
		// no setToken — protected-route inconsistency
		const h = harness({ name: 'roster' });

		await h.machine.loadForSelected();

		expect(h.statuses).toEqual(['load-error']);
		expect(h.loadCalls).toEqual([]);
		expect(h.events).toEqual(['reset:switch', 'no-token-hook', 'status:load-error']);
		expect(console.error).toHaveBeenCalledWith(
			'roster: no auth token in storage on a protected route'
		);
	});

	it("happy path → 'loading' set before the body runs; the body receives the full context shape (cfg, selected, g, isCurrent)", async () => {
		setCollectives(POLYPHONY);
		setToken('jwt-1');
		const h = harness();

		await h.machine.loadForSelected();

		expect(h.statuses).toEqual(['loading', 'ready']);
		expect(h.events).toEqual(['reset:switch', 'status:loading', 'load', 'status:ready']);
		expect(h.loadCalls).toHaveLength(1);
		const ctx = h.loadCalls[0] as {
			cfg: unknown;
			selected: unknown;
			g: unknown;
			isCurrent: () => boolean;
		};
		expect(ctx.cfg).toEqual({ db: 'polyphony', token: 'jwt-1' });
		expect(ctx.selected).toEqual(POLYPHONY);
		expect(typeof ctx.g).toBe('number');
		expect(ctx.isCurrent()).toBe(true);
	});

	it("the machine never invents 'ready' — a body that resolves without writing leaves status at 'loading' (the body owns 'ready')", async () => {
		setCollectives(POLYPHONY);
		setToken('jwt-1');
		const h = harness({ load: async () => {} });

		await h.machine.loadForSelected();

		expect(h.statuses).toEqual(['loading']);
	});

	it("an auth-expired rejection → 'session-expired', and NO console.error (a dead token is a named state, not a fault)", async () => {
		setCollectives(POLYPHONY);
		setToken('jwt-1');
		const h = harness({
			load: async () => {
				throw authExpiredError();
			}
		});

		await h.machine.loadForSelected();

		expect(h.statuses).toEqual(['loading', 'session-expired']);
		expect(console.error).not.toHaveBeenCalled();
	});

	it("a generic rejection → 'load-error', logged loud as '<name>: load failed' — and loadForSelected itself resolves (never rejects into the caller's effect)", async () => {
		setCollectives(POLYPHONY);
		setToken('jwt-1');
		const boom = new Error('listThings failed: 500');
		const h = harness({
			name: 'library',
			load: async () => {
				throw boom;
			}
		});

		await expect(h.machine.loadForSelected()).resolves.toBeUndefined();

		expect(h.statuses).toEqual(['loading', 'load-error']);
		expect(console.error).toHaveBeenCalledWith('library: load failed', boom);
	});
});

describe('routeLoad — stale-generation drop', () => {
	it("a superseded load's rejection writes NOTHING: no status, no console.error — the newer load's outcome stands", async () => {
		setCollectives(POLYPHONY, BRAVURA);
		setToken('jwt-1');
		const held = deferred();
		let first = true;
		const h = harness({
			load: async (ctx) => {
				if (first) {
					first = false;
					await held.promise; // held until after the supersession
					throw new Error('stale network failure');
				}
				statusesPushReady(ctx);
			}
		});
		function statusesPushReady(_ctx: unknown) {
			h.statuses.push('ready');
			h.events.push('status:ready');
		}

		const run1 = h.machine.loadForSelected(); // held
		selectedCollectiveDbStore.set('bravura');
		await h.machine.loadForSelected(); // supersedes, completes 'ready'
		held.resolve();
		await run1;

		expect(h.statuses).toEqual(['loading', 'loading', 'ready']);
		expect(console.error).not.toHaveBeenCalled();
	});

	it('ctx.isCurrent() flips false for the superseded run and stays true for the newest — the in-body guard seam', async () => {
		setCollectives(POLYPHONY, BRAVURA);
		setToken('jwt-1');
		const contexts: { isCurrent: () => boolean }[] = [];
		const h = harness({
			load: async (ctx) => {
				contexts.push(ctx);
			}
		});

		await h.machine.loadForSelected();
		selectedCollectiveDbStore.set('bravura');
		await h.machine.loadForSelected();

		expect(contexts).toHaveLength(2);
		expect(contexts[0].isCurrent()).toBe(false);
		expect(contexts[1].isCurrent()).toBe(true);
	});

	it('#260 co-guard seam: machine.generation is a NON-MUTATING read; a captured value goes stale exactly when a new load starts', async () => {
		setCollectives(POLYPHONY);
		setToken('jwt-1');
		const h = harness();
		await h.machine.loadForSelected();

		// Capture WITHOUT bumping — refreshCompletionGate's exact move.
		const g = h.machine.generation;
		expect(h.machine.generation).toBe(g); // reading twice must not mutate
		expect(h.machine.isCurrent(g)).toBe(true);

		await h.machine.loadForSelected(); // a refresh supersedes the capture

		expect(h.machine.isCurrent(g)).toBe(false);
		expect(h.machine.generation).toBeGreaterThan(g);
	});
});

describe('routeLoad — collective-switch reset (#255 semantics)', () => {
	it('first load of a collective is a SWITCH; a same-db reload is a REFRESH (deactivate/reinstate reload paths must not slam the inactive panel shut)', async () => {
		setCollectives(POLYPHONY);
		setToken('jwt-1');
		const resets: boolean[] = [];
		const h = harness({ reset: (info) => resets.push(info.isSwitch) });

		await h.machine.loadForSelected(); // first load — switch
		await h.machine.loadForSelected(); // same-db refresh

		expect(resets).toEqual([true, false]);
	});

	it('changing db is a SWITCH again, and dropping to no collective is a SWITCH too (state keyed to the old db must not survive it)', async () => {
		setCollectives(POLYPHONY, BRAVURA);
		setToken('jwt-1');
		const resets: { isSwitch: boolean; db: string | null }[] = [];
		const h = harness({
			reset: (info) => resets.push({ isSwitch: info.isSwitch, db: info.selected?.db ?? null })
		});

		await h.machine.loadForSelected(); // polyphony — first
		selectedCollectiveDbStore.set('bravura');
		urlCollectiveDbStore.set('bravura');
		await h.machine.loadForSelected(); // bravura — switch
		await h.machine.loadForSelected(); // bravura — refresh
		selectNone();
		await h.machine.loadForSelected(); // none — switch

		expect(resets).toEqual([
			{ isSwitch: true, db: 'polyphony' },
			{ isSwitch: true, db: 'bravura' },
			{ isSwitch: false, db: 'bravura' },
			{ isSwitch: true, db: null }
		]);
	});
});

// (*MVOX:Tallis*)
