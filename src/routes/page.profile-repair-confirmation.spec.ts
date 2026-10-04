// @vitest-environment happy-dom
// The profile repair and visibility messages reach their screens.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/pages/profileCopy')).profileMessages()
);

const h = vi.hoisted(() => ({
	applyDuplicateRepairMock: vi.fn(),
}));

vi.mock('$lib/profile/fieldMove', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/profile/fieldMove')>('$lib/profile/fieldMove');
	return { ...actual, applyDuplicateRepair: h.applyDuplicateRepairMock };
});
vi.mock('$lib/profile/profileData', async () =>
	(await import('$lib/testing/mocks/profile')).profileDataModule()
);
vi.mock('$lib/profile/applyProfileSave', async () =>
	(await import('$lib/testing/mocks/profile')).applyProfileSaveModule('bare')
);
vi.mock('$lib/profile/completionGate', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).completionGateModule(importOriginal)
);
vi.mock('$lib/profile/linkedIdentities', async () =>
	(await import('$lib/testing/mocks/profile')).noLinkedIdentitiesModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './profile/+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { get } from 'svelte/store';
import { completionGateStore, resetGate, type GateState } from '$lib/profile/completionGate';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { applyProfileSaveMock } from '$lib/testing/mocks/profile';
import { listMyProfilesMock, resolveGateMock } from '$lib/testing/mocks/session';
import { selectSampledb, waitReady } from '$lib/testing/pages/profile';

async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 20; i++) await Promise.resolve();
}

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);

function statusRegion(container: HTMLElement): HTMLElement | null {
	return q(container, '[data-testid="profile-repair-status"]') as HTMLElement | null;
}
function statusText(container: HTMLElement): string {
	return (statusRegion(container)?.textContent ?? '').trim();
}

const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING
function precedes(a: Element, b: Element): boolean {
	return (a.compareDocumentPosition(b) & FOLLOWING) !== 0;
}

function byExactText(container: HTMLElement, text: string): Element | null {
	const all = Array.from(container.querySelectorAll('*')).filter(
		(el) => (el.textContent ?? '').trim() === text
	);
	return all.length > 0 ? all[all.length - 1] : null;
}

afterEach(() => {
	vi.useRealTimers();
	cleanup();
	listMyProfilesMock.mockReset();
	applyProfileSaveMock.mockReset();
	h.applyDuplicateRepairMock.mockReset();
	resolveGateMock.mockReset();
	resetAppState();
	resetGate();
});

describe('#257 — repair confirmation announcement (profile_repair_done)', () => {
	it('the status region is PERSISTENT: mounted (empty) from first ready render, role="status" aria-live="polite" — even with no repair pending', async () => {
		selectSampledb();
		listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitReady(container);

		expect(q(container, '[data-testid="profile-visibility-repair-name"]')).toBeNull();
		const region = statusRegion(container);
		expect(region, 'persistent profile-repair-status region must render with the ready surface').not.toBeNull();
		expect(region!.getAttribute('role')).toBe('status');
		expect(region!.getAttribute('aria-live')).toBe('polite');
		expect(statusText(container)).toBe('');
	});

	it('fail THEN succeed in one flow: failure shows profile_repair_error (no done announcement); the successful retry announces profile_repair_done and the banner unmounts', async () => {
		selectSampledb();
		listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-priv', name: 'Ada', email: '', _sharing: 'private' },
			{ _id: 'prof-dom', name: 'Ada', email: '', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-visibility-repair-name"]')).not.toBeNull()
		);
		expect(statusRegion(container)).not.toBeNull();
		expect(statusText(container)).toBe('');

		h.applyDuplicateRepairMock.mockRejectedValueOnce(new Error('repair delete failed: 502'));
		const fix = q(
			container,
			'[data-testid="profile-visibility-repair-name-fix"]'
		) as HTMLButtonElement;
		await fireEvent.click(fix);
		await waitFor(() =>
			expect(
				q(container, '[data-testid="profile-visibility-repair-name-error"]')
			).not.toBeNull()
		);
		expect(
			q(container, '[data-testid="profile-visibility-repair-name-error"]')!.textContent
		).toBe("Couldn't finish. Your Name is still readable at Collective.");
		expect(statusText(container)).toBe('');
		expect(q(container, '[data-testid="profile-visibility-repair-name"]')).not.toBeNull();

		h.applyDuplicateRepairMock.mockResolvedValueOnce({
			field: 'name',
			clearedIds: ['prof-dom']
		});
		listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-priv', name: 'Ada', email: '', _sharing: 'private' },
			{ _id: 'prof-dom', name: '', email: '', _sharing: 'domain' }
		]);
		const regionBefore = statusRegion(container);
		await fireEvent.click(fix);
		await waitFor(() => {
			expect(q(container, '[data-testid="profile-visibility-repair-name"]')).toBeNull();
			expect(statusText(container)).toBe('Visibility change completed.');
		});
		expect(
			statusRegion(container),
			'the live region must SURVIVE the post-repair reload — same node, not a remount'
		).toBe(regionBefore);

		expect(h.applyDuplicateRepairMock).toHaveBeenCalledTimes(2);
		expect(h.applyDuplicateRepairMock.mock.calls[1][0]).toEqual({
			cfg: { db: 'sampledb', token: 'jwt-member' },
			field: 'name',
			clear: [{ id: 'prof-dom', sibling: '' }]
		});
	});

	it('transient per the house pattern: the announcement clears at the START of the next repair attempt — and NEVER by a timer', async () => {
		selectSampledb();
		listMyProfilesMock.mockResolvedValue([
			{ _id: 'p-priv', name: 'Ada', email: 'ada@x.io', _sharing: 'private' },
			{ _id: 'p-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, '[data-testid="profile-visibility-repair-name"]')).not.toBeNull();
			expect(q(container, '[data-testid="profile-visibility-repair-email"]')).not.toBeNull();
		});

		h.applyDuplicateRepairMock.mockResolvedValueOnce({ field: 'name', clearedIds: ['p-dom'] });
		listMyProfilesMock.mockResolvedValue([
			{ _id: 'p-priv', name: 'Ada', email: 'ada@x.io', _sharing: 'private' },
			{ _id: 'p-dom', name: '', email: 'ada@x.io', _sharing: 'domain' }
		]);
		await fireEvent.click(
			q(container, '[data-testid="profile-visibility-repair-name-fix"]') as HTMLButtonElement
		);
		await waitFor(() => {
			expect(q(container, '[data-testid="profile-visibility-repair-name"]')).toBeNull();
			expect(statusText(container)).toBe('Visibility change completed.');
		});

		const emailWrite = deferred<{ field: string; clearedIds: string[] }>();
		h.applyDuplicateRepairMock.mockReturnValueOnce(emailWrite.promise);
		await fireEvent.click(
			q(container, '[data-testid="profile-visibility-repair-email-fix"]') as HTMLButtonElement
		);
		await waitFor(() => expect(statusText(container)).toBe(''));
		expect(q(container, '[data-testid="profile-visibility-repair-email"]')).not.toBeNull();

		listMyProfilesMock.mockResolvedValue([
			{ _id: 'p-priv', name: 'Ada', email: 'ada@x.io', _sharing: 'private' },
			{ _id: 'p-dom', name: '', email: '', _sharing: 'domain' }
		]);
		vi.useFakeTimers();
		emailWrite.resolve({ field: 'email', clearedIds: ['p-dom'] });
		await flushMicrotasks();
		expect(statusText(container)).toBe('Visibility change completed.');
		expect(q(container, '[data-testid="profile-visibility-repair-email"]')).toBeNull();

		vi.advanceTimersByTime(60_000);
		await flushMicrotasks();
		expect(
			statusText(container),
			'the announcement must persist until the next attempt — no auto-dismiss timer'
		).toBe('Visibility change completed.');
	});

	it('the region is outside the status gate: mounted while status is still loading, before the ready surface exists', async () => {
		selectSampledb();
		const firstLoad = deferred<Array<Record<string, string>>>();
		listMyProfilesMock.mockReturnValueOnce(firstLoad.promise);
		const { container } = render(Page);

		await waitFor(() => expect(listMyProfilesMock).toHaveBeenCalledTimes(1));
		expect(q(container, '[data-testid="profile-field-name"]')).toBeNull();
		expect(
			statusRegion(container),
			'profile-repair-status must not be gated on `status` — a region that mounts alongside its own text announces nothing'
		).not.toBeNull();

		firstLoad.resolve([{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }]);
		await waitReady(container);
	});

	it('a superseded post-repair reload never announces: switching collectives mid-reload leaves the new profile silent', async () => {
		signIn({
			token: 'jwt-member',
			collectives: [
				{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
				{ db: 'bravura', name: 'Bravura', personId: 'person-b' }
			]
		});
		listMyProfilesMock.mockImplementation(async (cfg: { db: string }) =>
			cfg.db === 'bravura'
				? [{ _id: 'prof-b-dom', name: 'Bea', email: '', _sharing: 'domain' }]
				: [
						{ _id: 'prof-priv', name: 'Ada', email: '', _sharing: 'private' },
						{ _id: 'prof-dom', name: 'Ada', email: '', _sharing: 'domain' }
					]
		);
		const { container } = render(Page);
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-visibility-repair-name"]')).not.toBeNull()
		);

		h.applyDuplicateRepairMock.mockResolvedValueOnce({ field: 'name', clearedIds: ['prof-dom'] });
		const heldReload = deferred<Array<Record<string, string>>>();
		listMyProfilesMock.mockReturnValueOnce(heldReload.promise);
		await fireEvent.click(
			q(container, '[data-testid="profile-visibility-repair-name-fix"]') as HTMLButtonElement
		);
		await waitFor(() => expect(listMyProfilesMock).toHaveBeenCalledTimes(2));

		selectedCollectiveDbStore.set('bravura');
		await waitFor(() =>
			expect((q(container, '[data-testid="profile-name-value"]')?.textContent ?? '').trim()).toBe(
				'Bea'
			)
		);
		expect(statusText(container)).toBe('');

		heldReload.resolve([
			{ _id: 'prof-priv', name: 'Ada', email: '', _sharing: 'private' },
			{ _id: 'prof-dom', name: '', email: '', _sharing: 'domain' }
		]);
		await flushMicrotasks();
		expect(
			statusText(container),
			"a stale reload must not announce collective A's repair on collective B's profile"
		).toBe('');
	});
});

describe('#257 — visibility section heading (profile_visibility_title / profile_visibility_intro)', () => {
	async function renderReady(): Promise<HTMLElement> {
		selectSampledb();
		listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitReady(container);
		return container;
	}

	it('a REAL h2 carries profile_visibility_title immediately above the field list, with profile_visibility_intro as its explanatory line', async () => {
		const container = await renderReady();

		const fieldList = q(container, '[data-testid="profile-field-name"]')!;
		const pageIntro = byExactText(container, 'Fill in your name and email.');
		expect(pageIntro).not.toBeNull();
		expect(precedes(pageIntro!, fieldList)).toBe(true);

		const headings = Array.from(container.querySelectorAll('h2'));
		const visHeading = headings.find(
			(el) => (el.textContent ?? '').trim() === 'Who can see each field'
		);
		expect(
			visHeading,
			'an <h2> carrying profile_visibility_title must render on the ready surface'
		).not.toBeUndefined();

		const introLine = byExactText(container, 'Pick an icon to move a field.');
		expect(
			introLine,
			'profile_visibility_intro must render as the section\'s explanatory line'
		).not.toBeNull();

		expect(precedes(visHeading!, introLine!)).toBe(true);
		expect(precedes(introLine!, fieldList)).toBe(true);
		const linkedHeading = headings.find((el) =>
			(el.textContent ?? '').includes('Sign-ins that work for')
		);
		expect(linkedHeading, 'the Linked Accounts h2 stays').not.toBeUndefined();
		expect(precedes(fieldList, linkedHeading!)).toBe(true);
	});

	it('profile_intro stays where it is — the page intro precedes the new section heading (the two are complementary, not merged)', async () => {
		const container = await renderReady();

		const pageIntro = byExactText(container, 'Fill in your name and email.');
		expect(pageIntro, 'profile_intro must stay on the page').not.toBeNull();

		const h1 = q(container, 'h1')!;
		expect(precedes(h1, pageIntro!)).toBe(true);

		const visHeading = Array.from(container.querySelectorAll('h2')).find(
			(el) => (el.textContent ?? '').trim() === 'Who can see each field'
		);
		expect(visHeading).not.toBeUndefined();
		expect(
			precedes(pageIntro!, visHeading!),
			'the page intro introduces the page — it stays ABOVE the visibility section heading'
		).toBe(true);
	});
});

describe('#257 fold-in — live resolveGate rejection is logged, stale stays silent (#260 note 2)', () => {
	const COLLECTIVE_A = { db: 'sampledb', name: 'Sampledb', personId: 'person-p' };
	const COLLECTIVE_B = { db: 'bravura', name: 'Bravura', personId: 'person-b' };

	function wireProfilesPerCollective(): void {
		listMyProfilesMock.mockImplementation(async (cfg: { db: string }) =>
			cfg.db === 'bravura'
				? [{ _id: 'prof-b-dom', name: 'Bea', email: '', _sharing: 'domain' }]
				: [{ _id: 'prof-a-dom', name: 'Ada', email: '', _sharing: 'domain' }]
		);
	}

	function signInWithTwoCollectives(): void {
		signIn({
			token: 'jwt-member',
			collectives: [COLLECTIVE_A, COLLECTIVE_B],
			selected: 'sampledb'
		});
	}

	function displayValue(container: HTMLElement, field: 'name' | 'email'): string {
		return (q(container, `[data-testid="profile-${field}-value"]`)?.textContent ?? '').trim();
	}

	async function waitReadyShowing(container: HTMLElement, name: string): Promise<void> {
		await waitFor(() => {
			expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull();
			expect(displayValue(container, 'name')).toBe(name);
		});
	}

	async function openEditor(container: HTMLElement, field: 'name' | 'email') {
		const btn = q(container, `[data-testid="profile-${field}-edit"]`) as HTMLButtonElement | null;
		expect(btn, `profile-${field}-edit must render in display state`).not.toBeNull();
		await fireEvent.click(btn!);
		let editorInput: HTMLInputElement | null = null;
		await waitFor(() => {
			editorInput = q(container, `[data-testid="profile-${field}"]`) as HTMLInputElement | null;
			expect(editorInput).not.toBeNull();
		});
		return editorInput!;
	}

	async function saveNameToInitiateGateRead(
		container: HTMLElement,
		newName: string
	): Promise<void> {
		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: newName } });
		await fireEvent.blur(nameInput);
		await waitFor(() => expect(resolveGateMock).toHaveBeenCalledTimes(1));
	}

	it('a LIVE (current-generation) resolveGate rejection reaches console.error — a real failure to resolve membership standing must not vanish', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		wireProfilesPerCollective();
		applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-a-dom' });
		const liveRead = deferred<GateState>();
		resolveGateMock.mockReturnValueOnce(liveRead.promise);
		signInWithTwoCollectives();

		const { container } = render(Page);
		await waitReadyShowing(container, 'Ada');
		await saveNameToInitiateGateRead(container, 'Ada M.');

		const err = new Error('resolveGate: network down');
		liveRead.reject(err);
		await flushMicrotasks();

		const logged = consoleSpy.mock.calls.filter((args) => args.includes(err));
		expect(
			logged,
			'a live resolveGate rejection must reach console.error with the error object'
		).toHaveLength(1);
		expect(get(completionGateStore)).toBe('loading');
		consoleSpy.mockRestore();
	});

	it('a STALE rejection (after a collective switch) stays fully silent — no console.error either', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		wireProfilesPerCollective();
		applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-a-dom' });
		const staleRead = deferred<GateState>();
		resolveGateMock.mockReturnValueOnce(staleRead.promise);
		signInWithTwoCollectives();

		const { container } = render(Page);
		await waitReadyShowing(container, 'Ada');
		await saveNameToInitiateGateRead(container, 'Ada M.');

		selectedCollectiveDbStore.set('bravura');
		await waitReadyShowing(container, 'Bea');
		staleRead.reject(new Error('resolveGate: network down'));
		await flushMicrotasks();

		expect(consoleSpy).not.toHaveBeenCalled();
		expect(get(completionGateStore)).toBe('loading');
		consoleSpy.mockRestore();
	});
});

// (*MVOX:Tallis*)
