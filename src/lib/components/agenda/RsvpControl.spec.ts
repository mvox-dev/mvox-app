// @vitest-environment happy-dom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RsvpControl from './RsvpControl.svelte';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		rsvp_status_going: () => 'Going',
		rsvp_status_not_going: () => 'Not going',
		rsvp_status_maybe: () => 'Maybe',
		rsvp_status_late: () => 'Running late',
		rsvp_non_member_hint: () => 'You are not an active member.'
	}
}));

afterEach(cleanup);

const STATUSES = [
	['going', 'Going'],
	['not_going', 'Not going'],
	['maybe', 'Maybe'],
	['late', 'Running late']
] as const;

describe('RsvpControl — four status buttons', () => {
	it('renders one button per status with data-testid="rsvp-btn-<status>"', () => {
		const { container } = render(RsvpControl, { status: null });
		for (const [value] of STATUSES) {
			expect(container.querySelector(`[data-testid="rsvp-btn-${value}"]`)).not.toBeNull();
		}
	});

	it.each(STATUSES)('status=%s label comes from i18n (m.rsvp_status_%s), not a hardcoded string', (value, label) => {
		const { container } = render(RsvpControl, { status: null });
		const btn = container.querySelector(`[data-testid="rsvp-btn-${value}"]`);
		expect(btn?.textContent?.trim()).toBe(label);
	});
});

describe('RsvpControl — active status marking', () => {
	it('the button matching `status` has aria-pressed="true"; the other three "false"', () => {
		const { container } = render(RsvpControl, { status: 'maybe' });
		for (const [value] of STATUSES) {
			const btn = container.querySelector(`[data-testid="rsvp-btn-${value}"]`);
			expect(btn?.getAttribute('aria-pressed')).toBe(value === 'maybe' ? 'true' : 'false');
		}
	});

	it('status=null — no button is marked active (unanswered)', () => {
		const { container } = render(RsvpControl, { status: null });
		for (const [value] of STATUSES) {
			const btn = container.querySelector(`[data-testid="rsvp-btn-${value}"]`);
			expect(btn?.getAttribute('aria-pressed')).toBe('false');
		}
	});
});

describe('RsvpControl — tap behavior (set / tap-active-to-clear)', () => {
	it('tapping an INACTIVE status calls onchange(value)', async () => {
		const onchange = vi.fn();
		const { container } = render(RsvpControl, { status: 'going', onchange });
		const btn = container.querySelector('[data-testid="rsvp-btn-maybe"]');
		expect(btn).not.toBeNull();
		await fireEvent.click(btn!);
		expect(onchange).toHaveBeenCalledWith('maybe');
	});

	it('tapping the ACTIVE status calls onchange(null) — clears the answer', async () => {
		const onchange = vi.fn();
		const { container } = render(RsvpControl, { status: 'going', onchange });
		const btn = container.querySelector('[data-testid="rsvp-btn-going"]');
		expect(btn).not.toBeNull();
		await fireEvent.click(btn!);
		expect(onchange).toHaveBeenCalledWith(null);
	});

	it('tapping when status=null (unanswered) calls onchange(value) — a fresh set, never null', async () => {
		const onchange = vi.fn();
		const { container } = render(RsvpControl, { status: null, onchange });
		const btn = container.querySelector('[data-testid="rsvp-btn-late"]');
		expect(btn).not.toBeNull();
		await fireEvent.click(btn!);
		expect(onchange).toHaveBeenCalledWith('late');
	});
});

describe('RsvpControl — non-member (disabled) state', () => {
	it('disabled=true — every status button carries the disabled attribute', () => {
		const { container } = render(RsvpControl, { status: null, disabled: true });
		for (const [value] of STATUSES) {
			const btn = container.querySelector(`[data-testid="rsvp-btn-${value}"]`) as HTMLButtonElement | null;
			expect(btn?.disabled).toBe(true);
		}
	});

	it('disabled=true — shows the non-member hint, not a silent no-op', () => {
		const { container } = render(RsvpControl, { status: null, disabled: true });
		expect(container.textContent).toContain('You are not an active member.');
	});

	it('disabled=false (default) — no hint text, buttons are enabled', () => {
		const { container } = render(RsvpControl, { status: null });
		expect(container.textContent).not.toContain('You are not an active member.');
		const btn = container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
		expect(btn?.disabled).toBe(false);
	});

	it('disabled=true — clicking a button does NOT call onchange (real disablement, not just visual)', async () => {
		const onchange = vi.fn();
		const { container } = render(RsvpControl, { status: null, disabled: true, onchange });
		const btn = container.querySelector('[data-testid="rsvp-btn-going"]');
		expect(btn).not.toBeNull();
		await fireEvent.click(btn!);
		expect(onchange).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis*)
