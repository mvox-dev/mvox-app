// @vitest-environment happy-dom
// /links writes are gated while offline, on the real page.
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/paraglide/messages', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

vi.mock('$lib/entu/request', async (importOriginal) =>
	(await import('$lib/testing/mocks/seasons')).entuRequestModule(importOriginal)
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
const pageStub = vi.hoisted(() => ({ url: new URL('https://dev.mvox.eu/links') }));
vi.mock('$app/state', () => ({ page: pageStub }));

import Page from './+page.svelte';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { adminStore } from '$lib/nav/adminStore';
import {
	goOffline,
	goOnline,
	settle,
	isWriteDisabled,
	expectVisibleReason,
	exerciseEveryEnabledControl
} from '$lib/testing/networkSignal';
import { signIn } from '$lib/testing/session';
import { entuFetchMock } from '$lib/testing/mocks/seasons';
import { REASON } from '$lib/testing/pages/event';
import { DB_ENTITY, TYPE_ID, cleanupClearResetAdminOnLine } from '$lib/testing/pages/links';
import { rowEls } from '$lib/testing/pages/dom';

function nonGetWireCalls(): string[] {
	return (entuFetchMock.mock.calls as Array<[string, string, string, RequestInit | undefined]>)
		.filter(([, , , init]) => (init?.method ?? 'GET').toUpperCase() !== 'GET')
		.map(([, path, , init]) => `${init?.method} ${String(path)}`);
}

function installWireRouter() {
	entuFetchMock.mockImplementation(
		(_db: string, path: string, _token: string, init?: RequestInit) => {
			const p = String(path);
			const method = init?.method ?? 'GET';
			if (method === 'DELETE') return Promise.resolve(json({ deleted: true }));
			if (method === 'POST') {
				if (/^\/?entity$/.test(p)) return Promise.resolve(json({ _id: 'l-new' }));
				return Promise.resolve(json({}));
			}
			if (p.includes('_type.string=database')) {
				return Promise.resolve(json({ entities: [{ _id: DB_ENTITY }] }));
			}
			if (p.includes('_type.string=entity') && p.includes('name.string=link')) {
				return Promise.resolve(json({ entities: [{ _id: TYPE_ID }] }));
			}
			if (p.includes('_type.string=link')) {
				return Promise.resolve(
					json({
						entities: [
							{
								_id: 'l-rec',
								name: [{ string: 'Salvestused' }],
								url: [{ string: 'https://f.io/GCkGMr5J' }],
								description: [{ string: 'Crede recordings' }],
								display_order: [{ number: 1 }]
							},
							{
								_id: 'l-scores',
								name: [{ string: 'Scores' }],
								url: [{ string: 'example.com/x' }],
								display_order: [{ number: 2 }]
							}
						]
					})
				);
			}
			if (/^\/?entity\/[^/?]+\?props=display_order/.test(p)) {
				const id = p.match(/entity\/([^/?]+)/)?.[1] ?? '';
				return Promise.resolve(json({ entity: { display_order: [{ _id: `pv-${id}` }] } }));
			}
			return Promise.resolve(json({ entities: [], entity: {} }));
		}
	);
}

beforeEach(() => {
	resetTypeIdCache();
	installWireRouter();
	signIn();
	adminStore.set('admin');
});

afterEach(cleanupClearResetAdminOnLine);

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderReadyOnline() {
	await goOnline();
	const utils = render(Page);
	await waitFor(() => {
		expect(rowEls(utils.container)).toHaveLength(2);
		expect(q(utils.container, 'links-add-submit')).not.toBeNull();
	});
	return utils;
}

function writeControls(container: HTMLElement): HTMLElement[] {
	return [
		q(container, 'links-add-submit') as HTMLElement,
		...Array.from(container.querySelectorAll<HTMLElement>('[data-testid="links-edit"]')),
		...Array.from(container.querySelectorAll<HTMLElement>('[data-testid="links-remove"]')),
		...Array.from(container.querySelectorAll<HTMLElement>('[data-testid="links-move-up"]')),
		...Array.from(container.querySelectorAll<HTMLElement>('[data-testid="links-move-down"]'))
	];
}

describe('/links — writes while offline (#434 slice 6 review F1)', () => {
	it('offline: every write control is disabled and the reason is visible once', async () => {
		const { container } = await renderReadyOnline();
		expect(writeControls(container).length).toBeGreaterThanOrEqual(7);
		await goOffline();

		await waitFor(() => {
			for (const c of writeControls(container)) {
				expect(isWriteDisabled(c), c.dataset.testid).toBe(true);
			}
		});
		expectVisibleReason(container, 'links-write-unavailable', REASON);
		expect(container.querySelectorAll('[data-testid="links-write-unavailable"]')).toHaveLength(1);
	});

	it('offline: a filled add form writes nothing and KEEPS the typed draft', async () => {
		const { container } = await renderReadyOnline();
		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'Uus link' } });
		await fireEvent.input(q(container, 'links-add-url')!, { target: { value: 'crede.ee/x' } });
		await goOffline();
		entuFetchMock.mockClear();

		await fireEvent.click(q(container, 'links-add-submit')!);
		await fireEvent.submit(q(container, 'links-add-form')!);
		await settle();

		expect(nonGetWireCalls()).toEqual([]);
		expect((q(container, 'links-add-name') as HTMLInputElement).value).toBe('Uus link');
		expect((q(container, 'links-add-url') as HTMLInputElement).value).toBe('crede.ee/x');
	});

	it('offline: an edit form open when the signal drops cannot save, and keeps its draft', async () => {
		const { container } = await renderReadyOnline();
		await fireEvent.click(container.querySelectorAll('[data-testid="links-edit"]')[0]);
		const nameInput = await waitFor(() => {
			const el = q(container, 'links-edit-name') as HTMLInputElement | null;
			expect(el).not.toBeNull();
			return el as HTMLInputElement;
		});
		await fireEvent.input(nameInput, { target: { value: 'Renamed' } });
		await goOffline();
		entuFetchMock.mockClear();

		expect(isWriteDisabled(q(container, 'links-edit-save')!)).toBe(true);
		await fireEvent.click(q(container, 'links-edit-save')!);
		await settle();

		expect(nonGetWireCalls()).toEqual([]);
		expect((q(container, 'links-edit-name') as HTMLInputElement).value).toBe('Renamed');
	});

	it('offline: operating every enabled control puts no non-GET on the wire', async () => {
		const { container } = await renderReadyOnline();
		await goOffline();
		await settle();
		entuFetchMock.mockClear();

		const touched = await exerciseEveryEnabledControl(container);

		expect(touched.length).toBeGreaterThan(2);
		expect(nonGetWireCalls()).toEqual([]);
	});

	it('back online: the controls enable again, the sentence goes, and an add writes', async () => {
		const { container } = await renderReadyOnline();
		await goOffline();
		await goOnline();

		await waitFor(() => {
			expect(isWriteDisabled(q(container, 'links-add-submit')!)).toBe(false);
		});
		expect(q(container, 'links-write-unavailable')).toBeNull();

		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'Uus link' } });
		await fireEvent.input(q(container, 'links-add-url')!, { target: { value: 'crede.ee/x' } });
		await fireEvent.click(q(container, 'links-add-submit')!);

		await waitFor(() => expect(nonGetWireCalls().length).toBeGreaterThan(0));
	});
});

// (*MVOX:Josquin*)
