// @vitest-environment happy-dom
// The part link from the event page.
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { msgProxy } = vi.hoisted(() => ({
	msgProxy: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get: (_t, key) => (params?: Record<string, unknown>) =>
			params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));
vi.mock('$lib/paraglide/messages.js', () => ({ m: msgProxy }));
vi.mock('$lib/paraglide/messages', () => ({ m: msgProxy }));
vi.mock('$lib/paraglide/runtime', () => ({
	getLocale: () => 'en',
	setLocale: vi.fn(),
	locales: ['en', 'et', 'lv', 'uk'],
	overwriteGetLocale: vi.fn()
}));
vi.mock('$lib/paraglide/runtime.js', () => ({
	getLocale: () => 'en',
	setLocale: vi.fn(),
	locales: ['en', 'et', 'lv', 'uk'],
	overwriteGetLocale: vi.fn()
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
const pageStub = vi.hoisted(() => ({
	params: {} as Record<string, string>,
	url: new URL('http://localhost/')
}));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));
vi.mock('$lib/files/appLabelStore', () => ({
	getAppLabelStore: () => ({
		putLabel: async () => {},
		labelsFor: async () => new Map(),
		remove: async () => {}
	})
}));

import EventPage from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, hydrateCollectives } from '$lib/collectives/store';
import { flushReadCache, resetServedFromCache, setReadCacheFactory } from '$lib/entu/readCache';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';
import { json } from '$lib/testing/entuFetchKit';

let fakeByteStore: FakeByteStore;

const DB = 'sampledb';
const PERSON = 'person-1';
const IDENTITY = { db: DB, personId: PERSON };
const DB_ENTITY = 'db-entity-1';
const SEASON = 'season-1';
const EVENT = { id: 'ev-1', name: 'Tuesday rehearsal', start: '2026-10-06T15:00:00.000Z' };

const HELD_FILE = 'file-held';
const ABSENT_FILE = 'file-absent';
const HELD_WORK = 'Spem in alium';
const ABSENT_WORK = 'If ye love me';

const READ_AT = new Date('2026-09-28T07:05:00.000Z');
const LATER_SAME_DAY = new Date('2026-09-28T09:40:00.000Z');

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function urlOf(input: RequestInfo | URL): string {
	return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function pdfData() {
	return {
		bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
		filetype: 'application/pdf',
		sha256: 'sha-fixture'
	};
}

function eventEntity() {
	return {
		_id: EVENT.id,
		event_name: [{ string: EVENT.name }],
		event_type: [{ string: 'rehearsal' }],
		start_datetime: [{ datetime: EVENT.start }],
		duration_minutes: [{ number: 90 }],
		_parent: [{ reference: SEASON, entity_type: 'season' }]
	};
}

function onlineEntu() {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = urlOf(input);
		if (url.includes('_type.string=mvox_collective')) {
			return json(
				{ count: 1, entities: [{ _id: 'marker-1', name: [{ string: 'Sample Choir' }] }] },
				200,
				JSON_HEADERS
			);
		}
		if (url.includes('_type.string=database')) {
			return json({ count: 1, entities: [{ _id: DB_ENTITY }] }, 200, JSON_HEADERS);
		}
		if (url.includes(`entity/${EVENT.id}?`)) return json(
			{ entity: eventEntity() },
			200,
			JSON_HEADERS
		);
		if (url.includes(`entity/${SEASON}?`)) {
			return json({ entity: { _id: SEASON, name: [{ string: '2026/27' }] } }, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=program_item') && url.includes(`_parent.reference=${EVENT.id}`)) {
			return json({
				count: 2,
				entities: [
					{
						_id: 'pi-1',
						name: [{ string: HELD_WORK }],
						edition: [{ reference: 'ed-1' }],
						ordinal: [{ number: 1 }]
					},
					{
						_id: 'pi-2',
						name: [{ string: ABSENT_WORK }],
						edition: [{ reference: 'ed-2' }],
						ordinal: [{ number: 2 }]
					}
				]
			}, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=work&')) {
			return json({
				count: 2,
				entities: [
					{ _id: 'w-1', name: [{ string: HELD_WORK }], composer: [{ string: 'Thomas Tallis' }] },
					{ _id: 'w-2', name: [{ string: ABSENT_WORK }], composer: [{ string: 'Thomas Tallis' }] }
				]
			}, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=edition&')) {
			return json({
				count: 2,
				entities: [
					{
						_id: 'ed-1',
						name: [{ string: 'Vocal score' }],
						_parent: [{ reference: 'w-1', entity_type: 'work' }],
						file: [{ _id: HELD_FILE, filename: 'spem.pdf', filesize: 4, filetype: 'application/pdf' }]
					},
					{
						_id: 'ed-2',
						name: [{ string: 'Vocal score' }],
						_parent: [{ reference: 'w-2', entity_type: 'work' }],
						file: [
							{ _id: ABSENT_FILE, filename: 'ifye.pdf', filesize: 4, filetype: 'application/pdf' }
						]
					}
				]
			}, 200, JSON_HEADERS);
		}
		return json({ count: 0, entities: [] }, 200, JSON_HEADERS);
	});
}

function offlineEntu() {
	return vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
}

async function openEventPage() {
	pageStub.params = { id: EVENT.id };
	pageStub.url = new URL(`http://localhost/event/${EVENT.id}`);
	collectiveState.set({ status: 'loading' });
	await hydrateCollectives();
	return render(EventPage);
}

async function worksSettled(container: HTMLElement): Promise<Element> {
	return waitFor(
		() => {
			const works = container.querySelector('[data-testid="event-detail-works"]');
			expect(works, 'event-detail-works').not.toBeNull();
			expect(works!.textContent).toContain(HELD_WORK);
			expect(works!.textContent).toContain(ABSENT_WORK);
			expect(container.querySelector(`[data-testid="file-presence-${HELD_FILE}"]`)).not.toBeNull();
			expect(container.querySelector(`[data-testid="file-presence-${ABSENT_FILE}"]`)).not.toBeNull();
			return works!;
		},
		{ timeout: 4000 }
	);
}

function expectPartLink(container: HTMLElement, works: Element) {
	const link = container.querySelector(`[data-testid="part-link-${HELD_FILE}"]`);
	expect(link, `part-link-${HELD_FILE}`).not.toBeNull();
	expect(link!.tagName).toBe('A');
	expect(link!.getAttribute('href')).toBe(`/part/${HELD_FILE}?db=${DB}`);
	expect(link!.textContent?.trim()).toBe('[event_part_link]');
	expect(link!.getAttribute('aria-label')).toBe(
		`[event_part_link_aria_label ${JSON.stringify({ work: HELD_WORK })}]`
	);
	expect(works.contains(link)).toBe(true);
}

function expectNoLinkFor(container: HTMLElement, fileId: string) {
	expect(container.querySelector(`[data-testid="part-link-${fileId}"]`)).toBeNull();
	expect(container.querySelector(`a[href^="/part/${fileId}"]`)).toBeNull();
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'], now: READ_AT });
	setReadCacheFactory(new IDBFactory());
	vi.stubGlobal('indexedDB', new IDBFactory());
	fakeByteStore = createFakeByteStore();
	resetServedFromCache();
	localStorage.clear();
	setToken('tok-1');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { [DB]: PERSON },
		expMs: READ_AT.getTime() + 48 * 3_600_000
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	clearAll({ preserveProvider: false });
	setReadCacheFactory(undefined);
	collectiveState.set({ status: 'loading' });
});

describe('#434 slice 5 — the event page links a part that is on the device', () => {
	it('online: the held part links to /part/<fileId>; the part not on the device has no link', async () => {
		fakeByteStore.seed(IDENTITY, HELD_FILE, pdfData());
		vi.stubGlobal('fetch', onlineEntu());
		const { container } = await openEventPage();
		const works = await worksSettled(container);

		await waitFor(() => expectPartLink(container, works));
		expectNoLinkFor(container, ABSENT_FILE);
		expect(container.querySelectorAll('[data-testid^="part-link-"]').length).toBe(1);
		expect(container.querySelectorAll('[data-testid="work-link-pdf"]').length).toBe(1);
	});

	it('offline (after one online visit): the works list and the held part link are still there', async () => {
		fakeByteStore.seed(IDENTITY, HELD_FILE, pdfData());
		vi.stubGlobal('fetch', onlineEntu());
		const first = await openEventPage();
		await worksSettled(first.container);
		await flushReadCache();
		cleanup();

		vi.setSystemTime(LATER_SAME_DAY);
		vi.stubGlobal('fetch', offlineEntu());
		const { container } = await openEventPage();
		const works = await worksSettled(container);

		await waitFor(() => expectPartLink(container, works));
		expectNoLinkFor(container, ABSENT_FILE);
		expect(container.querySelectorAll('[data-testid^="part-link-"]').length).toBe(1);
	});

	it('online, nothing on the device: no part link at all', async () => {
		vi.stubGlobal('fetch', onlineEntu());
		const { container } = await openEventPage();
		await worksSettled(container);

		expectNoLinkFor(container, HELD_FILE);
		expectNoLinkFor(container, ABSENT_FILE);
		expect(container.querySelectorAll('[data-testid^="part-link-"]').length).toBe(0);
		expect(container.querySelectorAll('a[href^="/part/"]').length).toBe(0);
		expect(container.querySelectorAll('[data-testid="work-link-pdf"]').length).toBe(2);
	});

	it('offline, nothing on the device: the works list shows, and no part link (no dead link)', async () => {
		vi.stubGlobal('fetch', onlineEntu());
		const first = await openEventPage();
		await worksSettled(first.container);
		await flushReadCache();
		cleanup();

		vi.setSystemTime(LATER_SAME_DAY);
		vi.stubGlobal('fetch', offlineEntu());
		const { container } = await openEventPage();
		await worksSettled(container);

		expect(container.querySelectorAll('[data-testid^="part-link-"]').length).toBe(0);
		expect(container.querySelectorAll('a[href^="/part/"]').length).toBe(0);
	});

	it("another person's stored part does not link for this person", async () => {
		fakeByteStore.seed({ db: DB, personId: 'person-other' }, HELD_FILE, pdfData());
		vi.stubGlobal('fetch', onlineEntu());
		const { container } = await openEventPage();
		await worksSettled(container);

		expect(container.querySelectorAll('[data-testid^="part-link-"]').length).toBe(0);
	});
});

describe('#434 slice 5 — the part link message keys', () => {
	const locales = ['en', 'et', 'lv', 'uk'] as const;
	const keys = ['event_part_link', 'event_part_link_aria_label'] as const;

	function messages(locale: string): Record<string, unknown> {
		return JSON.parse(readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8'));
	}

	it('both keys exist, non-empty, in all four locales', () => {
		for (const locale of locales) {
			const msgs = messages(locale);
			for (const key of keys) {
				expect(typeof msgs[key], `${locale}.${key}`).toBe('string');
				expect((msgs[key] as string).trim(), `${locale}.${key}`).not.toBe('');
			}
		}
	});

	it('the aria label names the work in every locale', () => {
		for (const locale of locales) {
			expect(messages(locale)['event_part_link_aria_label'], locale).toContain('{work}');
		}
	});

	it('label in name: the visible text is inside the aria label, in every locale', () => {
		for (const locale of locales) {
			const visible = (messages(locale)['event_part_link'] as string).toLowerCase();
			const name = (messages(locale)['event_part_link_aria_label'] as string).toLowerCase();
			expect(name, locale).toContain(visible);
		}
	});

	it('et/lv/uk are translated, not copies of the English aria label', () => {
		const en = messages('en')['event_part_link_aria_label'];
		for (const locale of ['et', 'lv', 'uk'] as const) {
			expect(messages(locale)['event_part_link_aria_label'], locale).not.toBe(en);
		}
	});

	it("the key names pass #343's guard (no offline/cache/byte_store in a key)", () => {
		for (const key of keys) expect(key).not.toMatch(/offline|cache|byte_store|bytestore/i);
	});
});

// (*MVOX:Tallis*)
