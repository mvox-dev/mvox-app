// @vitest-environment happy-dom
// The event page wires programme management to the data layer (moved from the agenda, #921).
import { fireEvent } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';
vi.mock('$app/state', async () => (await import('$lib/testing/mocks/events')).appStateModule());
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import {
	installWorld,
	postsTo,
	renderEventWorks,
	useRepertoireWiringPage,
	type WorldOptions
} from '$lib/testing/pages/repertoireWiring';

useRepertoireWiringPage();

describe('/event/[id] — programme management wiring (#91 TR.3)', () => {
	const programItems = [
		{ _id: 'pi-a', name: [{ string: 'First' }], edition: [{ reference: 'ed-1' }], ordinal: [{ number: 0 }] },
		{ _id: 'pi-b', name: [{ string: 'Second' }], edition: [{ reference: 'ed-2' }], ordinal: [{ number: 1 }] }
	];

	it('MOVE UP writes BOTH sides of the swap — the displaced neighbour is renumbered too', async () => {
		const fetchMock = installWorld({ seasonEditor: false, eventEditor: true, programItems });
		const { container } = await renderEventWorks();

		await vi.waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-manage-move-up"]').length).toBe(2);
		});
		const ups = container.querySelectorAll('[data-testid="work-manage-move-up"]');
		await fireEvent.click(ups[1]); // move 'Second' above 'First'

		await vi.waitFor(() => {
			expect(postsTo(fetchMock, 'entity/pi-b').length).toBe(1);
			expect(postsTo(fetchMock, 'entity/pi-a').length).toBe(1);
		});
		expect(JSON.parse(String(postsTo(fetchMock, 'entity/pi-b')[0][1]!.body))).toEqual([
			{ _id: 'val-pi-b', type: 'ordinal', number: 0 }
		]);
		expect(JSON.parse(String(postsTo(fetchMock, 'entity/pi-a')[0][1]!.body))).toEqual([
			{ _id: 'val-pi-a', type: 'ordinal', number: 1 }
		]);
	});

	it('a reorder disables EVERY row in the programme, and a second move while it runs is a no-op', async () => {
		const threeItems = [
			...programItems,
			{
				_id: 'pi-c',
				name: [{ string: 'Third' }],
				edition: [{ reference: 'ed-1' }],
				ordinal: [{ number: 2 }]
			}
		];
		const fetchMock = installWorld({
			seasonEditor: false,
			eventEditor: true,
			programItems: threeItems
		});
		const { container } = await renderEventWorks();

		await vi.waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-manage-move-up"]').length).toBe(3);
		});
		await fireEvent.click(container.querySelectorAll('[data-testid="work-manage-move-up"]')[1]);

		const ups = [...container.querySelectorAll('[data-testid="work-manage-move-up"]')];
		expect(ups.every((btn) => (btn as HTMLButtonElement).disabled)).toBe(true);

		await fireEvent.click(ups[2]);
		await vi.waitFor(() => {
			expect(postsTo(fetchMock, 'entity/pi-b').length).toBe(1);
		});
		await vi.waitFor(() => {
			expect(postsTo(fetchMock, 'entity/pi-a').length).toBe(1);
		});
		expect(postsTo(fetchMock, 'entity/pi-c').length).toBe(0);
	});

	it('Remove on a programme row deletes the PROGRAM_ITEM — never the season repertoire entry', async () => {
		const fetchMock = installWorld({ seasonEditor: false, eventEditor: true, programItems });
		const { container } = await renderEventWorks();

		await vi.waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-manage-remove"]').length).toBe(2);
		});
		await fireEvent.click(container.querySelectorAll('[data-testid="work-manage-remove"]')[0]);

		await vi.waitFor(() => {
			const deletes = fetchMock.mock.calls
				.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')
				.map(([url]) => String(url));
			expect(deletes).toContain('https://api.entu-test.invalid/sampledb/entity/pi-a');
		});
		const deletes = fetchMock.mock.calls
			.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')
			.map(([url]) => String(url));
		expect(deletes.some((url) => url.includes('/entity/ri-'))).toBe(false);
	});

	it('an EVENT editor on an event with NO programme yet can still start one — the first program_item is creatable', async () => {
		const fetchMock = installWorld({ seasonEditor: false, eventEditor: true, programItems: [] });
		const { container } = await renderEventWorks();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-manage-add-programme"]')).not.toBeNull();
		});
		await fireEvent.change(
			container.querySelector('[data-testid="work-manage-add-programme-select"]')!,
			{ target: { value: 'ed-1' } }
		);
		await fireEvent.click(
			container.querySelector('[data-testid="work-manage-add-programme-button"]')!
		);

		await vi.waitFor(() => {
			expect(postsTo(fetchMock, '/entity').filter(([url]) => String(url).endsWith('/entity')).length).toBe(1);
		});
		const create = postsTo(fetchMock, '/entity').find(([url]) => String(url).endsWith('/entity'))!;
		expect(JSON.parse(String(create[1]!.body))).toEqual([
			{ type: '_type', reference: 'type-1' },
			{ type: '_parent', reference: 'ev-1' },
			{ type: 'edition', reference: 'ed-1' },
			{ type: 'ordinal', number: 0 }
		]);
	});

	it('an event-only editor gets NO repertoire row controls on the fallback rows (their ids are repertoire_item ids)', async () => {
		installWorld({ seasonEditor: false, eventEditor: true, programItems: [] });
		const { container } = await renderEventWorks();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-manage-add-programme"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="work-manage-row"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-manage-remove"]')).toBeNull();
	});
});

function installEditionlessWorld(options: WorldOptions = {}) {
	const base = installWorld(options);
	const wrapped = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (method === 'GET' && url.includes('_type.string=edition')) {
			return json({ entities: [] });
		}
		return base(input, init);
	});
	vi.stubGlobal('fetch', wrapped);
	return wrapped;
}

describe('#272 — event page: programme select + add link are conditionally shown', () => {
	it('the "Add to programme" button is ABSENT until an edition is selected, appears on selection, and is gone again after the add', async () => {
		const fetchMock = installWorld({ seasonEditor: false, eventEditor: true, programItems: [] });
		const { container } = await renderEventWorks();

		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-programme-select"]')
			).not.toBeNull();
		});
		expect(
			container.querySelector('[data-testid="work-manage-add-programme-button"]'),
			'nothing selected → the button must be absent (the old shape was disabled-but-present)'
		).toBeNull();

		await fireEvent.change(
			container.querySelector('[data-testid="work-manage-add-programme-select"]')!,
			{ target: { value: 'ed-1' } }
		);
		const button = container.querySelector(
			'[data-testid="work-manage-add-programme-button"]'
		) as HTMLButtonElement | null;
		expect(button, 'edition selected → the button appears').not.toBeNull();

		await fireEvent.click(button!);
		await vi.waitFor(() => {
			expect(
				postsTo(fetchMock, '/entity').filter(([url]) => String(url).endsWith('/entity')).length
			).toBe(1);
		});
		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-programme-button"]'),
				'post-add: selection reset → button hidden again'
			).toBeNull();
		});
	});

	it('an EVENT editor with NO programme yet and NOTHING pickable still gets the wrapper — select absent, button absent, the fallback works render un-crashed', async () => {
		installEditionlessWorld({ seasonEditor: false, eventEditor: true, programItems: [] });
		const { container } = await renderEventWorks();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-manage-add-programme"]')).not.toBeNull();
		});
		expect(
			container.querySelector('[data-testid="work-manage-add-programme-select"]'),
			'empty pickable list → a placeholder-only dropdown must not render'
		).toBeNull();
		expect(container.querySelector('[data-testid="work-manage-add-programme-button"]')).toBeNull();
		expect(container.querySelectorAll('[data-testid="work-row"]').length).toBeGreaterThan(0);
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
