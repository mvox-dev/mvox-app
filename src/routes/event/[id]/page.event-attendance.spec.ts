// @vitest-environment happy-dom
// The event page's attendance surface on a past event.
import { waitFor, fireEvent } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$app/state', async () => (await import('$lib/testing/mocks/events')).appStateModule());
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { expectNameMarkedOnce } from '$lib/testing/nameMarker';
import {
	pastEventEntity,
	renderComposePage,
	RN_RECORD_NAMES,
	seasonEntity,
	useEventPage
} from '$lib/testing/pages/eventDetail';

useEventPage();

function conductorSeason(over: Partial<Record<string, unknown>> = {}) {
	return seasonEntity({
		conductor: [{ reference: 'p-viewer' }, { reference: 'p-mihkel' }],
		...over
	});
}

describe('/event/[id] — attendance surfaces on a PAST event (#103 TE.3)', () => {
	it("shows the viewer's OWN attendance badge (member-1 was recorded present)", async () => {
		const { container, fetchStub } = renderComposePage({ event: pastEventEntity() });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-attendance"]')).not.toBeNull();
		});
		const badge = container.querySelector('[data-testid="event-detail-attendance-badge"]');
		expect(badge).not.toBeNull();
		const rendered = `${badge!.textContent ?? ''} ${badge!.getAttribute('aria-label') ?? ''}`;
		expect(rendered).toContain('attendance_status_present');
		const urls = fetchStub.mock.calls.map((c) => String(c[0]));
		expect(urls.some((u) => u.includes('_type.string=attendance'))).toBe(true);
	});

	it('shows the attendance tally — per-status counts from the child-of-event read (2 present / 1 absent / 1 late)', async () => {
		const { container } = renderComposePage({ event: pastEventEntity() });
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-attendance-tally"]')
			).not.toBeNull();
		});
		const count = (s: string) =>
			container.querySelector(`[data-testid="event-detail-attendance-tally-${s}"]`);
		expect(count('present'), 'tally-present missing').not.toBeNull();
		expect(count('present')!.textContent).toContain('2');
		expect(count('absent')!.textContent).toContain('1');
		expect(count('late')!.textContent).toContain('1');
	});

	it("offers 'Take attendance' to a CONDUCTOR and opens the real AttendanceSurface over the real roster", async () => {
		const { container } = renderComposePage({
			event: pastEventEntity({ _editor: [{ reference: 'p-viewer' }] }),
			season: conductorSeason()
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="take-attendance-btn"]')).not.toBeNull();
		});

		await fireEvent.click(container.querySelector('[data-testid="take-attendance-btn"]')!);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-panel"]')).not.toBeNull();
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-row-member-1"]')).not.toBeNull();
		});
		expect(
			container.querySelector('[data-testid="attendance-row-member-1"]')!.textContent
		).toContain('Viewer Vera');
		expect(container.querySelector('[data-testid="attendance-row-member-2"]')).not.toBeNull();

		expect(
			container
				.querySelector('[data-testid="attendance-toggle-member-1-present"]')
				?.getAttribute('aria-pressed')
		).toBe('true');
		expect(
			container
				.querySelector('[data-testid="attendance-toggle-member-3-absent"]')
				?.getAttribute('aria-pressed')
		).toBe('true');
	});

	it('the header names the conductors by their REAL names with the toggle ON (#469 review F3)', async () => {
		const { container } = renderComposePage({
			event: pastEventEntity({ _editor: [{ reference: 'p-viewer' }] }),
			season: conductorSeason(),
			realNames: true
		});
		const line = await waitFor(() => {
			const el = container.querySelector('[data-testid="event-detail-conductors"]');
			expect(el).not.toBeNull();
			expect(el!.textContent).toContain(RN_RECORD_NAMES['p-mihkel']);
			return el!;
		});
		expect(line.textContent).toContain(RN_RECORD_NAMES['p-viewer']);
		expect(line.textContent).not.toContain('Mihkel Putrinš');
		expect(line.textContent).not.toContain('Viewer Vera');
	});

	it('the header keeps the conductors\' PROFILE names with the toggle OFF, spending no records read (#469 review F3)', async () => {
		const { container, fetchStub } = renderComposePage({
			event: pastEventEntity({ _editor: [{ reference: 'p-viewer' }] }),
			season: conductorSeason(),
			realNames: 'off'
		});
		const line = await waitFor(() => {
			const el = container.querySelector('[data-testid="event-detail-conductors"]');
			expect(el).not.toBeNull();
			expect(el!.textContent).toContain('Mihkel Putrinš');
			return el!;
		});
		for (const recordName of Object.values(RN_RECORD_NAMES)) {
			expect(line.textContent).not.toContain(recordName);
		}
		expect(
			fetchStub.mock.calls
				.map((c) => String(c[0]))
				.filter((u) => u.includes('admin_member_record'))
		).toEqual([]);
	});

	it('the RSVP tally card names a PAST event\'s respondents by their REAL names with the toggle ON — resolved via loadRosterIncludingArchived (#469)', async () => {
		const { container } = renderComposePage({
			event: pastEventEntity(),
			realNames: true
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-tally-toggle"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="event-detail-tally-toggle"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-tally-card"]')).not.toBeNull();
		});

		const card = container.querySelector('[data-testid="event-detail-tally-card"]')!;
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-tally-card-group-going"]')!.textContent
			).toContain(RN_RECORD_NAMES['p-viewer']);
		});
		expect(card.textContent).not.toContain('Viewer Vera');
	});

	it('the RSVP tally card renders each respondent name through the capture marker, exactly once (#361)', async () => {
		const { container } = renderComposePage({
			event: pastEventEntity(),
			realNames: true
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-tally-toggle"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="event-detail-tally-toggle"]')!);
		const group = await waitFor(() => {
			const el = container.querySelector('[data-testid="event-detail-tally-card-group-going"]');
			expect(el).not.toBeNull();
			expect(el!.textContent).toContain(RN_RECORD_NAMES['p-viewer']);
			return el!;
		});
		expectNameMarkedOnce(group, RN_RECORD_NAMES['p-viewer'], 'in the RSVP tally card');
	});

	it("a NON-conductor gets the badge and tally but NO 'Take attendance'", async () => {
		const { container } = renderComposePage({ event: pastEventEntity() });
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-attendance-tally"]')
			).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="take-attendance-btn"]')).toBeNull();
		expect(container.querySelector('[data-testid="attendance-panel"]')).toBeNull();
	});

	it('NO attendance section on a past event with NOTHING recorded — a plain member gets no empty placeholder', async () => {
		const { container } = renderComposePage({ event: pastEventEntity(), attendance: [] });
		await waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-row"]').length).toBe(2);
		});
		await new Promise((r) => setTimeout(r, 30));
		expect(container.querySelector('[data-testid="event-detail-attendance"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-attendance-badge"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-attendance-tally"]')).toBeNull();
	});

	it("a CONDUCTOR still gets the section on a past event with nothing recorded — 'Take attendance' needs somewhere to live", async () => {
		const { container } = renderComposePage({
			event: pastEventEntity({ _editor: [{ reference: 'p-viewer' }] }),
			season: conductorSeason(),
			attendance: []
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="take-attendance-btn"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="event-detail-attendance"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="event-detail-attendance-tally"]')).toBeNull();
		expect(
			container.querySelector('[data-testid="event-detail-attendance-tally-present"]')
		).toBeNull();
	});

	it("the badge is the agenda's own component — colour dot (aria-hidden) + data-status", async () => {
		const { container } = renderComposePage({ event: pastEventEntity() });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-attendance-badge"]')).not.toBeNull();
		});
		const badge = container.querySelector('[data-testid="event-detail-attendance-badge"]')!;
		expect(badge.getAttribute('data-status')).toBe('present');
		const dot = badge.querySelector('.rounded-full');
		expect(dot, 'the badge must carry the status dot the agenda badge carries').not.toBeNull();
		expect(dot!.getAttribute('aria-hidden')).toBe('true');
	});

	it('NO attendance section on a FUTURE event — even for a conductor', async () => {
		const { container } = renderComposePage({ season: conductorSeason() });
		await waitFor(() => {
			const going = container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement;
			expect(going).not.toBeNull();
			expect(going.disabled).toBe(false);
		});
		await new Promise((r) => setTimeout(r, 30));
		expect(container.querySelector('[data-testid="event-detail-attendance"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-attendance-badge"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-attendance-tally"]')).toBeNull();
		expect(container.querySelector('[data-testid="take-attendance-btn"]')).toBeNull();
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
