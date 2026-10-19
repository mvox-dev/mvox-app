// @vitest-environment happy-dom
// #948: the feedback form, open while the reports it lists go out by themselves, never
// sends those reports a second time.
import { IDBFactory } from 'fake-indexeddb';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule({ afterNavigate: vi.fn() })
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/roster'), params: {} }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$lib/profile/completionGate', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).completionGateModule(importOriginal)
);
vi.mock('$lib/collective/membershipStore', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).membershipModule(importOriginal)
);
vi.mock('modern-screenshot', async () =>
	(await import('$lib/testing/mocks/files')).screenshotModule()
);

import Layout from './+layout.svelte';
import { resetGate } from '$lib/profile/completionGate';
import { resetMembership } from '$lib/collective/membershipStore';
import { cancelSavedFeedbackRetry, sendSavedFeedback } from '$lib/feedback/sendFeedback';
import { getProblemLog, resetProblemLog } from '$lib/problems/problemLog';
import { reportProblem } from '$lib/problems/reportProblem';
import { goOffline, goOnline, resetOnLine } from '$lib/testing/networkSignal';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { resetAppState } from '$lib/testing/appReset';
import { createBodies, feedbackEntu, prop } from '$lib/testing/feedbackEntu';
import { json } from '$lib/testing/entuFetchKit';
import { installLocks } from '$lib/testing/locks';
import { SAMPLEDB, signIn } from '$lib/testing/session';
import { discoverMock } from '$lib/testing/routeMocks';
import { domToBlobMock } from '$lib/testing/mocks/files';
import { resolveGateMock, resolveMembershipMock } from '$lib/testing/mocks/session';

const PNG = new Blob(['png'], { type: 'image/png' });

const children = createRawSnippet(() => ({
	render: () => `<section data-testid="page"><p data-testid="plain">Roster</p></section>`
}));

function doubleTap(target: Element) {
	const init = { bubbles: true, isPrimary: true, button: 0, clientX: 5, clientY: 5 };
	for (let i = 0; i < 2; i++) {
		target.dispatchEvent(new PointerEvent('pointerdown', init));
		target.dispatchEvent(new PointerEvent('pointerup', init));
	}
}

async function openEditor() {
	doubleTap(screen.getByTestId('plain'));
	await vi.waitFor(() => expect(screen.getByRole('toolbar')).toBeTruthy());
}

async function renderSignedIn() {
	render(Layout, { props: { children } });
	discoverMock.mockResolvedValue({ collectives: [SAMPLEDB], erroredDbs: [] });
	signIn();
	await vi.waitFor(() => expect(screen.getByRole('navigation')).toBeTruthy());
}

async function kept(count: number) {
	await vi.waitFor(async () =>
		expect((await getProblemLog()!.list({ db: 'sampledb', personId: 'person-p' })).length).toBe(count)
	);
}

let entu: ReturnType<typeof feedbackEntu>;

beforeEach(() => {
	vi.stubGlobal('indexedDB', new IDBFactory());
	resetProblemLog();
	resetTypeIdCache();
	installLocks();
	entu = feedbackEntu();
	vi.stubGlobal('fetch', entu.fetchImpl);
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-05T08:30:15.250Z'));
	resolveGateMock.mockResolvedValue('complete');
	resolveMembershipMock.mockResolvedValue('active');
	domToBlobMock.mockResolvedValue(PNG);
	URL.createObjectURL = () => 'blob:shot';
	URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
	cleanup();
	cancelSavedFeedbackRetry();
	resetOnLine();
	vi.useRealTimers();
	vi.clearAllMocks();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	resetProblemLog();
	resetAppState();
	resetGate();
	resetMembership();
});

describe('#948 the open form and the reports that went by themselves', () => {
	it('a report sent by itself while the form is open is not sent again with the form', async () => {
		await renderSignedIn();
		reportProblem({ area: 'roster', action: 'loading the join states', error: new Error('broke') });
		await kept(1);
		await openEditor();
		await vi.waitFor(() => expect(screen.getAllByRole('checkbox').length).toBe(1));

		await goOffline();
		await goOnline();
		await vi.waitFor(() => expect(createBodies(entu.fetchImpl).length).toBe(1));
		await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

		await vi.waitFor(() => expect(screen.queryByRole('toolbar')).toBeNull());
		const [auto, form] = createBodies(entu.fetchImpl);
		expect(JSON.parse(prop(auto, 'metadata')!).problems.map((p: { area: string }) => p.area)).toEqual([
			'roster'
		]);
		expect(JSON.parse(prop(form, 'metadata')!).problems).toEqual([]);
	});
	it('a form send racing the auto-sender carries the report once', async () => {
		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		let calls = 0;
		entu = feedbackEntu({
			create: () => (++calls === 1 ? held.then(() => json({ _id: 'fb-99' })) : undefined)
		});
		vi.stubGlobal('fetch', entu.fetchImpl);
		await renderSignedIn();
		reportProblem({ area: 'roster', action: 'loading the join states', error: new Error('broke') });
		await kept(1);
		await openEditor();
		await vi.waitFor(() => expect(screen.getAllByRole('checkbox').length).toBe(1));

		await fireEvent.click(screen.getByRole('button', { name: 'Send' }));
		await vi.waitFor(() => expect(calls).toBe(1));
		await goOffline();
		await goOnline();
		release();

		await vi.waitFor(() => expect(screen.queryByRole('toolbar')).toBeNull());
		await sendSavedFeedback();
		const carrying = createBodies(entu.fetchImpl).filter(
			(body) => JSON.parse(prop(body, 'metadata')!).problems.length > 0
		);
		expect(carrying.length).toBe(1);
	});
});

// (*MVOX:Josquin*)
