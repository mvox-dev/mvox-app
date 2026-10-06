// @vitest-environment happy-dom
import { render, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

beforeEach(editorTokenAtNow);

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const pageStub = vi.hoisted(() => ({
	params: { id: 'ev1' } as Record<string, string>,
	url: new URL('http://localhost/event/ev1')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

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
vi.mock('$lib/problems/reportProblem', async () =>
	(await import('$lib/testing/mocks/session')).reportProblemModule()
);

import Page from './+page.svelte';
import { reportProblem } from '$lib/testing/mocks/session';
import {
	cleanupRealTimersReset,
	editPosts,
	editorTokenAtNow,
	postedProps,
	seasonEntity,
	seriesEntity,
	setAuthedWithSampledb
} from '$lib/testing/pages/event';
import { flush } from '$lib/testing/pages/seasonEventCreate';
import { optionSet } from '$lib/testing/pages/dom';

const NEW_VENUE = 'Ürgoru laululava — sissepääs B!';

function eventEntity(over: Partial<Record<string, unknown>> = {}) {
	return {
		_id: 'ev1',
		name: [{ _id: 'val-name-1', string: 'Tuesday Rehearsal' }],
		event_type: [{ _id: 'val-type-1', string: 'rehearsal' }],
		start_datetime: [{ _id: 'val-start-1', datetime: '2026-09-01T16:00:00.000Z' }],
		duration_minutes: [{ _id: 'val-dur-1', number: 90 }],
		location: [{ _id: 'val-loc-1', string: 'Rehearsal Hall' }],
		description: [{ _id: 'val-desc-1', string: 'Come 15 minutes early.' }],
		capacity: [{ _id: 'val-cap-1', number: 20 }],
		_parent: [
			{ reference: 'season1', entity_type: 'season' },
			{ reference: 'series1', entity_type: 'event_series' }
		],
		_editor: [{ reference: 'p-viewer' }],
		...over
	};
}

function corpusEntities() {
	const mk = (id: string, location: string | null, dt: string) => ({
		_id: id,
		name: [{ string: `Event ${id}` }],
		start_datetime: [{ datetime: dt }],
		...(location === null ? {} : { location: [{ _id: `val-loc-${id}`, string: location }] }),
		_parent: [{ reference: 'season1', entity_type: 'season' }]
	});
	return [
		mk('evA', 'Hopneri Maja', '2026-09-08T16:00:00.000Z'),
		mk('evB', 'Estonia Hall', '2026-09-15T16:00:00.000Z'),
		mk('evC', 'Hopneri Maja', '2026-09-22T16:00:00.000Z'),
		mk('evD', 'Rehearsal Hall', '2026-09-29T16:00:00.000Z'),
		mk('evE', '', '2026-10-06T16:00:00.000Z'),
		mk('evF', null, '2026-10-13T16:00:00.000Z')
	];
}

const EXPECTED_SET = ['Estonia Hall', 'Hopneri Maja', 'Rehearsal Hall'];

function isCorpusUrl(url: string): boolean {
	return url.includes('entity?') && /[?&]_type\.string=event(?:&|$)/.test(url);
}

type WireOpts = {
	failCorpus?: boolean;
};

function wireStub(opts: WireOpts = {}) {
	const event: Record<string, unknown> = eventEntity();
	const season = seasonEntity();
	const series = seriesEntity();
	const corpusUrls: string[] = [];
	const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (method === 'GET' && isCorpusUrl(url)) {
			corpusUrls.push(url);
			return opts.failCorpus ? json({ message: 'boom' }, 500) : json({ entities: corpusEntities() });
		}
		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
		if (url.includes('/entity/ev1') && method === 'POST') {
			const props = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
			for (const prop of props) {
				const { type, ...valueParts } = prop;
				event[String(type)] = [{ _id: `val-${String(type)}-new`, ...valueParts }];
			}
			return json({});
		}
		if (url.includes('/entity/ev1')) return json({ entity: event });
		if (url.includes('/entity/season1')) return json({ entity: season });
		if (url.includes('/entity/series1')) return json({ entity: series });
		if (url.includes('_type.string=profile')) return json({ entities: [] });
		if (url.includes('_type.string=season')) return json({ entities: [season] });
		if (url.includes('_type.string=event_series')) return json({ entities: [series] });
		return json({ entities: [] });
	});
	return { stub, corpusUrls };
}

function renderDetail(opts: WireOpts = {}) {
	const { stub, corpusUrls } = wireStub(opts);
	vi.stubGlobal('fetch', stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithSampledb();
	const rendered = render(Page);
	return { ...rendered, fetchStub: stub, corpusUrls };
}

afterEach(cleanupRealTimersReset);

async function detailReady(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(container.querySelector('[data-testid="event-detail-location"]')).not.toBeNull();
	});
}

async function beginLocationEdit(container: HTMLElement): Promise<HTMLInputElement> {
	await waitFor(() => {
		expect(container.querySelector('[data-testid="event-edit-btn-location"]')).not.toBeNull();
	});
	await fireEvent.click(container.querySelector('[data-testid="event-edit-btn-location"]')!);
	return await waitFor(() => {
		const el = container.querySelector('[data-testid="event-edit-input-location"]');
		expect(el, 'event-edit-input-location missing after tapping edit').not.toBeNull();
		return el as HTMLInputElement;
	});
}

function resolveDatalist(input: HTMLInputElement): HTMLElement {
	const listId = input.getAttribute('list');
	expect(listId, 'event-edit-input-location must carry list=').toBeTruthy();
	const dl = document.querySelector(`datalist[id="${listId}"]`);
	expect(dl, `<datalist id="${listId}"> must exist in the page`).not.toBeNull();
	return dl as HTMLElement;
}

describe('#248 — detail-route location suggestions load LAZILY (PO ruling c)', () => {
	it('page load/render fires NO corpus request; the FIRST focus fires exactly ONE, whose projection includes location; the datalist then offers the deduped set', async () => {
		const { container, corpusUrls } = renderDetail();
		await detailReady(container);
		await flush();
		expect(corpusUrls).toEqual([]);

		const input = await beginLocationEdit(container);
		await fireEvent.focus(input);
		await waitFor(() => {
			expect(corpusUrls.length).toBeGreaterThan(0);
		});
		await flush();
		expect(corpusUrls).toHaveLength(1);
		expect(corpusUrls[0]).toContain('props=');
		expect(corpusUrls[0]).toContain('location');

		await waitFor(() => {
			expect(optionSet(resolveDatalist(input))).toEqual(EXPECTED_SET);
		});
	});

	it('a SECOND focus does not re-fetch: cancel the edit, reopen, focus again — still exactly one corpus request, suggestions still offered', async () => {
		const { container, corpusUrls } = renderDetail();
		await detailReady(container);
		const first = await beginLocationEdit(container);
		await fireEvent.focus(first);
		await waitFor(() => {
			expect(corpusUrls).toHaveLength(1);
		});

		await fireEvent.keyDown(first, { key: 'Escape' });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-input-location"]')).toBeNull();
		});

		const second = await beginLocationEdit(container);
		await fireEvent.focus(second);
		await flush();
		expect(corpusUrls).toHaveLength(1);
		await waitFor(() => {
			expect(optionSet(resolveDatalist(second))).toEqual(EXPECTED_SET);
		});
	});
});

describe('#248 — corpus fetch failure degrades silently', () => {
	it('a 500 corpus answer surfaces NO error and NO suggestions; the input stays plain free text and the save path is untouched (byte-identical write)', async () => {
		reportProblem.mockReset();
		const { container, fetchStub, corpusUrls } = renderDetail({ failCorpus: true });
		await detailReady(container);
		const input = await beginLocationEdit(container);
		await fireEvent.focus(input);
		await waitFor(() => {
			expect(corpusUrls.length).toBeGreaterThan(0);
			expect(reportProblem.mock.calls).toEqual([
				[{ area: 'event', action: 'loading the location suggestions', error: expect.any(Error) }]
			]);
		});
		await flush();

		expect(container.querySelector('[data-testid="event-edit-error-location"]')).toBeNull();
		const listId = input.getAttribute('list');
		if (listId) {
			const dl = document.querySelector(`datalist[id="${listId}"]`);
			if (dl) expect(optionSet(dl as HTMLElement)).toEqual([]);
		}

		await fireEvent.input(input, { target: { value: NEW_VENUE } });
		await fireEvent.blur(input);
		await waitFor(() => {
			const posts = editPosts(fetchStub);
			expect(posts.length).toBeGreaterThan(0);
			expect(postedProps(posts[0])).toEqual([
				{ _id: 'val-loc-1', type: 'location', string: NEW_VENUE }
			]);
		});
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-location"]')?.textContent
			).toContain(NEW_VENUE);
		});
	});
});

describe('#248 — a brand-new venue saves exactly as typed even with suggestions loaded', () => {
	it('suggestion-mismatching input → ONE write POST, [{type: location, string: <byte-identical>}] — the pre-#248 wire shape, no extra writes, no warning', async () => {
		const { container, fetchStub } = renderDetail();
		await detailReady(container);
		const input = await beginLocationEdit(container);
		await fireEvent.focus(input);
		await waitFor(() => {
			expect(optionSet(resolveDatalist(input))).toEqual(EXPECTED_SET);
		});

		expect(input.required).toBe(false);
		expect(input.getAttribute('pattern')).toBeNull();
		expect(input.getAttribute('maxlength')).toBeNull();

		await fireEvent.input(input, { target: { value: NEW_VENUE } });
		expect(container.querySelector('[data-testid="event-edit-error-location"]')).toBeNull();
		await fireEvent.blur(input);

		await waitFor(() => {
			const posts = editPosts(fetchStub);
			expect(posts).toHaveLength(1);
			expect(postedProps(posts[0])).toEqual([
				{ _id: 'val-loc-1', type: 'location', string: NEW_VENUE }
			]);
		});
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-location"]')?.textContent
			).toContain(NEW_VENUE);
		});
		expect(container.querySelector('[data-testid="event-edit-error-location"]')).toBeNull();
	});
});

// (*MVOX:Tallis*)
