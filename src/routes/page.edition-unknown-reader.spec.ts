// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkRow } from '$lib/repertoire/types';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket')
);

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).worksModule(await importOriginal())
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('list')
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule({ lists: 'bare' })
);

import Page from './+page.svelte';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import {
	listMyRsvpsMock,
	loadFullAgendaMock,
	loadWorksByEventIdMock
} from '$lib/testing/moduleHandles';
import { workRowOf } from '$lib/testing/pages/eventEdition';
import { agendaEvent } from '$lib/testing/pages/agendaWorks';

function setAuthedReader() {
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }, { db: 'orlando', name: 'Orlando', personId: 'person-p' }] });
}

function installAgenda() {
	loadFullAgendaMock.mockImplementation(async () =>
		fullAgendaResult(
			get(selectedCollectiveDbStore) === 'orlando'
				? {
						seasons: [],
						upcoming: [agendaEvent('or-ev', 'Orlando rehearsal')],
						recent: [],
						seasonId: 'season-or',
						seasonConductors: [],
						seasonOwners: [],
						seasonEditors: []
					}
				: {
						seasons: [],
						upcoming: [agendaEvent('pv-ev', 'Sampledb rehearsal')],
						recent: [],
						seasonId: 'season-1',
						seasonConductors: [],
						seasonOwners: [],
						seasonEditors: []
					}
		)
	);
}

function workRow(overrides: Partial<WorkRow> = {}): WorkRow {
	return {
		id: 'ri-1',
		kind: 'repertoire',
		workId: 'work-1',
		editionId: 'ed-9',
		workName: 'Old warhorse',
		composer: 'Anon.',
		status: 'active',
		editionName: '',
		ordinal: null,
		fileId: '',
		fileName: '',
		externalLinks: [],
		canBorrow: false,
		notes: '',
		truncated: true,
		...overrides
	};
}

function stubWire() {
	const fetchMock = vi.fn(
		async (_input: RequestInfo | URL, _init?: RequestInit) =>
			new Response(JSON.stringify({ entities: [] }))
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

async function renderExpandedAsReader(rowsByEvent: Record<string, WorkRow[]>) {
	loadWorksByEventIdMock.mockImplementation(async (cfg: { db: string }) =>
		cfg.db === 'orlando' ? { 'or-ev': [workRow({ id: 'ri-or' })] } : rowsByEvent
	);
	setAuthedReader();
	const rendered = render(Page);
	await waitFor(() => {
		expect(rendered.container.querySelector('[data-testid="works-line"]')).not.toBeNull();
	});
	await fireEvent.click(rendered.container.querySelector('[data-testid="works-line"]')!);
	await waitFor(() => {
		expect(rendered.container.querySelector('[data-testid="work-row"]')).not.toBeNull();
	});
	return rendered;
}

beforeEach(() => {
	resetTypeIdCache();
	installAgenda();
	listMyRsvpsMock.mockResolvedValue({ items: [], total: 0, truncated: false });
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadFullAgendaMock.mockReset();
	loadWorksByEventIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	resetAppState();
});

describe('#331 agenda — a rights-less reader under a TRUNCATED edition read', () => {
	it('a pin the truncated read could not name says UNKNOWN, never "no pinned edition"', async () => {
		const fetchMock = stubWire();
		const { container } = await renderExpandedAsReader({ 'pv-ev': [workRow()] });
		const li = workRowOf(container, 'Old warhorse');

		const unknown = li.querySelector('[data-testid="work-edition-unknown"]');
		expect(unknown, 'work-edition-unknown on the reader\u2019s row').not.toBeNull();
		expect(unknown!.textContent).toContain('[repertoire_edition_unknown]');
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(li.textContent).not.toContain('[repertoire_no_edition]');

		expect(li.querySelector('[data-testid="work-edition-picker"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-manage-row"]')).toBeNull();

		expect(
			fetchMock.mock.calls.some((c) => String(c[0]).includes('_type.string=edition'))
		).toBe(false);
		expect(
			fetchMock.mock.calls.some((c) => String(c[0]).includes('_parent.reference=work-1'))
		).toBe(false);
	});

	it('a pin the read DID name keeps its name — under truncated and complete reads alike', async () => {
		stubWire();
		const { container } = await renderExpandedAsReader({
			'pv-ev': [
				workRow({ id: 'ri-named-t', editionName: 'Peters, 1904', truncated: true }),
				workRow({
					id: 'ri-named-c',
					workId: 'work-2',
					workName: 'Mass in B minor',
					editionName: 'Bärenreiter BA 5103',
					truncated: false
				})
			]
		});

		const truncatedRow = workRowOf(container, 'Old warhorse');
		expect(truncatedRow.querySelector('[data-testid="work-edition"]')!.textContent).toContain(
			'Peters, 1904'
		);
		expect(truncatedRow.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();

		const completeRow = workRowOf(container, 'Mass in B minor');
		expect(completeRow.querySelector('[data-testid="work-edition"]')!.textContent).toContain(
			'Bärenreiter BA 5103'
		);
		expect(completeRow.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
	});
});

describe('#331 agenda — the reader\'s COMPLETE read keeps every stated fact', () => {
	it('nothing pinned, read complete → "no pinned edition", byte-identical to today', async () => {
		stubWire();
		const { container } = await renderExpandedAsReader({
			'pv-ev': [workRow({ editionId: '', truncated: false })]
		});
		const li = workRowOf(container, 'Old warhorse');
		const noEdition = li.querySelector('[data-testid="work-no-edition"]');
		expect(noEdition, 'work-no-edition').not.toBeNull();
		expect(noEdition!.textContent).toContain('[repertoire_no_edition]');
		expect(li.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
	});

	it('a DANGLING pin under a complete read is still a pin — unknown wording, not a claim of absence (#331 item 4)', async () => {
		stubWire();
		const { container } = await renderExpandedAsReader({
			'pv-ev': [workRow({ truncated: undefined })]
		});
		const li = workRowOf(container, 'Old warhorse');
		const unknown = li.querySelector('[data-testid="work-edition-unknown"]');
		expect(unknown, 'work-edition-unknown on the reader\u2019s row').not.toBeNull();
		expect(unknown!.textContent).toContain('[repertoire_edition_unknown_pinned]');
		expect(li.textContent).not.toContain('[repertoire_edition_unknown]');
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(li.textContent).not.toContain('[repertoire_no_edition]');
	});
});

describe('#331 agenda — a collective switch carries no stale unknown state across', () => {
	it('truncated rows left behind never caption the next collective\'s complete rows', async () => {
		stubWire();
		loadWorksByEventIdMock.mockImplementation(async (cfg: { db: string }) =>
			cfg.db === 'orlando'
				? {
						'or-ev': [
							workRow({
								id: 'ri-or',
								workId: 'work-or',
								workName: 'Fresh piece',
								editionName: 'Carus 40.688',
								truncated: false
							})
						]
					}
				: { 'pv-ev': [workRow()] }
		);
		setAuthedReader();
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="works-line"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="work-row"]')).not.toBeNull();
		});

		selectedCollectiveDbStore.set('orlando');
		await waitFor(() => {
			expect(container.textContent).toContain('Fresh piece');
		});
		if (container.querySelector('[data-testid="work-row"]') === null) {
			await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);
		}
		await waitFor(() => {
			expect(
				workRowOf(container, 'Fresh piece').querySelector('[data-testid="work-edition"]')
			).not.toBeNull();
		});

		expect(
			workRowOf(container, 'Fresh piece').querySelector('[data-testid="work-edition"]')!
				.textContent
		).toContain('Carus 40.688');
		expect(container.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		expect(container.textContent).not.toContain('[repertoire_edition_unknown]');
		expect(container.textContent).not.toContain('Old warhorse');
	});
});

// (*MVOX:Tallis* — #331 RED)
