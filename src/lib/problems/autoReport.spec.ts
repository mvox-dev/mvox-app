// @vitest-environment happy-dom
// #948: a kept report goes to Entu by itself, as a feedback with no screenshot, through the
// saved-feedback queue: one send across tabs, never twice, and only online and signed in.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { endSession } from '$lib/auth/session';
import { selectedCollectiveIdentityStore } from '$lib/collectives/store';
import {
	getSavedFeedbackStore,
	resetSavedFeedbackStore,
	type SavedFeedbackStore
} from '$lib/feedback/savedFeedback';
import {
	cancelSavedFeedbackRetry,
	sendSavedFeedback,
	startSendingSavedFeedback
} from '$lib/feedback/sendFeedback';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { resetAppState } from '$lib/testing/appReset';
import { API, TYPE_ID, createBodies, feedbackEntu, prop } from '$lib/testing/feedbackEntu';
import { installLocks } from '$lib/testing/locks';
import { goOffline, goOnline, nonGetCalls, resetOnLine } from '$lib/testing/networkSignal';
import { signIn } from '$lib/testing/session';
import { REPORT_DELAY_MS } from './autoReport';
import { getProblemLog, resetProblemLog, setProblemOwner, type ProblemLog } from './problemLog';
import { reportProblem } from './reportProblem';

const P = { db: 'sampledb', name: 'Sampledb', personId: 'person-p' };
const PRELOAD = 'preloading a part for the next rehearsal';

const quota = () => Object.assign(new Error('the disk is full'), { name: 'QuotaExceededError' });
const log = () => getProblemLog()!;
const queue = () => getSavedFeedbackStore()!;
const keptP = () => log().list('sampledb', 'person-p');
const queuedP = () => queue().list('sampledb', 'person-p');
const keep = (action = PRELOAD) =>
	log().add('sampledb', 'person-p', { area: 'files', action, detail: 'QuotaExceededError: full' });

const waitKept = (count: number) =>
	vi.waitFor(async () => expect((await keptP()).length).toBe(count));

let entu: ReturnType<typeof feedbackEntu>;
let stop: (() => void) | null = null;

// The sweep the sign-in starts is let finish first, so it cannot pick up a report early.
async function start() {
	stop = startSendingSavedFeedback();
	await sendSavedFeedback();
}

beforeEach(() => {
	vi.stubGlobal('indexedDB', new IDBFactory());
	resetProblemLog();
	resetSavedFeedbackStore();
	resetTypeIdCache();
	setProblemOwner(selectedCollectiveIdentityStore);
	installLocks();
	entu = feedbackEntu();
	vi.stubGlobal('fetch', entu.fetchImpl);
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
	vi.setSystemTime(new Date('2026-10-05T08:30:15.250Z'));
	window.history.replaceState(null, '', '/roster');
});

afterEach(() => {
	stop?.();
	stop = null;
	cancelSavedFeedbackRetry();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	resetOnLine();
	setProblemOwner(null);
	resetProblemLog();
	resetSavedFeedbackStore();
	resetAppState();
});

describe('#948 a kept report goes by itself', () => {
	it('online and signed in: one create, no screenshot or ink, the report in the metadata', async () => {
		signIn({ token: 'jwt-p', collectives: [P] });
		await start();

		reportProblem({ area: 'files', action: PRELOAD, error: quota() });
		await waitKept(1);
		await vi.advanceTimersByTimeAsync(REPORT_DELAY_MS);

		await vi.waitFor(async () => expect(createBodies(entu.fetchImpl).length).toBe(1));
		await vi.waitFor(async () => expect(await queuedP()).toEqual([]));
		expect(nonGetCalls(entu.fetchImpl).map(([u, i]) => [(i as RequestInit).method, String(u)])).toEqual(
			[['POST', `${API}sampledb/entity`]]
		);
		const [body] = createBodies(entu.fetchImpl);
		expect(body).toEqual([
			{ type: '_type', reference: TYPE_ID },
			{ type: '_parent', reference: 'member-p' },
			{ type: 'name', string: '/roster 2026-10-05' },
			{
				type: 'description',
				string: `Automatic problem report: 1 problem — ${PRELOAD} failed (QuotaExceededError).`
			},
			{ type: 'metadata', string: expect.any(String) }
		]);
		expect(JSON.parse(prop(body, 'metadata')!).problems).toEqual([
			{
				area: 'files',
				action: PRELOAD,
				time: '2026-10-05T08:30:15.250Z',
				detail: 'QuotaExceededError: the disk is full'
			}
		]);
		expect(await keptP()).toEqual([]);
	});

	it('a burst goes in one feedback that names each report in log order', async () => {
		signIn({ token: 'jwt-p', collectives: [P] });
		await start();

		reportProblem({ area: 'files', action: PRELOAD, error: quota() });
		await waitKept(1);
		await vi.advanceTimersByTimeAsync(500);
		reportProblem({ area: 'roster', action: 'loading the join states', error: new TypeError('x') });
		await waitKept(2);
		await vi.advanceTimersByTimeAsync(500);
		reportProblem({ area: 'library', action: 'loading the checkout data', error: 'odd' });
		await waitKept(3);
		await vi.advanceTimersByTimeAsync(REPORT_DELAY_MS);

		await vi.waitFor(async () => expect(createBodies(entu.fetchImpl).length).toBe(1));
		await vi.waitFor(async () => expect(await queuedP()).toEqual([]));
		expect(createBodies(entu.fetchImpl).map((b) => prop(b, 'description'))).toEqual([
			'Automatic problem report: 3 problems — ' +
				`${PRELOAD} failed (QuotaExceededError); ` +
				'loading the join states failed (TypeError); ' +
				'loading the checkout data failed.'
		]);
	});

	it('offline nothing is sent; it goes once the signal returns', async () => {
		signIn({ token: 'jwt-p', collectives: [P] });
		await start();
		await goOffline();

		reportProblem({ area: 'files', action: PRELOAD, error: quota() });
		await waitKept(1);
		await vi.advanceTimersByTimeAsync(REPORT_DELAY_MS * 5);
		expect(entu.fetchImpl).not.toHaveBeenCalled();
		expect((await keptP()).length).toBe(1);

		await goOnline();

		await vi.waitFor(async () => expect(createBodies(entu.fetchImpl).length).toBe(1));
		await vi.waitFor(async () => expect(await queuedP()).toEqual([]));
	});

	it('signed out nothing is sent; it goes at the next sign-in', async () => {
		signIn({ token: 'jwt-p', collectives: [P] });
		await start();
		reportProblem({ area: 'files', action: PRELOAD, error: quota() });
		await waitKept(1);
		endSession({ preserveProvider: false });

		await vi.advanceTimersByTimeAsync(REPORT_DELAY_MS * 5);
		expect(entu.fetchImpl).not.toHaveBeenCalled();

		signIn({ token: 'jwt-p', collectives: [P] });

		await vi.waitFor(async () => expect(createBodies(entu.fetchImpl).length).toBe(1));
		await vi.waitFor(async () => expect(await queuedP()).toEqual([]));
	});

	it('a failed send keeps the report on the device and reports nothing of its own', async () => {
		signIn({ token: 'jwt-p', collectives: [P] });
		let refuse = true;
		entu = feedbackEntu({ create: () => (refuse ? new Response('', { status: 500 }) : undefined) });
		await keep();

		await sendSavedFeedback({ fetchImpl: entu.fetchImpl });

		expect(await keptP()).toEqual([]);
		expect((await queuedP()).map((f) => f.description)).toEqual([
			`Automatic problem report: 1 problem — ${PRELOAD} failed (QuotaExceededError).`
		]);
		refuse = false;
		await sendSavedFeedback({ fetchImpl: entu.fetchImpl });

		expect(createBodies(entu.fetchImpl).length).toBe(2);
		expect([...entu.state.live]).toEqual(['fb-1']);
		expect(await queuedP()).toEqual([]);
		expect(await keptP()).toEqual([]);
	});
});

describe('#948 never twice', () => {
	it('two tabs sending at once send it once', async () => {
		signIn({ token: 'jwt-p', collectives: [P] });
		await keep();

		await Promise.all([
			sendSavedFeedback({ fetchImpl: entu.fetchImpl }),
			sendSavedFeedback({ fetchImpl: entu.fetchImpl })
		]);

		expect(createBodies(entu.fetchImpl).length).toBe(1);
	});

	it('a send cut off after its create landed is replaced, not doubled', async () => {
		signIn({ token: 'jwt-p', collectives: [P] });
		await keep();
		const cutOff: SavedFeedbackStore = {
			...queue(),
			delete: () => Promise.reject(new Error('the tab closed'))
		};

		await expect(sendSavedFeedback({ fetchImpl: entu.fetchImpl, store: cutOff })).rejects.toThrow(
			'the tab closed'
		);
		await sendSavedFeedback({ fetchImpl: entu.fetchImpl });

		expect([...entu.state.live]).toEqual(['fb-2']);
		expect(await queuedP()).toEqual([]);
	});

	it('cut off between the queue put and the log remove, the report is sent once', async () => {
		signIn({ token: 'jwt-p', collectives: [P] });
		await keep();
		const crashing: ProblemLog = {
			...log(),
			remove: () => Promise.reject(new Error('the tab closed'))
		};

		await sendSavedFeedback({ fetchImpl: entu.fetchImpl, log: crashing });
		expect((await keptP()).length).toBe(1);
		await sendSavedFeedback({ fetchImpl: entu.fetchImpl });
		await sendSavedFeedback({ fetchImpl: entu.fetchImpl });

		expect(createBodies(entu.fetchImpl).length).toBe(1);
		expect(await keptP()).toEqual([]);
		expect(await queuedP()).toEqual([]);
	});

	it('a failing log remove holds back only the report; saved feedback still goes', async () => {
		signIn({ token: 'jwt-p', collectives: [P] });
		await queue().put({
			id: 'saved-1',
			...P,
			screenshot: new Blob(['png'], { type: 'image/png' }),
			strokes: { v: 1, strokes: [] },
			description: 'typed',
			pagePath: '/roster',
			page: { route: '/roster', time: '2026-10-05T08:00:00.000Z', locale: 'en', viewport: '390x844' }
		});
		await keep();
		const crashing: ProblemLog = {
			...log(),
			remove: () => Promise.reject(new Error('the tab closed'))
		};

		await sendSavedFeedback({ fetchImpl: entu.fetchImpl, log: crashing });
		expect(createBodies(entu.fetchImpl).map((b) => prop(b, 'description'))).toEqual(['typed']);
		await sendSavedFeedback({ fetchImpl: entu.fetchImpl });

		expect(createBodies(entu.fetchImpl).length).toBe(2);
		expect(await queuedP()).toEqual([]);
		expect(await keptP()).toEqual([]);
	});

	it('a queue put that fails leaves the report in the log', async () => {
		signIn({ token: 'jwt-p', collectives: [P] });
		await keep();
		const full: SavedFeedbackStore = {
			...queue(),
			put: () => Promise.reject(new Error('the disk is full'))
		};

		await sendSavedFeedback({ fetchImpl: entu.fetchImpl, store: full });
		expect(entu.fetchImpl).not.toHaveBeenCalled();
		expect((await keptP()).length).toBe(1);
		await sendSavedFeedback({ fetchImpl: entu.fetchImpl });

		expect(createBodies(entu.fetchImpl).length).toBe(1);
		expect(await keptP()).toEqual([]);
	});
});

// (*MVOX:Josquin*)
