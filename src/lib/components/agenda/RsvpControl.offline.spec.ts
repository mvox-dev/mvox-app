// @vitest-environment happy-dom
// Offline, RSVP is disabled and says why in a visible sentence; a click queues nothing.
// Back online it is enabled again. `pending` alone stays a silent disable.
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RsvpControl from './RsvpControl.svelte';
import {
	expectVisibleReason,
	goOffline,
	goOnline,
	resetOnLine
} from '$lib/testing/networkSignal';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const REASON = '[write_unavailable_no_signal]';
const STATUSES = ['going', 'not_going', 'maybe', 'late'] as const;

function buttons(container: HTMLElement): HTMLButtonElement[] {
	return STATUSES.map(
		(s) => container.querySelector(`[data-testid="rsvp-btn-${s}"]`) as HTMLButtonElement
	);
}

beforeEach(async () => {
	await goOnline();
});

afterEach(() => {
	cleanup();
	resetOnLine();
});

describe('RsvpControl — offline is a disable reason that says why (#434 slice 6)', () => {
	it('offline: every button is disabled and the reason is visible inside the control', async () => {
		const { container } = render(RsvpControl, { status: 'going', onchange: vi.fn() });
		await goOffline();

		for (const b of buttons(container)) expect(b.disabled, b.dataset.testid).toBe(true);
		const control = container.querySelector('[data-testid="rsvp-control"]') as HTMLElement;
		expectVisibleReason(control, 'rsvp-write-unavailable', REASON);
	});

	it('offline at mount (the app opened with no signal): disabled from the first render', async () => {
		await goOffline();
		const { container } = render(RsvpControl, { status: null, onchange: vi.fn() });

		for (const b of buttons(container)) expect(b.disabled, b.dataset.testid).toBe(true);
		expectVisibleReason(container, 'rsvp-write-unavailable', REASON);
	});

	it('offline: a click never reaches onchange — nothing is queued', async () => {
		const onchange = vi.fn();
		const { container } = render(RsvpControl, { status: null, onchange });
		await goOffline();

		for (const b of buttons(container)) await fireEvent.click(b);
		expect(onchange).not.toHaveBeenCalled();
	});

	it('back online: enabled again, the reason gone, and a click writes', async () => {
		const onchange = vi.fn();
		const { container } = render(RsvpControl, { status: null, onchange });
		await goOffline();
		await goOnline();

		for (const b of buttons(container)) expect(b.disabled, b.dataset.testid).toBe(false);
		expect(container.querySelector('[data-testid="rsvp-write-unavailable"]')).toBeNull();
		await fireEvent.click(buttons(container)[0]);
		expect(onchange).toHaveBeenCalledWith('going');
	});

	it('online + pending: still the silent disable — no offline sentence', async () => {
		const { container } = render(RsvpControl, { status: null, pending: true, onchange: vi.fn() });

		for (const b of buttons(container)) expect(b.disabled).toBe(true);
		expect(container.querySelector('[data-testid="rsvp-write-unavailable"]')).toBeNull();
	});
});

// (*MVOX:Tallis*)
