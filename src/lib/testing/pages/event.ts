// Event page harness (no page import): the setup its specs had word for word.
import { cleanup } from '@testing-library/svelte';
import { IDBFactory } from 'fake-indexeddb';
import { vi } from 'vitest';
import { authStore } from '$lib/auth/session';
import { setToken } from '$lib/auth/storage';
import { resetServedFromCache, setReadCacheFactory } from '$lib/entu/readCache';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { resetAppState } from '$lib/testing/appReset';
import { testCfg } from '$lib/testing/entuFetchKit';
import { signIn } from '$lib/testing/session';

// Before the fixture event (2026-09-01), so it is upcoming; only Date is faked.
export const NOW = new Date('2026-08-20T10:00:00.000Z');
export { LOCALES } from './profile';
export const cfg = testCfg('sampledb');

export function isoAt(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString();
}

export const PROFILES: Record<string, unknown[]> = {
	'p-mihkel': [
		{ _id: 'prof-m', name: [{ string: 'Mihkel Putrinš' }], _sharing: [{ string: 'domain' }] }
	]
};

export const EDITABLE_FIELDS = [
	'name',
	'start_datetime',
	'duration_minutes',
	'location',
	'description'
] as const;

export function editPosts(fetchStub: ReturnType<typeof vi.fn>) {
	return fetchStub.mock.calls.filter(
		(c) =>
			((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'POST' &&
			String(c[0]).includes('/entity/ev1')
	);
}

export function postedProps(call: unknown[]): Array<Record<string, unknown>> {
	return JSON.parse(String((call[1] as RequestInit).body)) as Array<Record<string, unknown>>;
}

export const REASON = '[write_unavailable_no_signal]';

export function editorTokenAtNow(): void {
	setToken('jwt-editor');
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
}

export function fakeDateAtNow(): void {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
}

export function cleanupRealTimersReset(): void {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	resetAppState();
}

export function cleanupRealTimersResetTypes(): void {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	resetTypeIdCache();
	resetAppState();
}

export function cleanupResetReadCache(): void {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	resetAppState();
	setReadCacheFactory(undefined);
}

export function seasonEntity() {
	return {
		_id: 'season1',
		name: [{ string: '2026/27' }],
		start_date: [{ date: '2026-08-01' }],
		conductor: [{ reference: 'p-mihkel' }]
	};
}

export function seriesEntity() {
	return {
		_id: 'series1',
		name: [{ string: 'Tuesday Series' }],
		duration_minutes: [{ number: 120 }],
		default_location: [{ string: 'Church Hall' }],
		default_description: [{ string: 'Series default note.' }]
	};
}

export function setAuthedWithSampledb() {
	signIn({
		token: 'jwt-editor',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p-viewer' }]
	});
}

export function setAuthed(dbs: string[] = ['sampledb']) {
	signIn({
		token: 'jwt-editor',
		collectives: dbs.map((db) => ({ db, name: db, personId: 'p-viewer' }))
	});
}

export function pdfData() {
	return {
		bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
		filetype: 'application/pdf',
		sha256: 'sha-fixture'
	};
}

export const SIGNED_URL = 'https://s3.example/signed-ev?X-Amz-Expires=60';
export const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
export const DB = 'sampledb';
export const PERSON = 'person-1';
export const DB_ENTITY = 'db-entity-1';
export const SEASON = 'season-1';
// Only Date is faked. 07:05Z is 10:05 in Tallinn (EEST), so the as-of time is unmistakable.
export const READ_AT = new Date('2026-09-28T07:05:00.000Z');
export const LATER_SAME_DAY = new Date('2026-09-28T09:40:00.000Z');
export const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function urlOf(input: RequestInfo | URL): string {
	return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

export function offlineEntu() {
	return vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
}

export async function flushMicrotasks(times = 6) {
	for (let i = 0; i < times; i++) await Promise.resolve();
}

export function scheduleEntity(id: string, name: string, iso: string) {
	return {
		_id: id,
		name: [{ _id: `val-${id}-name`, string: name }],
		datetime: [{ _id: `val-${id}-dt`, datetime: iso }]
	};
}

export function cleanupResetAllMocks(): void {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	vi.resetAllMocks();
	localStorage.clear();
	resetAppState();
}

export const EVENTS = [
	{ id: 'ev-1', name: 'Tuesday rehearsal', start: '2026-10-06T15:00:00.000Z' },
	{ id: 'ev-2', name: 'Autumn concert', start: '2026-10-18T14:00:00.000Z' }
];

export function seedOfflineSession(): void {
	vi.useFakeTimers({ toFake: ['Date'], now: READ_AT });
	setReadCacheFactory(new IDBFactory());
	vi.stubGlobal('indexedDB', new IDBFactory());
	resetServedFromCache();
	localStorage.clear();
	setToken('tok-1');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { [DB]: PERSON },
		expMs: READ_AT.getTime() + 48 * 3_600_000
	});
}

// (*MVOX:Josquin*)
