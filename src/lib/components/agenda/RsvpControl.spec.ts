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
		rsvp_non_member_hint: () => 'You are not an active member.',
		rsvp_save_failed: () => 'Could not save your answer.'
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

// ── The root split (this fix): the disable REASON is now two distinct inputs ──
// `nonMember` (a confirmed non-member — disabled + hint) and `pending` (a write
// in flight — disabled, NO hint, per the PO's silent-disable ruling). The old
// single `disabled` boolean conflated the two, so a member with a write in
// flight got the "Only members can RSVP" hint (the reported regression).

describe('RsvpControl — non-member state (nonMember)', () => {
	it('nonMember=true — every status button carries the disabled attribute', () => {
		const { container } = render(RsvpControl, { status: null, nonMember: true });
		for (const [value] of STATUSES) {
			const btn = container.querySelector(`[data-testid="rsvp-btn-${value}"]`) as HTMLButtonElement | null;
			expect(btn?.disabled).toBe(true);
		}
	});

	it('nonMember=true — shows the non-member hint, not a silent no-op', () => {
		const { container } = render(RsvpControl, { status: null, nonMember: true });
		expect(container.textContent).toContain('You are not an active member.');
	});

	it('neither nonMember nor pending (default) — no hint text, buttons are enabled', () => {
		const { container } = render(RsvpControl, { status: null });
		expect(container.textContent).not.toContain('You are not an active member.');
		const btn = container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
		expect(btn?.disabled).toBe(false);
	});

	it('nonMember=true — clicking a button does NOT call onchange (real disablement, not just visual)', async () => {
		const onchange = vi.fn();
		const { container } = render(RsvpControl, { status: null, nonMember: true, onchange });
		const btn = container.querySelector('[data-testid="rsvp-btn-going"]');
		expect(btn).not.toBeNull();
		await fireEvent.click(btn!);
		expect(onchange).not.toHaveBeenCalled();
	});
});

describe('RsvpControl — pending (write in flight) state', () => {
	it('pending=true — every status button is disabled (preserves #15 whole-control disable)', () => {
		const { container } = render(RsvpControl, { status: 'going', pending: true });
		for (const [value] of STATUSES) {
			const btn = container.querySelector(`[data-testid="rsvp-btn-${value}"]`) as HTMLButtonElement | null;
			expect(btn?.disabled).toBe(true);
		}
	});

	it('pending=true — does NOT show the non-member hint (silent disable, PO ruling)', () => {
		const { container } = render(RsvpControl, { status: 'going', pending: true });
		expect(container.textContent).not.toContain('You are not an active member.');
	});

	it('pending=true — clicking a button does NOT call onchange', async () => {
		const onchange = vi.fn();
		const { container } = render(RsvpControl, { status: 'going', pending: true, onchange });
		const btn = container.querySelector('[data-testid="rsvp-btn-maybe"]');
		expect(btn).not.toBeNull();
		await fireEvent.click(btn!);
		expect(onchange).not.toHaveBeenCalled();
	});

	it('a member with a write in flight (pending, not nonMember) sees disabled buttons and NO hint — the reported regression', () => {
		const { container } = render(RsvpControl, { status: 'going', nonMember: false, pending: true });
		const btn = container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
		expect(btn?.disabled).toBe(true);
		expect(container.textContent).not.toContain('You are not an active member.');
	});
});

describe('RsvpControl — aria-busy while pending (a11y)', () => {
	it('pending=true — the control advertises aria-busy="true"', () => {
		const { container } = render(RsvpControl, { status: 'going', pending: true });
		const control = container.querySelector('[data-testid="rsvp-control"]');
		expect(control?.getAttribute('aria-busy')).toBe('true');
	});

	it('pending=false (default) — aria-busy is not "true"', () => {
		const { container } = render(RsvpControl, { status: 'going' });
		const control = container.querySelector('[data-testid="rsvp-control"]');
		expect(control?.getAttribute('aria-busy')).not.toBe('true');
	});

	it('nonMember=true (but no write in flight) — aria-busy is not "true"', () => {
		const { container } = render(RsvpControl, { status: null, nonMember: true });
		const control = container.querySelector('[data-testid="rsvp-control"]');
		expect(control?.getAttribute('aria-busy')).not.toBe('true');
	});
});

describe('RsvpControl — non-member hint is associated via aria-describedby (a11y)', () => {
	it('nonMember=true — the hint <p> has an id and the buttons point at it via aria-describedby', () => {
		const { container } = render(RsvpControl, { status: null, nonMember: true });
		const hint = container.querySelector('[data-testid="rsvp-non-member-hint"]');
		expect(hint).not.toBeNull();
		const hintId = hint!.getAttribute('id');
		expect(hintId).toBeTruthy();
		const btn = container.querySelector('[data-testid="rsvp-btn-going"]');
		expect(btn?.getAttribute('aria-describedby')).toBe(hintId);
	});

	it('not nonMember — buttons carry no aria-describedby (nothing to describe)', () => {
		const { container } = render(RsvpControl, { status: null });
		const btn = container.querySelector('[data-testid="rsvp-btn-going"]');
		expect(btn?.getAttribute('aria-describedby')).toBeNull();
	});
});

describe('RsvpControl — write-failure feedback (saveFailed)', () => {
	it('saveFailed=true — surfaces an inline save-failed error line', () => {
		const { container } = render(RsvpControl, { status: 'going', saveFailed: true });
		const err = container.querySelector('[data-testid="rsvp-save-failed"]');
		expect(err).not.toBeNull();
		expect(err?.textContent).toContain('Could not save your answer.');
	});

	it('the save-failed line is a role="alert" live region so it is announced', () => {
		const { container } = render(RsvpControl, { status: 'going', saveFailed: true });
		const err = container.querySelector('[data-testid="rsvp-save-failed"]');
		expect(err?.getAttribute('role')).toBe('alert');
	});

	it('saveFailed=false (default) — no error line', () => {
		const { container } = render(RsvpControl, { status: 'going' });
		expect(container.querySelector('[data-testid="rsvp-save-failed"]')).toBeNull();
	});
});

describe('RsvpControl — reserved message space (no layout jump)', () => {
	it('always renders the message-line container even with no hint/error, so toggling it never shifts layout', () => {
		const { container } = render(RsvpControl, { status: 'going' });
		expect(container.querySelector('[data-testid="rsvp-msg-line"]')).not.toBeNull();
	});
});

// (*MVOX:Tallis*)
