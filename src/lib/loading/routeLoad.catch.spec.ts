// @vitest-environment happy-dom
// #674: the machine catches throws from the page's hooks and status sink, not only from the body.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouteLoadMachine, type RouteLoadStatus } from '$lib/loading/routeLoad';
import { clearAll, setToken } from '$lib/auth/storage';

const SAMPLEDB = { db: 'sampledb' };

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	clearAll({ preserveProvider: false });
});

describe('routeLoad — hook and status throws', () => {
	it("a reset throw → 'load-error', logged as '<name>: load failed'; the body never runs", async () => {
		setToken('jwt-1');
		const boom = new Error('reset broke');
		const statuses: RouteLoadStatus[] = [];
		const load = vi.fn(async () => {});
		const machine = createRouteLoadMachine({
			name: 'links',
			selected: () => SAMPLEDB,
			setStatus: (s) => statuses.push(s),
			reset: () => {
				throw boom;
			},
			load
		});

		await expect(machine.loadForSelected()).resolves.toBeUndefined();

		expect(statuses).toEqual(['load-error']);
		expect(load).not.toHaveBeenCalled();
		expect(console.error).toHaveBeenCalledWith('links: load failed', boom);
	});

	it("a status-sink throw on 'loading' → 'load-error', logged; loadForSelected resolves", async () => {
		setToken('jwt-1');
		const boom = new Error('sink broke');
		const statuses: RouteLoadStatus[] = [];
		const load = vi.fn(async () => {});
		const machine = createRouteLoadMachine({
			name: 'roster',
			selected: () => SAMPLEDB,
			setStatus: (s) => {
				if (s === 'loading') throw boom;
				statuses.push(s);
			},
			load
		});

		await expect(machine.loadForSelected()).resolves.toBeUndefined();

		expect(statuses).toEqual(['load-error']);
		expect(load).not.toHaveBeenCalled();
		expect(console.error).toHaveBeenCalledWith('roster: load failed', boom);
	});

	it("an onNoCollective throw → 'no-collective' then 'load-error', logged", async () => {
		const boom = new Error('hook broke');
		const statuses: RouteLoadStatus[] = [];
		const machine = createRouteLoadMachine({
			name: 'profile',
			selected: () => null,
			setStatus: (s) => statuses.push(s),
			onNoCollective: () => {
				throw boom;
			},
			load: async () => {}
		});

		await expect(machine.loadForSelected()).resolves.toBeUndefined();

		expect(statuses).toEqual(['no-collective', 'load-error']);
		expect(console.error).toHaveBeenCalledWith('profile: load failed', boom);
	});
});

// (*MVOX:Josquin*)
