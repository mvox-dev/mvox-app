// @vitest-environment happy-dom
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const pageStub = vi.hoisted(() => ({
	params: { id: 'ev1' } as Record<string, string>,
	url: new URL('http://localhost/event/ev1')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { install401Recovery } from '$lib/auth/install-401-recovery';
import { setAuthExpiredHandler } from '$lib/entu/request';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

beforeEach(() => {
	install401Recovery();
});

function setAuthedWithSampledb() {
	signIn({
		token: 'jwt-stale',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p-viewer' }]
	});
}

function renderWithStatus(status: number) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response('{}', { status }))
	);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithSampledb();
	return render(Page);
}

afterEach(() => {
	setAuthExpiredHandler(null);
	cleanup();
	vi.unstubAllGlobals();
	gotoMock.mockReset();
	resetAppState();
});

describe('/event/[id] — session expired (#107 review F2)', () => {
	it('an Entu 401 shows the session-expired notice with a sign-in link — NOT the generic load error + Retry', async () => {
		const { container } = renderWithStatus(401);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="session-expired"]')).not.toBeNull();
		});
		const signin = container.querySelector('[data-testid="session-expired-signin"]');
		expect(signin, 'the notice must carry a sign-in link').not.toBeNull();
		expect(signin?.getAttribute('href') ?? '').toContain('/auth/login');

		expect(container.querySelector('[data-testid="event-detail-load-error"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-retry"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-not-available"]')).toBeNull();
	});

	it('the 401 also ends the session end-to-end: storage cleared, authStore anonymous, one redirect fired', async () => {
		renderWithStatus(401);

		await waitFor(() => {
			expect(gotoMock).toHaveBeenCalled();
		});
		expect(String(gotoMock.mock.calls[0][0])).toContain('session_expired');
		expect(get(authStore)).toEqual({ status: 'anonymous' });
	});

	it('a 404 still shows not-in-this-collective, and a 503 still shows the loud load error + Retry (401 handling must not swallow them)', async () => {
		const notAvailable = renderWithStatus(404);
		await waitFor(() => {
			expect(
				notAvailable.container.querySelector('[data-testid="event-detail-not-available"]')
			).not.toBeNull();
		});
		expect(notAvailable.container.querySelector('[data-testid="session-expired"]')).toBeNull();
		cleanup();
		vi.unstubAllGlobals();

		const transient = renderWithStatus(503);
		await waitFor(() => {
			expect(
				transient.container.querySelector('[data-testid="event-detail-load-error"]')
			).not.toBeNull();
		});
		expect(transient.container.querySelector('[data-testid="event-detail-retry"]')).not.toBeNull();
		expect(transient.container.querySelector('[data-testid="session-expired"]')).toBeNull();
	});
});

// (*MVOX:Josquin*)
