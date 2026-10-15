// Repertoire wiring specs on the event page (#921): the wire world and row helpers they share.
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';
import Page from '../../../routes/event/[id]/+page.svelte';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { resetAppState } from '$lib/testing/appReset';
import { pageStub } from '$lib/testing/mocks/events';
import { signIn } from '$lib/testing/session';

const EVENT_START = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

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

// The event ev-1 in season-1, its rights, the viewer's member record; anything else is empty.
export function eventPageWire(
	url: string,
	opts: { seasonEditor: boolean; eventEditor: boolean }
): Response {
	const grant = (on: boolean) => (on ? [{ reference: 'person-p' }] : []);
	if (url.includes('/entity/ev-1')) {
		return json({
			entity: {
				_id: 'ev-1',
				event_name: [{ string: 'Tuesday Rehearsal' }],
				start_datetime: [{ datetime: EVENT_START }],
				duration_minutes: [{ number: 90 }],
				_parent: [{ reference: 'season-1', entity_type: 'season' }],
				_editor: grant(opts.eventEditor)
			}
		});
	}
	if (url.includes('/entity/season-1')) {
		return json({
			entity: {
				_id: 'season-1',
				name: [{ string: '2026/27' }],
				start_date: [{ date: '2026-01-01' }],
				_editor: grant(opts.seasonEditor)
			}
		});
	}
	if (url.includes('_type.string=member') && url.includes('person.reference'))
		return json({ entities: [{ _id: 'member-1' }] });
	return json({ entities: [] });
}

export function installWorld(options: WorldOptions = {}) {
	const {
		seasonEditor = true,
		eventEditor = false,
		programItems = [],
		repertoireItems = [RI_ACTIVE, RI_RETIRED],
		workCount,
		editionCount
	} = options;

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
		return eventPageWire(url, { seasonEditor, eventEditor });
	});

	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

export async function renderEventWorks(ready = 'work-row') {
	pageStub.params = { id: 'ev-1' };
	pageStub.url = new URL('http://localhost/event/ev-1');
	signIn();
	const rendered = render(Page);
	await vi.waitFor(() => {
		expect(rendered.container.querySelector(`[data-testid="${ready}"]`)).not.toBeNull();
	});
	return rendered;
}

export function postsTo(fetchMock: ReturnType<typeof installWorld>, fragment: string) {
	return fetchMock.mock.calls.filter(
		([url, init]) =>
			String(url).includes(fragment) && (init as RequestInit | undefined)?.method === 'POST'
	);
}

export function useRepertoireWiringPage(): void {
	beforeEach(resetTypeIdCache);

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		resetAppState();
	});
}

// (*MVOX:Tallis*) (*MVOX:Josquin*)
