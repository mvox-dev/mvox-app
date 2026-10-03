// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);

const {
	loadRosterMock,
	listSectionsMock,
	assignMock,
	unassignMock,
	createMock,
	reorderMock,
	deleteMock,
	reparentMock,
	renameMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	assignMock: vi.fn(),
	unassignMock: vi.fn(),
	createMock: vi.fn(),
	reorderMock: vi.fn(),
	deleteMock: vi.fn(),
	reparentMock: vi.fn(),
	renameMock: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
vi.mock('$lib/sections/sectionActions', () => ({
	assignMemberSection: assignMock,
	unassignMemberSection: unassignMock,
	createSection: createMock,
	reorderSections: reorderMock,
	deleteSection: deleteMock,
	reparentSection: reparentMock,
	renameSection: renameMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import type { SectionNode } from '$lib/sections/sectionData';
import type { RosterRow } from '$lib/roster/rosterData';
import { adminStore, resetAdmin, type AdminState } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

function fixtureTree(): SectionNode[] {
	return [
		{
			id: 'sec-sop',
			name: 'Soprano',
			displayOrder: 1,
			parentId: null,
			depth: 0,
			children: [
				{ id: 'sec-sop1', name: 'Soprano 1', displayOrder: 1, parentId: 'sec-sop', depth: 1, children: [] },
				{ id: 'sec-sop2', name: 'Soprano 2', displayOrder: 2, parentId: 'sec-sop', depth: 1, children: [] }
			]
		},
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, depth: 0, children: [] },
		{ id: 'sec-bass', name: 'Bass', displayOrder: 3, parentId: null, depth: 0, children: [] }
	];
}

function fixtureRows(): RosterRow[] {
	return [
		{ memberId: 'm-eva', personId: 'p-eva', name: 'Eva Green', email: 'eva@x.com', sectionIds: ['sec-sop1'], ownerIds: ['person-p'] },
		{ memberId: 'm-sel', personId: 'p-sel', name: 'Selma Otsing', email: 'selma@x.com', sectionIds: ['sec-sop2'], ownerIds: ['person-p'] },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: '', sectionIds: ['sec-alto'], ownerIds: ['person-p'] }
	];
}

function setAuthedWithOneCollective() {
	signIn();
}

beforeEach(() => {
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue(fixtureTree());
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createMock.mockResolvedValue('sec-created');
	reorderMock.mockResolvedValue(undefined);
	deleteMock.mockResolvedValue(undefined);
	reparentMock.mockResolvedValue(undefined);
	renameMock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	assignMock.mockReset();
	unassignMock.mockReset();
	createMock.mockReset();
	reorderMock.mockReset();
	deleteMock.mockReset();
	reparentMock.mockReset();
	renameMock.mockReset();
	resetAppState();
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderArrangeReady(admin: AdminState = 'admin') {
	setAuthedWithOneCollective();
	adminStore.set(admin);
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'roster-groups')).not.toBeNull();
	});
	const arrangeChip = q(container, 'roster-view-chip-arrange') as HTMLElement | null;
	if (arrangeChip) {
		await fireEvent.click(arrangeChip);
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});
	}
	return container;
}

describe('/roster — inline RENAME in Arrange mode (#155/S4)', () => {
	it('arrange-rename-<id> renders on every row; tapping it swaps the name for a text input, pre-filled with the CURRENT name and auto-focused', async () => {
		const container = await renderArrangeReady();
		expect(q(container, 'arrange-rename-sec-alto')).not.toBeNull();

		await fireEvent.click(q(container, 'arrange-rename-sec-alto') as HTMLElement);

		const input = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement;
		expect(input).not.toBeNull();
		expect(input.value).toBe('Alto');
		await waitFor(() => {
			expect(document.activeElement).toBe(input);
		});
		expect(q(container, 'arrange-row-sec-alto')).toBeNull();
		const activator = q(container, 'arrange-rename-sec-alto') as HTMLButtonElement;
		expect(activator).not.toBeNull();
		expect(activator.disabled).toBe(true);
		expect(activator.textContent ?? '', 'no second copy of the name while renaming').not.toContain(
			'Alto'
		);
	});

	it('Enter saves: renameSection(cfg, id, trimmed) fires, the row shows the NEW name immediately (optimistic, no refetch), and the success is ANNOUNCED', async () => {
		const container = await renderArrangeReady();
		await fireEvent.click(q(container, 'arrange-rename-sec-alto') as HTMLElement);
		const input = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement;

		await fireEvent.input(input, { target: { value: '  Alto Voices  ' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});
		expect(renameMock).toHaveBeenCalledWith(
			{ db: 'sampledb', token: 'jwt-abc' },
			'sec-alto',
			'Alto Voices'
		);
		await waitFor(() => {
			expect(q(container, 'arrange-rename-sec-alto')?.textContent).toContain('Alto Voices');
		});
		expect(q(container, 'arrange-rename-input-sec-alto')).toBeNull();

		const status = q(container, 'roster-section-rename-status');
		expect(status?.getAttribute('role')).toBe('status');
		await waitFor(() => {
			expect(status?.textContent?.trim()).not.toBe('');
		});
		expect(listSectionsMock).toHaveBeenCalledTimes(1);
	});

	it('Escape cancels: no write, the row reverts to displaying the ORIGINAL name', async () => {
		const container = await renderArrangeReady();
		await fireEvent.click(q(container, 'arrange-rename-sec-alto') as HTMLElement);
		const input = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement;

		await fireEvent.input(input, { target: { value: 'Discarded Name' } });
		await fireEvent.keyDown(input, { key: 'Escape' });

		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-alto')).toBeNull();
		});
		expect(renameMock).not.toHaveBeenCalled();
		expect(q(container, 'arrange-rename-sec-alto')?.textContent).toContain('Alto');
		expect(q(container, 'arrange-rename-sec-alto')?.textContent).not.toContain('Discarded');
	});

	it('a REJECTED rename REVERTS the optimistic name and shows arrange-rename-error-<id> (role="alert")', async () => {
		renameMock.mockRejectedValue(new Error('403'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderArrangeReady();
		await fireEvent.click(q(container, 'arrange-rename-sec-alto') as HTMLElement);
		const input = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement;

		await fireEvent.input(input, { target: { value: 'Alto Voices' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			const error = q(container, 'arrange-rename-error-sec-alto');
			expect(error).not.toBeNull();
			expect(error!.getAttribute('role')).toBe('alert');
		});
		expect(q(container, 'arrange-rename-sec-alto')?.textContent).toContain('Alto');
		expect(q(container, 'arrange-rename-sec-alto')?.textContent).not.toContain('Alto Voices');
		consoleSpy.mockRestore();
	});

	it('a blank/whitespace-only value writes NOTHING and stays in edit mode (same "nothing written" refusal as a blank create)', async () => {
		const container = await renderArrangeReady();
		await fireEvent.click(q(container, 'arrange-rename-sec-alto') as HTMLElement);
		const input = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement;

		await fireEvent.input(input, { target: { value: '   ' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		expect(renameMock).not.toHaveBeenCalled();
		expect(q(container, 'arrange-rename-input-sec-alto')).not.toBeNull();
	});
});

describe('/roster — DELETE in Arrange mode is ALWAYS rendered, DISABLED when ineligible (#155/S4)', () => {
	it('Bass (0 members, leaf) — the ✕ is present and ENABLED', async () => {
		const container = await renderArrangeReady();
		const button = q(container, 'section-remove-sec-bass') as HTMLButtonElement;
		expect(button).not.toBeNull();
		expect(button.disabled).toBe(false);
	});

	it('Alto (1 member) — the ✕ is present but DISABLED (has members)', async () => {
		const container = await renderArrangeReady();
		const button = q(container, 'section-remove-sec-alto') as HTMLButtonElement;
		expect(button).not.toBeNull();
		expect(button.disabled).toBe(true);
	});

	it('Soprano (has children) — the ✕ is present but DISABLED (has sub-sections), even though it has no DIRECT members', async () => {
		const container = await renderArrangeReady();
		const button = q(container, 'section-remove-sec-sop') as HTMLButtonElement;
		expect(button).not.toBeNull();
		expect(button.disabled).toBe(true);
	});

	it('a DISABLED delete button ignores a click — no confirm step appears, deleteSection never fires', async () => {
		const container = await renderArrangeReady();
		await fireEvent.click(q(container, 'section-remove-sec-alto') as HTMLElement);
		expect(q(container, 'section-remove-confirm-sec-alto')).toBeNull();
		expect(deleteMock).not.toHaveBeenCalled();
	});

	it('the two-step confirm on an ELIGIBLE section: tap ✕ arms it, tap confirm deletes and the row disappears', async () => {
		const container = await renderArrangeReady();
		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-bass')).not.toBeNull();
		});

		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);

		await waitFor(() => {
			expect(deleteMock).toHaveBeenCalledWith({ db: 'sampledb', token: 'jwt-abc' }, 'sec-bass');
		});
		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-bass')).toBeNull();
		});
	});

	it('cancel disarms the confirm — nothing written, the row stays', async () => {
		const container = await renderArrangeReady();
		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-cancel-sec-bass')).not.toBeNull();
		});

		await fireEvent.click(q(container, 'section-remove-cancel-sec-bass') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'section-remove-sec-bass')).not.toBeNull();
		});
		expect(deleteMock).not.toHaveBeenCalled();
	});

	it('the armed confirm and cancel are 44px touch targets (#597)', async () => {
		const container = await renderArrangeReady();
		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-bass')).not.toBeNull();
		});

		for (const id of ['section-remove-confirm-sec-bass', 'section-remove-cancel-sec-bass']) {
			const btn = q(container, id) as HTMLButtonElement;
			for (const cls of ['flex', 'min-h-11', 'items-center']) {
				expect(btn.classList.contains(cls), `${cls} missing on ${id}`).toBe(true);
			}
		}
	});
});

describe('/roster — Collapsed and Expanded views carry NO section-management controls (#155/S4)', () => {
	it('Collapsed (the default): no rename/delete/drag-handle control anywhere on the page', async () => {
		const container = await renderArrangeReady();
		await fireEvent.click(q(container, 'roster-view-chip-collapsed') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'roster-groups')).not.toBeNull();
		});

		for (const prefix of ['section-remove-', 'arrange-rename-', 'section-drag-handle-']) {
			expect(
				container.querySelectorAll(`[data-testid^="${prefix}"]`),
				`no "${prefix}*" control anywhere in Collapsed view`
			).toHaveLength(0);
		}
		expect(container.querySelectorAll('[data-testid^="section-picker"]')).toHaveLength(0);
		expect(q(container, 'section-create-form')).toBeNull();
		expect(q(container, 'section-header-sec-bass')?.textContent).toContain('Bass');
	});

	it('Expanded: no rename/delete/drag-handle control anywhere, but member rows still show', async () => {
		const container = await renderArrangeReady();
		await fireEvent.click(q(container, 'roster-view-chip-expanded') as HTMLElement);
		await waitFor(() => {
			expect(container.querySelector('[data-testid^="roster-row-"]')).not.toBeNull();
		});

		for (const prefix of ['section-remove-', 'arrange-rename-', 'section-drag-handle-']) {
			expect(
				container.querySelectorAll(`[data-testid^="${prefix}"]`),
				`no "${prefix}*" control anywhere in Expanded view`
			).toHaveLength(0);
		}
		expect(q(container, 'roster-row-m-bea')).not.toBeNull();

		expect(
			q(container, 'section-picker-add-m-bea'),
			'the member→section controls stay on the member row in Expanded view'
		).not.toBeNull();
		expect(
			q(container, 'section-picker-new'),
			"the picker's create entry does not survive #470"
		).toBeNull();
		expect(q(container, 'section-create-form')).toBeNull();
		expect(q(container, 'roster-new-section')).toBeNull();
	});

	it('non-admin never sees any arrange chip or management control, in either display mode', async () => {
		const container = await renderArrangeReady('not-admin');
		expect(q(container, 'roster-view-chip-arrange')).toBeNull();

		for (const prefix of ['section-remove-', 'arrange-rename-', 'section-drag-handle-', 'roster-new-section']) {
			expect(container.querySelectorAll(`[data-testid^="${prefix}"]`)).toHaveLength(0);
		}
	});
});

describe('/roster — arrange-mode structural writes are SINGLE-FLIGHT (#155/S4 review F1)', () => {
	it('while a DELETE is in flight, rename/indent/unindent on every OTHER row are disabled and the rows are undraggable', async () => {
		const gate = deferred();
		deleteMock.mockImplementation(() => gate.promise);
		const container = await renderArrangeReady();

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-bass')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);

		await waitFor(() => {
			expect((q(container, 'arrange-rename-sec-alto') as HTMLButtonElement).disabled).toBe(true);
		});
		expect((q(container, 'arrange-indent-sec-alto') as HTMLButtonElement).disabled).toBe(true);
		expect((q(container, 'arrange-unindent-sec-sop1') as HTMLButtonElement).disabled).toBe(true);
		expect(q(container, 'arrange-row-sec-alto')?.getAttribute('draggable')).toBe('false');

		gate.resolve();
		await waitFor(() => {
			expect((q(container, 'arrange-rename-sec-alto') as HTMLButtonElement).disabled).toBe(false);
		});
		expect(q(container, 'arrange-row-sec-alto')?.getAttribute('draggable')).toBe('true');
	});

	it('while a REPARENT is in flight, rename and delete are disabled — and section-reorder-pending is on screen with aria-busy, clearing once it settles', async () => {
		const gate = deferred();
		reparentMock.mockImplementation(() => gate.promise);
		const container = await renderArrangeReady();
		expect(q(container, 'section-reorder-pending')).toBeNull();

		await fireEvent.click(q(container, 'arrange-indent-sec-alto') as HTMLElement);

		await waitFor(() => {
			const pending = q(container, 'section-reorder-pending');
			expect(pending).not.toBeNull();
			expect(pending!.getAttribute('role')).toBe('status');
			expect(pending!.getAttribute('aria-busy')).toBe('true');
		});
		expect((q(container, 'arrange-rename-sec-sop') as HTMLButtonElement).disabled).toBe(true);
		expect((q(container, 'section-remove-sec-bass') as HTMLButtonElement).disabled).toBe(true);

		gate.resolve();
		await waitFor(() => {
			expect(q(container, 'section-reorder-pending')).toBeNull();
		});
		expect((q(container, 'section-remove-sec-bass') as HTMLButtonElement).disabled).toBe(false);
	});

	it('section-reorder-pending clears when the structural write FAILS too (not only on success)', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		reparentMock.mockRejectedValue(new Error('403'));
		const container = await renderArrangeReady();

		await fireEvent.click(q(container, 'arrange-indent-sec-alto') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'section-reorder-error')).not.toBeNull();
		});
		expect(q(container, 'section-reorder-pending')).toBeNull();
		expect((q(container, 'arrange-rename-sec-sop') as HTMLButtonElement).disabled).toBe(false);
		consoleSpy.mockRestore();
	});

	it('a FAILED rename re-derives the tree from the SERVER (listSections) instead of restoring a stale pre-write snapshot', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		renameMock.mockRejectedValue(new Error('403'));
		const container = await renderArrangeReady();

		listSectionsMock.mockResolvedValue([
			...fixtureTree(),
			{ id: 'sec-ten', name: 'Tenor', displayOrder: 4, parentId: null, depth: 0, children: [] }
		] satisfies SectionNode[]);

		await fireEvent.click(q(container, 'arrange-rename-sec-alto') as HTMLElement);
		const input = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'Alto Voices' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(listSectionsMock).toHaveBeenCalledTimes(2);
		});
		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-ten')).not.toBeNull();
		});
		expect(q(container, 'arrange-rename-sec-alto')?.textContent).toContain('Alto');
		expect(q(container, 'arrange-rename-sec-alto')?.textContent).not.toContain('Voices');
		consoleSpy.mockRestore();
	});

	it('a FAILED delete re-derives the tree from the SERVER too', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		deleteMock.mockRejectedValue(new Error('500'));
		const container = await renderArrangeReady();

		listSectionsMock.mockResolvedValue([
			...fixtureTree(),
			{ id: 'sec-ten', name: 'Tenor', displayOrder: 4, parentId: null, depth: 0, children: [] }
		] satisfies SectionNode[]);

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-bass')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);

		await waitFor(() => {
			expect(listSectionsMock).toHaveBeenCalledTimes(2);
		});
		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-ten')).not.toBeNull();
		});
		expect(q(container, 'arrange-row-sec-bass')).not.toBeNull();
		consoleSpy.mockRestore();
	});
});

describe('/roster — the delete outcome is ANNOUNCED from arrange mode (#155/S4 review F5)', () => {
	it('a SUCCESSFUL delete announces into roster-section-remove-status (role="status", empty until then)', async () => {
		const container = await renderArrangeReady();
		const status = q(container, 'roster-section-remove-status');
		expect(status).not.toBeNull();
		expect(status!.getAttribute('role')).toBe('status');
		expect(status!.textContent?.trim()).toBe('');

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-bass')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);

		await waitFor(() => {
			expect(status!.textContent?.trim()).toContain('roster_section_removed');
		});
		expect(q(container, 'section-remove-error')).toBeNull();
	});

	it('a FAILED delete raises section-remove-error as role="alert" and the row comes back', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		deleteMock.mockRejectedValue(new Error('500'));
		const container = await renderArrangeReady();

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-bass')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);

		await waitFor(() => {
			const error = q(container, 'section-remove-error');
			expect(error).not.toBeNull();
			expect(error!.getAttribute('role')).toBe('alert');
			expect(error!.textContent).toContain('roster_section_remove_failed');
		});
		expect(q(container, 'arrange-row-sec-bass')).not.toBeNull();
		expect(q(container, 'roster-section-remove-status')?.textContent?.trim()).toBe('');
		consoleSpy.mockRestore();
	});

	it('a REFUSED delete ("that section is not empty") gets its OWN message, distinct from the generic write failure', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		deleteMock.mockRejectedValue({ code: 'section-not-empty' });
		const container = await renderArrangeReady();

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-bass')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);

		await waitFor(() => {
			const error = q(container, 'section-remove-error');
			expect(error).not.toBeNull();
			expect(error!.getAttribute('role')).toBe('alert');
			expect(error!.textContent).toContain('roster_section_remove_not_empty');
		});
		expect(q(container, 'section-remove-error')?.textContent).not.toContain(
			'roster_section_remove_failed'
		);
		consoleSpy.mockRestore();
	});
});

describe('/roster — arrange-mode CRUD keeps the keyboard contract (#155/S4 review F2/F3)', () => {
	it('a SUCCESSFUL delete lands focus on the PREVIOUS SIBLING arrange row — never on the Collapsed view-mode chip, never <body>', async () => {
		const gate = deferred();
		deleteMock.mockImplementation(() => gate.promise);
		const container = await renderArrangeReady();

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'section-remove-confirm-sec-bass'));
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);

		await waitFor(() => {
			const confirm = q(container, 'section-remove-confirm-sec-bass') as HTMLButtonElement;
			expect(confirm).not.toBeNull();
			expect(confirm.disabled).toBe(true);
		});

		gate.resolve();
		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-bass')).toBeNull();
		});
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'arrange-row-sec-alto'));
		});
		expect(document.activeElement).not.toBe(q(container, 'roster-view-chip-collapsed'));
		expect(document.activeElement).not.toBe(document.body);
		expect(q(container, 'roster-arrange-list')).not.toBeNull();
		expect(q(container, 'arrange-row-sec-alto')?.getAttribute('tabindex')).toBe('0');
	});

	it('a FAILED delete leaves the pair ARMED beside the error, focus on the re-enabled confirm — never <body>', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		deleteMock.mockRejectedValue(new Error('500'));
		const container = await renderArrangeReady();

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'section-remove-confirm-sec-bass'));
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'section-remove-error')).not.toBeNull();
		});
		const confirm = await waitFor(() => {
			const el = q(container, 'section-remove-confirm-sec-bass') as HTMLButtonElement;
			expect(el).not.toBeNull();
			return el;
		});
		expect(confirm.disabled).toBe(false);
		expect(q(container, 'section-remove-sec-bass')).toBeNull();
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'section-remove-confirm-sec-bass'));
		});
		expect(document.activeElement).not.toBe(document.body);
		consoleSpy.mockRestore();
	});

	it('a REFUSED delete keeps the pair armed (focus on confirm); cancelling restores an INELIGIBLE ✕ and lands focus on the row, not <body>', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		deleteMock.mockRejectedValue({ code: 'section-not-empty' });
		const container = await renderArrangeReady();

		listSectionsMock.mockResolvedValue([
			{ id: 'sec-sop', name: 'Soprano', displayOrder: 1, parentId: null, depth: 0, children: [] },
			{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, depth: 0, children: [] },
			{
				id: 'sec-bass',
				name: 'Bass',
				displayOrder: 3,
				parentId: null,
				depth: 0,
				children: [
					{ id: 'sec-bass1', name: 'Bass 1', displayOrder: 1, parentId: 'sec-bass', depth: 1, children: [] }
				]
			}
		] satisfies SectionNode[]);

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'section-remove-confirm-sec-bass'));
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-bass1')).not.toBeNull();
		});
		await waitFor(() => {
			const confirm = q(container, 'section-remove-confirm-sec-bass') as HTMLButtonElement;
			expect(confirm).not.toBeNull();
			expect(confirm.disabled).toBe(false);
		});
		expect(q(container, 'section-remove-sec-bass')).toBeNull();
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'section-remove-confirm-sec-bass'));
		});
		expect(document.activeElement).not.toBe(document.body);

		await fireEvent.click(q(container, 'section-remove-cancel-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-sec-bass')).not.toBeNull();
		});
		expect((q(container, 'section-remove-sec-bass') as HTMLButtonElement).disabled).toBe(true);
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'arrange-row-sec-bass'));
		});
		expect(document.activeElement).not.toBe(document.body);
		expect(q(container, 'arrange-row-sec-bass')?.getAttribute('tabindex')).toBe('0');
		consoleSpy.mockRestore();
	});

	it('the arrange list keeps EXACTLY ONE roving tab stop while a row is in rename mode', async () => {
		const container = await renderArrangeReady();
		const renderedRows = () => [
			...container.querySelectorAll<HTMLElement>('[data-testid^="arrange-row-"]')
		];
		expect(renderedRows().filter((r) => r.getAttribute('tabindex') === '0')).toHaveLength(1);

		await fireEvent.click(q(container, 'arrange-rename-sec-sop') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-sop')).not.toBeNull();
		});
		expect(q(container, 'arrange-row-sec-sop')).toBeNull();

		const zeroTab = renderedRows().filter((r) => r.getAttribute('tabindex') === '0');
		expect(
			zeroTab,
			'the reorder widget must stay reachable by Tab while a row is renaming'
		).toHaveLength(1);
		expect(zeroTab[0]).toBe(q(container, 'arrange-row-sec-sop1'));

		await fireEvent.keyDown(q(container, 'arrange-rename-input-sec-sop') as HTMLElement, {
			key: 'Escape'
		});
		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-sop')).not.toBeNull();
		});
		expect(renderedRows().filter((r) => r.getAttribute('tabindex') === '0')).toHaveLength(1);
	});
});

// (*MVOX:Palestrina*)

describe('/roster — #237 the section-remove trigger renders the shared red trashcan at 44px', () => {
	it('the idle ✕ becomes the shared unit: aria-hidden TrashIcon, red tone, min-h-11 min-w-11 by construction — the p-1 sub-20px face is gone', async () => {
		const container = await renderArrangeReady();
		const btn = q(container, 'section-remove-sec-bass') as HTMLButtonElement;
		expect(btn).not.toBeNull();

		const svg = btn.querySelector('svg[data-icon="trash"]');
		expect(svg, 'TrashIcon must render inside the trigger').not.toBeNull();
		expect(svg?.getAttribute('aria-hidden')).toBe('true');

		expect(btn.textContent ?? '').not.toMatch(/[×✕]/);

		for (const cls of ['min-h-11', 'min-w-11', 'text-red-700', 'hover:text-red-800']) {
			expect(btn.classList.contains(cls), `${cls} missing on the trigger`).toBe(true);
		}
		expect(btn.classList.contains('text-ink-2'), 'muted tone must go').toBe(false);

		expect(btn.getAttribute('aria-label')).toBe('roster_section_remove');
		expect(btn.getAttribute('title')).toBe('roster_section_remove');
	});

	it('gating is byte-preserved through the swap: an INELIGIBLE section renders the same trashcan, disabled — and the disabled trigger still ignores a click', async () => {
		const container = await renderArrangeReady();
		const btn = q(container, 'section-remove-sec-alto') as HTMLButtonElement;
		expect(btn).not.toBeNull();
		expect(btn.querySelector('svg[data-icon="trash"]')).not.toBeNull();
		expect(btn.disabled).toBe(true);
		await fireEvent.click(btn);
		expect(q(container, 'section-remove-confirm-sec-alto')).toBeNull();
		expect(deleteMock).not.toHaveBeenCalled();
	});

	it('the two-step survives the swap: arm → confirm/cancel (unchanged testids), cancel restores a trigger that STILL renders the trashcan', async () => {
		const container = await renderArrangeReady();
		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-bass')).not.toBeNull();
		});
		expect(deleteMock).not.toHaveBeenCalled();

		await fireEvent.click(q(container, 'section-remove-cancel-sec-bass') as HTMLElement);
		const restored = await waitFor(() => {
			const btn = q(container, 'section-remove-sec-bass');
			expect(btn).not.toBeNull();
			return btn as HTMLElement;
		});
		expect(restored.querySelector('svg[data-icon="trash"]')).not.toBeNull();
		expect(deleteMock).not.toHaveBeenCalled();
	});
});

// (*MVOX:Palestrina*)

describe('/roster — #273 the armed pair stays mounted, disabled + aria-busy, through the in-flight delete', () => {
	it('confirm starts the write WITHOUT unmounting the pair: both halves disabled, confirm aria-busy, labels unchanged — and a double-tap cannot fire two deletes', async () => {
		const gate = deferred();
		deleteMock.mockImplementation(() => gate.promise);
		const container = await renderArrangeReady();

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-bass')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);

		await waitFor(() => {
			const confirm = q(container, 'section-remove-confirm-sec-bass') as HTMLButtonElement;
			expect(confirm, 'confirm must stay mounted through the write').not.toBeNull();
			expect(confirm.disabled).toBe(true);
		});
		const confirm = q(container, 'section-remove-confirm-sec-bass') as HTMLButtonElement;
		expect(confirm.getAttribute('aria-busy')).toBe('true');
		const cancel = q(container, 'section-remove-cancel-sec-bass') as HTMLButtonElement;
		expect(cancel, 'cancel must stay mounted through the write').not.toBeNull();
		expect(cancel.disabled).toBe(true);
		expect(confirm.getAttribute('aria-label')).toBe('roster_section_remove_confirm');
		expect(cancel.getAttribute('aria-label')).toBe('roster_section_remove_cancel');

		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);
		expect(deleteMock).toHaveBeenCalledTimes(1);

		gate.resolve();
		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-bass')).toBeNull();
		});
		expect(deleteMock).toHaveBeenCalledTimes(1);
	});

	it('CANCEL mid-flight is INERT: disabled, the pair stays mounted (never a disarmed rest state), and the delete lands honestly', async () => {
		const gate = deferred();
		deleteMock.mockImplementation(() => gate.promise);
		const container = await renderArrangeReady();

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-bass')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect((q(container, 'section-remove-cancel-sec-bass') as HTMLButtonElement).disabled).toBe(
				true
			);
		});

		await fireEvent.click(q(container, 'section-remove-cancel-sec-bass') as HTMLElement);
		expect(
			q(container, 'section-remove-confirm-sec-bass'),
			'the pair must not disarm while the delete is in flight'
		).not.toBeNull();
		expect(q(container, 'section-remove-cancel-sec-bass')).not.toBeNull();
		expect(
			q(container, 'section-remove-sec-bass'),
			'the rest-state ✕ must never render while the write is running'
		).toBeNull();

		gate.resolve();
		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-bass')).toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'roster-section-remove-status')?.textContent).toContain(
				'roster_section_removed'
			);
		});
		expect(deleteMock).toHaveBeenCalledTimes(1);
	});

	it('SUCCESS clears the armed id: the pair unmounts with the row — normal post-delete state', async () => {
		const gate = deferred();
		deleteMock.mockImplementation(() => gate.promise);
		const container = await renderArrangeReady();

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-bass')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect((q(container, 'section-remove-confirm-sec-bass') as HTMLButtonElement).disabled).toBe(
				true
			);
		});

		gate.resolve();
		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-bass')).toBeNull();
		});
		expect(q(container, 'section-remove-confirm-sec-bass')).toBeNull();
		expect(q(container, 'section-remove-cancel-sec-bass')).toBeNull();
		await waitFor(() => {
			expect(q(container, 'roster-section-remove-status')?.textContent).toContain(
				'roster_section_removed'
			);
		});
	});

	it('FAILURE leaves the pair ARMED and re-enabled next to the error — direct retry through the SAME confirm succeeds', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const gate = deferred();
		deleteMock.mockImplementation(() => gate.promise);
		const container = await renderArrangeReady();

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-bass')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect((q(container, 'section-remove-confirm-sec-bass') as HTMLButtonElement).disabled).toBe(
				true
			);
		});

		gate.reject(new Error('500'));
		await waitFor(() => {
			expect(q(container, 'section-remove-error')).not.toBeNull();
		});
		const confirm = await waitFor(() => {
			const el = q(container, 'section-remove-confirm-sec-bass') as HTMLButtonElement;
			expect(el).not.toBeNull();
			expect(el.disabled).toBe(false);
			return el;
		});
		expect(confirm.getAttribute('aria-busy')).not.toBe('true');
		expect((q(container, 'section-remove-cancel-sec-bass') as HTMLButtonElement).disabled).toBe(
			false
		);
		expect(q(container, 'section-remove-sec-bass')).toBeNull();
		expect(q(container, 'arrange-row-sec-bass')).not.toBeNull();

		deleteMock.mockResolvedValue(undefined);
		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-bass')).toBeNull();
		});
		expect(deleteMock).toHaveBeenCalledTimes(2);
		await waitFor(() => {
			expect(q(container, 'roster-section-remove-status')?.textContent).toContain(
				'roster_section_removed'
			);
		});
		consoleSpy.mockRestore();
	});

	it('the KNOWN-GAP comments (source + this spec file) are removed with the fix', () => {
		const needle = ['carry no disabled/', 'aria-busy wiring'].join('');
		const page = readFileSync(resolve(process.cwd(), 'src/routes/roster/+page.svelte'), 'utf-8');
		expect(
			page.includes(needle),
			'roster/+page.svelte still carries the KNOWN GAP comment for a gap this fix closes'
		).toBe(false);
		const spec = readFileSync(
			resolve(process.cwd(), 'src/routes/page.roster-arrange-crud.spec.ts'),
			'utf-8'
		);
		expect(
			spec.includes(needle),
			'this spec file still carries the #237-era KNOWN-GAP near-duplicate comment'
		).toBe(false);
	});
});

// (*MVOX:Palestrina*)
