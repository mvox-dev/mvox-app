// @vitest-environment happy-dom
//
// #434 slice 6/6 RED (component half) — attendance marking is gated offline.
//
// CONTRACT: AttendanceSurface reads the ONE signal store ($lib/net/online)
// itself, like RsvpControl, so both host pages get the gate for free:
//   • offline → every attendance-toggle-* is write-disabled (`aria-disabled`
//     = "true", the surface's existing focusable-disable shape — `disabled`
//     also passes) and ONE visible sentence
//     [data-testid="attendance-write-unavailable"] inside attendance-panel
//     carries m.write_unavailable_no_signal() — once per panel, not per row.
//   • a toggle click while offline never reaches `ontoggle`.
//   • back online → toggles enabled, sentence gone.
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AttendanceSurface from './AttendanceSurface.svelte';
import type { AgendaItem } from '$lib/agenda/types';
import {
	expectVisibleReason,
	goOffline,
	goOnline,
	isWriteDisabled,
	resetOnLine
} from '$lib/testing/networkSignal';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const REASON = '[write_unavailable_no_signal]';

const ITEM = {
	id: 'ev1',
	name: 'Tuesday Rehearsal',
	startDatetime: '2026-06-15T09:00:00.000Z',
	durationMinutes: 90,
	location: '',
	conductors: [],
	owners: [],
	editors: []
} as unknown as AgendaItem;

const MEMBERS = [
	{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'a@x.com' },
	{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'b@x.com' }
];

function toggles(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll('[data-testid^="attendance-toggle-"]'));
}

function renderSurface(ontoggle = vi.fn()) {
	const rendered = render(AttendanceSurface, {
		item: ITEM,
		members: MEMBERS as never,
		attendanceByMemberId: {},
		rsvpByMemberId: {},
		loading: false,
		error: false,
		ontoggle
	});
	return { ...rendered, ontoggle };
}

beforeEach(async () => {
	await goOnline();
});

afterEach(() => {
	cleanup();
	resetOnLine();
});

describe('AttendanceSurface — offline gates marking and says why (#434 slice 6)', () => {
	it('offline: every toggle is write-disabled and ONE visible reason sits in the panel', async () => {
		const { container } = renderSurface();
		expect(toggles(container).length).toBe(6);
		await goOffline();

		for (const t of toggles(container)) expect(isWriteDisabled(t), t.dataset.testid).toBe(true);
		const panel = container.querySelector('[data-testid="attendance-panel"]') as HTMLElement;
		expectVisibleReason(panel, 'attendance-write-unavailable', REASON);
		expect(panel.querySelectorAll('[data-testid="attendance-write-unavailable"]')).toHaveLength(1);
	});

	it('offline: a toggle click never reaches ontoggle', async () => {
		const { container, ontoggle } = renderSurface();
		await goOffline();

		for (const t of toggles(container)) await fireEvent.click(t);
		expect(ontoggle).not.toHaveBeenCalled();
	});

	it('back online: toggles enabled, reason gone, a click marks', async () => {
		const { container, ontoggle } = renderSurface();
		await goOffline();
		await goOnline();

		for (const t of toggles(container)) expect(isWriteDisabled(t), t.dataset.testid).toBe(false);
		expect(container.querySelector('[data-testid="attendance-write-unavailable"]')).toBeNull();
		await fireEvent.click(container.querySelector('[data-testid="attendance-toggle-m1-present"]')!);
		expect(ontoggle).toHaveBeenCalledWith('m1', 'present');
	});
});

// (*MVOX:Tallis* — #434 slice 6 RED)
