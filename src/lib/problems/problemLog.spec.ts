// @vitest-environment happy-dom
// #684: each failure reportProblem receives is kept on the device under its owner, redacted.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { selectedCollectiveIdentityStore } from '$lib/collectives/store';
import { AuthExpiredError } from '$lib/entu/auth-expired';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import {
	createProblemLog,
	getProblemLog,
	resetProblemLog,
	setProblemOwner,
	KEPT_PROBLEMS
} from './problemLog';
import { reportProblem } from './reportProblem';

const P = { db: 'sampledb', name: 'Sampledb', personId: 'person-p' };
const Q = { db: 'sampledb', name: 'Sampledb', personId: 'person-q' };

const listP = () => getProblemLog()!.list('sampledb', 'person-p');

beforeEach(() => {
	vi.stubGlobal('indexedDB', new IDBFactory());
	resetProblemLog();
	setProblemOwner(selectedCollectiveIdentityStore);
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-05T08:30:15.250Z'));
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	resetProblemLog();
	setProblemOwner(null);
	resetAppState();
});

describe('#684 reportProblem keeps each failure for feedback', () => {
	it("keeps the area, the action, the time and the error's name and message under the signed-in person", async () => {
		signIn({ collectives: [P] });

		reportProblem({ area: 'roster', action: 'loading the join states', error: new TypeError('Failed to fetch') });

		await vi.waitFor(async () =>
			expect(await listP()).toEqual([
				{
					id: expect.any(String),
					area: 'roster',
					action: 'loading the join states',
					time: '2026-10-05T08:30:15.250Z',
					detail: 'TypeError: Failed to fetch'
				}
			])
		);
	});

	it('cuts every name and email out of the error before it is kept (ER-26)', async () => {
		signIn({ collectives: [P] });
		const body = JSON.stringify({ _owner: [{ reference: 'person-x', string: 'Mari Maasikas mari@example.ee' }] });

		reportProblem({ area: 'rights', action: 'reading the rights', error: new Error(`HTTP 500 ${body} for kati@example.ee`) });

		await vi.waitFor(async () => expect((await listP()).length).toBe(1));
		expect((await listP())[0].detail).toBe(
			'Error: HTTP 500 {"_owner":[{"reference":"person-x","string":"[redacted]"}]} for [email]'
		);
	});

	it('a thrown value that is not an Error is kept as its kind only', async () => {
		signIn({ collectives: [P] });

		reportProblem({ area: 'agenda', action: 'load', error: { name: 'Mari Maasikas' } });

		await vi.waitFor(async () => expect((await listP()).map((p) => p.detail)).toEqual(['not an Error (object)']));
	});

	it('two failures reported at once are both kept', async () => {
		signIn({ collectives: [P] });

		reportProblem({ area: 'agenda', action: 'first', error: new Error('1') });
		reportProblem({ area: 'agenda', action: 'second', error: new Error('2') });

		await vi.waitFor(async () => expect((await listP()).map((p) => p.action)).toEqual(['first', 'second']));
	});

	it("keeps each person's failures apart", async () => {
		signIn({ collectives: [Q] });
		reportProblem({ area: 'library', action: 'load', error: new Error('q broke') });
		await vi.waitFor(async () => expect((await getProblemLog()!.list('sampledb', 'person-q')).length).toBe(1));

		signIn({ collectives: [P] });
		reportProblem({ area: 'roster', action: 'load', error: new Error('p broke') });

		await vi.waitFor(async () => expect((await listP()).map((p) => p.detail)).toEqual(['Error: p broke']));
		expect((await getProblemLog()!.list('sampledb', 'person-q')).map((p) => p.detail)).toEqual(['Error: q broke']);
	});

	it('nothing is kept while no collective is selected', async () => {
		reportProblem({ area: 'collectives', action: 'load', error: new Error('before') });
		signIn({ collectives: [P] });
		reportProblem({ area: 'agenda', action: 'load', error: new Error('after') });

		await vi.waitFor(async () => expect((await listP()).map((p) => p.detail)).toEqual(['Error: after']));
	});

	it('an expired session is not kept', async () => {
		signIn({ collectives: [P] });

		reportProblem({ area: 'agenda', action: 'loading your answers', error: new AuthExpiredError() });
		reportProblem({ area: 'agenda', action: 'load', error: new Error('after') });

		await vi.waitFor(async () => expect((await listP()).map((p) => p.detail)).toEqual(['Error: after']));
	});
});

describe('#684 problem log', () => {
	const entry = (n: number) => ({ area: 'agenda', action: `step ${n}`, detail: `Error: ${n}` });

	it(`keeps only the last ${KEPT_PROBLEMS}, oldest first`, async () => {
		const log = createProblemLog(new IDBFactory());
		for (let n = 1; n <= KEPT_PROBLEMS + 2; n++) await log.add('sampledb', 'person-p', entry(n));

		const actions = (await log.list('sampledb', 'person-p')).map((p) => p.action);
		expect(actions).toEqual(Array.from({ length: KEPT_PROBLEMS }, (_, i) => `step ${i + 3}`));
	});

	it('remove drops only the named failures of that person', async () => {
		const log = createProblemLog(new IDBFactory());
		await log.add('sampledb', 'person-p', entry(1));
		await log.add('sampledb', 'person-p', entry(2));
		await log.add('sampledb', 'person-q', entry(3));
		const [first] = await log.list('sampledb', 'person-p');

		await log.remove('sampledb', 'person-p', [first.id]);

		expect((await log.list('sampledb', 'person-p')).map((p) => p.action)).toEqual(['step 2']);
		expect((await log.list('sampledb', 'person-q')).map((p) => p.action)).toEqual(['step 3']);
	});

	it('survives a reopen of the device store', async () => {
		const factory = new IDBFactory();
		await createProblemLog(factory).add('sampledb', 'person-p', entry(1));

		expect((await createProblemLog(factory).list('sampledb', 'person-p')).map((p) => p.action)).toEqual([
			'step 1'
		]);
	});
});

// (*MVOX:Josquin*)
