// @vitest-environment happy-dom
//
// T4.8/#28 RED — "not shown as a member anywhere until the domain name is filled."
// RECON A proved the ONLY surface presenting the current user AS a member is the
// enabled RSVP control (S1) on the agenda home. This spec renders the real +page →
// AgendaList → RsvpControl chain and asserts that an INCOMPLETE member (real member
// id, but no domain name → completionGateStore !== 'complete') is NOT presented as a
// member: her control stays disabled and — crucially — she is NEVER mislabeled a
// non-member (no "Only members can RSVP" hint; she is a member, just incomplete).
//
// RED: +page.svelte does not yet consume completionGateStore, so a member with an
// incomplete gate is wrongly shown the ENABLED control — the load-bearing
// suppression assertions FAIL until GREEN folds the gate into `gatedMembership`.
// Template: page.rsvp-membership.spec.ts.
import { render, cleanup, waitFor } from '@testing-library/svelte';
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

const { loadAgendaMock, discoverMock, gotoMock, findMyMemberIdMock, listMyRsvpsMock } = vi.hoisted(() => ({
	loadAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn()
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

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, selectedCollectiveDbStore, urlCollectiveDbStore } from '$lib/collectives/store';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';

const EVENT = {
	id: 'e1',
	name: 'Rehearsal e1',
	startDatetime: '2026-06-15T09:00:00.000Z',
	durationMinutes: 90,
	location: ''
};

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({ status: 'authenticated', personIdByDb: { polyphony: 'person-p' }, expMs: Date.now() + 100_000 });
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

function goingButton(container: HTMLElement) {
	return container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
}
async function waitForGoingButton(container: HTMLElement) {
	return waitFor(() => {
		const btn = goingButton(container);
		expect(btn).not.toBeNull();
		return btn!;
	});
}

afterEach(() => {
	cleanup();
	loadAgendaMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetGate();
});

describe('+page — completion gate suppresses S1 (the member RSVP affordance)', () => {
	it('an INCOMPLETE member (real member id, gate incomplete) is NOT shown as a member: control disabled AND no non-member hint (never mislabeled)', async () => {
		loadAgendaMock.mockResolvedValue([EVENT]);
		findMyMemberIdMock.mockResolvedValue('member-1'); // she IS an active member
		listMyRsvpsMock.mockResolvedValue([]);
		completionGateStore.set('incomplete'); // ...but her domain name is missing
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await waitForGoingButton(container);
		await vi.waitFor(() => expect(findMyMemberIdMock).toHaveBeenCalled());
		// Let membership resolution + Svelte reactivity fully settle (a macrotask flushes
		// all pending microtasks/effects), so we test the RESOLVED state, not a loading tick.
		await new Promise((r) => setTimeout(r, 0));

		const btn = goingButton(container)!;
		expect(btn.disabled).toBe(true); // S1 must NOT light for an incomplete member
		expect(container.textContent).not.toContain('Only members can RSVP.'); // she is a member, not a non-member
	});

	it('a COMPLETE member (gate complete) IS shown as a member: control enabled (the release path)', async () => {
		loadAgendaMock.mockResolvedValue([EVENT]);
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue([]);
		completionGateStore.set('complete');
		setAuthedWithOneCollective();

		const { container } = render(Page);
		const btn = await waitForGoingButton(container);
		await waitFor(() => expect(btn.disabled).toBe(false));
		expect(container.textContent).not.toContain('Only members can RSVP.');
	});

	it('a member with the gate still LOADING is disabled with NO hint (no flash of the member affordance)', async () => {
		loadAgendaMock.mockResolvedValue([EVENT]);
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue([]);
		completionGateStore.set('loading');
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await waitForGoingButton(container);
		await vi.waitFor(() => expect(findMyMemberIdMock).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 0));

		const btn = goingButton(container)!;
		expect(btn.disabled).toBe(true);
		expect(container.textContent).not.toContain('Only members can RSVP.');
	});

	it('a GENUINE non-member is unaffected by the gate: disabled + the non-member hint (no over-reach)', async () => {
		loadAgendaMock.mockResolvedValue([EVENT]);
		findMyMemberIdMock.mockResolvedValue(null); // confirmed non-member
		listMyRsvpsMock.mockResolvedValue([]);
		completionGateStore.set('complete');
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await waitForGoingButton(container);
		await waitFor(() => expect(container.textContent).toContain('Only members can RSVP.'));
		expect(goingButton(container)!.disabled).toBe(true);
	});
});

// (*MVOX:Tallis*)
