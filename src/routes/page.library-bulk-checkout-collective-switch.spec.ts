// @vitest-environment happy-dom
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/pages/libraryCopy')).libraryMessages()
);

vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/mocks/library')).libraryReadsModule()
);
vi.mock('$lib/paraglide/runtime', async () =>
	(await import('$lib/testing/moduleStubs')).runtimeModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).activeMembersModule()
);

vi.mock('$lib/library/librarianStore', async () =>
	(await import('$lib/testing/mocks/library')).librarianOverRealModule()
);

vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('member')
);

vi.mock('$lib/library/lendingActions', async () =>
	(await import('$lib/testing/mocks/library')).lendingModule()
);

import Page from './library/+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { bulkCheckoutMock } from '$lib/testing/mocks/library';
import {
	DB_A,
	DB_B,
	cleanupClearReset,
	seedTwoLibraries,
	setAuthedWithTwoCollectives
} from '$lib/testing/pages/library';
import { q } from '$lib/testing/pages/dom';

beforeEach(seedTwoLibraries);

afterEach(cleanupClearReset);

async function renderWithFullSelectionInA(): Promise<HTMLElement> {
	setAuthedWithTwoCollectives();
	const { container } = render(Page);

	await waitFor(() => {
		expect(q(container, 'bulk-checkout-work-select')).not.toBeNull();
	});
	const workSelect = q(container, 'bulk-checkout-work-select') as HTMLSelectElement;
	expect(workSelect.textContent).toContain('Spem in alium');
	await fireEvent.change(workSelect, { target: { value: 'work-a1' } });

	await waitFor(() => {
		expect(q(container, 'bulk-checkout-edition-select')).not.toBeNull();
	});
	await fireEvent.change(q(container, 'bulk-checkout-edition-select') as HTMLSelectElement, {
		target: { value: 'edition-a1' }
	});

	await waitFor(() => {
		expect(q(container, 'bulk-checkout-member-list')).not.toBeNull();
	});
	const checkboxes = container.querySelectorAll(
		'[data-testid="bulk-checkout-member-list"] input[type="checkbox"]'
	);
	expect(checkboxes.length).toBe(2);
	await fireEvent.click(checkboxes[0]); // member-a1
	expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);

	const dueDate = q(container, 'bulk-checkout-due-date') as HTMLInputElement;
	expect(dueDate).not.toBeNull();
	await fireEvent.input(dueDate, { target: { value: '2027-01-15' } });
	expect(dueDate.value).toBe('2027-01-15');

	return container;
}

async function switchTo(container: HTMLElement, db: string, expectedWorkName: string) {
	selectedCollectiveDbStore.set(db);
	await waitFor(() => {
		const sel = q(container, 'bulk-checkout-work-select');
		expect(sel).not.toBeNull();
		expect(sel?.textContent).toContain(expectedWorkName);
	});
}

describe('/library — #300 bulk-checkout selection across a collective switch', () => {
	it('a switch clears the work and edition selection: no edition select and no edition-gated panel render in the new collective', async () => {
		const container = await renderWithFullSelectionInA();

		await switchTo(container, DB_B, 'Cantique de Jean Racine');

		expect(q(container, 'bulk-checkout-edition-select')).toBeNull();
		expect(q(container, 'bulk-checkout-member-list')).toBeNull();
		expect(q(container, 'bulk-checkout-due-date')).toBeNull();
		expect(q(container, 'bulk-checkout-submit')).toBeNull();
	});

	it('switching away and back does not resurrect the selection: the checked-member set is gone', async () => {
		const container = await renderWithFullSelectionInA();

		await switchTo(container, DB_B, 'Cantique de Jean Racine');
		await switchTo(container, DB_A, 'Spem in alium');

		const checked = Array.from(
			container.querySelectorAll('[data-testid="bulk-checkout"] input[type="checkbox"]')
		).filter((cb) => (cb as HTMLInputElement).checked);
		expect(checked).toEqual([]);
		expect((q(container, 'bulk-checkout-work-select') as HTMLSelectElement).value).toBe('');
		expect(q(container, 'bulk-checkout-member-list')).toBeNull();
	});

	it('the due date is cleared by the switch (explicit #300 decision: due date is per-transaction state)', async () => {
		const container = await renderWithFullSelectionInA();

		await switchTo(container, DB_B, 'Cantique de Jean Racine');

		await fireEvent.change(q(container, 'bulk-checkout-work-select') as HTMLSelectElement, {
			target: { value: 'work-b1' }
		});
		await waitFor(() => {
			expect(q(container, 'bulk-checkout-edition-select')).not.toBeNull();
		});
		await fireEvent.change(q(container, 'bulk-checkout-edition-select') as HTMLSelectElement, {
			target: { value: 'edition-b1' }
		});
		await waitFor(() => {
			expect(q(container, 'bulk-checkout-due-date')).not.toBeNull();
		});

		expect((q(container, 'bulk-checkout-due-date') as HTMLInputElement).value).toBe('');
	});

	it('after a switch, a fresh selection in the new collective posts ONLY the new collective ids — no stale assignedUntil from the old one', async () => {
		const container = await renderWithFullSelectionInA();

		await switchTo(container, DB_B, 'Cantique de Jean Racine');

		await fireEvent.change(q(container, 'bulk-checkout-work-select') as HTMLSelectElement, {
			target: { value: 'work-b1' }
		});
		await waitFor(() => {
			expect(q(container, 'bulk-checkout-edition-select')).not.toBeNull();
		});
		await fireEvent.change(q(container, 'bulk-checkout-edition-select') as HTMLSelectElement, {
			target: { value: 'edition-b1' }
		});
		await waitFor(() => {
			expect(q(container, 'bulk-checkout-member-list')).not.toBeNull();
		});
		const checkboxes = container.querySelectorAll(
			'[data-testid="bulk-checkout-member-list"] input[type="checkbox"]'
		);
		expect(checkboxes.length).toBe(1); // member-b1 only — B's roster
		await fireEvent.click(checkboxes[0]);

		bulkCheckoutMock.mockResolvedValue({ succeeded: [], failed: [] });
		const submitBtn = q(container, 'bulk-checkout-submit') as HTMLButtonElement;
		expect(submitBtn.disabled).toBe(false); // copy-b1 available → 1 ≥ 1
		await fireEvent.click(submitBtn);

		await waitFor(() => {
			expect(bulkCheckoutMock).toHaveBeenCalledTimes(1);
		});
		const [cfg, libraryId, payload] = bulkCheckoutMock.mock.calls[0];
		expect(cfg.db).toBe(DB_B);
		expect(libraryId).toBe('lib-b');
		expect(payload).toEqual({
			editionId: 'edition-b1',
			memberIds: ['member-b1'],
			assignedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
		});
	});
});

// (*MVOX:Tallis*)
