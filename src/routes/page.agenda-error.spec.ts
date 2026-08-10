// @vitest-environment happy-dom
//
// M2 fix (Bentham MUST-FIX): a rejecting loadAgenda() used to leave agendaLoading
// stuck at true forever — permanent skeleton, no error, no recovery. This spec
// covers the error state + retry affordance added in +page.svelte.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		agenda_empty_no_rehearsals: () => 'No upcoming rehearsals.',
		agenda_duration_min: (params: { minutes: number }) => `${params.minutes} min`,
		agenda_today: () => 'Today',
		agenda_tomorrow: () => 'Tomorrow',
		agenda_gap_weeks: (params: { weeks: number }) => `In ${params.weeks} weeks`,
		agenda_load_error: () => "Couldn't load the agenda.",
		agenda_retry: () => 'Retry'
	}
}));

const { loadFullAgendaMock, discoverMock, gotoMock, findMyMemberIdMock, listMyRsvpsMock } = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn()
}));
vi.mock('$lib/agenda/agendaData', () => ({
	loadFullAgenda: loadFullAgendaMock
}));
// Same boundary as store.spec.ts: severs discover.ts's $env import under happy-dom
// and stubs goto (can't run outside an app / not exercised by this spec).
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
// #12 — +page.svelte now imports $lib/rsvp/rsvpData at module scope, which pulls
// in $lib/entu/request -> $env/dynamic/public (same $env wall as discover.ts).
// This spec doesn't exercise RSVP behavior, just needs the import to resolve
// cleanly; rsvpsByEventId is reimplemented inline (pure, no $env) since the
// page calls it directly on listMyRsvps' resolution.
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: findMyMemberIdMock,
	listMyRsvps: listMyRsvpsMock,
	rsvpsByEventId: (rsvps: Array<{ rsvpId: string; eventId: string; status: string }>) => {
		const map: Record<string, { rsvpId: string; status: string }> = {};
		for (const r of rsvps) map[r.eventId] = { rsvpId: r.rsvpId, status: r.status };
		return map;
	},
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { collectiveState, selectedCollectiveDbStore, urlCollectiveDbStore } from '$lib/collectives/store';

function setAuthedWithOneCollective() {
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'p1' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'p1' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

function setAuthedWithTwoCollectives() {
	authStore.set({
		status: 'authenticated',
		personIdByDb: { 'org-a': 'p1', 'org-b': 'p1' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [
			{ db: 'org-a', name: 'Org A', personId: 'p1' },
			{ db: 'org-b', name: 'Org B', personId: 'p1' }
		],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('org-a');
}

// Safe default so loadForSelected's findMyMemberId(...).then/listMyRsvps(...).then
// have something to resolve — no test in this file asserts on RSVP state.
findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue([]);

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('+page — agenda load error + retry (M2)', () => {
	it('surfaces an error + retry affordance on rejection, instead of a permanent skeleton', async () => {
		loadFullAgendaMock.mockRejectedValueOnce(new Error('network down'));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-skeleton"]')).toBeNull();
		});
		expect(container.querySelector('[data-testid="agenda-error"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="agenda-retry"]')).not.toBeNull();
	});

	it('retry re-invokes loadAgenda and recovers on success', async () => {
		loadFullAgendaMock.mockRejectedValueOnce(new Error('network down'));
		loadFullAgendaMock.mockResolvedValueOnce({ upcoming: [], recent: [], seasonId: null, seasonConductors: [] });
		setAuthedWithOneCollective();
		const { container } = render(Page);

		const retryBtn = await waitFor(() => {
			const btn = container.querySelector('[data-testid="agenda-retry"]');
			expect(btn).not.toBeNull();
			return btn as HTMLButtonElement;
		});

		await fireEvent.click(retryBtn);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-error"]')).toBeNull();
		});
		expect(container.querySelector('[data-testid="agenda-empty"]')).not.toBeNull();
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
	});

	it('a later successful load is not clobbered by a stale rejection (requestId guard)', async () => {
		let rejectFirst!: (err: Error) => void;
		loadFullAgendaMock.mockImplementationOnce(
			() => new Promise((_resolve, reject) => { rejectFirst = reject; })
		);
		loadFullAgendaMock.mockResolvedValueOnce({ upcoming: [], recent: [], seasonId: null, seasonConductors: [] });
		setAuthedWithTwoCollectives();
		const { container } = render(Page);

		// Switch collective before the first (org-a) load resolves — starts a second,
		// distinct request for org-b while the first is still in flight.
		selectedCollectiveDbStore.set('org-b');

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-empty"]')).not.toBeNull();
		});

		// The stale org-a request now rejects — must not clobber the resolved org-b state.
		rejectFirst(new Error('stale'));
		await new Promise((r) => setTimeout(r, 0));

		expect(container.querySelector('[data-testid="agenda-error"]')).toBeNull();
		expect(container.querySelector('[data-testid="agenda-empty"]')).not.toBeNull();
	});
});

// (*MVOX:Byrd*)
