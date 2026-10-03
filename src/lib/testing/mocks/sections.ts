// Section write mocks for the roster page; spec and factory share one handle each.
import { vi } from 'vitest';

export const assignMock = vi.fn();
export const unassignMock = vi.fn();
export const createMock = vi.fn();
export const createSectionMock = vi.fn();
export const reorderMock = vi.fn();
export const deleteMock = vi.fn();
export const reparentMock = vi.fn();
export const renameMock = vi.fn();

// Arrange-mode writes, createSection on createMock; extra adds reparent and/or rename.
export function sectionActionsModule(extra: Array<'reparent' | 'rename'> = []) {
	return {
		assignMemberSection: assignMock,
		unassignMemberSection: unassignMock,
		createSection: createMock,
		reorderSections: reorderMock,
		deleteSection: deleteMock,
		...(extra.includes('reparent') ? { reparentSection: reparentMock } : {}),
		...(extra.includes('rename') ? { renameSection: renameMock } : {})
	};
}

// createSection on createSectionMock; arrange adds reorder and delete.
export function sectionCreateModule(opts: { arrange: boolean }) {
	return {
		assignMemberSection: assignMock,
		unassignMemberSection: unassignMock,
		createSection: createSectionMock,
		...(opts.arrange ? { reorderSections: reorderMock, deleteSection: deleteMock } : {})
	};
}

// (*MVOX:Josquin*)
