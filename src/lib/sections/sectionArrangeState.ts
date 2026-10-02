/** The section tree editor's state; lives as long as the page, so it survives a view switch. */
export interface ArrangeState {
	reorderPending: boolean;
	reorderError: boolean;
	reparentPartial: boolean;
	reorderStatus: string;
	removeError: { name: string; kind: 'write' | 'not-empty' } | null;
	pendingRemoveId: string | null;
	removeStatus: string;
	removePending: boolean;
	pageCreateOpen: boolean;
	pageCreateName: string;
	pageCreateParentId: string;
	pageCreateError: (() => string) | null;
	pageCreateStatus: string;
	renamingSectionId: string | null;
	renameValue: string;
	renamePending: boolean;
	renameError: { id: string; name: string } | null;
	renameStatus: string;
	draggedSectionId: string | null;
	dragOverId: string | null;
	touchDragId: string | null;
	touchOverId: string | null;
	grabbedSectionId: string | null;
	rovingHandleId: string | null;
}

export function createArrangeState(): ArrangeState {
	return {
		reorderPending: false,
		reorderError: false,
		reparentPartial: false,
		reorderStatus: '',
		removeError: null,
		pendingRemoveId: null,
		removeStatus: '',
		removePending: false,
		pageCreateOpen: false,
		pageCreateName: '',
		pageCreateParentId: '',
		pageCreateError: null,
		pageCreateStatus: '',
		renamingSectionId: null,
		renameValue: '',
		renamePending: false,
		renameError: null,
		renameStatus: '',
		draggedSectionId: null,
		dragOverId: null,
		touchDragId: null,
		touchOverId: null,
		grabbedSectionId: null,
		rovingHandleId: null
	};
}

// Writes only, and before the rename flush: the flush's own gate reads these.
export function clearStructuralWrites(a: ArrangeState): void {
	a.reorderError = false;
	a.reorderStatus = '';
	a.reorderPending = false;
	a.removeError = null;
	a.pendingRemoveId = null;
	a.pageCreateError = null;
	a.removePending = false;
}

// Writes only, after the rename flush. Drag, grab and the roving stop are never reset.
export function resetArrange(a: ArrangeState, { isSwitch }: { isSwitch: boolean }): void {
	a.renamingSectionId = null;
	a.renameValue = '';
	a.renamePending = false;
	a.renameError = null;
	a.removeStatus = '';
	a.renameStatus = '';
	a.pageCreateStatus = '';
	if (isSwitch) {
		a.pageCreateOpen = false;
		a.pageCreateName = '';
		a.pageCreateParentId = '';
	}
}

export function isStructuralWritePending(a: ArrangeState): boolean {
	return a.reorderPending || a.renamePending || a.removePending;
}
