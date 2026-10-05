// @vitest-environment happy-dom
// Series creation on the agenda page: a bulk run held open, stopped and resumed.
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);
vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/entity/entityCreate', async () =>
	(await import('$lib/testing/mocks/events')).entityCreateModule(['series', 'event'])
);
vi.mock('$lib/seasons/seasonManage', async () =>
	(await import('$lib/testing/mocks/seasons')).seasonManageModule()
);
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).entityIdModule(await importOriginal())
);
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).rightsModule(await importOriginal())
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('empty')
);
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule()
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);
vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/moduleStubs')).libraryDataModule()
);
vi.mock('$lib/repertoire/repertoireData', async () =>
	(await import('$lib/testing/mocks/seasons')).repertoireDataModule('empty')
);

import Page from './+page.svelte';
import type { CreateEventInput } from '$lib/entity/entityCreate';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { signIn } from '$lib/testing/session';
import { loadFullAgendaMock } from '$lib/testing/moduleHandles';
import { createEventMock, createEventSeriesMock } from '$lib/testing/mocks/events';
import { listEventSeriesForSeasonMock } from '$lib/testing/mocks/seasons';
import { q } from '$lib/testing/pages/dom';
import {
	NEW_SERIES_ID,
	enableMondayGeneration,
	openSeriesForm
} from '$lib/testing/pages/seasonPanel';
import { renderReady } from '$lib/testing/pages/seasonRender';
import { flush } from '$lib/testing/pages/seasonEventCreate';
import {
	fillValidTemplate,
	previewDates,
	submit,
	useSeriesCreatePage
} from '$lib/testing/pages/seriesCreate';

useSeriesCreatePage();

describe('season panel — dismissal is refused while a bulk run is in flight', () => {
	it('Escape when IDLE closes the form but NOT the panel it sits in — the WAI-APG two-Escapes-to-leave layering', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		await fireEvent.keyDown(q(container, 'series-create-form') as HTMLElement, { key: 'Escape' });

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(createEventSeriesMock).not.toHaveBeenCalled();
	});

	it('cancel is DISABLED and Escape is ignored mid-run: the form cannot unmount while the loop is still POSTing', async () => {
		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});
		expect((q(container, 'series-create-cancel') as HTMLButtonElement).disabled).toBe(true);

		await fireEvent.click(q(container, 'series-create-cancel') as HTMLElement);
		await fireEvent.keyDown(q(container, 'series-create-form') as HTMLElement, { key: 'Escape' });
		await flush();
		expect(q(container, 'series-create-form')).not.toBeNull();

		resolvers[0]('ev-new-1');
		await waitFor(() => {
			expect(resolvers.length).toBe(2);
		});
		resolvers[1]('ev-new-2');
		await waitFor(() => {
			expect(resolvers.length).toBe(3);
		});
		resolvers[2]('ev-new-3');
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect((q(container, 'series-create-cancel') as HTMLButtonElement | null) ?? null).toBeNull();
	});
});

describe('season panel — a STOPPED bulk run resumes instead of duplicating', () => {
	it('the failure path re-reads the agenda AND the panel lists so the occurrences that DID land become visible', async () => {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		const seriesReadsBefore = listEventSeriesForSeasonMock.mock.calls.length;
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);

		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock.mock.calls.length).toBeGreaterThan(seriesReadsBefore);
		});
		const resume = q(container, 'series-create-resume') as HTMLElement;
		expect(resume).not.toBeNull();
		expect(resume.textContent).toContain('series_create_resume_notice');
		expect(resume.textContent).toContain('"remaining":2');
		expect(resume.textContent).toContain('"total":3');
		expect(q(container, 'series-create-preview-count')).toBeNull();
	});

	it('review F3 — the preview ROWS shrink to the remainder too: the list and the resume notice describe the SAME set (never 3 dates over a "2 remaining")', async () => {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(previewDates(container)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21']);
		});

		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});

		await waitFor(() => {
			expect(previewDates(container)).toEqual(['2026-09-14', '2026-09-21']);
		});
		expect(q(container, 'series-create-resume')?.textContent).toContain('"remaining":2');
	});

	it('review F5 — the template and recurrence boxes go INERT while a run is resumable: submit finishes THAT run, so an edit here would be silently discarded', async () => {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});
		for (const testid of [
			'series-create-name',
			'series-create-type',
			'series-create-duration',
			'series-create-location',
			'series-create-description',
			'series-create-repeat',
			'series-create-day',
			'series-create-time-hour',
			'series-create-time-minute',
			'series-create-from',
			'series-create-until'
		]) {
			expect(
				(q(container, testid) as HTMLInputElement | HTMLButtonElement | null)?.disabled
			).toBe(true);
		}
		expect((q(container, 'series-create-submit') as HTMLButtonElement).disabled).toBe(false);
		expect((q(container, 'series-create-cancel') as HTMLButtonElement).disabled).toBe(false);
	});

	it('re-submitting creates NO second series and only the occurrences that never landed', async () => {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(createEventMock).toHaveBeenCalledTimes(2);

		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		expect(createEventMock).toHaveBeenCalledTimes(4);
		expect(
			createEventMock.mock.calls.slice(2).map((c) => (c[1] as CreateEventInput).startDatetime)
		).toEqual(['2026-09-14T16:00:00.000Z', '2026-09-21T16:00:00.000Z']);
		for (const call of createEventMock.mock.calls.slice(2)) {
			expect((call[1] as CreateEventInput).seriesId).toBe(NEW_SERIES_ID);
		}
	});
});

describe('#138 — a stopped series run survives a collective round trip', () => {
	function setAuthedWithTwoCollectives(): void {
		signIn({
			collectives: [
				{ db: 'org-a', name: 'Org A', personId: 'person-p' },
				{ db: 'org-b', name: 'Org B', personId: 'person-p' }
			]
		});
	}

	async function renderTwoReady(): Promise<HTMLElement> {
		setAuthedWithTwoCollectives();
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		return container;
	}

	async function stopRunInOrgA(container: HTMLElement): Promise<void> {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});
	}

	async function leaveOrgA(container: HTMLElement): Promise<void> {
		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
	}

	it('coming back to org-a re-surfaces the run, and a re-submit creates NO second series and re-POSTs nothing that landed', async () => {
		const container = await renderTwoReady();
		await stopRunInOrgA(container);
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		expect(createEventMock).toHaveBeenCalledTimes(2);

		await leaveOrgA(container);
		selectedCollectiveDbStore.set('org-a');

		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});
		const resume = q(container, 'series-create-resume') as HTMLElement;
		expect(resume.textContent).toContain('"remaining":2');
		expect(resume.textContent).toContain('"total":3');
		expect(previewDates(container)).toEqual(['2026-09-14', '2026-09-21']);
		expect((q(container, 'series-create-submit') as HTMLButtonElement).disabled).toBe(false);
		expect((q(container, 'series-create-cancel') as HTMLButtonElement).disabled).toBe(false);

		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		expect(createEventMock).toHaveBeenCalledTimes(4);
		expect(
			createEventMock.mock.calls.slice(2).map((c) => (c[1] as CreateEventInput).startDatetime)
		).toEqual(['2026-09-14T16:00:00.000Z', '2026-09-21T16:00:00.000Z']);
		for (const call of createEventMock.mock.calls.slice(2)) {
			expect((call[1] as CreateEventInput).seriesId).toBe(NEW_SERIES_ID);
			expect(call[0]).toEqual({ db: 'org-a', token: 'jwt-abc' });
		}
		await waitFor(() => {
			expect((q(container, 'season-manage-add-series') as HTMLButtonElement).disabled).toBe(false);
		});
	});

	it('a switch MID-generation (nothing failed) records what org-a still owes — the orphan #138 is actually named after', async () => {
		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		const container = await renderTwoReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);
		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});

		await leaveOrgA(container);
		resolvers[0]('ev-new-1');
		await flush();
		expect(createEventMock).toHaveBeenCalledTimes(1);
		expect(q(container, 'series-create-resume')).toBeNull();

		selectedCollectiveDbStore.set('org-a');
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});
		expect((q(container, 'series-create-resume') as HTMLElement).textContent).toContain(
			'"remaining":2'
		);

		createEventMock.mockImplementation(async () => `ev-resumed-${createEventMock.mock.calls.length}`);
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		expect(createEventMock).toHaveBeenCalledTimes(3);
		expect(
			createEventMock.mock.calls.slice(1).map((c) => (c[1] as CreateEventInput).startDatetime)
		).toEqual(['2026-09-14T16:00:00.000Z', '2026-09-21T16:00:00.000Z']);
	});

	it('org-b is unaffected while org-a owes a run: its entry points stay live and it creates its own series', async () => {
		const container = await renderTwoReady();
		await stopRunInOrgA(container);

		await leaveOrgA(container);
		await openSeriesForm(container);
		expect(q(container, 'series-create-resume')).toBeNull();

		createEventMock.mockImplementation(async () => `ev-b-${createEventMock.mock.calls.length}`);
		await fillValidTemplate(container);
		await enableMondayGeneration(container); // #240 — every submit generates
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventSeriesMock).toHaveBeenCalledTimes(2);
		expect(createEventSeriesMock.mock.calls[1][0]).toEqual({ db: 'org-b', token: 'jwt-abc' });

		selectedCollectiveDbStore.set('org-a');
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});
	});

	it('Cancel after the round trip abandons the run and unlocks org-a', async () => {
		const container = await renderTwoReady();
		await stopRunInOrgA(container);
		await leaveOrgA(container);
		selectedCollectiveDbStore.set('org-a');
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});

		await fireEvent.click(q(container, 'series-create-cancel') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect((q(container, 'season-manage-add-series') as HTMLButtonElement).disabled).toBe(false);
		await fireEvent.click(q(container, 'season-manage-add-series') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'series-create-form')).not.toBeNull();
		});
		expect(q(container, 'series-create-resume')).toBeNull();
		expect((q(container, 'series-create-name') as HTMLInputElement).value).toBe('');
	});

	it('a run still IN FLIGHT in the collective just left does not swallow the arriving one’s restore', async () => {
		const container = await renderTwoReady();

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-card-expand')).not.toBeNull();
		});
		await stopRunInOrgA(container); // db-agnostic: it runs in whatever is selected
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);

		selectedCollectiveDbStore.set('org-a');
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});

		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);
		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});

		resolvers[0]('ev-a-1');
		await flush();
		expect(q(container, 'series-create-resume')).not.toBeNull();
		expect(previewDates(container)).toEqual(['2026-09-14', '2026-09-21']);
		expect((q(container, 'series-create-submit') as HTMLButtonElement).disabled).toBe(false);
		expect((q(container, 'series-create-cancel') as HTMLButtonElement).disabled).toBe(false);

		await fireEvent.click(q(container, 'series-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect((q(container, 'season-manage-add-series') as HTMLButtonElement).disabled).toBe(false);

		selectedCollectiveDbStore.set('org-a');
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});
		expect((q(container, 'series-create-resume') as HTMLElement).textContent).toContain(
			'"remaining":2'
		);
	});
});

// (*MVOX:Tallis*) (*MVOX:Palestrina*)
