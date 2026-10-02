// @vitest-environment happy-dom
// #682: the optional gate runs after 'loading' and before the body; false ends at 'no-access'.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouteLoadMachine, type GatedRouteLoadStatus } from '$lib/loading/routeLoad';
import { clearAll, setToken } from '$lib/auth/storage';

const SAMPLEDB = { db: 'sampledb' };

function authExpiredError(): Error {
	const e = new Error('Entu returned 401 — session expired');
	e.name = 'AuthExpiredError';
	return e;
}

function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

function harness(gate: () => Promise<boolean>) {
	const events: string[] = [];
	const statuses: GatedRouteLoadStatus[] = [];
	const machine = createRouteLoadMachine({
		name: 'admin',
		selected: () => SAMPLEDB,
		setStatus: (s) => {
			statuses.push(s);
			events.push(`status:${s}`);
		},
		gate: async (ctx) => {
			events.push(`gate:${ctx.cfg.db}`);
			return gate();
		},
		load: async () => {
			events.push('load');
		}
	});
	return { machine, events, statuses };
}

beforeEach(() => {
	setToken('jwt-1');
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	clearAll({ preserveProvider: false });
});

describe('routeLoad — gate', () => {
	it("a passing gate runs between 'loading' and the body", async () => {
		const h = harness(async () => true);

		await h.machine.loadForSelected();

		expect(h.events).toEqual(['status:loading', 'gate:sampledb', 'load']);
	});

	it("a refusing gate ends at 'no-access'; the body never runs; nothing is logged", async () => {
		const h = harness(async () => false);

		await h.machine.loadForSelected();

		expect(h.events).toEqual(['status:loading', 'gate:sampledb', 'status:no-access']);
		expect(console.error).not.toHaveBeenCalled();
	});

	it("an auth-expired gate throw → 'session-expired'", async () => {
		const h = harness(async () => {
			throw authExpiredError();
		});

		await h.machine.loadForSelected();

		expect(h.statuses).toEqual(['loading', 'session-expired']);
		expect(console.error).not.toHaveBeenCalled();
	});

	it("any other gate throw → 'load-error', logged as '<name>: load failed'", async () => {
		const boom = new Error('rights read broke');
		const h = harness(async () => {
			throw boom;
		});

		await h.machine.loadForSelected();

		expect(h.statuses).toEqual(['loading', 'load-error']);
		expect(console.error).toHaveBeenCalledWith('admin: load failed', boom);
	});

	it('a superseded gate answer writes nothing and runs no body', async () => {
		const first = deferred<boolean>();
		const answers = [first.promise, Promise.resolve(true)];
		const h = harness(() => answers.shift()!);

		const stale = h.machine.loadForSelected();
		await h.machine.loadForSelected();
		first.resolve(false);
		await stale;

		expect(h.events).toEqual([
			'status:loading',
			'gate:sampledb',
			'status:loading',
			'gate:sampledb',
			'load'
		]);
	});
});

// (*MVOX:Josquin*)
