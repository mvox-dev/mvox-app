// @vitest-environment happy-dom
// The event page's works section and its pickers.
import { waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/paraglide/runtime.js', async () =>
	(await import('$lib/testing/mocks/session')).localeRuntimeModule()
);
vi.mock('$app/state', async () => (await import('$lib/testing/mocks/events')).appStateModule());
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import {
	type ComposeFixtures,
	composeWireStub,
	eventEntity,
	libraryWorksFixture,
	renderComposePage,
	renderWithFetch,
	repertoireItemsFixture,
	seasonEntity,
	useEventPage
} from '$lib/testing/pages/eventDetail';

useEventPage();

function editorSeason(over: Partial<Record<string, unknown>> = {}) {
	return seasonEntity({ _editor: [{ reference: 'p-viewer' }], ...over });
}

function programItemsFixture(): unknown[] {
	return [
		{
			_id: 'pi-1',
			name: [{ string: 'Bogoróditse Djévo' }],
			edition: [{ reference: 'ed-1' }],
			ordinal: [{ number: 0 }]
		},
		{
			_id: 'pi-2',
			name: [{ string: 'Locus iste' }],
			edition: [{ reference: 'ed-2' }],
			ordinal: [{ number: 1 }]
		}
	];
}

describe('/event/[id] — works section (#103 TE.3: RepertoireElement, always expanded)', () => {
	it('renders the works section with the rows ALREADY expanded — work names + composers, no tap needed', async () => {
		const { container, fetchStub } = renderComposePage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-works"]')).not.toBeNull();
		});
		const section = container.querySelector('[data-testid="event-detail-works"]')!;

		expect(section.querySelector('[data-testid="works-expanded"]')).not.toBeNull();
		const rows = [...section.querySelectorAll('[data-testid="work-row"]')];
		expect(rows).toHaveLength(2);
		const text = rows.map((r) => r.textContent ?? '').join(' ');
		expect(text).toContain('Bogoróditse Djévo');
		expect(text).toContain('Locus iste');
		expect(text).toContain('Arvo Pärt');
		expect(text).toContain('Anton Bruckner');

		const line = section.querySelector('[data-testid="works-line"]');
		if (line) expect(line.getAttribute('aria-expanded')).toBe('true');

		const urls = fetchStub.mock.calls.map((c) => String(c[0]));
		expect(urls.some((u) => u.includes('_type.string=program_item') && u.includes('ev1'))).toBe(
			true
		);
		expect(
			urls.some((u) => u.includes('_type.string=repertoire_item') && u.includes('season1'))
		).toBe(true);
	});

	it('management controls render for a season rights-holder (_editor on the parent season)', async () => {
		const { container } = renderComposePage({ season: editorSeason() });
		await waitFor(() => {
			expect(
				container.querySelectorAll('[data-testid="work-row"]').length
			).toBeGreaterThan(0);
		});
		const section = container.querySelector('[data-testid="event-detail-works"]')!;
		expect(section.querySelectorAll('[data-testid="work-status-active"]')).toHaveLength(2);
		expect(section.querySelectorAll('[data-testid="work-manage-remove"]')).toHaveLength(2);
		expect(section.querySelector('[data-testid="work-manage-add-work"]')).not.toBeNull();
	});

	it('reads the event and the season ONCE each — no second GET for the parent id or for season rights', async () => {
		const { container, fetchStub } = renderComposePage({ season: editorSeason() });
		await waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-row"]').length).toBe(2);
		});
		const urls = fetchStub.mock.calls.map((c) => String(c[0]));
		expect(urls.filter((u) => u.includes('/entity/ev1'))).toHaveLength(1);
		expect(urls.filter((u) => u.includes('/entity/season1'))).toHaveLength(1);
	});

	it('a season editor sees the RETIRED rows too — includeInactive rides on the same read as the rights', async () => {
		const { container } = renderComposePage({
			season: editorSeason(),
			repertoireItems: [
				...repertoireItemsFixture(),
				{
					_id: 'ri-3',
					name: [{ string: 'Ave Maria' }],
					work: [{ reference: 'w-3' }],
					status: [{ string: 'retired' }]
				}
			],
			works: [
				...libraryWorksFixture(),
				{ _id: 'w-3', name: [{ string: 'Ave Maria' }], composer: [{ string: 'Josquin' }] }
			]
		});
		await waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-row"]').length).toBe(3);
		});
		expect(
			container.querySelector('[data-testid="event-detail-works"]')!.textContent
		).toContain('Ave Maria');
	});

	it('a plain member reads the works with NO management controls (default season: no rights visible)', async () => {
		const { container } = renderComposePage();
		await waitFor(() => {
			expect(
				container.querySelectorAll('[data-testid="work-row"]').length
			).toBeGreaterThan(0);
		});
		expect(container.querySelector('[data-testid="work-status-active"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-manage-remove"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-manage-add-work"]')).toBeNull();
	});

	it('NO works section at all when the event resolves no works — never an empty placeholder', async () => {
		const { container } = renderComposePage({ programItems: [], repertoireItems: [] });
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
			).toBe('true');
		});
		await new Promise((r) => setTimeout(r, 30));
		expect(container.querySelector('[data-testid="event-detail-works"]')).toBeNull();
		expect(container.querySelector('[data-testid="works-line"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-row"]')).toBeNull();
	});

	it('a PROGRAMMED event shows the PROGRAMME surface — per-row move/remove for an event editor, as on the agenda', async () => {
		const { container } = renderComposePage({
			event: eventEntity({ _editor: [{ reference: 'p-viewer' }] }),
			season: editorSeason(),
			programItems: programItemsFixture()
		});
		await waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-row"]').length).toBe(2);
		});
		const section = container.querySelector('[data-testid="event-detail-works"]')!;
		expect(section.querySelectorAll('[data-testid="work-manage-move-up"]')).toHaveLength(2);
		expect(section.querySelectorAll('[data-testid="work-manage-move-down"]')).toHaveLength(2);
		expect(section.querySelectorAll('[data-testid="work-manage-remove"]')).toHaveLength(2);
		expect(section.querySelector('[data-testid="work-manage-add-programme"]')).not.toBeNull();
		expect(section.querySelector('[data-testid="work-manage-add-work"]')).toBeNull();
		expect(section.querySelector('[data-testid="work-status-active"]')).toBeNull();
	});
});

describe('/event/[id] — #311: the Add Work picker keys hiding off "nothing left to pick once loading COMPLETED SUCCESSFULLY"', () => {
	function worksHoldStub(
		fixtures: ComposeFixtures = {},
		{ failWorks = false, armed = false }: { failWorks?: boolean; armed?: boolean } = {}
	) {
		const base = composeWireStub(fixtures);
		const held: Array<(r: Response) => void> = [];
		let holdArmed = armed;
		const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if ((init?.method ?? 'GET') === 'GET' && url.includes('_type.string=work')) {
				if (failWorks) return json({ error: 'boom' }, 500);
				if (holdArmed) return new Promise<Response>((resolve) => held.push(resolve));
			}
			return base(input, init);
		});
		return {
			stub,
			heldCount: () => held.length,
			async releaseWorkReads() {
				holdArmed = false;
				for (const resolve of held.splice(0, held.length)) {
					resolve(await base('https://api.entu-test.invalid/sampledb/search?_type.string=work'));
				}
			}
		};
	}

	it('load completes with every library work already in the repertoire → select and button GONE, wrapper and rows stand', async () => {
		const { container } = renderComposePage({ season: editorSeason() });
		await waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-row"]').length).toBe(2);
		});
		const section = container.querySelector('[data-testid="event-detail-works"]')!;
		await waitFor(() => {
			expect(section.querySelector('[data-testid="work-manage-add-work-select"]')).toBeNull();
		});
		expect(section.querySelector('[data-testid="work-manage-add-work-button"]')).toBeNull();
		expect(section.querySelector('[data-testid="work-manage-add-work"]')).not.toBeNull();
		expect(section.querySelectorAll('[data-testid="work-row"]').length).toBe(2);
	});

	it('while the picker load is IN FLIGHT the select stays (still loading is not empty), and settles to the real options', async () => {
		const world = worksHoldStub(
			{
				season: editorSeason(),
				works: [
					...libraryWorksFixture(),
					{ _id: 'w-3', name: [{ string: 'Ave Maria' }], composer: [{ string: 'Josquin' }] }
				]
			},
			{ armed: true }
		);
		const { container } = renderWithFetch(world.stub);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-works"]')).not.toBeNull();
		});
		await waitFor(() => {
			expect(world.heldCount()).toBeGreaterThan(0);
		});
		expect(
			container.querySelector('[data-testid="work-manage-add-work-select"]'),
			'picker load in flight → the select must not be withheld off a still-loading list'
		).not.toBeNull();

		await world.releaseWorkReads();
		await waitFor(() => {
			const select = container.querySelector(
				'[data-testid="work-manage-add-work-select"]'
			) as HTMLSelectElement | null;
			expect(select).not.toBeNull();
			expect(select!.querySelector('option[value="w-3"]')).not.toBeNull();
		});
	});

	it('the picker load FAILS → the select stays — the catch’s visible-but-empty choice stands, a failed load never hides', async () => {
		const world = worksHoldStub({ season: editorSeason() }, { failWorks: true });
		const { container } = renderWithFetch(world.stub);

		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
			).toBe('true');
		});
		await new Promise((r) => setTimeout(r, 30));
		const section = container.querySelector('[data-testid="event-detail-works"]');
		expect(section, 'the editor still gets the works section').not.toBeNull();
		expect(
			section!.querySelector('[data-testid="work-manage-add-work-select"]'),
			'a FAILED load must never hide the control'
		).not.toBeNull();
	});
});

describe('/event/[id] — the repertoire pickers state a truncated library read (#321 review F2)', () => {
	const WORK_OPTION = 'work-manage-add-work-partial-option';
	const PROGRAMME_OPTION = 'work-manage-add-programme-partial-option';

	function worksWithSomethingPickable(): unknown[] {
		return [
			...libraryWorksFixture(),
			{ _id: 'w-3', name: [{ string: 'Ave Maria' }], composer: [{ string: 'Josquin' }] }
		];
	}

	it('a truncated WORK read puts a trailing disabled option inside the Add-work select', async () => {
		const { container } = renderComposePage({
			season: editorSeason(),
			works: worksWithSomethingPickable(),
			workCount: 900
		});

		await waitFor(() => {
			expect(container.querySelector(`[data-testid="${WORK_OPTION}"]`)).not.toBeNull();
		});
		const select = container.querySelector(
			'[data-testid="work-manage-add-work-select"]'
		) as HTMLSelectElement;
		const options = Array.from(select.options);
		const last = options[options.length - 1];
		expect(last.getAttribute('data-testid')).toBe(WORK_OPTION);
		expect(last.disabled).toBe(true);
		expect(container.querySelector(`[data-testid="${PROGRAMME_OPTION}"]`)).toBeNull();
	});

	it('with the reads complete the option is ABSENT from the select', async () => {
		const { container } = renderComposePage({
			season: editorSeason(),
			works: worksWithSomethingPickable()
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="work-manage-add-work-select"]')).not.toBeNull();
		});

		expect(container.querySelector(`[data-testid="${WORK_OPTION}"]`)).toBeNull();
	});
});

describe('/event/[id] — "Add to programme" picker shows composer (#204)', () => {
	it('labels read "Work - Composer — Edition"; a composerless work keeps its bare name — no dangling " - "', async () => {
		const { container } = renderComposePage({
			event: eventEntity({ _editor: [{ reference: 'p-viewer' }] }),
			season: editorSeason(),
			programItems: programItemsFixture(),
			works: [
				{ _id: 'w-1', name: [{ string: 'Bogoróditse Djévo' }], composer: [{ string: 'Arvo Pärt' }] },
				{ _id: 'w-2', name: [{ string: 'Locus iste' }], composer: [{ string: 'Anton Bruckner' }] },
				{ _id: 'w-3', name: [{ string: 'Ubi caritas' }] }
			],
			editions: [
				{
					_id: 'ed-1',
					name: [{ string: 'Edition A' }],
					_parent: [{ reference: 'w-1', entity_type: 'work' }]
				},
				{
					_id: 'ed-2',
					name: [{ string: 'Edition B' }],
					_parent: [{ reference: 'w-2', entity_type: 'work' }]
				},
				{
					_id: 'ed-3',
					name: [{ string: 'Edition C' }],
					_parent: [{ reference: 'w-1', entity_type: 'work' }]
				},
				{
					_id: 'ed-4',
					name: [{ string: 'Edition D' }],
					_parent: [{ reference: 'w-3', entity_type: 'work' }]
				}
			]
		});

		await waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-row"]').length).toBe(2);
			const sel = container.querySelector(
				'[data-testid="work-manage-add-programme-select"]'
			) as HTMLSelectElement | null;
			expect(sel).not.toBeNull();
			expect(sel!.querySelectorAll('option').length).toBe(3);
		});
		const select = container.querySelector(
			'[data-testid="work-manage-add-programme-select"]'
		) as HTMLSelectElement;
		const labels = [...select.querySelectorAll('option')]
			.filter((o) => (o as HTMLOptionElement).value !== '')
			.map((o) => (o.textContent ?? '').trim());
		expect(labels).toEqual([
			'Bogoróditse Djévo - Arvo Pärt — Edition C',
			'Ubi caritas — Edition D'
		]);
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
