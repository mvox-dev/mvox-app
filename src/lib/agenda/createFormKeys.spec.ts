// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import EventCreateForm from './EventCreateForm.svelte';
import SeasonCreateForm from './SeasonCreateForm.svelte';
import SeriesCreateForm from './SeriesCreateForm.svelte';

afterEach(cleanup);

const shared = {
	selected: null,
	rosterPartial: false,
	sectionsReadFailed: false,
	submitting: false,
	status: '',
	getRoster: async () => [],
	getSections: async () => [],
	rosterPickerOptions: () => [],
	pickerPromptText: () => '',
	loadForSelected: () => {}
};

function renderEvent() {
	const props = {
		...shared,
		manageableSeasonId: null,
		seasons: [],
		agendaTypeFilter: '',
		agendaFilterBucketOf: () => '',
		locationSuggestionsId: 'loc',
		refreshSeasonManageLists: () => {},
		dismiss: vi.fn(),
		onclose: vi.fn(),
		restoreEventCreateFocus: () => {},
		surfaceCreatedEvent: () => {}
	};
	return { ...render(EventCreateForm, { props }), close: props.dismiss };
}

function renderSeason() {
	const props = { ...shared, dismiss: vi.fn(), onclose: vi.fn() };
	return { ...render(SeasonCreateForm, { props }), close: props.dismiss };
}

function renderSeries() {
	const props = {
		selected: null,
		manageableSeasonId: null,
		seasonManageStartDate: '2026-09-01',
		seasonManageEndDate: '2027-06-30',
		seasonManagePanelEl: null,
		locationSuggestionsId: 'loc',
		submitting: false,
		resumeByDb: {},
		seriesRunDb: null,
		onclose: vi.fn(),
		loadForSelected: () => {},
		refreshSeasonManageLists: () => {}
	};
	return { ...render(SeriesCreateForm, { props }), close: props.onclose };
}

const FORMS = [
	{ name: 'event', mount: renderEvent, enterFrom: 'event-create-name' },
	{ name: 'season', mount: renderSeason, enterFrom: 'season-create-start' },
	{ name: 'series', mount: renderSeries, enterFrom: 'series-create-name' }
];

function byTestId(container: HTMLElement, testid: string): HTMLElement {
	const el = container.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
	if (!el) throw new Error(`no ${testid}`);
	return el;
}

describe.each(FORMS)('$name create form keys (#560)', ({ name, mount, enterFrom }) => {
	it('Escape on the form closes it', async () => {
		const { container, close } = mount();
		await fireEvent.keyDown(byTestId(container, `${name}-create-form`), { key: 'Escape' });
		expect(close).toHaveBeenCalledTimes(1);
	});

	it('Enter from a single-line field submits', async () => {
		const { container } = mount();
		await fireEvent.keyDown(byTestId(container, enterFrom), { key: 'Enter' });
		await waitFor(() => {
			expect(container.querySelector(`[data-testid="${name}-create-error"]`)).not.toBeNull();
		});
	});

	it('on open, focus is on the first field', async () => {
		const { container } = mount();
		await waitFor(() => {
			expect(document.activeElement).toBe(byTestId(container, `${name}-create-name`));
		});
	});
});

describe.each(FORMS.filter((f) => f.name !== 'season'))(
	'$name create form textarea (#560)',
	({ name, mount }) => {
		it('Enter in the description textarea does not submit', async () => {
			const { container } = mount();
			const textarea = byTestId(container, `${name}-create-description`);
			const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
			textarea.dispatchEvent(event);
			await Promise.resolve();
			expect(event.defaultPrevented).toBe(false);
			expect(container.querySelector(`[data-testid="${name}-create-error"]`)).toBeNull();
		});
	}
);
