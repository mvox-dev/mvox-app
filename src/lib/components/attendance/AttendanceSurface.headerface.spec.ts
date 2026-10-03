// @vitest-environment happy-dom
// The panel's header span (event name) is the smallest truncated user text: no display face.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

import AttendanceSurface from './AttendanceSurface.svelte';
import type { AgendaItem } from '$lib/agenda/types';

afterEach(cleanup);

const item: AgendaItem = {
	id: 'past-1',
	name: 'Rehearsal past-1',
	startDatetime: '2026-06-10T16:00:00.000Z',
	durationMinutes: 90,
	location: '',
	conductors: [],
	owners: [],
	editors: []
} as AgendaItem;

describe('AttendanceSurface — panel header uses the body face, not font-display (#290)', () => {
	it('the event-name span beside the close button drops font-display but keeps truncate + text-sm', () => {
		const { container } = render(AttendanceSurface, {
			props: {
				item,
				members: [{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'a@example.com' }],
				attendanceByMemberId: {},
				rsvpByMemberId: {},
				loading: false,
				error: false
			}
		});

		// Locate the header span structurally: it shares the panel's header row
		// with the close button, before the roster rows.
		const closeBtn = container.querySelector('[data-testid="attendance-collapse-btn"]');
		expect(closeBtn).not.toBeNull();
		const headerRow = closeBtn!.parentElement!;
		const headerSpan = headerRow.querySelector('span');
		expect(headerSpan).not.toBeNull();
		expect(headerSpan!.textContent).toBe(item.name);

		expect(headerSpan!.classList.contains('font-display')).toBe(false);
		// Size/truncation unchanged — only the face goes.
		expect(headerSpan!.classList.contains('truncate')).toBe(true);
		expect(headerSpan!.classList.contains('text-sm')).toBe(true);
	});
});

// (*MVOX:Tallis*)
