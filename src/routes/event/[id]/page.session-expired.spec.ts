// @vitest-environment happy-dom
//
// #107 review F2 — auth token expiry recovery on the EVENT DETAIL page.
//
// The first #107 pass covered the agenda, roster, profile and library but left
// this one out, so a 401 here still landed in `status = 'load-error'`: the
// generic "couldn't load" copy plus a Retry button firing `loadForSelected()`
// against a token entuFetch had already deleted from localStorage — an action
// that can never succeed. This is a primary member surface (every agenda row
// links to it), so it is exactly the misleading-message class #107 set out to
// remove.
//
// Why the tag survives to the catch: `loadEventDetail` only constructs an
// `EventDetailLoadError` AFTER inspecting `eventRes.ok`, but entuFetch throws
// AuthExpiredError before any response is returned — so the raw AuthExpiredError
// propagates and must be recognised BEFORE the EventDetailLoadError/unavailable
// branch.
//
// INTEGRATION posture inherited from page.spec.ts: the REAL data layer and the
// REAL entuFetch run; only the wire (global fetch) and $app/navigation are
// stubbed. That is what makes this exercise the actual 401 → recovery path
// rather than a hand-thrown error.
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

// Full-fallback paraglide mock — same Proxy stub page.spec.ts uses.
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
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { install401Recovery } from '$lib/auth/install-401-recovery';
import { setAuthExpiredHandler } from '$lib/entu/request';

// The teardown+redirect half of the recovery is registered into entuFetch rather
// than imported by it, so $lib/entu/request stays node-importable for the 37
// migration scripts (review R2/F1). Production installs it from the root layout's
// module scope; this spec renders the page component alone, so it installs the
// REAL one itself — the assertions below still exercise production code.
beforeEach(() => {
	install401Recovery();
});

function setAuthedWithPolyphony() {
	setToken('jwt-stale');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'p-viewer' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'p-viewer' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

function renderWithStatus(status: number) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response('{}', { status }))
	);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithPolyphony();
	return render(Page);
}

afterEach(() => {
	setAuthExpiredHandler(null);
	cleanup();
	vi.unstubAllGlobals();
	gotoMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
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

		// The three misleading alternatives, all absent.
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
