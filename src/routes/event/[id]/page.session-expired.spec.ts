// @vitest-environment happy-dom
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const pageStub = vi.hoisted(() => ({
	params: { id: 'ev1' } as Record<string, string>,
	url: new URL('http://localhost/event/ev1')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './+page.svelte';
import { install401Recovery } from '$lib/auth/install-401-recovery';
import { setAuthExpiredHandler } from '$lib/entu/request';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { gotoMock } from '$lib/testing/routeMocks';

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
	it('a 404 still shows not-in-this-collective, not the session-expired notice', async () => {
		const { container } = renderWithStatus(404);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-not-available"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="session-expired"]')).toBeNull();
	});
});

// (*MVOX:Josquin*)
