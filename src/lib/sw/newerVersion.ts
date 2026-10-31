// #1052: tells the user when the deployed build differs from the running one; Refresh updates.
import { get, writable } from 'svelte/store';
import { online } from '$lib/net/online';
import { reportProblem } from '$lib/problems/reportProblem';
import { runningBuildCommit } from '$lib/runningBuild';
import {
	UPDATE_CHECK_INTERVAL_MS,
	decideUpdateCheck,
	initialUpdateSchedulerState,
	type UpdateCheckEvent
} from './swUpdate';

/** How long a controlled page waits, once update() settles with nothing installing, to show it. */
export const UPDATE_GRACE_MS = 10_000;
/** How long Refresh waits on the update check, and on a new worker, before it says why not. */
export const REFRESH_WAIT_MS = 15_000;
/** How long Refresh waits for the page to reload once the update is in, before it says why not. */
export const RELOAD_WAIT_MS = 30_000;

export type RefreshFailure = 'offline' | 'install-failed' | 'not-deployed';

export type NewerVersion =
	| { state: 'none' }
	| { state: 'available' }
	| { state: 'refreshing' }
	| { state: 'failed'; reason: RefreshFailure };

export const newerVersion = writable<NewerVersion>({ state: 'none' });

export interface VersionWatchDeps {
	runningCommit: string;
	fetchImpl: typeof fetch;
	serviceWorker: ServiceWorkerContainer | undefined;
	reload: () => void;
}

export interface VersionWatch {
	refresh(): Promise<void>;
	stop(): void;
}

function platformDeps(): VersionWatchDeps {
	const hasWorkers = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
	return {
		runningCommit: runningBuildCommit,
		fetchImpl: (input, init) => fetch(input, init),
		serviceWorker: hasWorkers ? navigator.serviceWorker : undefined,
		reload: () => window.location.reload()
	};
}

/** The deployed commit, or null when the stamp names none (a dev server). */
async function readDeployedCommit(fetchImpl: typeof fetch): Promise<string | null> {
	const res = await fetchImpl('/version.json', { cache: 'no-store' });
	if (!res.ok) throw new Error(`/version.json answered HTTP ${res.status}`);
	const stamp = (await res.json()) as { commit?: unknown };
	return typeof stamp.commit === 'string' ? stamp.commit : null;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function within<T, L>(promise: Promise<T>, ms: number, late: L): Promise<T | L> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<L>((resolve) => (timer = setTimeout(() => resolve(late), ms)));
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function workerSettles(worker: ServiceWorker): Promise<ServiceWorkerState> {
	return new Promise((resolve) => {
		const onChange = () => {
			if (worker.state !== 'activated' && worker.state !== 'redundant') return;
			worker.removeEventListener('statechange', onChange);
			resolve(worker.state);
		};
		worker.addEventListener('statechange', onChange);
		onChange();
	});
}

type InFlight = 'none' | 'activated' | 'redundant' | 'pending';

/** What became of `worker` (or one installing now); 'pending' once the wait runs out. */
async function inFlight(
	registration: ServiceWorkerRegistration,
	worker = registration.installing ?? registration.waiting
): Promise<InFlight> {
	if (!worker) return 'none';
	const state = await within(workerSettles(worker), REFRESH_WAIT_MS, 'pending' as const);
	return state === 'activated' || state === 'redundant' ? state : 'pending';
}

interface UpdateRun {
	/** Why update() failed, or null when it settled. */
	failure: string | null;
	/** What became of a new worker, however fast it landed; 'none' when the update found none. */
	flight: InFlight;
}

/** Runs update(), noting first what the registration has, so a fast new worker is never missed. */
async function runUpdate(
	registration: ServiceWorkerRegistration,
	sw: ServiceWorkerContainer
): Promise<UpdateRun> {
	const activeBefore = registration.active;
	let found: ServiceWorker | null = null;
	let tookOver = false;
	const onFound = () => (found = registration.installing ?? found);
	const onTakeOver = () => (tookOver = true);
	registration.addEventListener('updatefound', onFound);
	sw.addEventListener('controllerchange', onTakeOver);
	try {
		const updated = registration.update().then(
			() => null,
			(error: unknown) => `the update check failed: ${errorText(error)}`
		);
		const failure = await within(updated, REFRESH_WAIT_MS, 'the update check did not answer');
		const worker = registration.installing ?? registration.waiting ?? found;
		if (worker) return { failure: null, flight: await inFlight(registration, worker) };
		const replaced = tookOver || registration.active !== activeBefore;
		return { failure: replaced ? null : failure, flight: replaced ? 'activated' : 'none' };
	} finally {
		registration.removeEventListener('updatefound', onFound);
		sw.removeEventListener('controllerchange', onTakeOver);
	}
}

function errorText(error: unknown): string {
	return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function startVersionWatch(overrides: Partial<VersionWatchDeps> = {}): VersionWatch {
	const deps = { ...platformDeps(), ...overrides };
	const sw = deps.serviceWorker;
	// A page controlled at boot is reloaded by swUpdate.ts when a new worker takes over.
	const controlledAtBoot = Boolean(sw?.controller);
	let stopped = false;
	let latestCheck = 0;
	newerVersion.set({ state: 'none' });

	const differs = async () => {
		const deployed = await readDeployedCommit(deps.fetchImpl);
		return deployed !== null && deployed !== deps.runningCommit;
	};
	const hideUnlessRefreshing = () =>
		newerVersion.update((s) => (s.state === 'refreshing' ? s : { state: 'none' }));

	async function check() {
		const mine = ++latestCheck;
		const current = () => !stopped && mine === latestCheck;
		try {
			let newer = await differs();
			const registration = newer && controlledAtBoot ? await sw!.getRegistration() : undefined;
			if (registration) {
				if (!(await autoUpdateFailedOrIdle(registration, current))) return;
				newer = await differs();
			}
			if (!current()) return;
			if (!newer) hideUnlessRefreshing();
			else newerVersion.update((s) => (s.state === 'none' ? { state: 'available' } : s));
		} catch (error) {
			console.warn('[#1052] newer-version check failed', error);
		}
	}

	// False when the auto-update is landing (its reload follows) or still pending.
	async function autoUpdateFailedOrIdle(registration: ServiceWorkerRegistration, current: () => boolean) {
		const run = await runUpdate(registration, sw!);
		if (run.failure) console.warn('[#1052] update check failed', run.failure);
		let flight = run.flight;
		if (flight === 'none') {
			await sleep(UPDATE_GRACE_MS);
			flight = await inFlight(registration);
		}
		return current() && (flight === 'none' || flight === 'redundant');
	}

	function fail(reason: RefreshFailure, detail: string) {
		newerVersion.set({ state: 'failed', reason });
		reportProblem({ area: 'update', action: 'refresh', reason: detail });
	}

	// On a controlled page the reload is swUpdate.ts's, on controllerchange; this bounds the wait.
	async function reloadAwaited(reloadHere: boolean) {
		if (reloadHere) deps.reload();
		await sleep(RELOAD_WAIT_MS);
		if (stopped || get(newerVersion).state !== 'refreshing') return;
		fail('install-failed', 'the page did not reload after the update');
	}

	async function refresh() {
		if (get(newerVersion).state === 'refreshing') return;
		newerVersion.set({ state: 'refreshing' });
		if (!get(online)) return fail('offline', 'the device is offline');
		const registration = sw ? await sw.getRegistration() : undefined;
		if (!registration) return reloadAwaited(true);

		const { failure: updateFailure, flight } = await runUpdate(registration, sw!);
		if (updateFailure !== null) {
			const reachable = await differs().then(
				() => true,
				() => false
			);
			if (reachable) return fail('install-failed', updateFailure);
			return fail('offline', `${updateFailure}; the server could not be reached`);
		}
		if (flight === 'redundant' || flight === 'pending') {
			return fail('install-failed', 'the new version failed to install');
		}
		if (flight === 'activated') {
			return reloadAwaited(!controlledAtBoot);
		}
		// Uncontrolled, the active worker already is the newest the server has.
		if (!controlledAtBoot) return reloadAwaited(true);
		const stillNewer = await differs().catch(() => null);
		if (stillNewer === null) return fail('offline', 'the version check could not reach the server');
		if (stillNewer) return fail('not-deployed', 'the server still serves the old version');
		newerVersion.set({ state: 'none' });
	}

	let schedule = initialUpdateSchedulerState(Date.now());
	const onEvent = (event: UpdateCheckEvent) => {
		const decision = decideUpdateCheck(schedule, event);
		schedule = decision.state;
		if (decision.check) void check();
	};
	const interval = setInterval(() => {
		onEvent({ kind: 'interval-tick', nowMs: Date.now() });
	}, UPDATE_CHECK_INTERVAL_MS);
	const onVisibility = () => {
		if (document.visibilityState === 'visible') onEvent({ kind: 'became-visible', nowMs: Date.now() });
	};
	document.addEventListener('visibilitychange', onVisibility);
	void check();

	return {
		refresh,
		stop() {
			stopped = true;
			clearInterval(interval);
			document.removeEventListener('visibilitychange', onVisibility);
		}
	};
}

// (*MVOX:Josquin*)
