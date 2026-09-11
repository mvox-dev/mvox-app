// @vitest-environment happy-dom
//
// #326 RED (component half) — RSVP: the saved state gets its own cue.
//
// The defect: RsvpControl has exactly three states — nonMember (hint),
// pending (silent aria-busy disable, PO-ruled, STAYS), saveFailed
// (role=alert, value reverted upstream). There is NO saved state: a value
// whose write reconciled renders byte-identical to one that was never
// attempted — exactly the dangerous pair epic #289 names.
//
// Contract (issue #326 + Gama's ruling, #328 comment 5637755878, applied to
// #326 by reference in its build note): **shared cue SHAPE, own NODE per
// surface.** The cue's reference minimum is #267's persistent role="status"
// aria-live="polite" announcement node (profile roster-names shape, sr-only
// there): mounted from the start (a live region must pre-exist its first
// announcement to be announced), text set when the write settles
// successfully, blank otherwise. Whether an ADDITIONAL visible cue joins the
// announcement is GREEN's stated choice — these tests pin the announcement
// and tolerate any extra visible cue; they never assert the absence of other
// saved-themed markup.
//
// The component's leg of the contract: a new `saved` boolean prop.
//   - saved=true  → the persistent status region carries m.rsvp_saved().
//   - saved=false → the region is mounted and BLANK.
//   - `saved` never disables anything — the control stays interactive.
//   - `pending` rendering stays byte-identical to today (PO's silent-disable
//     ruling): aria-busy + disabled + NO text anywhere, including the cue
//     region — the wiring clears `saved` when a new write starts.
//
// CONSISTENCY (pin for the sibling): #327 (attendance saved cue) mirrors this
// exact shape — a persistent per-surface role="status" aria-live="polite"
// announcement node OWNED by that surface (never a reused node from another
// surface's queue), fed by the same per-key Set wiring, with its own
// per-surface i18n key (attendance_saved next to this surface's rsvp_saved).
// Same shape, own node — see the Gama ruling cited above.
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RsvpControl from './RsvpControl.svelte';

vi.mock('$lib/paraglide/messages.js', () => {
	const keys: Record<string, (params?: Record<string, unknown>) => string> = {
		rsvp_status_going: () => 'Going',
		rsvp_status_not_going: () => 'Not going',
		rsvp_status_maybe: () => 'Maybe',
		rsvp_status_late: () => 'Running late',
		rsvp_group_label: () => 'RSVP',
		rsvp_non_member_hint: () => 'You are not an active member.',
		rsvp_save_failed: () => 'Could not save your answer.',
		rsvp_saved: () => 'Saved.'
	};
	return {
		m: new Proxy(keys, {
			get: (target, key) => target[String(key)] ?? (() => `[${String(key)}]`)
		})
	};
});

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

// (*MVOX:Tallis* — #326 RED)
