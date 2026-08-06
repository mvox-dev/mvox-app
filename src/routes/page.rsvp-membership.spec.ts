// @vitest-environment happy-dom
//
// The full-scope RSVP disabled/pending/non-member UX fix, page level. Renders
// the real +page -> AgendaList -> RsvpControl chain (with agenda rows present,
// unlike page.rsvp-wiring which loads an empty agenda) so we can observe the
// membership 3-state and the write-failure feedback in the DOM:
//   - loading / lookup-failure   → control disabled, NO false non-member hint
//   - confirmed non-member       → control disabled + hint
//   - confirmed member           → control enabled, no hint
//   - a rejected write           → per-row error surfaced + optimistic value reverts
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		agenda_empty_no_rehearsals: () => 'No upcoming rehearsals.',
		agenda_duration_min: (p: { minutes: number }) => `${p.minutes} min`,
		agenda_today: () => 'Today',
		agenda_tomorrow: () => 'Tomorrow',
		agenda_gap_weeks: (p: { weeks: number }) => `${p.weeks} weeks later`,
		agenda_load_error: () => "Couldn't load the agenda.",
		agenda_retry: () => 'Retry',
		rsvp_status_going: () => 'Going',
		rsvp_status_not_going: () => 'Not going',
		rsvp_status_maybe: () => 'Maybe',
		rsvp_status_late: () => 'Running late',
		rsvp_non_member_hint: () => 'Only members can RSVP.',
		rsvp_save_failed: () => 'Could not save your answer.'
	}
}));

const {
	loadAgendaMock,
	discoverMock,
	gotoMock,
	findMyMemberIdMock,
	listMyRsvpsMock,
	applyRsvpChangeMock
} = vi.hoisted(() => ({
	loadAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	applyRsvpChangeMock: vi.fn()
}));
vi.mock('$lib/agenda/agendaData', () => ({ loadAgenda: loadAgendaMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
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
// The write dispatch — mocked so a "write" can be made to reject on demand.
vi.mock('$lib/rsvp/rsvpOptimistic', () => ({ applyRsvpChange: applyRsvpChangeMock }));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, selectedCollectiveDbStore, urlCollectiveDbStore } from '$lib/collectives/store';

const EVENT = {
	id: 'e1',
	name: 'Rehearsal e1',
	startDatetime: '2026-06-15T09:00:00.000Z',
	durationMinutes: 90,
	location: ''
};

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

async function waitForGoingButton(container: HTMLElement) {
	return waitFor(() => {
		const btn = container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
		expect(btn).not.toBeNull();
		return btn!;
	});
}

afterEach(() => {
	cleanup();
	loadAgendaMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	applyRsvpChangeMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('+page — membership 3-state gates the non-member hint', () => {
	it('while membership is UNRESOLVED (findMyMemberId still in flight) the control is disabled with NO non-member hint', async () => {
		loadAgendaMock.mockResolvedValue([EVENT]);
		findMyMemberIdMock.mockReturnValue(new Promise(() => {})); // never resolves — stays loading
		listMyRsvpsMock.mockResolvedValue([]);
		setAuthedWithOneCollective();

		const { container } = render(Page);
		const btn = await waitForGoingButton(container);

		expect(btn.disabled).toBe(true);
		expect(container.textContent).not.toContain('Only members can RSVP.');
	});

	it('a CONFIRMED non-member (findMyMemberId resolves null) shows disabled control + the hint', async () => {
		loadAgendaMock.mockResolvedValue([EVENT]);
		findMyMemberIdMock.mockResolvedValue(null);
		listMyRsvpsMock.mockResolvedValue([]);
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await waitForGoingButton(container);

		await waitFor(() => {
			expect(container.textContent).toContain('Only members can RSVP.');
		});
		const btn = container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
	});

	it('a CONFIRMED member (findMyMemberId resolves an id) enables the control and shows no hint', async () => {
		loadAgendaMock.mockResolvedValue([EVENT]);
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue([]);
		setAuthedWithOneCollective();

		const { container } = render(Page);
		const btn = await waitForGoingButton(container);

		await waitFor(() => {
			expect(btn.disabled).toBe(false);
		});
		expect(container.textContent).not.toContain('Only members can RSVP.');
	});

	it('a lookup FAILURE (findMyMemberId rejects) does NOT assert non-member — disabled, no false hint (fail-safe)', async () => {
		loadAgendaMock.mockResolvedValue([EVENT]);
		findMyMemberIdMock.mockRejectedValue(new Error('lookup boom'));
		listMyRsvpsMock.mockResolvedValue([]);
		setAuthedWithOneCollective();

		const { container } = render(Page);
		const btn = await waitForGoingButton(container);

		// Let the rejection settle so we're testing the FAILED state, not merely the
		// initial loading tick.
		await waitFor(() => expect(findMyMemberIdMock).toHaveBeenCalled());
		await Promise.resolve();
		await Promise.resolve();

		expect(btn.disabled).toBe(true);
		expect(container.textContent).not.toContain('Only members can RSVP.');
	});
});

describe('+page — write-failure feedback (a rejected rsvp save)', () => {
	it('a rejected write surfaces a per-row save-failed error AND reverts the optimistic value', async () => {
		loadAgendaMock.mockResolvedValue([EVENT]);
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue([]);
		applyRsvpChangeMock.mockRejectedValue(new Error('save failed'));
		setAuthedWithOneCollective();

		const { container } = render(Page);
		const goingBtn = await waitForGoingButton(container);
		await waitFor(() => expect(goingBtn.disabled).toBe(false));

		await fireEvent.click(goingBtn);

		// The error line appears...
		await waitFor(() => {
			expect(container.querySelector('[data-testid="rsvp-save-failed"]')).not.toBeNull();
		});
		expect(container.textContent).toContain('Could not save your answer.');
		// ...and the optimistic "going" is rolled back (no longer the active answer).
		const goingAfter = container.querySelector('[data-testid="rsvp-btn-going"]');
		expect(goingAfter?.getAttribute('aria-pressed')).toBe('false');
	});
});

// (*MVOX:Tallis*)
