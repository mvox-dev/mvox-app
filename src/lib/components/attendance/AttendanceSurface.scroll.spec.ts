// @vitest-environment happy-dom
//
// #158 — the attendance panel scrolls itself into view once its DATA has
// landed, not when it merely opened.
//
// Why this file exists (review F4): the fix is one `$effect` keyed on the
// `loading` prop, and NOTHING else in the suite observes scrolling — the panel
// specs all assert on rendered rows, which look identical whether the scroll
// fires on mount, on every re-render, or never. A future refactor that moves
// the call into `onMount` would restore exactly the bug #158 reports (the page
// scrolls against the three-row loading skeleton and lands short of the roster
// once the real rows expand it) with a fully green suite. These pin the edge
// the scroll hangs off, not just that a scroll happens.
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AttendanceSurface from './AttendanceSurface.svelte';
import type { AgendaItem } from '$lib/agenda/types';
import type { RosterRow } from '$lib/roster/rosterData';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const ITEM: AgendaItem = {
	id: 'ev1',
	name: 'Tuesday Rehearsal',
	startDatetime: '2026-08-01T16:00:00.000Z',
	durationMinutes: 90,
	location: 'Rehearsal Hall',
	conductors: ['p-viewer'],
	owners: [],
	editors: ['p-viewer']
};

const MEMBERS: RosterRow[] = [
	{ memberId: 'm1', personId: 'p1', name: 'Ada Lovelace', email: 'ada@example.org' },
	{ memberId: 'm2', personId: 'p2', name: 'Alan Turing', email: 'alan@example.org' }
];

/** Record the RECEIVER as well as the options — a bare call count would pass a
 *  component that scrolled some unrelated element (or the close button) into
 *  view instead of the panel. */
function spyScroll() {
	const calls: Array<{ el: Element; arg: boolean | ScrollIntoViewOptions | undefined }> = [];
	vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (
		this: Element,
		arg?: boolean | ScrollIntoViewOptions
	) {
		calls.push({ el: this, arg });
	});
	return calls;
}

/** The effect scrolls inside a `tick()` continuation; give the microtask queue
 *  a couple of turns so "did NOT scroll" assertions are real, not premature. */
async function settle() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

describe('#158 — AttendanceSurface auto-scroll', () => {
	it('does NOT scroll while the roster is still loading — the skeleton is the wrong height to measure against', async () => {
		const calls = spyScroll();
		const { container } = render(AttendanceSurface, { item: ITEM, loading: true });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-panel-loading"]')).not.toBeNull();
		});
		await settle();
		expect(calls, 'the panel scrolled against its loading skeleton').toEqual([]);
	});

	it('scrolls the PANEL into view with { block: "start", behavior: "smooth" } once loading flips false', async () => {
		const calls = spyScroll();
		const { container, rerender } = render(AttendanceSurface, {
			item: ITEM,
			loading: true,
			members: []
		});
		await settle();
		expect(calls).toEqual([]);

		// The roster arrives — the panel is now its real height.
		await rerender({ item: ITEM, loading: false, members: MEMBERS });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-row-m1"]')).not.toBeNull();
		});
		await settle();

		const panel = container.querySelector('[data-testid="attendance-panel"]')!;
		expect(calls.length, 'the loaded panel did not scroll itself into view').toBe(1);
		expect(calls[0].el, 'something other than the panel was scrolled into view').toBe(panel);
		expect(calls[0].arg).toEqual({ block: 'start', behavior: 'smooth' });
	});

	it('a load FAILURE scrolls too — the error line is what the user must be shown', async () => {
		const calls = spyScroll();
		const { container, rerender } = render(AttendanceSurface, { item: ITEM, loading: true });
		await settle();
		await rerender({ item: ITEM, loading: false, error: true });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-panel-error"]')).not.toBeNull();
		});
		await settle();
		expect(calls.length).toBe(1);
		expect(calls[0].el).toBe(container.querySelector('[data-testid="attendance-panel"]'));
	});

	it('scrolls ONCE per open — an unrelated re-render (a toggle write landing) must not yank the page again', async () => {
		const calls = spyScroll();
		const { rerender } = render(AttendanceSurface, {
			item: ITEM,
			loading: true,
			members: []
		});
		await settle();
		await rerender({ item: ITEM, loading: false, members: MEMBERS });
		await settle();
		expect(calls.length).toBe(1);

		// A toggle write settles: attendance data changes, `loading` does not.
		await rerender({
			item: ITEM,
			loading: false,
			members: MEMBERS,
			attendanceByMemberId: { m1: { attendanceId: 'a1', status: 'present' } }
		});
		await settle();
		expect(calls.length, 'a status write re-scrolled the page').toBe(1);
	});
});

// (*MVOX:Palestrina* — #157/#158 review round 1, F4)
