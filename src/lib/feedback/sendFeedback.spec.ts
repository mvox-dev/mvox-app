// @vitest-environment happy-dom
// Send: online it creates the feedback on the member's own key; offline it waits on the device
// under its owner and goes out once, on that owner's key, when the signal returns.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { endSession } from '$lib/auth/session';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { serialize } from '$lib/strokes/strokes';
import { json } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import { installLocks } from '$lib/testing/locks';
import { goOffline, goOnline, nonGetCalls, resetOnLine } from '$lib/testing/networkSignal';
import { signIn } from '$lib/testing/session';
import {
	API,
	COMMIT,
	TYPE_ID,
	UPLOAD_URL,
	createBodies,
	feedbackEntu,
	prop
} from '$lib/testing/feedbackEntu';
import { createSavedFeedbackStore, type SavedFeedbackStore } from './savedFeedback';
import { sendFeedback, sendSavedFeedback } from './sendFeedback';

const PNG = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
const STROKES = { v: 1 as const, strokes: [{ pen: 'red' as const, w: 0.004, pts: [0.1, 0.1, 0.5, 0.5] }] };
const draft = () => ({ screenshot: PNG, strokes: STROKES, description: 'typed', pagePath: '/roster' });

const P = { db: 'sampledb', name: 'Sampledb', personId: 'person-p' };
const Q = { db: 'sampledb', name: 'Sampledb', personId: 'person-q' };
const signInP = (ttlMs?: number) => signIn({ token: 'jwt-p', collectives: [P], ttlMs });
const signInQ = () => signIn({ token: 'jwt-q', collectives: [Q] });

let store: SavedFeedbackStore;

beforeEach(() => {
	resetTypeIdCache();
	store = createSavedFeedbackStore(new IDBFactory());
	installLocks();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-05T08:30:15.250Z'));
	window.innerWidth = 390;
	window.innerHeight = 844;
});

afterEach(() => {
	vi.useRealTimers();
	resetOnLine();
	resetAppState();
});

async function saveOffline(entu: ReturnType<typeof feedbackEntu>) {
	await goOffline();
	await expect(sendFeedback(draft(), { fetchImpl: entu.fetchImpl, store })).resolves.toBe('saved');
	await goOnline();
}

describe('#611 send, online', () => {
	it("creates one feedback with the five values under the sender's member, on their own key", async () => {
		signInP();
		const entu = feedbackEntu();

		await expect(sendFeedback(draft(), { fetchImpl: entu.fetchImpl, store })).resolves.toBe('sent');

		expect(createBodies(entu.fetchImpl)).toEqual([
			[
				{ type: '_type', reference: TYPE_ID },
				{ type: '_parent', reference: 'member-p' },
				{ type: 'name', string: '/roster 2026-10-05' },
				{ type: 'description', string: 'typed' },
				{ type: 'doodle_layer', string: serialize(STROKES) },
				{ type: 'metadata', string: expect.any(String) }
			]
		]);
		const put = entu.fetchImpl.mock.calls.find(([u]) => String(u) === UPLOAD_URL);
		expect(put?.[1]?.body).toBe(PNG);
		for (const [u, init] of entu.fetchImpl.mock.calls.filter(([u]) => String(u).startsWith(API))) {
			expect((init?.headers as Record<string, string>).Authorization, String(u)).toBe('Bearer jwt-p');
		}
	});

	it('metadata is the route path, time, app version, locale and viewport, and nothing personal', async () => {
		signInP();
		const entu = feedbackEntu();

		await sendFeedback(draft(), { fetchImpl: entu.fetchImpl, store });

		const metadata = JSON.parse(prop(createBodies(entu.fetchImpl)[0], 'metadata')!);
		expect(metadata).toEqual({
			route: '/roster',
			time: '2026-10-05T08:30:15.250Z',
			version: { branch: 'main', commit: COMMIT },
			locale: 'en',
			viewport: '390x844'
		});
	});

	it("writes nothing but the feedback's own create, screenshot property and upload", async () => {
		signInP();
		const entu = feedbackEntu();

		await sendFeedback(draft(), { fetchImpl: entu.fetchImpl, store });

		expect(nonGetCalls(entu.fetchImpl).map(([u, i]) => [(i as RequestInit).method, String(u)])).toEqual([
			['POST', `${API}sampledb/entity`],
			['POST', `${API}sampledb/entity/fb-1`],
			['PUT', UPLOAD_URL]
		]);
		expect(await store.list('sampledb', 'person-p')).toEqual([]);
	});

	it('a send that loses the network on the way is saved on the device', async () => {
		signInP();
		const entu = feedbackEntu({ create: () => Promise.reject(new TypeError('Failed to fetch')) });

		await expect(sendFeedback(draft(), { fetchImpl: entu.fetchImpl, store })).resolves.toBe('saved');

		expect((await store.list('sampledb', 'person-p')).length).toBe(1);
	});
});

describe('#611 send, offline', () => {
	it('saves the feedback on the device under its owner and touches no network', async () => {
		signInP();
		const entu = feedbackEntu();
		await goOffline();

		await expect(sendFeedback(draft(), { fetchImpl: entu.fetchImpl, store })).resolves.toBe('saved');

		expect(entu.fetchImpl).not.toHaveBeenCalled();
		const saved = await store.list('sampledb', 'person-p');
		expect(saved.map((f) => [f.description, f.pagePath])).toEqual([['typed', '/roster']]);
	});

	it('when the signal returns it is sent once and leaves the device', async () => {
		signInP();
		const entu = feedbackEntu();
		await saveOffline(entu);

		await sendSavedFeedback({ fetchImpl: entu.fetchImpl, store });
		await sendSavedFeedback({ fetchImpl: entu.fetchImpl, store });

		expect(createBodies(entu.fetchImpl).map((b) => prop(b, '_parent'))).toEqual(['member-p']);
		expect(await store.list('sampledb', 'person-p')).toEqual([]);
	});

	it('two sends racing (two tabs coming back online) send it once', async () => {
		signInP();
		const entu = feedbackEntu();
		await saveOffline(entu);

		await Promise.all([
			sendSavedFeedback({ fetchImpl: entu.fetchImpl, store }),
			sendSavedFeedback({ fetchImpl: entu.fetchImpl, store })
		]);

		expect(createBodies(entu.fetchImpl).length).toBe(1);
	});

	it('the app version is the one current when it reaches Entu, not when it was saved', async () => {
		signInP();
		const entu = feedbackEntu({ branch: 'old-build' });
		await saveOffline(entu);
		entu.state.branch = 'new-build';

		await sendSavedFeedback({ fetchImpl: entu.fetchImpl, store });

		const metadata = JSON.parse(prop(createBodies(entu.fetchImpl)[0], 'metadata')!);
		expect(metadata.version).toEqual({ branch: 'new-build', commit: COMMIT });
		expect(metadata.time).toBe('2026-10-05T08:30:15.250Z');
	});
});

describe('#611 saved feedback goes out only on its owner key', () => {
	it("is never sent on another person's key; it waits for its owner's next sign-in", async () => {
		signInP();
		const entu = feedbackEntu();
		await saveOffline(entu);

		signInQ();
		await sendSavedFeedback({ fetchImpl: entu.fetchImpl, store });

		expect(entu.fetchImpl).not.toHaveBeenCalled();
		expect((await store.list('sampledb', 'person-p')).length).toBe(1);

		signInP();
		await sendSavedFeedback({ fetchImpl: entu.fetchImpl, store });

		expect(createBodies(entu.fetchImpl).map((b) => prop(b, '_parent'))).toEqual(['member-p']);
		const keys = entu.fetchImpl.mock.calls
			.filter(([u]) => String(u).startsWith(API))
			.map(([, i]) => (i?.headers as Record<string, string>).Authorization);
		expect(new Set(keys)).toEqual(new Set(['Bearer jwt-p']));
	});

	it('signing out keeps it on the device, unsent', async () => {
		signInP();
		const entu = feedbackEntu();
		await saveOffline(entu);

		endSession({ preserveProvider: false });
		await sendSavedFeedback({ fetchImpl: entu.fetchImpl, store });

		expect(entu.fetchImpl).not.toHaveBeenCalled();
		expect((await store.list('sampledb', 'person-p')).length).toBe(1);
	});

	it('an expired key keeps it to send after sign-in, without a request', async () => {
		signInP(-1000);
		const entu = feedbackEntu();

		await expect(sendFeedback(draft(), { fetchImpl: entu.fetchImpl, store })).resolves.toBe(
			'after-sign-in'
		);
		await sendSavedFeedback({ fetchImpl: entu.fetchImpl, store });

		expect(entu.fetchImpl).not.toHaveBeenCalled();
		expect((await store.list('sampledb', 'person-p')).length).toBe(1);
	});

	it('a key Entu refuses keeps it to send after sign-in', async () => {
		signInP();
		const entu = feedbackEntu({ create: () => json({ error: 'expired' }, 401) });

		await expect(sendFeedback(draft(), { fetchImpl: entu.fetchImpl, store })).resolves.toBe(
			'after-sign-in'
		);
		await sendSavedFeedback({ fetchImpl: entu.fetchImpl, store });

		expect((await store.list('sampledb', 'person-p')).length).toBe(1);
	});
});

// (*MVOX:Josquin*)
