// @vitest-environment happy-dom
// #684: the feedback editor lists the failures the problem-handler kept, all ticked; a send
// carries the ticked ones in the feedback's metadata, and they leave the list.
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
import { cancelSavedFeedbackRetry } from '$lib/feedback/sendFeedback';
import { getProblemLog, resetProblemLog } from '$lib/problems/problemLog';
import { reportProblem } from '$lib/problems/reportProblem';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { resetAppState } from '$lib/testing/appReset';
import { createBodies, feedbackEntu, prop } from '$lib/testing/feedbackEntu';
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

function rows() {
	return screen.getAllByRole('checkbox').map((box) => [
		box.closest('label')!.textContent!.replace(/\s+/g, ' ').trim(),
		(box as HTMLInputElement).checked
	]);
}

async function kept(count: number) {
	await vi.waitFor(async () =>
		expect((await getProblemLog()!.list('sampledb', 'person-p')).length).toBe(count)
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
	vi.useRealTimers();
	vi.clearAllMocks();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	resetProblemLog();
	resetAppState();
	resetGate();
	resetMembership();
});

describe('#684 failures in the feedback editor', () => {
	it('lists each kept failure by area, action and Tallinn time, all ticked, without its detail', async () => {
		await renderSignedIn();
		reportProblem({ area: 'roster', action: 'loading the join states', error: new Error('roster broke') });
		await kept(1);
		vi.setSystemTime(new Date('2026-10-05T08:31:40.000Z'));
		reportProblem({ area: 'library', action: 'loading the checkout data', error: new Error('library broke') });
		await kept(2);

		await openEditor();

		await vi.waitFor(() =>
			expect(rows()).toEqual([
				['roster: loading the join states 2026-10-05 11:30', true],
				['library: loading the checkout data 2026-10-05 11:31', true]
			])
		);
		expect(screen.getByTestId('feedback-editor').textContent).not.toMatch(/broke/);
	});

	it('shows no failure list when nothing was kept', async () => {
		await renderSignedIn();

		await openEditor();

		expect(screen.queryAllByRole('checkbox')).toEqual([]);
	});

	it('send carries the ticked failures, redacted, in the metadata; they leave the list, the unticked stay', async () => {
		await renderSignedIn();
		reportProblem({ area: 'roster', action: 'loading the join states', error: new Error('roster broke for mari@example.ee') });
		await kept(1);
		reportProblem({ area: 'library', action: 'loading the checkout data', error: new Error('library broke') });
		await kept(2);
		await openEditor();
		await vi.waitFor(() => expect(screen.getAllByRole('checkbox').length).toBe(2));

		await fireEvent.click(screen.getAllByRole('checkbox')[1]);
		await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

		await vi.waitFor(() => expect(screen.queryByRole('toolbar')).toBeNull());
		const metadata = JSON.parse(prop(createBodies(entu.fetchImpl)[0], 'metadata')!);
		expect(metadata.problems).toEqual([
			{
				area: 'roster',
				action: 'loading the join states',
				time: '2026-10-05T08:30:15.250Z',
				detail: 'Error: roster broke for [email]'
			}
		]);
		await kept(1);

		await openEditor();

		await vi.waitFor(() =>
			expect(rows()).toEqual([['library: loading the checkout data 2026-10-05 11:30', true]])
		);
	});

	it('a send that fails keeps every failure on the list', async () => {
		entu = feedbackEntu({ create: () => new Response('', { status: 500 }) });
		vi.stubGlobal('fetch', entu.fetchImpl);
		await renderSignedIn();
		reportProblem({ area: 'roster', action: 'loading the join states', error: new Error('roster broke') });
		await kept(1);
		await openEditor();
		await vi.waitFor(() => expect(screen.getAllByRole('checkbox').length).toBe(1));

		await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

		await vi.waitFor(() => expect(screen.getByText('The feedback could not be sent.')).toBeTruthy());
		expect((await getProblemLog()!.list('sampledb', 'person-p')).length).toBe(1);
	});
});

// (*MVOX:Josquin*)
