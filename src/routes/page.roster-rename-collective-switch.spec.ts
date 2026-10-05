// @vitest-environment happy-dom
// The rename state resets on a collective switch; a late result is dropped.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);

vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/sections/sectionActions', async () =>
	(await import('$lib/testing/mocks/sections')).sectionActionsModule(['reparent', 'rename'])
);
vi.mock('$lib/roster/memberLifecycle', async () =>
	(await import('$lib/testing/mocks/roster')).memberLifecycleModule()
);
vi.mock('$lib/invite/inviteData', async (importOriginal) =>
	(await import('$lib/testing/mocks/admin')).inviteWritesModule(importOriginal, { withdraw: false })
);
vi.mock('$lib/library/librarianStore', async (importOriginal) =>
	(await import('$lib/testing/mocks/library')).readyLibrarianModule(importOriginal)
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

import { resetAdmin } from '$lib/nav/adminStore';
import { resetAppState } from '$lib/testing/appReset';
import { renameMock } from '$lib/testing/mocks/sections';
import {
	anyRenameErrorAlert,
	anyRenameInput,
	flush,
	renameStatusText,
	seedTwoCollectiveMocks,
	switchBackToSampledbArrange
} from '$lib/testing/pages/roster';
import { switchToOtherChoirArrange } from '$lib/testing/pages/rosterArrange';
import { renderInArrangeMode } from '$lib/testing/pages/rosterRender';
import { q } from '$lib/testing/pages/dom';

beforeEach(seedTwoCollectiveMocks);

afterEach(() => {
	cleanup();
	renameMock.mockReset();
	vi.clearAllMocks();
	resetAppState();
	resetAdmin();
});

async function openRename(container: HTMLElement, sectionId: string, newName: string) {
	await fireEvent.click(q(container, `arrange-rename-${sectionId}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `arrange-rename-input-${sectionId}`)).not.toBeNull();
	});
	const input = q(container, `arrange-rename-input-${sectionId}`) as HTMLInputElement;
	await fireEvent.input(input, { target: { value: newName } });
	return input;
}

async function submitHeldRename(
	container: HTMLElement,
	sectionId: string,
	newName: string,
	nthWrite: number
) {
	const input = await openRename(container, sectionId, newName);
	await fireEvent.keyDown(input, { key: 'Enter' });
	await waitFor(() => {
		expect(renameMock).toHaveBeenCalledTimes(nthWrite);
	});
	expect(q(container, `arrange-rename-input-${sectionId}`)).toBeNull();
}

describe('/roster — #297 rename settle across a collective switch', () => {
	it("STALE DISABLE: with collective A's rename WRITE still in flight, collective B's structural controls render ENABLED from load — A's unresolved write is not B's business", async () => {
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await submitHeldRename(container, 'sec-alto', 'Contralto', 1);

		await switchToOtherChoirArrange(container);

		expect(
			(q(container, 'arrange-rename-sec-b1') as HTMLButtonElement).disabled,
			"B's rename trigger must not be disabled by A's in-flight write"
		).toBe(false);
		expect(
			(q(container, 'section-remove-sec-b2') as HTMLButtonElement).disabled,
			"B's delete trigger must not be disabled by A's in-flight write"
		).toBe(false);
		expect(
			(q(container, 'arrange-indent-sec-b2') as HTMLButtonElement).disabled,
			"B's indent control must not be disabled by A's in-flight write"
		).toBe(false);
		expect(
			q(container, 'arrange-row-sec-b1')?.getAttribute('draggable'),
			"B's rows must be draggable — no structural write is in flight HERE"
		).toBe('true');

		gate.resolve();
		await flush();
	});

	it("CROSS-COLLECTIVE ERROR: A's rename REJECTING after the switch paints no rename-failure alert — not on B, and not on A after switching back", async () => {
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await submitHeldRename(container, 'sec-alto', 'Contralto', 1);
		await switchToOtherChoirArrange(container);

		gate.reject(new Error('403'));
		await flush();
		await flush(); // catch → refetch (one more microtask hop) → guards

		expect(
			anyRenameErrorAlert(container),
			'no rename-failure alert may render against collective B'
		).toBeNull();
		expect(renameStatusText(container)).toBe('');
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
		expect(q(container, 'arrange-row-sec-sop')).toBeNull();

		await switchBackToSampledbArrange(container);
		expect(
			anyRenameErrorAlert(container),
			"a superseded rename failure must not resurface on A's row after switching back"
		).toBeNull();
	});
});

describe('/roster — #297/#303 rename state across a collective switch: settled failures clear, open edits commit', () => {
	it('CLEARED ON SWITCH (renameError): a rename failure fully settled ON A does not resurface on its row after a round-trip through B', async () => {
		renameMock.mockRejectedValueOnce(new Error('403'));
		const container = await renderInArrangeMode();

		await submitHeldRename(container, 'sec-alto', 'Contralto', 1);
		await waitFor(() => {
			expect(q(container, 'arrange-rename-error-sec-alto')).not.toBeNull();
		});

		await switchToOtherChoirArrange(container);
		expect(anyRenameErrorAlert(container)).toBeNull();

		await switchBackToSampledbArrange(container);
		expect(
			q(container, 'arrange-rename-error-sec-alto'),
			'a rename failure from before the switch must not survive it'
		).toBeNull();
	});
});

describe('/roster — #297 late settle vs a live write, and the focus contract', () => {
	it("LATE-SETTLE CLOBBER: A's stale settle lands AFTER a genuine new rename has started on B — B's controls stay frozen, nothing announces A, and B then completes honestly", async () => {
		const gateA = deferred();
		const gateB = deferred();
		renameMock
			.mockImplementationOnce(() => gateA.promise)
			.mockImplementationOnce(() => gateB.promise);
		const container = await renderInArrangeMode();

		await submitHeldRename(container, 'sec-alto', 'Contralto', 1);
		await switchToOtherChoirArrange(container);

		expect(
			(q(container, 'arrange-rename-sec-b1') as HTMLButtonElement).disabled,
			"B's rename trigger must be enabled after the switch"
		).toBe(false);

		await submitHeldRename(container, 'sec-b1', 'Bass Uno', 2);
		expect(
			(q(container, 'section-remove-sec-b2') as HTMLButtonElement).disabled,
			"B's own write is in flight — its structural controls are frozen"
		).toBe(true);

		gateA.resolve();
		await flush();

		expect(
			(q(container, 'section-remove-sec-b2') as HTMLButtonElement).disabled,
			"B's write is STILL in flight — structural controls stay frozen"
		).toBe(true);
		expect(q(container, 'arrange-row-sec-b2')?.getAttribute('draggable')).toBe('false');
		expect(renameStatusText(container)).toBe('');

		await fireEvent.click(q(container, 'arrange-rename-sec-b2') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-b2')).not.toBeNull();
		});
		const probeInput = q(container, 'arrange-rename-input-sec-b2') as HTMLInputElement;
		await fireEvent.input(probeInput, { target: { value: 'Bass Due' } });
		await fireEvent.keyDown(probeInput, { key: 'Enter' });
		await flush();
		expect(renameMock).toHaveBeenCalledTimes(2);
		expect(
			(q(container, 'arrange-rename-input-sec-b2') as HTMLInputElement)?.value,
			'the refused rename stays open — its text is not discardable'
		).toBe('Bass Due');
		await fireEvent.keyDown(probeInput, { key: 'Escape' });
		await waitFor(() => {
			expect(anyRenameInput(container)).toBeNull();
		});

		gateB.resolve();
		await flush();
		await waitFor(() => {
			expect((q(container, 'section-remove-sec-b2') as HTMLButtonElement).disabled).toBe(false);
		});
		expect((q(container, 'arrange-rename-sec-b2') as HTMLButtonElement).disabled).toBe(false);
		expect(renameStatusText(container)).toContain('roster_section_renamed');
		expect(renameStatusText(container)).toContain('Bass Uno');
		expect(renameStatusText(container)).not.toContain('Contralto');
		expect(q(container, 'arrange-rename-sec-b1')?.textContent).toContain('Bass Uno');
		expect(renameMock).toHaveBeenCalledTimes(2);
	});

	it('FOCUS ON A SUPERSEDED SETTLE: the settle still lands focus on the rename trigger — and still announces NOTHING (gate the flag write, not the finally block)', async () => {
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await submitHeldRename(container, 'sec-alto', 'Contralto', 1);
		await switchToOtherChoirArrange(container);
		await switchBackToSampledbArrange(container);

		gate.resolve();
		await flush();

		expect(renameStatusText(container)).toBe('');
		await waitFor(() => {
			expect(document.activeElement?.getAttribute('data-testid')).toBe(
				'arrange-rename-sec-alto'
			);
		});
		expect(document.activeElement).not.toBe(document.body);
	});
});

// (*MVOX:Tallis*)
