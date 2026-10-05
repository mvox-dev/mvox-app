// @vitest-environment happy-dom
// The editor's Send, through the root layout: online it saves to Entu and closes; offline it
// saves on the device, closes and says so, and the layout sends it once when the signal returns.
import 'fake-indexeddb/auto';
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
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { getSavedFeedbackStore } from '$lib/feedback/savedFeedback';
import { resetAppState } from '$lib/testing/appReset';
import { SAMPLEDB, signIn } from '$lib/testing/session';
import { discoverMock } from '$lib/testing/routeMocks';
import { domToBlobMock } from '$lib/testing/mocks/files';
import { resolveGateMock, resolveMembershipMock } from '$lib/testing/mocks/session';
import { installLocks } from '$lib/testing/locks';
import { goOffline, goOnline, nonGetCalls, resetOnLine } from '$lib/testing/networkSignal';
import { createBodies, feedbackEntu, prop } from '$lib/testing/feedbackEntu';

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

async function openEditor(ttlMs?: number) {
	render(Layout, { props: { children } });
	discoverMock.mockResolvedValue({ collectives: [SAMPLEDB], erroredDbs: [] });
	signIn({ ttlMs });
	await vi.waitFor(() => expect(screen.getByRole('navigation')).toBeTruthy());
	doubleTap(screen.getByTestId('plain'));
	await vi.waitFor(() => expect(screen.getByRole('toolbar')).toBeTruthy());
	await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'typed' } });
}

const saved = () => getSavedFeedbackStore()!.list('sampledb', 'person-p');

let entu: ReturnType<typeof feedbackEntu>;
beforeEach(() => {
	resetTypeIdCache();
	installLocks();
	entu = feedbackEntu({ members: { 'person-p': 'member-p' } });
	vi.stubGlobal('fetch', entu.fetchImpl);
	resolveGateMock.mockResolvedValue('complete');
	resolveMembershipMock.mockResolvedValue('active');
	domToBlobMock.mockResolvedValue(PNG);
	URL.createObjectURL = () => 'blob:shot';
	URL.revokeObjectURL = vi.fn();
});

afterEach(async () => {
	cleanup();
	for (const f of await saved()) await getSavedFeedbackStore()!.delete('sampledb', 'person-p', f.id);
	vi.clearAllMocks();
	vi.unstubAllGlobals();
	resetOnLine();
	resetAppState();
	resetGate();
	resetMembership();
});

describe('+layout — the feedback editor sends (#611)', () => {
	it('Send saves one feedback to Entu and closes the editor', async () => {
		await openEditor();

		await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

		await vi.waitFor(() => expect(screen.queryByRole('toolbar')).toBeNull());
		const bodies = createBodies(entu.fetchImpl);
		expect(bodies.map((b) => [prop(b, '_parent'), prop(b, 'description')])).toEqual([
			['member-p', 'typed']
		]);
		expect(JSON.parse(prop(bodies[0], 'metadata')!).route).toBe('/roster');
	});

	it('offline, Send saves on the device, closes and says so; when the signal returns it is sent once', async () => {
		await openEditor();
		await goOffline();

		await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

		await vi.waitFor(() => expect(screen.queryByRole('toolbar')).toBeNull());
		expect(screen.getByTestId('feedback-saved').textContent?.trim()).toBe(
			'Feedback saved on this device. It will be sent when the signal returns.'
		);
		expect(nonGetCalls(entu.fetchImpl)).toEqual([]);
		expect((await saved()).length).toBe(1);

		await goOnline();

		await vi.waitFor(async () => expect(await saved()).toEqual([]));
		expect(createBodies(entu.fetchImpl).map((b) => prop(b, 'description'))).toEqual(['typed']);
	});

	it('an expired key: the editor says it will be sent after sign-in, and holds Send', async () => {
		await openEditor(-1000);

		await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

		await vi.waitFor(() =>
			expect(screen.getByTestId('feedback-editor').textContent).toContain(
				'Feedback saved. It will be sent after you sign in.'
			)
		);
		expect(screen.queryByRole('alert')).toBeNull();
		expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
		expect(nonGetCalls(entu.fetchImpl)).toEqual([]);
		expect((await saved()).length).toBe(1);
	});
});

// (*MVOX:Josquin*)
