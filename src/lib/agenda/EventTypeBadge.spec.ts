// @vitest-environment happy-dom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import AgendaList from './AgendaList.svelte';
import AgendaMonthView from './AgendaMonthView.svelte';
import type { AgendaItem } from '$lib/agenda/types';

afterEach(cleanup);

const concert = {
	id: 'c1',
	name: 'Kevadkontsert',
	startDatetime: '2030-06-12T16:00:00.000Z',
	durationMinutes: 90,
	location: '',
	conductors: [],
	owners: [],
	editors: [],
	eventType: 'concert'
} as AgendaItem;

describe('#590 — the event-type badge is monospace in both agenda views', () => {
	it.each([
		['the day list', AgendaList],
		['the month view', AgendaMonthView]
	])('%s', (_view, View) => {
		const { container } = render(View, { items: [concert] });
		const badge = container.querySelector('[data-testid="event-type-badge-c1"]');
		expect(badge).not.toBeNull();
		expect(badge!.classList.contains('font-mono')).toBe(true);
	});
});
