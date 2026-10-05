// @vitest-environment happy-dom
// The event page composing header, RSVP, works and attendance together.
import { waitFor, fireEvent } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$app/state', async () => (await import('$lib/testing/mocks/events')).appStateModule());
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import {
	pastEventEntity,
	renderComposePage,
	seasonEntity,
	useEventPage
} from '$lib/testing/pages/eventDetail';

useEventPage();

describe('/event/[id] — composing both sections (#103 TE.3)', () => {
	it('BOTH sections absent when there is nothing to show (future event, no works) — the page stays whole', async () => {
		const { container } = renderComposePage({ programItems: [], repertoireItems: [] });
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
			).toBe('true');
		});
		await new Promise((r) => setTimeout(r, 30));
		expect(container.querySelector('[data-testid="event-detail-works"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-attendance"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
			'Tuesday Rehearsal'
		);
		expect(container.querySelector('[data-testid="event-detail-rsvp"]')).not.toBeNull();
	});

	it('integration: ONE page composes header + rsvp + works (expanded, managed) + attendance (badge, tally, surface) from the existing components', async () => {
		const { container } = renderComposePage({
			event: pastEventEntity({ _editor: [{ reference: 'p-viewer' }] }),
			season: seasonEntity({
				conductor: [{ reference: 'p-viewer' }],
				_editor: [{ reference: 'p-viewer' }]
			})
		});

		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-works"]')).not.toBeNull();
			expect(container.querySelector('[data-testid="event-detail-attendance"]')).not.toBeNull();
		});

		const worksSection = container.querySelector('[data-testid="event-detail-works"]')!;
		await waitFor(() => {
			expect(worksSection.querySelectorAll('[data-testid="work-row"]').length).toBe(2);
		});
		expect(worksSection.querySelector('[data-testid="works-expanded"]')).not.toBeNull();
		expect(
			worksSection.querySelector('[data-testid="work-status-active"]')
		).not.toBeNull();

		const attSection = container.querySelector('[data-testid="event-detail-attendance"]')!;
		await waitFor(() => {
			expect(
				attSection.querySelector('[data-testid="event-detail-attendance-tally"]')
			).not.toBeNull();
		});
		expect(attSection.querySelector('[data-testid="event-detail-attendance-badge"]')).not.toBeNull();
		expect(attSection.querySelector('[data-testid="take-attendance-btn"]')).not.toBeNull();

		await fireEvent.click(attSection.querySelector('[data-testid="take-attendance-btn"]')!);
		await waitFor(() => {
			expect(attSection.querySelector('[data-testid="attendance-panel"]')).not.toBeNull();
			expect(attSection.querySelector('[data-testid="attendance-row-member-1"]')).not.toBeNull();
		});

		expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
			'Tuesday Rehearsal'
		);
		expect(container.querySelector('[data-testid="event-detail-rsvp"]')).not.toBeNull();
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
