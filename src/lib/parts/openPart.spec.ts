import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

import { openPart } from './openPart';
import { gotoMock } from '$lib/testing/routeMocks';

afterEach(() => gotoMock.mockReset());

describe('openPart', () => {
	it('navigates to the viewer with the label in the navigation state', () => {
		const label = { work: 'Ave', composer: 'Byrd', edition: 'Urtext', filename: 'ave.pdf' };
		openPart('sampledb', 'file-1', label);
		expect(gotoMock.mock.calls).toEqual([
			['/part/file-1?db=sampledb', { state: { partLabel: label } }]
		]);
	});

	it('sends an empty state when there is no label', () => {
		openPart('sampledb', 'file-1');
		expect(gotoMock.mock.calls).toEqual([['/part/file-1?db=sampledb', { state: {} }]]);
	});
});
