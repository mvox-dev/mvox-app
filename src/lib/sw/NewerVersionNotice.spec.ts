// @vitest-environment happy-dom
// #1052: the notice shows when the deployed build differs from the running one; Refresh updates.
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/problems/reportProblem', async () =>
	(await import('$lib/testing/mocks/session')).reportProblemModule()
);

import NewerVersionNotice from './NewerVersionNotice.svelte';
import { REFRESH_WAIT_MS, RELOAD_WAIT_MS, UPDATE_GRACE_MS, newerVersion, type VersionWatchDeps } from './newerVersion';
import { UPDATE_CHECK_INTERVAL_MS, VISIBILITY_CHECK_MIN_GAP_MS } from './swUpdate';
import { reportProblem } from '$lib/testing/mocks/session';
import { goOffline, resetOnLine, settle } from '$lib/testing/networkSignal';
import { LOCALES, readMessages } from '$lib/testing/pages/files';
import { setLocale } from '$lib/paraglide/runtime.js';
import { json } from '$lib/testing/entuFetchKit';

const RUNNING = 'a'.repeat(40);
const NEWER = 'b'.repeat(40);

let deployed: string | null;
const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
	if (String(input) !== '/version.json') throw new Error(`unexpected request: ${String(input)}`);
	return json({ source: 'cloudflare-pages', branch: 'main', commit: deployed });
});
const reload = vi.fn();

class FakeWorker extends EventTarget {
	state: ServiceWorkerState = 'installing';
	become(state: ServiceWorkerState) {
		this.state = state;
		this.dispatchEvent(new Event('statechange'));
	}
}

interface FakeRegistration extends EventTarget {
	installing: FakeWorker | null;
	waiting: FakeWorker | null;
	active: FakeWorker | null;
	update: ReturnType<typeof vi.fn>;
}

/** A service worker container; `onUpdate` is what registration.update() does. */
function fakeSw(opts: { controlled: boolean; onUpdate?: (reg: FakeRegistration) => unknown }) {
	const active = new FakeWorker();
	active.state = 'activated';
	const reg: FakeRegistration = Object.assign(new EventTarget(), {
		installing: null,
		waiting: null,
		active,
		update: vi.fn()
	});
	reg.update.mockImplementation(async () => opts.onUpdate?.(reg));
	const container = Object.assign(new EventTarget(), {
		controller: opts.controlled ? active : null,
		getRegistration: vi.fn(async () => reg)
	}) as unknown as ServiceWorkerContainer;
	return { container, reg };
}

/** From now on, registration.update() does `onUpdate`. */
function armUpdate(reg: FakeRegistration, onUpdate: (reg: FakeRegistration) => unknown) {
	reg.update.mockImplementation(async () => onUpdate(reg));
}

/** update() finds a new worker and leaves it installing; the spec moves it on. */
function installsNewWorker(reg: FakeRegistration): FakeWorker {
	const worker = new FakeWorker();
	reg.installing = worker;
	worker.addEventListener('statechange', () => {
		if (worker.state === 'activated') reg.active = worker;
		if (worker.state === 'activated' || worker.state === 'redundant') reg.installing = null;
	});
	reg.dispatchEvent(new Event('updatefound'));
	return worker;
}

function show(deps: Partial<VersionWatchDeps> = {}) {
	return render(NewerVersionNotice, {
		props: { deps: { runningCommit: RUNNING, fetchImpl, serviceWorker: undefined, reload, ...deps } }
	});
}

const text = (key: string, locale = 'en') => readMessages(locale)[key] as string;
const notice = () => screen.queryByTestId('newer-version-notice');
const refreshButton = () => screen.getByRole('button', { name: text('newer_version_refresh') });

async function noticeShown() {
	await vi.waitFor(() => expect(notice()?.textContent).toContain(text('newer_version_available')));
}

/** Lets the version read and its follow-ups run, so an absent notice is really absent. */
async function checked() {
	await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
	await settle();
}

beforeEach(() => {
	deployed = RUNNING;
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.clearAllMocks();
	reportProblem.mockReset();
	resetOnLine();
	setLocale('en', { reload: false });
	newerVersion.set({ state: 'none' });
});

describe('#1052 the notice', () => {
	it.each(LOCALES)('%s: a differing deployed build shows the notice and a Refresh button', async (locale) => {
		setLocale(locale, { reload: false });
		deployed = NEWER;
		show();

		await vi.waitFor(() =>
			expect(notice()?.textContent).toContain(text('newer_version_available', locale))
		);
		expect(
			screen.getByRole('button', { name: text('newer_version_refresh', locale) })
		).toBeTruthy();
	});

	it('the same build deployed as running shows nothing', async () => {
		show();
		await checked();
		expect(notice()).toBeNull();
	});

	it('a deployed stamp with no commit (a dev server) shows nothing', async () => {
		deployed = null;
		show();
		await checked();
		expect(notice()).toBeNull();
	});

	it('a failed version read shows nothing', async () => {
		fetchImpl.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		show();
		await checked();
		expect(notice()).toBeNull();
	});

	it('reads a fresh /version.json, not a cached one, which would hide the deploy', async () => {
		show();
		await checked();
		expect(fetchImpl).toHaveBeenCalledWith('/version.json', { cache: 'no-store' });
	});
});

describe('#1052 the notice waits out the normal auto-update', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	it('a controlled page shows nothing during the grace, then the notice when nothing installs', async () => {
		deployed = NEWER;
		show({ serviceWorker: fakeSw({ controlled: true }).container });

		await vi.advanceTimersByTimeAsync(UPDATE_GRACE_MS - 1000);
		expect(notice()).toBeNull();
		await vi.advanceTimersByTimeAsync(1000);
		await noticeShown();
	});

	it('a worker still installing after the grace means the auto-update is in flight: nothing shows', async () => {
		deployed = NEWER;
		const sw = fakeSw({ controlled: true });
		show({ serviceWorker: sw.container });
		sw.reg.installing = new FakeWorker();

		await vi.advanceTimersByTimeAsync(UPDATE_GRACE_MS + 1000);
		expect(notice()).toBeNull();
	});

	it('re-checks before showing: builds that match by the end of the grace show nothing', async () => {
		deployed = NEWER;
		show({ serviceWorker: fakeSw({ controlled: true }).container });
		await vi.advanceTimersByTimeAsync(1000);
		deployed = RUNNING;

		await vi.advanceTimersByTimeAsync(UPDATE_GRACE_MS);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(notice()).toBeNull();
	});

	it('a slow update check: the grace starts only once update() settles with nothing installing', async () => {
		deployed = NEWER;
		let settleUpdate!: () => void;
		const sw = fakeSw({ controlled: true, onUpdate: () => new Promise<void>((r) => (settleUpdate = r)) });
		show({ serviceWorker: sw.container });

		await vi.advanceTimersByTimeAsync(UPDATE_GRACE_MS + 2000);
		expect(notice()).toBeNull();
		settleUpdate();
		await vi.advanceTimersByTimeAsync(UPDATE_GRACE_MS - 1000);
		expect(notice()).toBeNull();
		await vi.advanceTimersByTimeAsync(1000);
		await noticeShown();
	});

	it('an auto-update that fails after the grace: the notice follows as the worker goes redundant', async () => {
		deployed = NEWER;
		let worker: FakeWorker | undefined;
		const sw = fakeSw({ controlled: true, onUpdate: (reg) => (worker = installsNewWorker(reg)) });
		show({ serviceWorker: sw.container });

		await vi.advanceTimersByTimeAsync(UPDATE_GRACE_MS + 2000);
		expect(notice()).toBeNull();
		worker!.become('redundant');
		await noticeShown();
	});
});

describe('#1052 when it checks again', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	it('a deploy found on return to the foreground shows the notice', async () => {
		show();
		await vi.advanceTimersByTimeAsync(VISIBILITY_CHECK_MIN_GAP_MS);
		expect(notice()).toBeNull();

		deployed = NEWER;
		document.dispatchEvent(new Event('visibilitychange'));
		await noticeShown();
	});

	it('a deploy found by the hourly check shows the notice', async () => {
		show();
		await vi.advanceTimersByTimeAsync(1000);
		expect(notice()).toBeNull();

		deployed = NEWER;
		await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
		await noticeShown();
	});
});

describe('#1052 Refresh', () => {
	beforeEach(() => {
		deployed = NEWER;
	});

	it('with no service worker, reloads the page', async () => {
		show();
		await noticeShown();
		await fireEvent.click(refreshButton());

		await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
	});

	it('an uncontrolled page reloads once the new worker is active', async () => {
		let worker: FakeWorker | undefined;
		const sw = fakeSw({ controlled: false, onUpdate: (reg) => (worker = installsNewWorker(reg)) });
		show({ serviceWorker: sw.container });
		await noticeShown();
		await fireEvent.click(refreshButton());

		await vi.waitFor(() => expect(worker).toBeDefined());
		expect(reload).not.toHaveBeenCalled();
		worker!.become('activated');
		await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
	});

	it('an uncontrolled page with no newer worker reloads into the newest one the server has', async () => {
		show({ serviceWorker: fakeSw({ controlled: false }).container });
		await noticeShown();
		await fireEvent.click(refreshButton());

		await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
	});

	it('a controlled page leaves the reload to the worker taking over, and shows no failure', async () => {
		vi.useFakeTimers();
		let worker: FakeWorker | undefined;
		const sw = fakeSw({ controlled: true });
		show({ serviceWorker: sw.container });
		await vi.advanceTimersByTimeAsync(UPDATE_GRACE_MS);
		await noticeShown();
		armUpdate(sw.reg, (reg) => (worker = installsNewWorker(reg)));
		const checksBefore = sw.reg.update.mock.calls.length;
		await fireEvent.click(refreshButton());

		await vi.waitFor(() => expect(worker).toBeDefined());
		worker!.become('activated');
		await vi.advanceTimersByTimeAsync(REFRESH_WAIT_MS);
		expect(sw.reg.update).toHaveBeenCalledTimes(checksBefore + 1);
		expect(reload).not.toHaveBeenCalled();
		expect(notice()?.textContent).not.toContain("Can't");
		expect(reportProblem).not.toHaveBeenCalled();
	});
});

describe('#1052 Refresh: a new worker that lands fast is a success, never "still old"', () => {
	beforeEach(() => {
		deployed = NEWER;
		vi.useFakeTimers();
	});

	async function refreshWith(controlled: boolean, onUpdate: (reg: FakeRegistration) => unknown) {
		const sw = fakeSw({ controlled });
		show({ serviceWorker: sw.container });
		await vi.advanceTimersByTimeAsync(UPDATE_GRACE_MS);
		await noticeShown();
		armUpdate(sw.reg, onUpdate);
		await fireEvent.click(refreshButton());
		await vi.advanceTimersByTimeAsync(REFRESH_WAIT_MS);
		return sw;
	}

	function noFailure() {
		expect(notice()?.textContent).not.toContain("Can't");
		expect(reportProblem).not.toHaveBeenCalled();
	}

	it('the new worker is active before update() settles: no failure, the take-over reloads', async () => {
		await refreshWith(true, (reg) => installsNewWorker(reg).become('activated'));
		noFailure();
		expect(reload).not.toHaveBeenCalled();
	});

	it('an uncontrolled page whose new worker is active before update() settles reloads', async () => {
		await refreshWith(false, (reg) => installsNewWorker(reg).become('activated'));
		noFailure();
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it('a changed active worker, with no updatefound seen, is a success', async () => {
		await refreshWith(true, (reg) => {
			const worker = new FakeWorker();
			worker.state = 'activated';
			reg.active = worker;
		});
		noFailure();
	});

	it('a controllerchange during the update is a success', async () => {
		const sw = fakeSw({ controlled: true });
		show({ serviceWorker: sw.container });
		await vi.advanceTimersByTimeAsync(UPDATE_GRACE_MS);
		await noticeShown();
		armUpdate(sw.reg, () => sw.container.dispatchEvent(new Event('controllerchange')));
		await fireEvent.click(refreshButton());
		await vi.advanceTimersByTimeAsync(REFRESH_WAIT_MS);
		noFailure();
	});

	it('a new worker that fails before update() settles: says it did not install', async () => {
		await refreshWith(true, (reg) => installsNewWorker(reg).become('redundant'));
		await vi.waitFor(() => expect(notice()?.textContent).toContain(text('newer_version_failed_install')));
		expect(reportProblem).toHaveBeenCalledWith({
			area: 'update',
			action: 'refresh',
			reason: 'the new version failed to install'
		});
	});
});

describe('#1052 Refresh does not hang when the reload never comes', () => {
	const NO_RELOAD = 'the page did not reload after the update';

	beforeEach(() => {
		deployed = NEWER;
		vi.useFakeTimers();
	});

	async function saysNoReloadOnce() {
		await vi.waitFor(() => expect(notice()?.textContent).toContain(text('newer_version_failed_install')));
		expect(reportProblem).toHaveBeenCalledTimes(1);
		expect(reportProblem).toHaveBeenCalledWith({ area: 'update', action: 'refresh', reason: NO_RELOAD });
		await vi.advanceTimersByTimeAsync(RELOAD_WAIT_MS * 2);
		expect(reportProblem).toHaveBeenCalledTimes(1);
	}

	it('the new worker takes over but the page never reloads: says why, after the wait', async () => {
		const sw = fakeSw({ controlled: true });
		show({ serviceWorker: sw.container });
		await vi.advanceTimersByTimeAsync(UPDATE_GRACE_MS);
		await noticeShown();
		armUpdate(sw.reg, (reg) => installsNewWorker(reg).become('activated'));
		await fireEvent.click(refreshButton());

		await vi.advanceTimersByTimeAsync(RELOAD_WAIT_MS - 1000);
		expect(notice()?.textContent).not.toContain("Can't");
		expect(reportProblem).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1000);
		await saysNoReloadOnce();
	});

	it('with no service worker, a reload that never happens: says why, after the wait', async () => {
		show();
		await noticeShown();
		await fireEvent.click(refreshButton());
		await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));

		await vi.advanceTimersByTimeAsync(RELOAD_WAIT_MS);
		await saysNoReloadOnce();
	});
});

describe('#1052 Refresh says why it cannot update, and reports it once', () => {
	beforeEach(() => {
		deployed = NEWER;
		vi.useFakeTimers();
	});

	async function refreshOnControlledPage(onUpdate?: (reg: FakeRegistration) => unknown) {
		const sw = fakeSw({ controlled: true });
		show({ serviceWorker: sw.container });
		await vi.advanceTimersByTimeAsync(UPDATE_GRACE_MS);
		await noticeShown();
		if (onUpdate) armUpdate(sw.reg, onUpdate);
		await fireEvent.click(refreshButton());
		return sw;
	}

	async function says(key: string, reason: string) {
		await vi.waitFor(() => expect(notice()?.textContent).toContain(text(key)));
		expect(reload).not.toHaveBeenCalled();
		expect(reportProblem).toHaveBeenCalledTimes(1);
		expect(reportProblem).toHaveBeenCalledWith({ area: 'update', action: 'refresh', reason });
	}

	it('offline: says there is no connection, and tries nothing', async () => {
		const sw = fakeSw({ controlled: true });
		show({ serviceWorker: sw.container });
		await vi.advanceTimersByTimeAsync(UPDATE_GRACE_MS);
		await noticeShown();
		await goOffline();

		const checksBefore = sw.reg.update.mock.calls.length;
		await fireEvent.click(refreshButton());

		await says('newer_version_failed_no_connection', 'the device is offline');
		expect(sw.reg.update).toHaveBeenCalledTimes(checksBefore);
	});

	it('the update check fails and the server cannot be reached: says there is no connection', async () => {
		await refreshOnControlledPage(() => {
			fetchImpl.mockRejectedValueOnce(new TypeError('Failed to fetch'));
			return Promise.reject(new TypeError('Failed to fetch'));
		});
		await says(
			'newer_version_failed_no_connection',
			'the update check failed: TypeError: Failed to fetch; the server could not be reached'
		);
	});

	it('the server answers the worker script with an error: says it did not install, with the error', async () => {
		const bad = 'Failed to update a ServiceWorker: A bad HTTP response code (404) was received';
		await refreshOnControlledPage(() => Promise.reject(new TypeError(bad)));
		await says('newer_version_failed_install', `the update check failed: TypeError: ${bad}`);
	});

	it('the update check never answers while the server does: says it did not install, after the wait', async () => {
		await refreshOnControlledPage(() => new Promise(() => {}));
		await vi.advanceTimersByTimeAsync(REFRESH_WAIT_MS);
		await says('newer_version_failed_install', 'the update check did not answer');
	});

	it('the new worker fails to install: says it did not install', async () => {
		let worker: FakeWorker | undefined;
		await refreshOnControlledPage((reg) => (worker = installsNewWorker(reg)));
		await vi.waitFor(() => expect(worker).toBeDefined());
		worker!.become('redundant');

		await says('newer_version_failed_install', 'the new version failed to install');
	});

	it('the new worker never finishes installing: says it did not install, after the wait', async () => {
		await refreshOnControlledPage((reg) => installsNewWorker(reg));
		await vi.advanceTimersByTimeAsync(REFRESH_WAIT_MS);

		await says('newer_version_failed_install', 'the new version failed to install');
	});

	it('no newer worker while the deployed build still differs: says the server sends the old one', async () => {
		await refreshOnControlledPage();
		await says('newer_version_failed_not_deployed', 'the server still serves the old version');
	});

	it('a second failed Refresh reports its own failure once', async () => {
		await refreshOnControlledPage();
		await says('newer_version_failed_not_deployed', 'the server still serves the old version');
		await fireEvent.click(refreshButton());

		await vi.waitFor(() => expect(reportProblem).toHaveBeenCalledTimes(2));
		await vi.advanceTimersByTimeAsync(REFRESH_WAIT_MS);
		expect(reportProblem).toHaveBeenCalledTimes(2);
	});
});

// (*MVOX:Josquin*)
