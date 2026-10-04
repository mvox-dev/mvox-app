// @vitest-environment happy-dom
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);

vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/sections/sectionActions', async () =>
	(await import('$lib/testing/mocks/sections')).sectionCreateModule({ arrange: true })
);
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).entityIdModule(await importOriginal())
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

import Page from './roster/+page.svelte';
import { adminStore } from '$lib/nav/adminStore';
import { createSectionMock } from '$lib/testing/mocks/sections';
import { ORG_EFK } from '$lib/testing/pages/rosterFixtures';
import {
	CFG,
	cleanupResetCreateSectionMocks,
	seedCreateSectionMocks,
	setAuthedWithOneCollective
} from '$lib/testing/pages/roster';
import { q } from '$lib/testing/pages/dom';

beforeEach(seedCreateSectionMocks);

afterEach(cleanupResetCreateSectionMocks);

async function renderArrangeReady() {
	setAuthedWithOneCollective();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="roster-groups"]')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'roster-view-chip-arrange') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-arrange-list')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'roster-new-section') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-new-section-form')).not.toBeNull();
	});
	return container;
}

describe('#560 — one key listener on the roster section-create form', () => {
	it('Escape fired at the form wrapper closes it; nothing was written', async () => {
		const container = await renderArrangeReady();

		await fireEvent.keyDown(q(container, 'roster-new-section-form') as HTMLElement, {
			key: 'Escape'
		});

		await waitFor(() => {
			expect(q(container, 'roster-new-section-form')).toBeNull();
		});
		expect(createSectionMock).not.toHaveBeenCalled();
	});

	it('Enter from the name field submits the form', async () => {
		const container = await renderArrangeReady();
		const name = q(container, 'roster-new-section-name') as HTMLInputElement;

		await fireEvent.input(name, { target: { value: 'Tenor 2' } });
		await fireEvent.keyDown(name, { key: 'Enter' });

		await waitFor(() => {
			expect(createSectionMock).toHaveBeenCalledTimes(1);
		});
		expect(createSectionMock).toHaveBeenCalledWith(CFG, {
			name: 'Tenor 2',
			parentId: null,
			dbEntityId: ORG_EFK
		});
	});

	it('Enter on the parent select does not submit', async () => {
		const container = await renderArrangeReady();

		await fireEvent.input(q(container, 'roster-new-section-name') as HTMLInputElement, {
			target: { value: 'Tenor 2' }
		});
		await fireEvent.keyDown(q(container, 'roster-new-section-parent') as HTMLElement, {
			key: 'Enter'
		});

		expect(q(container, 'roster-new-section-form')).not.toBeNull();
		expect(createSectionMock).not.toHaveBeenCalled();
	});
});
