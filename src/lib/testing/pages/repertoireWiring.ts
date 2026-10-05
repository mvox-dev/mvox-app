// Repertoire wiring specs: the wire worlds and row helpers their files share.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';
import Page from '../../../routes/+page.svelte';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { loadFullAgendaMock } from '$lib/testing/moduleHandles';
import { cleanupUnstubResetAgenda, upcoming } from '$lib/testing/pages/agendaWorks';

export interface WorldOptions {
	seasonEditor?: boolean;
	eventEditor?: boolean;
	programItems?: Array<Record<string, unknown>>;
	repertoireItems?: Array<Record<string, unknown>>;
	workCount?: number;
	editionCount?: number;
}

export const RI_ACTIVE = {
	_id: 'ri-1',
	name: [{ string: 'Spem in alium' }],
	work: [{ reference: 'work-1' }],
	edition: [{ reference: 'ed-1' }],
	status: [{ string: 'active' }]
};

export const RI_RETIRED = {
	_id: 'ri-2',
	name: [{ string: 'Old warhorse' }],
	work: [{ reference: 'work-2' }],
	status: [{ string: 'retired' }]
};

export function installWorld(options: WorldOptions = {}) {
	const {
		seasonEditor = true,
		eventEditor = false,
		programItems = [],
		repertoireItems = [RI_ACTIVE, RI_RETIRED],
		workCount,
		editionCount
	} = options;

	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
		upcoming: [{ ...upcoming[0], editors: eventEditor ? ['person-p'] : [] }],
		recent: [],
		seasonId: 'season-1',
		seasonConductors: [],
		seasonOwners: [],
		seasonEditors: seasonEditor ? ['person-p'] : []
	}));

	const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';

		if (method === 'DELETE') return json({ deleted: true });
		if (method === 'POST') return json({ _id: 'new-1' });

		if (url.includes('?props=status')) return json({ entity: { status: [{ _id: 'val-status' }] } });
		if (url.includes('?props=edition')) return json({ entity: { edition: [] } });
		if (url.includes('?props=ordinal')) {
			const itemId = url.split('/').pop()?.split('?')[0];
			return json({ entity: { ordinal: [{ _id: `val-${itemId}` }] } });
		}
		if (url.includes('_type.string=entity')) return json({ entities: [{ _id: 'type-1' }] });
		if (url.includes('_type.string=work')) {
			return json({
				...(workCount === undefined ? {} : { count: workCount }),
				entities: [
					{ _id: 'work-1', name: [{ string: 'Spem in alium' }] },
					{ _id: 'work-2', name: [{ string: 'Old warhorse' }] },
					{ _id: 'work-3', name: [{ string: 'Nunc dimittis' }] }
				]
			});
		}
		if (url.includes('_type.string=edition')) {
			return json({
				...(editionCount === undefined ? {} : { count: editionCount }),
				entities: [
					{
						_id: 'ed-1',
						name: [{ string: '40-part original' }],
						_parent: [{ reference: 'work-1', entity_type: 'work' }]
					},
					{
						_id: 'ed-2',
						name: [{ string: 'Bärenreiter' }],
						_parent: [{ reference: 'work-1', entity_type: 'work' }]
					}
				]
			});
		}
		if (url.includes('_type.string=copy')) return json({ entities: [] });
		if (url.includes('_type.string=program_item')) return json({ entities: programItems });
		if (url.includes('_type.string=repertoire_item')) return json({ entities: repertoireItems });

		return json({ error: `unrouted: ${url}` }, 404);
	});

	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

export async function renderAndExpand() {
	const rendered = render(Page);
	await vi.waitFor(() => {
		expect(rendered.container.querySelector('[data-testid="works-line"]')).not.toBeNull();
	});
	await fireEvent.click(rendered.container.querySelector('[data-testid="works-line"]')!);
	return rendered;
}

export function postsTo(fetchMock: ReturnType<typeof installWorld>, fragment: string) {
	return fetchMock.mock.calls.filter(
		([url, init]) =>
			String(url).includes(fragment) && (init as RequestInit | undefined)?.method === 'POST'
	);
}

export type HeldRead = { kind: 'work' | 'edition'; url: string; resolve: (r: Response) => void };

export function installReloadWorld(options: WorldOptions = {}) {
	const base = installWorld(options);
	const held: HeldRead[] = [];
	const heldRows: Array<{ url: string; resolve: (r: Response) => void }> = [];
	let armed = false;
	let heldWork = false;
	let heldEdition = false;
	let armedRows = false;
	let heldRow = false;
	const wrapped = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (method === 'GET' && url.includes('_type.string=database')) {
			return json({ entities: [{ _id: 'db-entity-1' }] });
		}
		if (armedRows && method === 'GET' && url.includes('_type.string=copy') && !heldRow) {
			heldRow = true;
			return new Promise<Response>((resolve) => heldRows.push({ url, resolve }));
		}
		if (armed && method === 'GET') {
			if (url.includes('_type.string=work') && !heldWork) {
				heldWork = true;
				return new Promise<Response>((resolve) => held.push({ kind: 'work', url, resolve }));
			}
			if (url.includes('_type.string=edition') && !heldEdition) {
				heldEdition = true;
				return new Promise<Response>((resolve) => held.push({ kind: 'edition', url, resolve }));
			}
		}
		return base(input, init);
	});
	vi.stubGlobal('fetch', wrapped);
	return {
		fetchMock: wrapped,
		armPickerHold() {
			armed = true;
			heldWork = false;
			heldEdition = false;
		},
		armRowHold() {
			armedRows = true;
			heldRow = false;
		},
		heldCount: () => held.length,
		rowHeldCount: () => heldRows.length,
		async releasePickerReads({ editionsEmpty = false, worksEmpty = false, fail = false } = {}) {
			armed = false;
			const toRelease = held.splice(0, held.length);
			for (const read of toRelease) {
				if (fail) {
					read.resolve(json({ error: 'boom' }, 500));
				} else if (editionsEmpty && read.kind === 'edition') {
					read.resolve(json({ entities: [] }));
				} else if (worksEmpty && read.kind === 'work') {
					read.resolve(json({ entities: [] }));
				} else {
					read.resolve(await base(read.url));
				}
			}
		},
		async releaseRowReads() {
			armedRows = false;
			const toRelease = heldRows.splice(0, heldRows.length);
			for (const read of toRelease) {
				read.resolve(await base(read.url));
			}
		}
	};
}

export async function submitSeasonCreateAndEnterReload(
	container: HTMLElement,
	world: ReturnType<typeof installReloadWorld>,
	{ holdRows = false }: { holdRows?: boolean } = {}
) {
	await fireEvent.click(container.querySelector('[data-testid="season-create"]')!);
	await vi.waitFor(() => {
		expect(container.querySelector('[data-testid="season-create-name"]')).not.toBeNull();
	});
	await fireEvent.input(container.querySelector('[data-testid="season-create-name"]')!, {
		target: { value: 'Autumn 2026' }
	});
	await fireEvent.input(container.querySelector('[data-testid="season-create-start"]')!, {
		target: { value: '2026-09-01' }
	});
	await fireEvent.input(container.querySelector('[data-testid="season-create-end"]')!, {
		target: { value: '2026-12-20' }
	});
	world.armPickerHold();
	if (holdRows) world.armRowHold();
	await fireEvent.click(container.querySelector('[data-testid="season-create-submit"]')!);
	await vi.waitFor(() => {
		expect(world.heldCount()).toBe(2);
	});
	if (holdRows) {
		await vi.waitFor(() => {
			expect(world.rowHeldCount()).toBe(1);
		});
	}
}

export async function reExpandWorks(container: HTMLElement) {
	await vi.waitFor(() => {
		expect(container.querySelector('[data-testid="works-line"]')).not.toBeNull();
	});
	await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);
	await vi.waitFor(() => {
		expect(container.querySelector('[data-testid="work-manage-add-programme"]')).not.toBeNull();
	});
}

export function useRepertoireWiringPage(): void {
	beforeEach(() => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		resetTypeIdCache();
	});

	afterEach(cleanupUnstubResetAgenda);
}

// (*MVOX:Tallis*) (*MVOX:Josquin*)
