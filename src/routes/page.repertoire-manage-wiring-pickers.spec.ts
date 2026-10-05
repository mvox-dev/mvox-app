// @vitest-environment happy-dom
// The agenda page work pickers: composer labels, hiding and truncated reads.
import { describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket')
);
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
	reExpandWorks,
	renderAndExpand,
	submitSeasonCreateAndEnterReload,
	useRepertoireWiringPage,
	type WorldOptions
} from '$lib/testing/pages/repertoireWiring';

useRepertoireWiringPage();

type WireWork = { _id: string; name?: Array<{ string: string }>; composer?: Array<{ string: string }> };

const DEFAULT_COMPOSER_WORKS: WireWork[] = [
	{
		_id: 'work-1',
		name: [{ string: 'Spem in alium' }],
		composer: [{ string: 'Thomas Tallis' }]
	},
	{ _id: 'work-2', name: [{ string: 'Old warhorse' }] },
	{
		_id: 'work-3',
		name: [{ string: 'Nunc dimittis' }],
		composer: [{ string: 'Rachmaninoff' }]
	}
];

function installComposerWorld(options: WorldOptions = {}, works: WireWork[] = DEFAULT_COMPOSER_WORKS) {
	const base = installWorld(options);
	const wrapped = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (method === 'GET' && url.includes('_type.string=work')) {
			return json({ entities: works });
		}
		if (method === 'GET' && url.includes('_type.string=edition')) {
			return json({
				entities: [
					{
						_id: 'ed-1',
						name: [{ string: '40-part original' }],
						_parent: [{ reference: 'work-1', entity_type: 'work' }]
					},
					{
						_id: 'ed-3',
						name: [{ string: 'Eulenburg' }],
						_parent: [{ reference: 'work-2', entity_type: 'work' }]
					}
				]
			});
		}
		return base(input, init);
	});
	vi.stubGlobal('fetch', wrapped);
	return wrapped;
}

describe('#204 — agenda page work pickers show composer', () => {
	it('the "Add work" select labels its options "Name - Composer"', async () => {
		installComposerWorld({ seasonEditor: true });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-manage-add-work-select"]')).not.toBeNull();
		});
		const select = container.querySelector(
			'[data-testid="work-manage-add-work-select"]'
		) as HTMLSelectElement;
		await vi.waitFor(() => {
			expect(select.querySelectorAll('option').length).toBe(2);
		});
		const labels = [...select.querySelectorAll('option')].map((o) => (o.textContent ?? '').trim());
		expect(labels).toEqual(['[repertoire_add_work_label]', 'Nunc dimittis - Rachmaninoff']);
	});

	it('the "Add to programme" edition picker labels read "Work - Composer — Edition"; a composerless work keeps its bare name', async () => {
		installComposerWorld({ seasonEditor: false, eventEditor: true, programItems: [] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-programme-select"]')
			).not.toBeNull();
		});
		const select = container.querySelector(
			'[data-testid="work-manage-add-programme-select"]'
		) as HTMLSelectElement;
		await vi.waitFor(() => {
			expect(select.querySelectorAll('option').length).toBe(3);
		});
		const labels = [...select.querySelectorAll('option')].map((o) => (o.textContent ?? '').trim());
		expect(labels).toEqual([
			'[repertoire_add_programme_label]',
			'Spem in alium - Thomas Tallis — 40-part original',
			'Old warhorse — Eulenburg'
		]);
	});

	it('an edition whose work has NO name on the wire falls back to the bare edition label — no leading " — "', async () => {
		installComposerWorld({ seasonEditor: false, eventEditor: true, programItems: [] }, [
			{
				_id: 'work-1',
				name: [{ string: 'Spem in alium' }],
				composer: [{ string: 'Thomas Tallis' }]
			},
			{ _id: 'work-2', composer: [{ string: '   ' }] }
		]);
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-programme-select"]')
			).not.toBeNull();
		});
		const select = container.querySelector(
			'[data-testid="work-manage-add-programme-select"]'
		) as HTMLSelectElement;
		await vi.waitFor(() => {
			expect(select.querySelectorAll('option').length).toBe(3);
		});
		const labels = [...select.querySelectorAll('option')].map((o) => (o.textContent ?? '').trim());
		expect(labels).toEqual([
			'[repertoire_add_programme_label]',
			'Spem in alium - Thomas Tallis — 40-part original',
			'Eulenburg'
		]);
	});
});

describe('#311 — the Add Work picker keys hiding off "nothing left to pick once loading COMPLETED SUCCESSFULLY"', () => {
	it('RELOAD resolving works-EMPTY: the select stays through the window, then hides once the load completes with nothing left to pick', async () => {
		const world = installReloadWorld({ seasonEditor: true, eventEditor: true, programItems: [] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			const select = container.querySelector('[data-testid="work-manage-add-work-select"]');
			expect(select).not.toBeNull();
			expect(select!.querySelector('option[value="work-3"]')).not.toBeNull();
		});

		await submitSeasonCreateAndEnterReload(container, world);
		await reExpandWorks(container);

		expect(
			container.querySelector('[data-testid="work-manage-add-work-select"]'),
			'reload in flight → the Add Work control the admin just saw must STAY on screen'
		).not.toBeNull();

		await world.releasePickerReads({ worksEmpty: true });
		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-work-select"]'),
				'loading COMPLETED with nothing left to pick → the select resolves to hidden'
			).toBeNull();
		});
		expect(container.querySelector('[data-testid="work-manage-add-work-button"]')).toBeNull();
		expect(container.querySelectorAll('[data-testid="work-row"]').length).toBeGreaterThan(0);
	});

	it('RELOAD resolving NON-empty: the select never vanishes — visible before, THROUGH the window, and after, with the real options', async () => {
		const world = installReloadWorld({ seasonEditor: true, eventEditor: true, programItems: [] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-work-select"]')
			).not.toBeNull();
		});

		await submitSeasonCreateAndEnterReload(container, world);
		await reExpandWorks(container);

		expect(
			container.querySelector('[data-testid="work-manage-add-work-select"]'),
			'a reload with a non-empty library must never make the control vanish and reappear'
		).not.toBeNull();

		await world.releasePickerReads();
		await vi.waitFor(() => {
			const select = container.querySelector(
				'[data-testid="work-manage-add-work-select"]'
			) as HTMLSelectElement | null;
			expect(select).not.toBeNull();
			expect(select!.querySelector('option[value="work-3"]')).not.toBeNull();
		});
	});

	it('RELOAD whose picker load FAILS: the select does NOT hide — "Empty pickers, not a broken page" stands, hiding requires a load that completed SUCCESSFULLY', async () => {
		const world = installReloadWorld({ seasonEditor: true, eventEditor: true, programItems: [] });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-work-select"]')
			).not.toBeNull();
		});

		await submitSeasonCreateAndEnterReload(container, world);
		await reExpandWorks(container);

		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await world.releasePickerReads({ fail: true });
		await new Promise((r) => setTimeout(r, 30));
		expect(errorSpy.mock.calls.map((call) => call[0])).toEqual(
			expect.arrayContaining([
				'repertoire pickers: loading the library works failed',
				'repertoire pickers: loading the library editions failed'
			])
		);
		errorSpy.mockRestore();
		expect(
			container.querySelector('[data-testid="work-manage-add-work-select"]'),
			'a FAILED load must never hide the control — no picker, no error, nothing anywhere is the bug'
		).not.toBeNull();
	});

	it('FIRST render with the picker load held: the select is ALREADY visible (safe default — deliberately asymmetric with the editions first-render guard), and hides only once the load completes empty', async () => {
		const world = installReloadWorld({ seasonEditor: true, eventEditor: true, programItems: [] });
		world.armPickerHold();
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(world.heldCount()).toBe(2);
		});
		expect(
			container.querySelector('[data-testid="work-manage-add-work-select"]'),
			'first render, load in flight → the works select renders (default is RENDER, not length > 0)'
		).not.toBeNull();

		await world.releasePickerReads({ worksEmpty: true });
		await vi.waitFor(() => {
			expect(
				container.querySelector('[data-testid="work-manage-add-work-select"]'),
				'the initial load completing to genuine emptiness hides it — same rule as the reload'
			).toBeNull();
		});
	});
});

describe('#321 review F2 — the agenda repertoire pickers state a truncated library read', () => {
	const WORK_OPTION = 'work-manage-add-work-partial-option';
	const PROGRAMME_OPTION = 'work-manage-add-programme-partial-option';

	function lastOption(container: HTMLElement, selectTestid: string): HTMLOptionElement {
		const select = container.querySelector(`[data-testid="${selectTestid}"]`) as HTMLSelectElement;
		expect(select, `expected [data-testid="${selectTestid}"]`).not.toBeNull();
		const options = Array.from(select.options);
		return options[options.length - 1];
	}

	it('a truncated WORK read puts the notice inside the Add-work select, as a trailing disabled option', async () => {
		installWorld({ workCount: 900 });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector(`[data-testid="${WORK_OPTION}"]`)).not.toBeNull();
		});
		const last = lastOption(container, 'work-manage-add-work-select');
		expect(last.getAttribute('data-testid')).toBe(WORK_OPTION);
		expect(last.disabled).toBe(true);
		expect(last.textContent?.trim()).toBe('[picker_partial_options_notice]');
		expect(
			Array.from(
				(container.querySelector('[data-testid="work-manage-add-work-select"]') as HTMLSelectElement)
					.options
			).some((o) => o.textContent?.includes('Nunc dimittis'))
		).toBe(true);
	});

	it('a truncated EDITION read raises it in the Add-to-programme select — and NOT in the works one', async () => {
		installWorld({ eventEditor: true, editionCount: 4000 });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();

		await vi.waitFor(() => {
			expect(container.querySelector(`[data-testid="${PROGRAMME_OPTION}"]`)).not.toBeNull();
		});
		expect(lastOption(container, 'work-manage-add-programme-select').disabled).toBe(true);
		expect(container.querySelector(`[data-testid="${WORK_OPTION}"]`)).toBeNull();
	});

	it('with both reads complete neither option is in the DOM', async () => {
		installWorld({ eventEditor: true });
		setAuthedWithOneCollective();
		const { container } = await renderAndExpand();
		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="work-manage-add-work-select"]')).not.toBeNull();
		});

		expect(container.querySelector(`[data-testid="${WORK_OPTION}"]`)).toBeNull();
		expect(container.querySelector(`[data-testid="${PROGRAMME_OPTION}"]`)).toBeNull();
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
