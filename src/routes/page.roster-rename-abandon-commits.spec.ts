// @vitest-environment happy-dom
// An abandoned section rename commits; Escape is the only discard.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
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
	renameMock,
	deactivateMemberMock,
	reinstateMemberMock,
	loadInactiveRosterMock,
	listInactiveMembersMock,
	listDeactivateBlockersMock,
	createInviteMock,
	mintSelfLinkInviteMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	assignMock: vi.fn(),
	unassignMock: vi.fn(),
	createMock: vi.fn(),
	reorderMock: vi.fn(),
	deleteMock: vi.fn(),
	reparentMock: vi.fn(),
	renameMock: vi.fn(),
	deactivateMemberMock: vi.fn(),
	reinstateMemberMock: vi.fn(),
	loadInactiveRosterMock: vi.fn(),
	listInactiveMembersMock: vi.fn(),
	listDeactivateBlockersMock: vi.fn(),
	createInviteMock: vi.fn(),
	mintSelfLinkInviteMock: vi.fn()
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
vi.mock('$lib/roster/memberLifecycle', () => ({
	deactivateMember: deactivateMemberMock,
	reinstateMember: reinstateMemberMock,
	loadInactiveRoster: loadInactiveRosterMock,
	listInactiveMembers: listInactiveMembersMock,
	listDeactivateBlockers: listDeactivateBlockersMock
}));
vi.mock('$lib/invite/inviteData', async (importActual) => ({
	...(await importActual<typeof import('$lib/invite/inviteData')>()),
	createInvite: createInviteMock,
	mintSelfLinkInvite: mintSelfLinkInviteMock
}));
vi.mock('$lib/library/librarianStore', async (importActual) => ({
	...(await importActual<typeof import('$lib/library/librarianStore')>()),
	resolveMyLibraryId: vi.fn().mockResolvedValue('lib-1'),
	resolveLibrarian: vi.fn().mockResolvedValue({ state: 'ready', libraryId: 'lib-1' })
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import type { SectionNode } from '$lib/sections/sectionData';
import type { RosterRow } from '$lib/roster/rosterData';
import { resolveMyLibraryId } from '$lib/library/librarianStore';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures';
import { testCfg } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function treeA(): SectionNode[] {
	return [
		{ id: 'sec-sop', name: 'Soprano', displayOrder: 1, parentId: null, dbEntityId: ORG_A, depth: 0, children: [] },
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, dbEntityId: ORG_A, depth: 0, children: [] },
		{ id: 'sec-tenor', name: 'Tenor', displayOrder: 3, parentId: null, dbEntityId: ORG_A, depth: 0, children: [] }
	];
}

function treeB(): SectionNode[] {
	return [
		{ id: 'sec-b1', name: 'Bass I', displayOrder: 1, parentId: null, dbEntityId: ORG_B, depth: 0, children: [] },
		{ id: 'sec-b2', name: 'Bass II', displayOrder: 2, parentId: null, dbEntityId: ORG_B, depth: 0, children: [] }
	];
}

function rowsA(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: [], dbEntityId: ORG_A },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: 'bea@x.com', sectionIds: [], dbEntityId: ORG_A }
	];
}

function rowsB(): RosterRow[] {
	return [
		{ memberId: 'm-bob', personId: 'p-bob', name: 'Bob Bass', email: 'bob@x.com', sectionIds: [], dbEntityId: ORG_B }
	];
}

const CFG_A = testCfg('sampledb', 'jwt-abc');

function setAuthedWithTwoCollectives() {
	signIn({
		collectives: [
			{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
			{ db: 'other-choir', name: 'Other Choir', personId: 'person-q' }
		]
	});
}

beforeEach(() => {
	loadRosterMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(toListRead(cfg.db === 'sampledb' ? rowsA() : rowsB()))
	);
	listSectionsMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(cfg.db === 'sampledb' ? treeA() : treeB())
	);
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createMock.mockResolvedValue('sec-created');
	reorderMock.mockResolvedValue(undefined);
	deleteMock.mockResolvedValue(undefined);
	reparentMock.mockResolvedValue(undefined);
	renameMock.mockResolvedValue(undefined);
	deactivateMemberMock.mockResolvedValue(undefined);
	reinstateMemberMock.mockResolvedValue(undefined);
	loadInactiveRosterMock.mockResolvedValue(toListRead([]));
	listInactiveMembersMock.mockResolvedValue(toListRead([]));
	listDeactivateBlockersMock.mockResolvedValue([]);
	vi.mocked(resolveMyLibraryId).mockResolvedValue('lib-1');
});

afterEach(() => {
	cleanup();
	renameMock.mockReset();
	deleteMock.mockReset();
	vi.clearAllMocks();
	resetAppState();
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function renameStatusText(container: HTMLElement): string {
	return (q(container, 'roster-section-rename-status')?.textContent ?? '').trim();
}

function anyRenameErrorAlert(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[data-testid^="arrange-rename-error-"]');
}

function anyRenameInput(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[data-testid^="arrange-rename-input-"]');
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function renderInArrangeMode(): Promise<HTMLElement> {
	setAuthedWithTwoCollectives();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'roster-groups')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'roster-view-chip-arrange') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-arrange-list')).not.toBeNull();
	});
	return container;
}

async function switchToOtherChoirArrange(container: HTMLElement) {
	selectedCollectiveDbStore.set('other-choir');
	await waitFor(() => {
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
	});
	expect(q(container, 'arrange-row-sec-sop')).toBeNull();
}

async function switchBackToSampledbArrange(container: HTMLElement) {
	selectedCollectiveDbStore.set('sampledb');
	await waitFor(() => {
		expect(q(container, 'arrange-row-sec-sop')).not.toBeNull();
	});
	expect(q(container, 'arrange-row-sec-b1')).toBeNull();
}

async function openRenameRaw(container: HTMLElement, sectionId: string): Promise<HTMLInputElement> {
	await fireEvent.click(q(container, `arrange-rename-${sectionId}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `arrange-rename-input-${sectionId}`)).not.toBeNull();
	});
	return q(container, `arrange-rename-input-${sectionId}`) as HTMLInputElement;
}

async function openRename(container: HTMLElement, sectionId: string, newName: string) {
	const input = await openRenameRaw(container, sectionId);
	await fireEvent.input(input, { target: { value: newName } });
	return input;
}

describe('/roster — #303 blur COMMITS the open rename', () => {
	it('BLUR COMMITS: losing focus writes renameSection(cfg, id, trimmed) exactly ONCE, closes the input, shows the new name, and ANNOUNCES exactly as Enter does', async () => {
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', '  Contralto  ');

		await fireEvent.blur(input);

		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});
		expect(renameMock).toHaveBeenCalledWith(CFG_A, 'sec-alto', 'Contralto');
		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-alto')).toBeNull();
		});
		expect(q(container, 'arrange-rename-sec-alto')?.textContent).toContain('Contralto');
		const status = q(container, 'roster-section-rename-status');
		expect(status?.getAttribute('role')).toBe('status');
		await waitFor(() => {
			expect(renameStatusText(container)).toContain('roster_section_renamed');
		});
		expect(renameStatusText(container)).toContain('Contralto');
		await flush();
		expect(renameMock).toHaveBeenCalledTimes(1);
	});

	it('BLUR COMMIT DOES NOT STEAL FOCUS: the settle leaves focus where the user put it — the Enter path’s trigger-refocus must not yank it back', async () => {
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', 'Contralto');

		const elsewhere = q(container, 'arrange-rename-sec-tenor') as HTMLButtonElement;
		elsewhere.focus();
		await fireEvent.blur(input);
		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});

		gate.resolve();
		await flush();
		await flush(); // settle's own `await tick()` before its focus write

		expect(
			document.activeElement,
			'a blur-triggered commit must not steal focus back to the rename trigger'
		).toBe(elsewhere);
	});

	it('BLUR ON AN UNCHANGED VALUE: no write (nothing to commit), the input closes, no residue, no announcement', async () => {
		const container = await renderInArrangeMode();
		const input = await openRenameRaw(container, 'sec-alto');
		expect(input.value).toBe('Alto');

		await fireEvent.blur(input);

		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-alto')).toBeNull();
		});
		expect(renameMock).not.toHaveBeenCalled();
		expect(q(container, 'arrange-rename-sec-alto')?.textContent).toContain('Alto');
		expect(renameStatusText(container)).toBe('');
	});

	it('BLUR WITH BLANK/WHITESPACE: refuses without writing, the input closes, the ORIGINAL name stands, no announcement', async () => {
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', '   ');

		await fireEvent.blur(input);

		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-alto')).toBeNull();
		});
		expect(renameMock).not.toHaveBeenCalled();
		expect(q(container, 'arrange-rename-sec-alto')?.textContent).toContain('Alto');
		expect(renameStatusText(container)).toBe('');
	});

	it('BLUR WHILE ANOTHER STRUCTURAL WRITE IS IN FLIGHT: refuses without writing and KEEPS the input and its text — never a silent discard, never a second write', async () => {
		const gate = deferred();
		deleteMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', 'Contralto');

		await fireEvent.click(q(container, 'section-remove-sec-tenor') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-tenor')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-tenor') as HTMLElement);
		await waitFor(() => {
			expect(deleteMock).toHaveBeenCalledTimes(1);
		});

		await fireEvent.blur(input);
		await flush();

		expect(renameMock).not.toHaveBeenCalled();
		const stillOpen = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement;
		expect(stillOpen, 'the refused rename stays open — its text is not discardable').not.toBeNull();
		expect(stillOpen.value).toBe('Contralto');

		gate.resolve();
		await flush();
		await fireEvent.keyDown(stillOpen, { key: 'Enter' });
		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});
		expect(renameMock).toHaveBeenCalledWith(CFG_A, 'sec-alto', 'Contralto');
	});
});

describe('/roster — #303 the double-commit traps (call count, never final state)', () => {
	it('BLUR AFTER ENTER: the unmount-blur a browser fires after submit adds NO second write', async () => {
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', 'Contralto');

		await fireEvent.keyDown(input, { key: 'Enter' });
		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});
		expect(q(container, 'arrange-rename-input-sec-alto')).toBeNull();
		await fireEvent.blur(input);
		await flush();
		expect(renameMock).toHaveBeenCalledTimes(1);

		gate.resolve();
		await flush();
		expect(renameMock).toHaveBeenCalledTimes(1);
		await waitFor(() => {
			expect(renameStatusText(container)).toContain('Contralto');
		});
	});

	it('BLUR AFTER ESCAPE: Escape discarded — the unmount-blur must not resurrect the discarded text as a write', async () => {
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', 'Discarded Name');

		await fireEvent.keyDown(input, { key: 'Escape' });
		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-alto')).toBeNull();
		});
		await fireEvent.blur(input);
		await flush();

		expect(renameMock).not.toHaveBeenCalled();
		expect(q(container, 'arrange-rename-sec-alto')?.textContent).toContain('Alto');
		expect(q(container, 'arrange-rename-sec-alto')?.textContent).not.toContain('Discarded');
	});

	it('UNMOUNT PROBE: in THIS environment, unmounting the genuinely-FOCUSED input fires no blur — one Enter, one write; the environment fact is pinned so a change surfaces loudly', async () => {
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', 'Contralto');
		await waitFor(() => {
			expect(document.activeElement).toBe(input);
		});
		let removalBlurs = 0;
		input.addEventListener('blur', () => removalBlurs++);
		input.addEventListener('focusout', () => removalBlurs++);

		await fireEvent.keyDown(input, { key: 'Enter' });
		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-alto')).toBeNull();
		});
		await flush();
		expect(removalBlurs, 'happy-dom fired blur/focusout on unmount — re-check the manual-dispatch coverage').toBe(0);
		expect(renameMock).toHaveBeenCalledTimes(1);

		gate.resolve();
		await flush();
		expect(renameMock).toHaveBeenCalledTimes(1);
	});
});

describe('/roster — #303 starting a rename on ANOTHER section commits the outgoing one', () => {
	it('SECTION SWITCH COMMITS (no preceding blur — the programmatic path): the outgoing rename writes ONCE, then the new row arms pre-filled — the silent overwrite is gone', async () => {
		const container = await renderInArrangeMode();
		await openRename(container, 'sec-alto', 'Contralto');

		await fireEvent.click(q(container, 'arrange-rename-sec-tenor') as HTMLElement);

		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});
		expect(renameMock).toHaveBeenCalledWith(CFG_A, 'sec-alto', 'Contralto');
		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-tenor')).not.toBeNull();
		});
		expect((q(container, 'arrange-rename-input-sec-tenor') as HTMLInputElement).value).toBe(
			'Tenor'
		);
		expect(q(container, 'arrange-rename-sec-alto')?.textContent).toContain('Contralto');
		await flush();
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'arrange-rename-input-sec-tenor'));
		});
		expect(renameMock).toHaveBeenCalledTimes(1);
	});

	it('SECTION SWITCH COMMITS IN REAL-BROWSER ORDER (blur, THEN click): the commit must not swallow the click that caused it — the new row still arms, pre-filled and focused', async () => {
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', 'Contralto');

		await fireEvent.blur(input);
		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});
		await flush(); // let the DOM catch up with the flag the commit just set

		const tenorTrigger = q(container, 'arrange-rename-sec-tenor') as HTMLButtonElement;
		expect(
			tenorTrigger.disabled,
			'the outgoing commit must not disable the trigger the user is clicking toward'
		).toBe(false);
		await fireEvent.click(tenorTrigger);

		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-tenor')).not.toBeNull();
		});
		expect((q(container, 'arrange-rename-input-sec-tenor') as HTMLInputElement).value).toBe(
			'Tenor'
		);
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'arrange-rename-input-sec-tenor'));
		});
		expect(renameMock).toHaveBeenCalledTimes(1);
		expect(renameMock).toHaveBeenCalledWith(CFG_A, 'sec-alto', 'Contralto');

		gate.resolve();
		await flush();
		await flush();
		expect(renameMock).toHaveBeenCalledTimes(1);
		expect(q(container, 'arrange-rename-sec-alto')?.textContent).toContain('Contralto');
		expect(document.activeElement).toBe(q(container, 'arrange-rename-input-sec-tenor'));
	});

	it('SWITCH REFUSED IS NOT A DISCARD: when the outgoing commit is refused, the FIRST editor keeps its text and the second row does NOT arm over it', async () => {
		const container = await renderInArrangeMode();
		await openRename(container, 'sec-alto', 'Contralto');

		await fireEvent.click(q(container, 'section-remove-sec-sop') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-sop')).not.toBeNull();
		});

		const tenorTrigger = q(container, 'arrange-rename-sec-tenor') as HTMLButtonElement;
		expect(tenorTrigger.disabled).toBe(false);
		await fireEvent.click(tenorTrigger);
		await flush();

		expect(renameMock).not.toHaveBeenCalled();
		expect(
			q(container, 'arrange-rename-input-sec-tenor'),
			'the new row must not arm over a rename that could not be committed'
		).toBeNull();
		const stillOpen = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement;
		expect(stillOpen, 'the refused rename stays open — its text is not discardable').not.toBeNull();
		expect(stillOpen.value).toBe('Contralto');
	});
});

describe('/roster — #303 an armed-but-unconfirmed delete holds the floor', () => {
	it('AN ARMED-BUT-UNCONFIRMED DELETE HOLDS THE FLOOR: Enter in an open rename refuses without writing and keeps the text; cancelling the delete releases it', async () => {
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', 'Contralto');

		await fireEvent.click(q(container, 'section-remove-sec-tenor') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-tenor')).not.toBeNull();
		});
		expect(renameMock).not.toHaveBeenCalled();
		expect((q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement).value).toBe(
			'Contralto'
		);

		input.focus();
		await fireEvent.keyDown(input, { key: 'Enter' });
		await flush();
		expect(renameMock).not.toHaveBeenCalled();
		expect((q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement).value).toBe(
			'Contralto'
		);

		(q(container, 'arrange-rename-sec-sop') as HTMLElement).focus();
		await fireEvent.blur(input);
		await flush();
		expect(renameMock).not.toHaveBeenCalled();
		expect((q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement).value).toBe(
			'Contralto'
		);

		await fireEvent.click(q(container, 'section-remove-cancel-sec-tenor') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-tenor')).toBeNull();
		});
		const reopened = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement;
		expect(reopened).not.toBeNull();
		reopened.focus();
		await fireEvent.keyDown(reopened, { key: 'Enter' });
		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});
		expect(renameMock).toHaveBeenCalledWith(CFG_A, 'sec-alto', 'Contralto');
	});
});

describe('/roster — #303 a collective switch commits the open rename (and the generation hazard)', () => {
	it('COLLECTIVE SWITCH COMMITS: exactly ONE write, to the OUTGOING collective’s cfg, with the typed value', async () => {
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', 'Half-typed');

		await switchToOtherChoirArrange(container);

		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});
		expect(renameMock).toHaveBeenCalledWith(CFG_A, 'sec-alto', 'Half-typed');
		expect(anyRenameInput(container)).toBeNull();

		await fireEvent.blur(input);
		await flush();
		expect(renameMock).toHaveBeenCalledTimes(1);
	});

	it('GENERATION HAZARD: the switch-commit’s success settles into SILENCE — the outgoing collective’s announcement must not land in B’s live region, and B’s controls are free meanwhile', async () => {
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();
		await openRename(container, 'sec-alto', 'Half-typed');

		await switchToOtherChoirArrange(container);
		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});

		expect(
			(q(container, 'arrange-rename-sec-b1') as HTMLButtonElement).disabled,
			"B's rename trigger must not be disabled by A's switch-commit in flight"
		).toBe(false);
		expect(q(container, 'arrange-row-sec-b1')?.getAttribute('draggable')).toBe('true');

		gate.resolve();
		await flush();

		expect(
			renameStatusText(container),
			"A's switch-commit success must announce NOTHING into B's live region"
		).toBe('');
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
		expect(q(container, 'arrange-row-sec-b2')).not.toBeNull();
		expect(renameMock).toHaveBeenCalledTimes(1);
	});

	it('SWITCH-COMMIT REJECTION: no failure alert on B, no A-tree clobber of B, and nothing resurfaces on A after switching back', async () => {
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderInArrangeMode();
		await openRename(container, 'sec-alto', 'Half-typed');

		await switchToOtherChoirArrange(container);
		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});

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
			"a superseded switch-commit failure must not resurface on A's row"
		).toBeNull();
		expect(anyRenameInput(container)).toBeNull();
		consoleSpy.mockRestore();
	});

	it('SWITCH DURING A BLUR-COMMIT: the reset finds nothing left to commit — exactly ONE write, and the stale settle announces nothing into B', async () => {
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', 'Contralto');

		await fireEvent.blur(input);
		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirArrange(container);
		await flush();
		expect(renameMock).toHaveBeenCalledTimes(1);
		expect(
			(q(container, 'arrange-rename-sec-b1') as HTMLButtonElement).disabled,
			"B's controls must not be frozen by A's in-flight blur-commit"
		).toBe(false);

		gate.resolve();
		await flush();
		expect(renameStatusText(container)).toBe('');
		expect(renameMock).toHaveBeenCalledTimes(1);
	});
});

// (*MVOX:Tallis*)
