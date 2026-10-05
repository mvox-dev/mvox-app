// @vitest-environment happy-dom
// The page metadata a feedback carries: route, time, app version, locale, viewport, and nothing else.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';
import { setLocale } from '$lib/paraglide/runtime';
import { capturePage, feedbackMetadata, readAppVersion } from './pageMetadata';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-05T08:30:15.250Z'));
	window.innerWidth = 390;
	window.innerHeight = 844;
});

afterEach(() => {
	vi.useRealTimers();
	setLocale('en', { reload: false });
});

describe('#611 page metadata', () => {
	it('carries exactly the route path, time, app version, locale and viewport', () => {
		setLocale('et', { reload: false });
		const metadata = feedbackMetadata(capturePage('/event/abc'), { branch: 'main', commit: COMMIT });

		expect(JSON.parse(metadata)).toEqual({
			route: '/event/abc',
			time: '2026-10-05T08:30:15.250Z',
			version: { branch: 'main', commit: COMMIT },
			locale: 'et',
			viewport: '390x844'
		});
	});

	it('reads the app version from /version.json, the #350 build stamp', async () => {
		const fetchImpl = vi.fn(async () =>
			json({ source: 'cloudflare-pages', branch: 'main', commit: COMMIT })
		);

		await expect(readAppVersion(fetchImpl)).resolves.toEqual({ branch: 'main', commit: COMMIT });
		expect(fetchImpl.mock.calls.map(([url, init]) => [String(url), init?.method ?? 'GET'])).toEqual([
			['/version.json', 'GET']
		]);
	});

	it('a build stamp that cannot be read rejects instead of sending a made-up version', async () => {
		const fetchImpl = vi.fn(async () => json({ error: 'nope' }, 404));
		await expect(readAppVersion(fetchImpl)).rejects.toThrow(/version/);
	});
});

// (*MVOX:Josquin*)
