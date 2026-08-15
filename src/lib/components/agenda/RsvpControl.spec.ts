// @vitest-environment happy-dom
import { render, cleanup, createEvent, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RsvpControl from './RsvpControl.svelte';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		rsvp_status_going: () => 'Going',
		rsvp_status_not_going: () => 'Not going',
		rsvp_status_maybe: () => 'Maybe',
		rsvp_status_late: () => 'Running late',
		rsvp_group_label: () => 'RSVP',
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

// ---------------------------------------------------------------------------
// #156 — roving tabindex. WAI-APG TOOLBAR semantics: exactly one Tab stop,
// arrows MOVE focus only (never activate — tapping the active status CLEARS the
// answer, so an arrow that activated would silently destroy data), Tab/Enter/
// Space untouched, and the stop never parks on a disabled button.
// ---------------------------------------------------------------------------
describe('RsvpControl — roving tabindex (#156)', () => {
	function buttons(container: HTMLElement): HTMLButtonElement[] {
		return Array.from(
			container.querySelectorAll<HTMLButtonElement>('[data-testid^="rsvp-btn-"]')
		);
	}
	function tabStops(container: HTMLElement): HTMLButtonElement[] {
		return buttons(container).filter((b) => b.getAttribute('tabindex') === '0');
	}

	it('the group is a role="toolbar" with an accessible name', () => {
		const { container } = render(RsvpControl, { status: 'maybe' });
		const group = container.querySelector('[data-testid="rsvp-status-group"]');
		expect(group?.getAttribute('role')).toBe('toolbar');
		expect(group?.getAttribute('aria-label')).toBe('RSVP');
	});

	it('exactly ONE button is the Tab stop, and it is the answered status', () => {
		const { container } = render(RsvpControl, { status: 'maybe' });
		const stops = tabStops(container);
		expect(stops).toHaveLength(1);
		expect(stops[0].getAttribute('data-testid')).toBe('rsvp-btn-maybe');
	});

	it('status=null (never answered) still has exactly one Tab stop — the FIRST button, not zero', () => {
		const { container } = render(RsvpControl, { status: null });
		const stops = tabStops(container);
		expect(stops).toHaveLength(1);
		expect(stops[0].getAttribute('data-testid')).toBe('rsvp-btn-going');
	});

	it('ArrowRight moves focus forward and WRAPS; ArrowLeft wraps backwards', async () => {
		const { container } = render(RsvpControl, { status: null });
		const btns = buttons(container);
		expect(btns).toHaveLength(4);

		btns[0].focus();
		await fireEvent.keyDown(btns[0], { key: 'ArrowRight' });
		expect(document.activeElement).toBe(btns[1]);

		await fireEvent.keyDown(btns[3], { key: 'ArrowRight' });
		expect(document.activeElement).toBe(btns[0]);

		await fireEvent.keyDown(btns[0], { key: 'ArrowLeft' });
		expect(document.activeElement).toBe(btns[3]);
	});

	it('Home/End jump to the ends', async () => {
		const { container } = render(RsvpControl, { status: null });
		const btns = buttons(container);
		btns[1].focus();
		await fireEvent.keyDown(btns[1], { key: 'End' });
		expect(document.activeElement).toBe(btns[3]);
		await fireEvent.keyDown(btns[3], { key: 'Home' });
		expect(document.activeElement).toBe(btns[0]);
	});

	it('arrows MOVE ONLY — they never call onchange (toolbar, not radiogroup)', async () => {
		const onchange = vi.fn();
		const { container } = render(RsvpControl, { status: 'going', onchange });
		const btns = buttons(container);
		btns[0].focus();
		await fireEvent.keyDown(btns[0], { key: 'ArrowRight' });
		await fireEvent.keyDown(btns[1], { key: 'ArrowRight' });
		expect(onchange).not.toHaveBeenCalled();
	});

	it('the Tab stop TRAVELS with focus', async () => {
		const { container } = render(RsvpControl, { status: 'going' });
		const btns = buttons(container);
		btns[0].focus();
		await fireEvent.keyDown(btns[0], { key: 'ArrowRight' });
		const stops = tabStops(container);
		expect(stops).toHaveLength(1);
		expect(stops[0]).toBe(btns[1]);
	});

	it('Tab, Enter and Space are NOT preventDefault-ed — focus leaves the group and the button still activates', () => {
		const { container } = render(RsvpControl, { status: 'going' });
		const btn = buttons(container)[0];
		for (const key of ['Tab', 'Enter', ' ']) {
			const event = createEvent.keyDown(btn, { key });
			fireEvent(btn, event);
			expect(event.defaultPrevented, `${key} must not be swallowed`).toBe(false);
		}
	});

	it('all four buttons disabled (non-member) — arrows move nothing, no crash, and no stop is claimed by a disabled button', async () => {
		const { container } = render(RsvpControl, { status: 'going', nonMember: true });
		const btns = buttons(container);
		btns.forEach((b) => expect(b.disabled).toBe(true));
		await fireEvent.keyDown(btns[0], { key: 'ArrowRight' });
		expect(document.activeElement).not.toBe(btns[1]);
	});
});

// (*MVOX:Tallis*)
