// @vitest-environment happy-dom
// The agenda page wires programme management to the data layer.
import { fireEvent } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';
vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { setAuthedWithOneCollective } from '$lib/testing/pages/roster';
import {
	installReloadWorld,
	installWorld,
	postsTo,
	reExpandWorks,
	renderAndExpand,
	submitSeasonCreateAndEnterReload,
	useRepertoireWiringPage,
	type WorldOptions
} from '$lib/testing/pages/repertoireWiring';

useRepertoireWiringPage();

describe('+page — programme management wiring (#91 TR.3)', () => {
	const programItems = [
		{ _id: 'pi-a', name: [{ string: 'First' }], edition: [{ reference: 'ed-1' }], ordinal: [{ number: 0 }] },
		{ _id: 'pi-b', name: [{ string: 'Second' }], edition: [{ reference: 'ed-2' }], ordinal: [{ number: 1 }] }
	];

	it('MOVE UP writes BOTH sides of the swap — the displaced neighbour is renumbered too', async () => {
		const fetchMock = installWorld({ seasonEditor: false, eventEditor: true, programItems });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

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
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

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
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

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
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

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
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

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

describe('#272 — agenda page: programme select + add link are conditionally shown', () => {
	it('the "Add to programme" button is ABSENT until an edition is selected, appears on selection, and is gone again after the add', async () => {
		const fetchMock = installWorld({ seasonEditor: false, eventEditor: true, programItems: [] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

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
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

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

describe('#288 item 1 — the programme control keys visibility off "no options once loading has COMPLETED", not "no options right now"', () => {
	it('RELOAD, resolving non-empty: the select the admin just saw does NOT vanish while the picker refill is in flight, and still shows once it lands', async () => {
		const world = installReloadWorld({ seasonEditor: true, eventEditor: true, programItems: [] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-programme-select"]')
			).not.toBeNull();
		});

		await submitSeasonCreateAndEnterReload(container, world);
		await reExpandWorks(container);

		expect(
			container.querySelector('[data-testid="work-manage-add-programme-select"]'),
			'reload in flight → the control the admin just saw must STAY on screen (PO ruling: ' +
				'visibility keys off "no options once loading has COMPLETED", never off a ' +
				'still-loading list being transiently empty)'
		).not.toBeNull();

		await world.releasePickerReads();
		await vi.waitFor(() => {
			const select = container.querySelector(
				'[data-testid="work-manage-add-programme-select"]'
			) as HTMLSelectElement | null;
			expect(select).not.toBeNull();
			expect(select!.querySelector('option[value="ed-1"]')).not.toBeNull();
		});
	});

	it('RELOAD, resolving EMPTY: the select stays through the window, then hides on actual emptiness — loaded-and-empty still means no chooser', async () => {
		const world = installReloadWorld({ seasonEditor: true, eventEditor: true, programItems: [] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-programme-select"]')
			).not.toBeNull();
		});

		await submitSeasonCreateAndEnterReload(container, world);
		await reExpandWorks(container);

		expect(
			container.querySelector('[data-testid="work-manage-add-programme-select"]'),
			'reload in flight → the control must STAY visible until loading has COMPLETED'
		).not.toBeNull();

		await world.releasePickerReads({ editionsEmpty: true });
		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-programme-select"]'),
				'loading COMPLETED with no options → the select resolves to hidden'
			).toBeNull();
		});
		expect(container.querySelector('[data-testid="work-manage-add-programme"]')).not.toBeNull();
		expect(container.querySelectorAll('[data-testid="work-row"]').length).toBeGreaterThan(0);
	});

	it('RELOAD with the PICKERS settling FIRST: the select survives the ROW load too — gating on the picker read alone only MOVES the vanish window (#288 review F1)', async () => {
		const world = installReloadWorld({ seasonEditor: true, eventEditor: true, programItems: [] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-programme-select"]')
			).not.toBeNull();
		});

		await submitSeasonCreateAndEnterReload(container, world, { holdRows: true });

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="works-manage-empty"]')).not.toBeNull();
		});
		expect(
			container.querySelector('[data-testid="work-manage-add-programme-select"]'),
			'both sources in flight → the control must STAY on screen'
		).not.toBeNull();

		await world.releasePickerReads();
		await vi.waitFor(() => {
			const addWork = container.querySelector('[data-testid="work-manage-add-work-select"]');
			expect(addWork).not.toBeNull();
			expect(addWork!.querySelector('option[value="work-3"]')).not.toBeNull();
		});
		expect(
			world.rowHeldCount(),
			'the row read must still be in flight here, or this spec pins nothing'
		).toBe(1);

		expect(
			container.querySelector('[data-testid="work-manage-add-programme-select"]'),
			'pickers SETTLED but the row read still in flight → `pickableEditionsByEventId` has no ' +
				'entry for this event yet (it is keyed off `worksByEventId`), so the decision is not ' +
				'decidable and the control must STILL be on screen. Gating the sticky effect on ' +
				'`libraryPickersLoading` alone recomputes an empty map here and wipes it for the ' +
				'whole remaining duration of the row load — the same visible→hidden→visible flip, ' +
				'just moved to the other read.'
		).not.toBeNull();

		await world.releaseRowReads();
		await reExpandWorks(container);
		const select = container.querySelector(
			'[data-testid="work-manage-add-programme-select"]'
		) as HTMLSelectElement | null;
		expect(select).not.toBeNull();
		expect(select!.querySelector('option[value="ed-1"]')).not.toBeNull();
		expect(container.querySelectorAll('[data-testid="work-row"]').length).toBeGreaterThan(0);
	});

	it('FIRST render guard (unchanged by #288): while the initial picker load is in flight the select is NOT yet shown — no placeholder-only flash — and appears once it lands', async () => {
		const world = installReloadWorld({ seasonEditor: true, eventEditor: true, programItems: [] });
		world.armPickerHold();
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-manage-add-programme"]')).not.toBeNull();
		});
		await vi.waitFor(() => {
			expect(world.heldCount()).toBe(2);
		});
		expect(
			container.querySelector('[data-testid="work-manage-add-programme-select"]'),
			'first render, picker load in flight → nothing was ever visible, so nothing shows yet'
		).toBeNull();

		await world.releasePickerReads();
		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-programme-select"]')
			).not.toBeNull();
		});
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
