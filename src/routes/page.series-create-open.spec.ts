// @vitest-environment happy-dom
// Series creation on the agenda page: the [+ Series] entry point.
import { fireEvent, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/entity/entityCreate', async () =>
	(await import('$lib/testing/mocks/events')).entityCreateModule(['series', 'event'])
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

import { gotoMock } from '$lib/testing/routeMocks';
import { loadFullAgendaMock } from '$lib/testing/moduleHandles';
import { createEventMock, createEventSeriesMock } from '$lib/testing/mocks/events';
import { q } from '$lib/testing/pages/dom';
import { fill, openSeriesForm } from '$lib/testing/pages/seasonPanel';
import { renderReady } from '$lib/testing/pages/seasonRender';
import { flush } from '$lib/testing/pages/seasonEventCreate';
import { agendaResult, useSeriesCreatePage } from '$lib/testing/pages/seriesCreate';

useSeriesCreatePage();

describe('season panel — the [+ Series] entry point', () => {
	it('season editor: clicking season-manage-add-series opens series-create-form INLINE (no goto); merely opening writes nothing and shows no preview (the recurrence is incomplete, not gated — #240)', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		expect(gotoMock).not.toHaveBeenCalled();
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'series-create-preview')).toBeNull();

		expect(q(container, 'series-create-generate')).toBeNull();
	});

	it('NON-editor: no season card at all (#261 — the gear is gone for everyone) — the panel (and with it the form) is unreachable, fail-closed like every other rights gate', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		await flush();
		expect(q(container, 'agenda-admin-card')).toBeNull();
		expect(q(container, 'season-card-expand')).toBeNull();
		expect(q(container, 'season-manage-gear')).toBeNull();
		expect(q(container, 'series-create-form')).toBeNull();
	});

	it('cancel closes the form; nothing written', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Doomed draft');

		await fireEvent.click(q(container, 'series-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis*) (*MVOX:Palestrina*)
