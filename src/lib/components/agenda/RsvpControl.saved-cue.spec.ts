// @vitest-environment happy-dom
// A settled write gets its own cue: a persistent role=status node, mounted blank, carrying
// m.rsvp_saved() when saved. `saved` disables nothing; `pending` stays a silent disable.
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RsvpControl from './RsvpControl.svelte';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket', {
		rsvp_status_going: () => 'Going',
		rsvp_status_not_going: () => 'Not going',
		rsvp_status_maybe: () => 'Maybe',
		rsvp_status_late: () => 'Running late',
		rsvp_group_label: () => 'RSVP',
		rsvp_non_member_hint: () => 'You are not an active member.',
		rsvp_save_failed: () => 'Could not save your answer.',
		rsvp_saved: () => 'Saved.'
	})
);

afterEach(cleanup);

const STATUS_VALUES = ['going', 'not_going', 'maybe', 'late'] as const;

function savedRegion(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[data-testid="rsvp-saved-status"]');
}

describe('RsvpControl — the saved announcement region is PERSISTENT (#267 shape)', () => {
	it('mounted even when saved=false — a live region must exist before its first announcement', () => {
		const { container } = render(RsvpControl, { status: null, saved: false });
		expect(savedRegion(container)).not.toBeNull();
	});

	it('the region is role="status" aria-live="polite" (polite announcement, never an alert)', () => {
		const { container } = render(RsvpControl, { status: null, saved: false });
		const region = savedRegion(container);
		expect(region?.getAttribute('role')).toBe('status');
		expect(region?.getAttribute('aria-live')).toBe('polite');
	});

	it('saved=false (default) — the region is mounted BLANK', () => {
		const { container } = render(RsvpControl, { status: null });
		expect(savedRegion(container)?.textContent?.trim()).toBe('');
	});
});

describe('RsvpControl — saved=true announces the reconciled write', () => {
	it('saved=true — the region carries the i18n saved message (m.rsvp_saved)', () => {
		const { container } = render(RsvpControl, { status: 'going', saved: true });
		expect(savedRegion(container)?.textContent).toContain('Saved.');
	});

	it('saved=true with status=null — a successfully CLEARED answer announces too (a reconciled null renders identically to never-answered; the cue is the only distinguisher)', () => {
		const { container } = render(RsvpControl, { status: null, saved: true });
		expect(savedRegion(container)?.textContent).toContain('Saved.');
	});

	it('saved never disables — all four buttons stay enabled and clicking still calls onchange', async () => {
		const onchange = vi.fn();
		const { container } = render(RsvpControl, { status: 'going', saved: true, onchange });
		for (const value of STATUS_VALUES) {
			const btn = container.querySelector(
				`[data-testid="rsvp-btn-${value}"]`
			) as HTMLButtonElement | null;
			expect(btn?.disabled, `rsvp-btn-${value}`).toBe(false);
		}
		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-maybe"]')!);
		expect(onchange).toHaveBeenCalledWith('maybe');
	});

	it('saved=true does NOT set aria-busy — saved is a settled state, not an in-flight one', () => {
		const { container } = render(RsvpControl, { status: 'going', saved: true });
		const control = container.querySelector('[data-testid="rsvp-control"]');
		expect(control?.getAttribute('aria-busy')).not.toBe('true');
	});
});

describe('RsvpControl — the pending silent-disable stays byte-identical (PO ruling)', () => {
	it('pending=true — disabled + aria-busy, and NO text anywhere: msg line blank, saved region blank', () => {
		const { container } = render(RsvpControl, { status: 'going', pending: true });
		const control = container.querySelector('[data-testid="rsvp-control"]');
		expect(control?.getAttribute('aria-busy')).toBe('true');
		for (const value of STATUS_VALUES) {
			const btn = container.querySelector(
				`[data-testid="rsvp-btn-${value}"]`
			) as HTMLButtonElement | null;
			expect(btn?.disabled, `rsvp-btn-${value}`).toBe(true);
		}
		expect(
			container.querySelector('[data-testid="rsvp-msg-line"]')?.textContent?.trim()
		).toBe('');
		expect(savedRegion(container)?.textContent?.trim()).toBe('');
		expect(container.textContent).not.toContain('Saved.');
	});
});

describe('RsvpControl — failure and saved are mutually exclusive states', () => {
	it('saveFailed=true (saved absent) — the role=alert error renders, the saved region stays blank', () => {
		const { container } = render(RsvpControl, { status: 'going', saveFailed: true });
		const alert = container.querySelector('[data-testid="rsvp-save-failed"]');
		expect(alert).not.toBeNull();
		expect(alert?.getAttribute('role')).toBe('alert');
		expect(container.textContent).toContain('Could not save your answer.');
		expect(savedRegion(container)?.textContent?.trim()).toBe('');
	});
});

// (*MVOX:Tallis*)
