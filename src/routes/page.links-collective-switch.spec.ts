// @vitest-environment happy-dom
//
// #256 RED — pin 6: multi-collective. The /links page state resets on a
// collective switch, and a list read still in flight for the OLD collective
// NEVER repopulates the NEW collective's page (the #287/#296/#297/#299 bug
// class, guarded on new pages by the EXTRACTED machine).
//
// House method (#259's deterministic race construction, worked example:
// page.roster-pending-collective-switch.spec.ts): the read mock itself is
// release-controlled — hold → switch → settle. Assertions read rendered DOM
// and mock call records, never component internals.
//
// STRUCTURAL PIN: this is a NEW page, so it uses the extracted
// createRouteLoadMachine from $lib/loading/routeLoad.ts (the machine roster/
// library/profile share) — NOT a hand-rolled in-file counter (the agenda
// +page.svelte's requestId idiom is grandfathered in-file precedent, not the
// pattern for new pages; see routeLoad.wiring.spec.ts's "actually replaces,
// not sits beside" discipline).
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_t, key) => () => String(key) })
}));
vi.mock('$lib/paraglide/messages', () => ({
	m: new Proxy({}, { get: (_t, key) => () => String(key) })
}));

const { listLinksMock, createLinkMock, updateLinkMock, reorderLinksMock, deleteLinkMock } =
	vi.hoisted(() => ({
		listLinksMock: vi.fn(),
		createLinkMock: vi.fn(),
		updateLinkMock: vi.fn(),
		reorderLinksMock: vi.fn(),
		deleteLinkMock: vi.fn()
	}));
vi.mock('$lib/links/linkData', () => ({ listLinks: listLinksMock }));
vi.mock('$lib/links/linkActions', () => ({
	createLink: createLinkMock,
	updateLink: updateLinkMock,
	reorderLinks: reorderLinksMock,
	deleteLink: deleteLinkMock
}));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './links/+page.svelte';
import type { LinkRow } from '$lib/links/linkData';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

function rowsA(): LinkRow[] {
	return [
		{ id: 'la-1', name: 'A-Archive', url: 'https://a.example/one', description: null, displayOrder: 1 },
		{ id: 'la-2', name: 'A-Scores', url: 'a.example/two', description: 'from A', displayOrder: 2 }
	];
}

function rowsB(): LinkRow[] {
	return [
		{ id: 'lb-1', name: 'B-Website', url: 'https://b.example', description: null, displayOrder: 1 }
	];
}

function deferred<T = void>() {
	let resolveFn!: (v: T) => void;
	let rejectFn!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolveFn = res;
		rejectFn = rej;
	});
	return { promise, resolve: resolveFn, reject: rejectFn };
}

function setAuthedWithTwoCollectives() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p', 'other-choir': 'person-q' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [
			{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' },
			{ db: 'other-choir', name: 'Other Choir', personId: 'person-q' }
		],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

beforeEach(() => {
	setAuthedWithTwoCollectives();
	adminStore.set('admin');
	createLinkMock.mockResolvedValue('l-new');
	updateLinkMock.mockResolvedValue(undefined);
	reorderLinksMock.mockResolvedValue(undefined);
	deleteLinkMock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function rowNames(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll('[data-testid="links-row"]')).map(
		(r) => r.querySelector('[data-testid="links-row-name"]')?.textContent?.trim() ?? ''
	);
}

describe('#256 pin 6 — a stale list read never repopulates the new collective (hold → switch → settle)', () => {
	it("collective A's read, settling AFTER a switch to B, leaves B's rows (and ONLY B's) on screen", async () => {
		const heldA = deferred<LinkRow[]>();
		listLinksMock.mockImplementation((cfg: { db: string }) =>
			cfg.db === 'polyphony' ? heldA.promise : Promise.resolve(rowsB())
		);

		const { container } = render(Page);
		// A's read is in flight — nothing rendered yet.
		await waitFor(() => {
			expect(listLinksMock).toHaveBeenCalled();
		});
		expect(rowNames(container)).toEqual([]);

		// Switch to B; B's read resolves immediately.
		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['B-Website']);
		});

		// NOW A's stale read settles — it must change NOTHING.
		heldA.resolve(rowsA());
		await Promise.resolve();
		await Promise.resolve();
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['B-Website']);
		});
		expect(container.textContent).not.toContain('A-Archive');
		expect(container.textContent).not.toContain('A-Scores');
	});

	it("a stale read REJECTING after the switch neither surfaces an error over B's list nor clears it", async () => {
		const heldA = deferred<LinkRow[]>();
		listLinksMock.mockImplementation((cfg: { db: string }) =>
			cfg.db === 'polyphony' ? heldA.promise : Promise.resolve(rowsB())
		);
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		const { container } = render(Page);
		await waitFor(() => {
			expect(listLinksMock).toHaveBeenCalled();
		});
		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['B-Website']);
		});

		heldA.reject(new Error('stale wire failure'));
		await Promise.resolve();
		await Promise.resolve();
		expect(rowNames(container)).toEqual(['B-Website']);
		expect(q(container, 'links-load-error')).toBeNull();
		consoleError.mockRestore();
	});
});

describe('#256 pin 6 — page state resets on a collective switch', () => {
	it("typed add-form draft from collective A does not survive into B (a cross-collective draft is the #299 bug class)", async () => {
		listLinksMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(cfg.db === 'polyphony' ? rowsA() : rowsB())
		);
		const { container } = render(Page);
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['A-Archive', 'A-Scores']);
		});

		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'Draft name' } });
		await fireEvent.input(q(container, 'links-add-url')!, { target: { value: 'draft.example' } });

		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['B-Website']);
		});
		expect((q(container, 'links-add-name') as HTMLInputElement).value).toBe('');
		expect((q(container, 'links-add-url') as HTMLInputElement).value).toBe('');
	});

	it('an OPEN edit form from collective A is not left open over B rows', async () => {
		listLinksMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(cfg.db === 'polyphony' ? rowsA() : rowsB())
		);
		const { container } = render(Page);
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['A-Archive', 'A-Scores']);
		});
		await fireEvent.click(
			container
				.querySelectorAll('[data-testid="links-row"]')[0]
				.querySelector('[data-testid="links-edit"]')!
		);
		expect(q(container, 'links-edit-name')).not.toBeNull();

		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['B-Website']);
		});
		expect(q(container, 'links-edit-name')).toBeNull();
	});
});

describe('#256 structural — the NEW page uses the extracted route-load machine', () => {
	it('src/routes/links/+page.svelte imports createRouteLoadMachine from $lib/loading/routeLoad (not a hand-rolled in-file counter)', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/routes/links/+page.svelte'),
			'utf-8'
		);
		expect(source).toContain('createRouteLoadMachine');
		expect(source).toContain('$lib/loading/routeLoad');
	});
});

// (*MVOX:Tallis* — #256 RED)
