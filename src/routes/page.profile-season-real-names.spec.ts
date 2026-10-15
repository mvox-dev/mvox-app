// @vitest-environment happy-dom
// #361 on /profile (#920): both rows of the season-rate table mark the member name once.
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/seasons/entuSeasons', async () =>
	(await import('$lib/testing/mocks/seasons')).seasonReadsModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('member')
);
vi.mock('$lib/attendance/attendanceData', async (importOriginal) =>
	(await import('$lib/testing/mocks/events')).attendanceListsOverRealModule(importOriginal)
);

import Page from './profile/+page.svelte';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { realNamesWire, REAL_NAMES } from '$lib/testing/realNamesFence';
import { expectNameMarkedOnce } from '$lib/testing/nameMarker';
import { resetAppState } from '$lib/testing/appReset';
import { resetGate } from '$lib/profile/completionGate';
import { listAttendanceMock } from '$lib/testing/mocks/events';
import { EXPAND, renderWithSummary, wireMemberSeason } from '$lib/testing/pages/profileSeason';

beforeEach(() => {
	wireMemberSeason({ owners: ['person-p'] });
	listAttendanceMock.mockResolvedValue([
		{ attendanceId: 'a1', memberId: 'm1', status: 'present' },
		{ attendanceId: 'a2', memberId: 'm9', status: 'present' }
	]);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	resetTypeIdCache();
	resetAppState();
	resetGate();
});

describe('#361 — season-rate table: both row branches mark the member name', () => {
	it('active rows (member-rate-*) and the archived row (member-rate-inactive-*) mark the name once', async () => {
		realNamesWire();
		const { container } = await renderWithSummary(Page);
		await waitFor(() => expect(container.querySelector(EXPAND)).not.toBeNull());
		await fireEvent.click(container.querySelector(EXPAND)!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-rate-inactive-m9"]')).not.toBeNull()
		);
		const row = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement;
		expectNameMarkedOnce(row('member-rate-m1'), REAL_NAMES.m1, 'in the active season-rate row');
		expectNameMarkedOnce(row('member-rate-m2'), REAL_NAMES.m2, 'in the active season-rate row');
		expectNameMarkedOnce(row('member-rate-inactive-m9'), REAL_NAMES.m9, 'in the archived season-rate row');
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
