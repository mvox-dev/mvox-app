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

const { loadAgendaMock, discoverMock, gotoMock } = vi.hoisted(() => ({
	loadAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn()
}));
vi.mock('$lib/agenda/agendaData', () => ({ loadAgenda: loadAgendaMock }));
// Same boundary as store.spec.ts: severs discover.ts's $env import under happy-dom
// and stubs goto (can't run outside an app / not exercised by this spec).
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));

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

afterEach(() => {
	cleanup();
	loadAgendaMock.mockReset();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('+page — agenda load error + retry (M2)', () => {
	it('surfaces an error + retry affordance on rejection, instead of a permanent skeleton', async () => {
		loadAgendaMock.mockRejectedValueOnce(new Error('network down'));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-skeleton"]')).toBeNull();
		});
		expect(container.querySelector('[data-testid="agenda-error"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="agenda-retry"]')).not.toBeNull();
	});

	it('retry re-invokes loadAgenda and recovers on success', async () => {
		loadAgendaMock.mockRejectedValueOnce(new Error('network down'));
		loadAgendaMock.mockResolvedValueOnce([]);
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
		expect(loadAgendaMock).toHaveBeenCalledTimes(2);
	});

	it('a later successful load is not clobbered by a stale rejection (requestId guard)', async () => {
		let rejectFirst!: (err: Error) => void;
		loadAgendaMock.mockImplementationOnce(
			() => new Promise((_resolve, reject) => { rejectFirst = reject; })
		);
		loadAgendaMock.mockResolvedValueOnce([]);
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
