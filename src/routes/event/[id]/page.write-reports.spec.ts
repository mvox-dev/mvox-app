// @vitest-environment happy-dom
// #1049: each failed write on the event page (series, delete, convert) keeps one report,
// filed under the collective the write started in, and a late result never shows on the next.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const h = vi.hoisted(() => ({
	reassign: vi.fn(),
	unassign: vi.fn(),
	deleteEvent: vi.fn()
}));

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);
vi.mock('$app/state', () => ({
	page: { params: { id: 'ev1' }, url: new URL('http://localhost/event/ev1') }
}));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/files/appByteStore', async () =>
	(await import('$lib/testing/mocks/files')).fakeAppByteStoreModule()
);
vi.mock('$lib/events/eventSeriesActions', async (importOriginal) => ({
	...((await importOriginal()) as object),
	reassignEventSeries: h.reassign,
	unassignEventSeries: h.unassign
}));
vi.mock('$lib/seasons/seasonManage', async (importOriginal) => ({
	...((await importOriginal()) as object),
	deleteEvent: h.deleteEvent
}));
vi.mock('$lib/events/eventConvert', async (importOriginal) =>
	(await import('$lib/testing/mocks/events')).eventConvertModule(importOriginal)
);
vi.mock('$lib/entity/entityCreate', async () =>
	(await import('$lib/testing/mocks/events')).entityCreateModule()
);
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).entityIdModule(await importOriginal())
);

import Page from './+page.svelte';
import { AuthExpiredError } from '$lib/entu/auth-expired';
import { EventConvertError } from '$lib/events/eventConvert';
import { selectedCollectiveDbStore, selectedCollectiveIdentityStore } from '$lib/collectives/store';
import { deferred, json } from '$lib/testing/entuFetchKit';
import { keptProblems, useKeptProblems } from '$lib/testing/keptProblems';
import { convertEventToSeriesMock, createEventMock } from '$lib/testing/mocks/events';
import { resolveDatabaseEntityIdMock } from '$lib/testing/moduleHandles';
import { gotoMock } from '$lib/testing/routeMocks';
import { cleanupResetAllMocks, eventEntity, fakeDateAtNow, seasonEntity } from '$lib/testing/pages/event';
import { q } from '$lib/testing/pages/dom';
import { fill } from '$lib/testing/pages/seasonPanel';
import { signIn } from '$lib/testing/session';

useKeptProblems();

const A = { db: 'org-a', name: 'Org A', personId: 'p-viewer' };
const B = { db: 'org-b', name: 'Org B', personId: 'p-viewer' };
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

// B reuses A's ids, so a stale error keyed by id would show on B; only the names differ.
const suffix = (url: string) => (url.includes(`/${B.db}/`) ? ' B' : '');
const IN_SERIES = { _owner: [{ reference: 'p-viewer' }] };
const STANDALONE = {
	_owner: [{ reference: 'p-viewer' }],
	_parent: [{ reference: 'season1', entity_type: 'season' }]
};

function series(id: string, name: string) {
	return { _id: id, name: [{ string: name }], duration_minutes: [{ number: 90 }] };
}

function wire(event: Record<string, unknown>) {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if ((init?.method ?? 'GET') !== 'GET') throw new Error(`unexpected write ${url}`);
		const name = [{ _id: 'val-name-1', string: `Tuesday Rehearsal${suffix(url)}` }];
		if (url.includes('/entity/ev1')) return json({ entity: eventEntity({ ...event, event_name: name }) });
		if (url.includes('/entity/season1')) return json({ entity: seasonEntity() });
		if (url.includes('_type.string=event_series')) {
			return json({ entities: [series('series1', 'Tuesday Series'), series('series2', 'Friday Series')] });
		}
		return json({ entities: [] });
	});
}

beforeEach(() => {
	fakeDateAtNow();
	vi.spyOn(console, 'error').mockImplementation(() => {});
	signIn({ token: 'jwt-editor', collectives: [A, B], selected: A.db });
	h.reassign.mockResolvedValue(undefined);
	h.unassign.mockResolvedValue(undefined);
	h.deleteEvent.mockResolvedValue(undefined);
	convertEventToSeriesMock.mockResolvedValue({ seriesId: 'series-new', eventType: 'rehearsal' });
	createEventMock.mockResolvedValue('ev-new');
	resolveDatabaseEntityIdMock.mockResolvedValue('org-entity');
});

afterEach(cleanupResetAllMocks);

async function ready(c: HTMLElement, name: string): Promise<void> {
	await waitFor(() => expect(q(c, 'event-detail-name')?.textContent).toContain(name));
}

async function shown(c: HTMLElement, id: string): Promise<void> {
	await waitFor(() => expect(q(c, id)).not.toBeNull());
}

async function pickSeries(c: HTMLElement, id: string): Promise<void> {
	await shown(c, 'event-series-select');
	await fireEvent.change(q(c, 'event-series-select') as HTMLElement, { target: { value: id } });
}

async function armDelete(c: HTMLElement): Promise<void> {
	await shown(c, 'event-detail-delete');
	await fireEvent.click(q(c, 'event-detail-delete') as HTMLElement);
	await shown(c, 'event-detail-delete-confirm');
}

async function openConvert(c: HTMLElement): Promise<void> {
	await shown(c, 'event-detail-convert');
	await fireEvent.click(q(c, 'event-detail-convert') as HTMLElement);
	await shown(c, 'event-convert-form');
	await fill(c, 'event-convert-duration', '90');
	await fill(c, 'event-convert-end-date', '2026-09-30');
}

async function convert(c: HTMLElement): Promise<void> {
	await openConvert(c);
	await fireEvent.click(q(c, 'event-convert-submit') as HTMLElement);
}

const alerts = (c: HTMLElement) =>
	Array.from(c.querySelectorAll('[role="alert"]'), (el) => el.textContent?.trim());

interface Row {
	site: string;
	event: Record<string, unknown>;
	write: () => Mock;
	// 'null': the write's lookup answers with nothing instead of failing.
	outcome?: 'null';
	act: (c: HTMLElement) => Promise<void>;
	error: string;
	action: string;
	detail?: string;
	// Opens on B, before the late failure, the place the stale error would show.
	reveal?: (c: HTMLElement) => Promise<void>;
	revealed?: string;
}

const NO_DB_ENTITY = 'no database entity is visible in this collective';

const ROWS: Row[] = [
	{
		site: 'EventSeriesPicker: moving the event to another series',
		event: IN_SERIES,
		write: () => h.reassign,
		act: (c) => pickSeries(c, 'series2'),
		error: 'event-series-error',
		action: 'moving the event to another series'
	},
	{
		site: 'EventSeriesPicker: taking the event out of its series',
		event: IN_SERIES,
		write: () => h.unassign,
		act: (c) => pickSeries(c, ''),
		error: 'event-series-error',
		action: 'taking the event out of its series'
	},
	{
		site: 'EventDangerZone: deleting the event',
		event: IN_SERIES,
		write: () => h.deleteEvent,
		act: async (c) => {
			await armDelete(c);
			await fireEvent.click(q(c, 'event-detail-delete-confirm') as HTMLElement);
		},
		error: 'event-detail-delete-error',
		action: 'deleting the event',
		reveal: armDelete,
		revealed: 'event-detail-delete-confirm'
	},
	{
		site: 'EventConvertForm: the conversion write',
		event: STANDALONE,
		write: () => convertEventToSeriesMock,
		act: convert,
		error: 'event-convert-error',
		action: 'converting the event to a series',
		reveal: openConvert,
		revealed: 'event-convert-form'
	},
	{
		site: 'EventConvertForm: the database entity lookup throws',
		event: STANDALONE,
		write: () => resolveDatabaseEntityIdMock,
		act: convert,
		error: 'event-convert-error',
		action: 'resolving the database entity for converting the event to a series',
		reveal: openConvert,
		revealed: 'event-convert-form'
	},
	{
		site: 'EventConvertForm: no database entity is visible',
		event: STANDALONE,
		write: () => resolveDatabaseEntityIdMock,
		outcome: 'null',
		act: convert,
		error: 'event-convert-error',
		action: 'resolving the database entity for converting the event to a series',
		detail: NO_DB_ENTITY,
		reveal: openConvert,
		revealed: 'event-convert-form'
	},
	{
		site: 'EventConvertForm: generating an occurrence',
		event: STANDALONE,
		write: () => createEventMock,
		act: convert,
		error: 'event-convert-error',
		action: 'creating an occurrence of the converted series',
		reveal: openConvert,
		revealed: 'event-convert-form'
	}
];

const kept = (row: Row) => [{ area: 'event', action: row.action, detail: row.detail ?? 'Error: boom-a' }];

async function renderPage(event: Record<string, unknown>): Promise<HTMLElement> {
	vi.stubGlobal('fetch', wire(event));
	const { container } = render(Page);
	await ready(container, 'Tuesday Rehearsal');
	return container;
}

describe('/event — a failed write keeps one report (#1049)', () => {
	it.each(ROWS.map((row) => [row.site, row] as const))('%s', async (_, row) => {
		const c = await renderPage(row.event);
		row.write().mockImplementationOnce(() =>
			row.outcome === 'null' ? Promise.resolve(null) : Promise.reject(new Error('boom-a'))
		);

		await row.act(c);

		await shown(c, row.error);
		await waitFor(async () => expect(await keptProblems()).toEqual(kept(row)));
	});

	it.each(ROWS.map((row) => [row.site, row] as const))(
		'%s, settling after a switch: kept under the collective it started in, nothing on the new one',
		async (_, row) => {
			const held = deferred<null>();
			const c = await renderPage(row.event);
			// The load may read through the same mock (the database entity), so count from here.
			const before = row.write().mock.calls.length;
			row.write().mockImplementationOnce(() => held.promise);
			const identityA = get(selectedCollectiveIdentityStore);
			await row.act(c);
			await waitFor(() => expect(row.write()).toHaveBeenCalledTimes(before + 1));

			selectedCollectiveDbStore.set(B.db);
			await ready(c, 'Tuesday Rehearsal B');
			const identityB = get(selectedCollectiveIdentityStore);
			await row.reveal?.(c);
			const alertsOnB = alerts(c);
			if (row.outcome === 'null') held.resolve(null);
			else held.reject(new Error('boom-a'));
			await settle();

			expect(await keptProblems(identityA)).toEqual(kept(row));
			expect(await keptProblems(identityB)).toEqual([]);
			expect(q(c, row.error)).toBeNull();
			expect(alerts(c)).toEqual(alertsOnB);
			if (row.revealed) expect(q(c, row.revealed)).not.toBeNull();
		}
	);

	it('a delete for A that lands after a switch leaves B’s event page open', async () => {
		const held = deferred<void>();
		h.deleteEvent.mockImplementationOnce(() => held.promise);
		const c = await renderPage(IN_SERIES);
		await armDelete(c);
		await fireEvent.click(q(c, 'event-detail-delete-confirm') as HTMLElement);

		selectedCollectiveDbStore.set(B.db);
		await ready(c, 'Tuesday Rehearsal B');
		held.resolve();
		await settle();

		expect(gotoMock).not.toHaveBeenCalled();
		expect(q(c, 'event-detail-name')?.textContent).toContain('Tuesday Rehearsal B');
	});

	it('a conversion refused for a missing name shows its message and keeps nothing', async () => {
		convertEventToSeriesMock.mockRejectedValueOnce(
			new EventConvertError('read-event', 'no name', { reason: 'missing-name' })
		);
		const c = await renderPage(STANDALONE);

		await convert(c);

		await waitFor(() => expect(q(c, 'event-convert-error')?.textContent).toContain('event_convert_missing_name'));
		await settle();
		expect(await keptProblems()).toEqual([]);
	});

	it('a delete refused for an expired session shows its error and keeps nothing', async () => {
		h.deleteEvent.mockRejectedValueOnce(new AuthExpiredError());
		const c = await renderPage(IN_SERIES);

		await armDelete(c);
		await fireEvent.click(q(c, 'event-detail-delete-confirm') as HTMLElement);

		await shown(c, 'event-detail-delete-error');
		await settle();
		expect(await keptProblems()).toEqual([]);
	});

	it('a page that loads without failing keeps nothing', async () => {
		const c = await renderPage(IN_SERIES);

		await shown(c, 'event-series-select');
		await settle();
		expect(await keptProblems()).toEqual([]);
	});
});

// (*MVOX:Josquin*)
