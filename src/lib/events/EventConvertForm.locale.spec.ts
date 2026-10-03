// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Collective } from '$lib/collectives/types';
import type { EventDetail } from '$lib/events/eventDetail';
import type { EventActions } from '$lib/events/eventPageState';

const localeMock = vi.hoisted(() => ({
	state: null as { get(k: string): string | undefined; set(k: string, v: string): unknown } | null
}));
vi.mock('$lib/paraglide/messages.js', async () => {
	const { SvelteMap } = await import('svelte/reactivity');
	localeMock.state ??= new SvelteMap<string, string>([['locale', 'en']]);
	return {
		m: new Proxy({} as Record<string, () => string>, {
			get: (_t, key) => () => `${localeMock.state!.get('locale')}:${String(key)}`
		})
	};
});

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import EventConvertForm from './EventConvertForm.svelte';

afterEach(() => {
	cleanup();
	localeMock.state?.set('locale', 'en');
});

describe('EventConvertForm error line', () => {
	it('follows a language switch', async () => {
		const { getByTestId } = render(EventConvertForm, {
			detail: {
				id: 'ev-9',
				seasonId: 'season-1',
				startDatetime: '2026-08-21T16:00:00.000Z'
			} as EventDetail,
			selected: { db: 'sampledb', name: 'Sample', personId: 'p1' } as Collective,
			canConvert: true,
			isOffline: false,
			generation: () => 0,
			actions: {} as EventActions,
			refreshDetail: async () => {}
		});
		await fireEvent.click(getByTestId('event-detail-convert'));
		await fireEvent.input(getByTestId('event-convert-interval'), { target: { value: '' } });
		await fireEvent.click(getByTestId('event-convert-submit'));
		await waitFor(() =>
			expect(getByTestId('event-convert-error').textContent?.trim()).toBe(
				'en:event_convert_interval_required'
			)
		);

		localeMock.state!.set('locale', 'et');

		await waitFor(() =>
			expect(getByTestId('event-convert-error').textContent?.trim()).toBe(
				'et:event_convert_interval_required'
			)
		);
	});
});
