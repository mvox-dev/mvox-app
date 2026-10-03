// @vitest-environment happy-dom
// The agenda's program reader says unknown when the edition read was partial.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket')
);

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
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
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { listMyRsvpsMock, loadFullAgendaMock } from '$lib/testing/moduleHandles';

const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

function setAuthedReader() {
	signIn();
}

function installAgenda() {
	loadFullAgendaMock.mockImplementation(async () =>
		fullAgendaResult({
			seasons: [],
			upcoming: [
				{
					id: 'pv-ev',
					name: 'Season Concert',
					startDatetime: future,
					durationMinutes: 90,
					location: '',
					conductors: [],
					owners: [],
					editors: []
				}
			],
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [],
			seasonOwners: [],
			seasonEditors: []
		})
	);
}

const PROGRAM_ITEMS = [
	{
		_id: 'pi-2',
		name: [{ string: 'Ghost piece' }],
		edition: [{ reference: 'ed-9' }],
		ordinal: [{ number: 1 }]
	}
];

function wireStub(opts: { editionCount?: number } = {}) {
	const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (method !== 'GET') return json({ _id: 'new-1' });
		if (url.includes('_type.string=program_item')) return json({ entities: PROGRAM_ITEMS });
		if (url.includes('_type.string=edition')) {
			return json({
				...(opts.editionCount === undefined ? {} : { count: opts.editionCount }),
				entities: [
					{
						_id: 'ed-1',
						name: [{ string: 'Bärenreiter BA 5103' }],
						_parent: [{ reference: 'w-2', entity_type: 'work' }]
					}
				]
			});
		}
		if (url.includes('_type.string=work'))
			return json({
				entities: [
					{ _id: 'w-2', name: [{ string: 'Mass in B minor' }], composer: [{ string: 'J. S. Bach' }] }
				]
			});
		return json({ entities: [] });
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function workRowOf(container: HTMLElement, workName: string): HTMLElement {
	const li = Array.from(container.querySelectorAll('[data-testid="work-row"]')).find(
		(el) => el.querySelector('[data-testid="work-name"]')?.textContent?.trim() === workName
	);
	expect(li, `work-row for ${workName}`).not.toBeUndefined();
	return li as HTMLElement;
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
	listMyRsvpsMock.mockReset();
	resetAppState();
});

describe('#337 agenda — a reader’s program row through the shared element', () => {
	it('a program row whose pin the truncated wire read could not name says UNKNOWN, never "no pinned edition"', async () => {
		wireStub({ editionCount: 4000 });
		setAuthedReader();
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="works-line"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="work-row"]')).not.toBeNull();
		});

		const li = workRowOf(container, 'Ghost piece');
		const unknown = li.querySelector('[data-testid="work-edition-unknown"]');
		expect(unknown, 'work-edition-unknown on the reader’s program row').not.toBeNull();
		expect(unknown!.textContent).toContain('[repertoire_edition_unknown]');
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(li.textContent).not.toContain('[repertoire_no_edition]');

		expect(li.querySelector('[data-testid="work-edition-picker"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-manage-row"]')).toBeNull();
	});
});

describe('#342 agenda — a reader’s program row, dangling pin under a COMPLETE read', () => {
	it('a program row pinned to an edition the complete read does not hold gets the dangling wording', async () => {
		wireStub();
		setAuthedReader();
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="works-line"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="work-row"]')).not.toBeNull();
		});

		const li = workRowOf(container, 'Ghost piece');
		const unknown = li.querySelector('[data-testid="work-edition-unknown"]');
		expect(unknown, 'work-edition-unknown on the reader’s program row').not.toBeNull();
		expect(unknown!.textContent).toContain('[repertoire_edition_unknown_pinned]');
		expect(li.textContent).not.toContain('[repertoire_edition_unknown]');
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(li.textContent).not.toContain('[repertoire_no_edition]');

		expect(li.querySelector('[data-testid="work-edition-picker"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-manage-row"]')).toBeNull();
	});
});

// (*MVOX:Tallis*)
