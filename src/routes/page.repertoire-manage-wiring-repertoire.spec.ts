// @vitest-environment happy-dom
// The agenda page wires repertoire management to the data layer.
import { fireEvent } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { setAuthedWithOneCollective } from '$lib/testing/pages/roster';
import {
	installWorld,
	postsTo,
	renderAndExpand,
	RI_ACTIVE,
	useRepertoireWiringPage
} from '$lib/testing/pages/repertoireWiring';

useRepertoireWiringPage();

function rowStatus(container: HTMLElement, workName: string): string | null {
	const li = Array.from(container.querySelectorAll('[data-testid="work-row"]')).find(
		(el) => el.querySelector('[data-testid="work-name"]')?.textContent?.trim() === workName
	);
	return li?.getAttribute('data-status') ?? null;
}

function rowEl(container: HTMLElement, workName: string): HTMLElement {
	const li = Array.from(container.querySelectorAll('[data-testid="work-row"]')).find(
		(el) => el.querySelector('[data-testid="work-name"]')?.textContent?.trim() === workName
	);
	if (!li) throw new Error(`no work-row for ${workName}`);
	return li as HTMLElement;
}

describe('+page — repertoire management wiring (#91 TR.3)', () => {
	it('a season editor SEES the management controls on the agenda row', async () => {
		installWorld({ seasonEditor: true });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-status-active"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="work-manage-add-work"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="work-manage-remove"]')).not.toBeNull();
	});

	it('a NON-editor sees the works read-only — no management controls anywhere', async () => {
		installWorld({ seasonEditor: false, eventEditor: false });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-row"]').length).toBeGreaterThan(0);
		});
		expect(container.querySelector('[data-testid="work-manage-row"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-manage-add-work"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-manage-add-programme"]')).toBeNull();
	});

	it('an editor reads the UNFILTERED repertoire, so a retired work is on screen and re-activatable', async () => {
		const fetchMock = installWorld({ seasonEditor: true });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-manage-row"]').length).toBe(2);
		});
		const retiredRow = rowEl(container, 'Old warhorse');
		expect(
			retiredRow.querySelector('[data-testid="work-status-retired"]')!.getAttribute('aria-pressed')
		).toBe('true');

		await fireEvent.click(retiredRow.querySelector('[data-testid="work-status-active"]')!);
		await vi.waitFor(() => {
			expect(postsTo(fetchMock, 'entity/ri-2').length).toBe(1);
		});
		expect(JSON.parse(String(postsTo(fetchMock, 'entity/ri-2')[0][1]!.body))).toEqual([
			{ _id: 'val-status', type: 'status', string: 'active' }
		]);
	});

	it('changing a status writes it through: value-id lookup, ONE atomic overwrite-POST carrying the old id (#264) — no DELETE round-trip', async () => {
		const fetchMock = installWorld({ seasonEditor: true });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-status-active"]')).not.toBeNull();
		});
		await fireEvent.click(rowEl(container, 'Spem in alium').querySelector('[data-testid="work-status-learning"]')!);

		await vi.waitFor(() => {
			expect(postsTo(fetchMock, 'entity/ri-1').length).toBe(1);
		});
		const urls = fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${String(url)}`);
		expect(urls).toContain('GET https://api.entu-test.invalid/sampledb/entity/ri-1?props=status');
		expect(urls).not.toContain('DELETE https://api.entu-test.invalid/sampledb/property/val-status');
		expect(JSON.parse(String(postsTo(fetchMock, 'entity/ri-1')[0][1]!.body))).toEqual([
			{ _id: 'val-status', type: 'status', string: 'learning' }
		]);
	});

	it('the status change lands OPTIMISTICALLY — the picker updates on tap, before any refetch', async () => {
		installWorld({ seasonEditor: true, repertoireItems: [RI_ACTIVE] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(rowStatus(container, 'Spem in alium')).toBe('active');
		});
		await fireEvent.click(container.querySelector('[data-testid="work-status-learning"]')!);
		expect(rowStatus(container, 'Spem in alium')).toBe('learning');
	});

	it('adding a work creates a repertoire_item under the SEASON, with NO explicit _sharing (#133: inherited from the domain-tier season parent)', async () => {
		const fetchMock = installWorld({ seasonEditor: true });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			const select = container.querySelector(
				'[data-testid="work-manage-add-work-select"]'
			) as HTMLSelectElement;
			expect(select?.querySelectorAll('option').length).toBe(2);
		});
		await fireEvent.change(container.querySelector('[data-testid="work-manage-add-work-select"]')!, {
			target: { value: 'work-3' }
		});
		await fireEvent.click(container.querySelector('[data-testid="work-manage-add-work-button"]')!);

		await vi.waitFor(() => {
			expect(postsTo(fetchMock, '/entity').filter(([url]) => String(url).endsWith('/entity')).length).toBe(1);
		});
		const create = postsTo(fetchMock, '/entity').find(([url]) => String(url).endsWith('/entity'))!;
		expect(JSON.parse(String(create[1]!.body))).toEqual([
			{ type: '_type', reference: 'type-1' },
			{ type: '_parent', reference: 'season-1' },
			{ type: 'work', reference: 'work-3' },
			{ type: 'status', string: 'active' }
		]);
	});

	it('issues NO per-entity rights probe — rights ride on the agenda read', async () => {
		const fetchMock = installWorld({ seasonEditor: true });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-status-active"]')).not.toBeNull();
		});
		const rightsProbes = fetchMock.mock.calls.filter(
			([url]) => String(url).includes('props=_owner,_editor') && !String(url).includes('/entity/person-p?')
		);
		expect(rightsProbes).toEqual([]);
	});

	it('an in-place write does NOT trigger a full agenda-works refetch', async () => {
		const fetchMock = installWorld({ seasonEditor: true, repertoireItems: [RI_ACTIVE] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-status-active"]')).not.toBeNull();
		});
		const worksReadsBefore = fetchMock.mock.calls.filter(([url]) =>
			String(url).includes('_type.string=work')
		).length;

		await fireEvent.click(container.querySelector('[data-testid="work-status-learning"]')!);
		await vi.waitFor(() => {
			expect(postsTo(fetchMock, 'entity/ri-1').length).toBe(1);
		});

		expect(
			fetchMock.mock.calls.filter(([url]) => String(url).includes('_type.string=work')).length
		).toBe(worksReadsBefore);
	});

	it('the status write is ONE atomic overwrite-POST carrying the old value id — no DELETE round-trip remains', async () => {
		const fetchMock = installWorld({ seasonEditor: true, repertoireItems: [RI_ACTIVE] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-status-active"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="work-status-learning"]')!);
		await vi.waitFor(() => {
			expect(postsTo(fetchMock, 'entity/ri-1').length).toBe(1);
		});
		const calls = fetchMock.mock.calls.map(
			([url, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${String(url)}`
		);
		expect(calls).not.toContain('DELETE https://api.entu-test.invalid/sampledb/property/val-status');
		expect(JSON.parse(String(postsTo(fetchMock, 'entity/ri-1')[0][1]!.body))).toEqual([
			{ _id: 'val-status', type: 'status', string: 'learning' }
		]);
	});

	it('a settling create does NOT clobber a still-in-flight status change', async () => {
		let releaseStatusPost: (() => void) | undefined;
		const statusPostLanded = new Promise<void>((resolve) => {
			releaseStatusPost = resolve;
		});
		const base = installWorld({ seasonEditor: true, repertoireItems: [RI_ACTIVE] });
		const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			if ((init?.method ?? 'GET') === 'POST' && url.endsWith('/entity/ri-1')) {
				await statusPostLanded;
			}
			return base(input, init);
		});
		vi.stubGlobal('fetch', fetchMock);
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-manage-add-work-select"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="work-status-learning"]')!);
		expect(rowStatus(container, 'Spem in alium')).toBe('learning');

		await fireEvent.change(container.querySelector('[data-testid="work-manage-add-work-select"]')!, {
			target: { value: 'work-3' }
		});
		await fireEvent.click(container.querySelector('[data-testid="work-manage-add-work-button"]')!);
		await vi.waitFor(() => {
			expect(
				fetchMock.mock.calls.filter(
					([url, init]) =>
						String(url).endsWith('/entity') && (init as RequestInit | undefined)?.method === 'POST'
				).length
			).toBe(1);
		});
		await vi.waitFor(() => {
			expect(
				fetchMock.mock.calls.filter(([url]) => String(url).includes('_type.string=repertoire_item'))
					.length
			).toBeGreaterThan(1);
		});

		expect(rowStatus(container, 'Spem in alium')).toBe('learning');
		releaseStatusPost!();
	});

	it('a removed work becomes pickable again without waiting for a page reload', async () => {
		installWorld({ seasonEditor: true, repertoireItems: [RI_ACTIVE] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		const optionCount = () =>
			container.querySelector('[data-testid="work-manage-add-work-select"]')?.querySelectorAll('option')
				.length ?? 0;

		await vi.waitFor(() => {
			expect(optionCount()).toBe(3);
		});
		await fireEvent.click(container.querySelector('[data-testid="work-manage-remove"]')!);
		await vi.waitFor(() => {
			expect(optionCount()).toBe(4);
		});
	});

	it('Remove on a repertoire row DELETEs the repertoire_item entity', async () => {
		const fetchMock = installWorld({ seasonEditor: true, repertoireItems: [RI_ACTIVE] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-manage-remove"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="work-manage-remove"]')!);

		await vi.waitFor(() => {
			const deletes = fetchMock.mock.calls.filter(
				([, init]) => (init as RequestInit | undefined)?.method === 'DELETE'
			);
			expect(deletes.map(([url]) => String(url))).toContain(
				'https://api.entu-test.invalid/sampledb/entity/ri-1'
			);
		});
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
