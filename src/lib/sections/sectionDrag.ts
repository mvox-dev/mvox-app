import { tick } from 'svelte';
import { m } from '$lib/paraglide/messages.js';
import type { SectionNode } from '$lib/sections/sectionData';
import {
	applySiblingOrder,
	findSectionNode,
	type ArrangeRow
} from '$lib/sections/sectionTree';
import {
	isStructuralWritePending,
	type ArrangeOps,
	type ArrangeState
} from '$lib/sections/sectionArrangeOps';
import type { RosterState } from '$lib/roster/rosterPageState';

const LONG_PRESS_MS = 400;
const LONG_PRESS_SLOP_PX = 10;

export interface ArrangeDragDeps {
	roster: RosterState;
	arrange: ArrangeState;
	ops: ArrangeOps;
	isAdmin: () => boolean;
	visibleSections: () => SectionNode[];
	arrangeRows: () => ArrangeRow[];
}

export type ArrangeDrag = ReturnType<typeof createArrangeDrag>;

/** The first id in `ids` unless the roving stop sits on one of them. */
export function rovingStop(rovingId: string | null, ids: string[]): string | null {
	return rovingId !== null && ids.includes(rovingId) ? rovingId : (ids[0] ?? null);
}

export function createArrangeDrag(deps: ArrangeDragDeps) {
	const { roster, arrange: a, ops } = deps;
	const structuralWritePending = () => isStructuralWritePending(a);

	let longPressTimer: ReturnType<typeof setTimeout> | null = null;
	let pressOrigin: { x: number; y: number } | null = null;
	let pressHandle: HTMLElement | null = null;
	let pressPointerId: number | null = null;
	let grabSiblingIds: string[] | null = null;
	let grabRefocusPending = false;

	function handleDragStart(id: string, event: DragEvent): void {
		a.draggedSectionId = id;
		a.dragOverId = null;
		if (event.dataTransfer) {
			event.dataTransfer.setData('text/plain', id);
			event.dataTransfer.effectAllowed = 'move';
		}
	}

	function handleDragEnd(): void {
		a.draggedSectionId = null;
		a.dragOverId = null;
	}

	function handleDragOver(id: string, event: DragEvent): void {
		if (a.draggedSectionId === null) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		a.dragOverId = id;
	}

	function handleDragLeave(id: string, event: DragEvent): void {
		if (a.dragOverId !== id) return;
		const row = event.currentTarget as HTMLElement | null;
		const to = event.relatedTarget as Node | null;
		if (row && to && row.contains(to)) return;
		a.dragOverId = null;
	}

	function dropOnto(fromId: string, targetId: string): void {
		if (!fromId || fromId === targetId) return;

		const siblingNodes = ops.visibleSiblingsOf(fromId);
		if (!siblingNodes) return;
		const siblingIds = siblingNodes.map((n) => n.id);
		const targetIndex = siblingIds.indexOf(targetId);
		if (targetIndex === -1) return;

		const withoutFrom = siblingIds.filter((id) => id !== fromId);
		const insertAt = Math.min(targetIndex, withoutFrom.length);
		const afterIds = [...withoutFrom.slice(0, insertAt), fromId, ...withoutFrom.slice(insertAt)];
		void ops.performReorder(siblingIds, afterIds, fromId);
	}

	function handleDrop(targetId: string, event: DragEvent): void {
		const fromId = a.draggedSectionId;
		a.draggedSectionId = null;
		a.dragOverId = null;
		if (!fromId) return;
		event.preventDefault();
		dropOnto(fromId, targetId);
	}

	function endTouchDrag(): void {
		if (longPressTimer !== null) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
		if (pressHandle && pressPointerId !== null) {
			try {
				if (pressHandle.hasPointerCapture?.(pressPointerId)) {
					pressHandle.releasePointerCapture(pressPointerId);
				}
			} catch {
			}
		}
		pressOrigin = null;
		pressHandle = null;
		pressPointerId = null;
		a.touchDragId = null;
		a.touchOverId = null;
	}

	function sectionIdUnderPointer(x: number, y: number): string | null {
		const under = document.elementFromPoint?.(x, y);
		const match =
			under?.closest(
				'[data-testid^="section-group-"], [data-testid^="arrange-row-"], [data-drop-row]'
			) ?? null;
		const testid = match?.getAttribute('data-testid') ?? '';
		const id = testid.startsWith('arrange-row-')
			? testid.slice('arrange-row-'.length)
			: testid.startsWith('section-group-')
				? testid.slice('section-group-'.length)
				: (match?.getAttribute('data-drop-row') ?? '');
		return id && id !== 'unassigned' ? id : null;
	}

	function handlePointerDown(id: string, event: PointerEvent): void {
		if (event.pointerType === 'mouse') return;
		if (structuralWritePending()) return;
		endTouchDrag();
		const handle = (event.target as HTMLElement | null)?.closest?.(
			'[data-testid^="section-drag-handle-"], [data-testid^="arrange-grip-"]'
		) as HTMLElement | null;
		if (!handle) return;
		pressHandle = handle;
		pressPointerId = event.pointerId;
		pressOrigin = { x: event.clientX, y: event.clientY };
		longPressTimer = setTimeout(() => {
			longPressTimer = null;
			a.touchDragId = id;
			a.touchOverId = id;
			try {
				handle.setPointerCapture(pressPointerId as number);
			} catch {
			}
		}, LONG_PRESS_MS);
	}

	function handlePointerMove(event: PointerEvent): void {
		if (a.touchDragId === null) {
			if (longPressTimer === null || !pressOrigin) return;
			const dx = event.clientX - pressOrigin.x;
			const dy = event.clientY - pressOrigin.y;
			if (Math.hypot(dx, dy) > LONG_PRESS_SLOP_PX) endTouchDrag();
			return;
		}
		event.preventDefault();
		a.touchOverId = sectionIdUnderPointer(event.clientX, event.clientY);
	}

	function handlePointerUp(event: PointerEvent): void {
		const fromId = a.touchDragId;
		if (fromId === null) {
			endTouchDrag();
			return;
		}
		const targetId = sectionIdUnderPointer(event.clientX, event.clientY) ?? a.touchOverId;
		endTouchDrag();
		if (targetId) dropOnto(fromId, targetId);
	}

	function reorderableHandleIds(): string[] {
		if (!deps.isAdmin()) return [];
		const ids: string[] = [];
		function walk(nodes: SectionNode[]): void {
			for (const n of nodes) {
				if (roster.expandedIds.has(n.id)) walk(n.children);
				else ids.push(n.id);
			}
		}
		walk(deps.visibleSections());
		return ids;
	}

	function arrangeReorderableIds(): string[] {
		return deps
			.arrangeRows()
			.filter((r) => r.id !== a.renamingSectionId)
			.map((r) => r.id);
	}

	function handleElementFor(id: string): HTMLElement | null {
		return (
			document.querySelector<HTMLElement>(`[data-testid="section-drag-handle-${id}"]`) ??
			document.querySelector<HTMLElement>(`[data-testid="arrange-row-${id}"]`)
		);
	}

	function moveFocus(direction: 1 | -1): void {
		const ids = roster.viewMode === 'arrange' ? arrangeReorderableIds() : reorderableHandleIds();
		const currentId = rovingStop(a.rovingHandleId, ids);
		if (currentId === null) return;
		const idx = ids.indexOf(currentId);
		const nextIdx = idx + direction;
		if (idx === -1 || nextIdx < 0 || nextIdx >= ids.length) return;
		const nextId = ids[nextIdx];
		a.rovingHandleId = nextId;
		tick().then(() => handleElementFor(nextId)?.focus());
	}

	async function toggleGrab(node: SectionNode): Promise<void> {
		if (a.grabbedSectionId !== null && a.grabbedSectionId !== node.id) return;

		if (a.grabbedSectionId === null) {
			if (structuralWritePending()) return;
			a.grabbedSectionId = node.id;
			grabSiblingIds = ops.visibleSiblingsOf(node.id)?.map((n) => n.id) ?? [node.id];
			a.rovingHandleId = node.id;
			a.reorderStatus = m.roster_section_grabbed({ name: node.name });
			return;
		}

		const before = grabSiblingIds ?? [];
		const after = ops.visibleSiblingsOf(node.id)?.map((n) => n.id) ?? before;
		a.grabbedSectionId = null;
		grabSiblingIds = null;
		if (before.length === after.length && before.every((id, i) => id === after[i])) {
			a.reorderStatus = m.roster_section_dropped({
				name: node.name,
				position: after.indexOf(node.id) + 1,
				total: after.length
			});
			return;
		}
		const wrote = await ops.performReorder(before, after, node.id);
		if (!wrote) return;
		const committed = ops.visibleSiblingsOf(node.id)?.map((n) => n.id) ?? after;
		a.reorderStatus = m.roster_section_dropped({
			name: node.name,
			position: committed.indexOf(node.id) + 1,
			total: committed.length
		});
	}

	async function handleHandleKeydown(node: SectionNode, event: KeyboardEvent): Promise<void> {
		if (event.target !== event.currentTarget) return;

		const key = event.key;

		if (a.grabbedSectionId !== null && a.grabbedSectionId !== node.id) return;

		if (a.grabbedSectionId === null) {
			if (key === ' ' || key === 'Enter') {
				event.preventDefault();
				await toggleGrab(node);
				return;
			}
			if (key === 'ArrowDown') {
				event.preventDefault();
				moveFocus(1);
				return;
			}
			if (key === 'ArrowUp') {
				event.preventDefault();
				moveFocus(-1);
			}
			return;
		}

		if (key === 'ArrowUp' || key === 'ArrowDown') {
			event.preventDefault();
			const siblingIds = ops.visibleSiblingsOf(node.id)?.map((n) => n.id) ?? [];
			const idx = siblingIds.indexOf(node.id);
			const nextIdx = idx + (key === 'ArrowUp' ? -1 : 1);
			if (idx === -1 || nextIdx < 0 || nextIdx >= siblingIds.length) return;
			const reordered = [...siblingIds];
			reordered.splice(idx, 1);
			reordered.splice(nextIdx, 0, node.id);
			grabRefocusPending = true;
			roster.sections = applySiblingOrder(roster.sections, reordered);
			a.reorderStatus = m.roster_section_moved({
				name: node.name,
				position: nextIdx + 1,
				total: reordered.length
			});
			try {
				await tick();
				handleElementFor(node.id)?.focus();
			} finally {
				grabRefocusPending = false;
			}
			return;
		}

		if (key === 'ArrowRight' || key === 'ArrowLeft') {
			if (findSectionNode(roster.sections, node.id)?.parentDamaged === true) {
				event.preventDefault();
				return;
			}
		}

		if (key === 'ArrowRight') {
			event.preventDefault();
			if (ops.prevSiblingId(node.id) === null) return;
			a.grabbedSectionId = null;
			grabSiblingIds = null;
			await ops.handleIndent(node);
			return;
		}

		if (key === 'ArrowLeft') {
			event.preventDefault();
			if (node.parentId === null) return;
			a.grabbedSectionId = null;
			grabSiblingIds = null;
			await ops.handleUnindent(node);
			return;
		}

		if (key === ' ' || key === 'Enter') {
			event.preventDefault();
			await toggleGrab(node);
			return;
		}

		if (key === 'Escape') {
			event.preventDefault();
			cancelGrab(node);
			await tick();
			handleElementFor(node.id)?.focus();
		}
	}

	function cancelGrab(node: SectionNode): void {
		const restore = grabSiblingIds;
		a.grabbedSectionId = null;
		grabSiblingIds = null;
		if (restore) roster.sections = applySiblingOrder(roster.sections, restore);
		a.reorderStatus = m.roster_section_move_cancelled({ name: node.name });
	}

	function handleHandleBlur(node: SectionNode): void {
		if (grabRefocusPending) return;
		if (a.grabbedSectionId !== node.id) return;
		cancelGrab(node);
	}

	return {
		handleDragStart,
		handleDragEnd,
		handleDragOver,
		handleDragLeave,
		handleDrop,
		endTouchDrag,
		handlePointerDown,
		handlePointerMove,
		handlePointerUp,
		arrangeReorderableIds,
		handleElementFor,
		toggleGrab,
		handleHandleKeydown,
		handleHandleBlur
	};
}

// (*MVOX:Josquin*)
