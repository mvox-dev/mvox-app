// @vitest-environment happy-dom
// #1049: a create with no collective chosen cannot happen from the page; if it does, it reports.
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { createLibraryWrites } from './libraryPageWrites';
import {
	createBulkCheckout,
	createEditionDrafts,
	createEditionFilesState,
	createLibraryState,
	createWorkForm
} from './libraryState';
import type { RouteLoadMachine } from '$lib/loading/routeLoad';
import { keptProblems, useKeptProblems } from '$lib/testing/keptProblems';
import { signIn } from '$lib/testing/session';

useKeptProblems();

function writesWithNoCollective() {
	const workForm = createWorkForm();
	const editionDrafts = createEditionDrafts();
	const writes = createLibraryWrites({
		selected: () => null,
		isOffline: () => false,
		lib: createLibraryState(),
		workForm: () => workForm,
		editionDrafts: () => editionDrafts,
		bulk: () => createBulkCheckout(),
		fileUploads: createEditionFilesState(),
		routeLoad: { generation: 1, isCurrent: () => true } as unknown as RouteLoadMachine,
		setLendingsPartial: () => {},
		setReturnError: () => {}
	});
	return { writes, workForm, editionDrafts };
}

describe('#1049 a create with no collective selected', () => {
	it('create work: the message shows and one report names the reason', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		signIn();
		const { writes, workForm } = writesWithNoCollective();

		await writes.submitCreateWork();

		expect(workForm.error?.()).toBe('Could not create the work.');
		await vi.waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'library', action: 'creating a work', detail: 'no collective is selected' }
			])
		);
	});

	it('create edition: the message shows and one report names the reason', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		signIn();
		const { writes, editionDrafts } = writesWithNoCollective();

		await writes.submitCreateEdition('work-1');

		expect(editionDrafts.errors.get('work-1')?.()).toBe('Could not create the edition.');
		await vi.waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'library', action: 'creating an edition', detail: 'no collective is selected' }
			])
		);
	});
});

// (*MVOX:Josquin*)
