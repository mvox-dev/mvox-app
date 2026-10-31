// @vitest-environment happy-dom
// #1052: the root layout shows the newer-version notice when /version.json names another build.
import { render, cleanup, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule({ afterNavigate: vi.fn() })
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/login'), params: {} }));
vi.mock('$app/state', () => ({ page: pageStub }));

import Layout from './+layout.svelte';
import { runningBuildCommit } from '$lib/runningBuild';
import { newerVersion } from '$lib/sw/newerVersion';
import { resetAppState } from '$lib/testing/appReset';
import { readMessages } from '$lib/testing/pages/files';
import { settle } from '$lib/testing/networkSignal';
import { json } from '$lib/testing/entuFetchKit';

function deploy(commit: string) {
	const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
		String(input) === '/version.json'
			? json({ source: 'cloudflare-pages', branch: 'main', commit })
			: json({ entities: [], count: 0 })
	);
	vi.stubGlobal('fetch', fetchImpl);
	return fetchImpl;
}

const notice = () => screen.queryByTestId('newer-version-notice');

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	resetAppState();
	newerVersion.set({ state: 'none' });
});

describe('+layout — the newer-version notice (#1052)', () => {
	it('signed out, a newer deployed build shows the notice', async () => {
		deploy('f'.repeat(40));
		render(Layout);

		await vi.waitFor(() =>
			expect(notice()?.textContent).toContain(readMessages('en').newer_version_available as string)
		);
	});

	it('the running build deployed shows no notice', async () => {
		const fetchImpl = deploy(runningBuildCommit);
		render(Layout);

		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('/version.json', { cache: 'no-store' }));
		await settle();
		expect(notice()).toBeNull();
	});
});

// (*MVOX:Josquin*)
