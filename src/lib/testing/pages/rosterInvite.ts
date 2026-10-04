// Invite-copy and join-state roster specs: clipboard stub and their one-section tree.
import { cleanup } from '@testing-library/svelte';
import { vi } from 'vitest';
import { resetAdmin } from '$lib/nav/adminStore';
import type { SectionNode } from '$lib/sections/sectionData';
import { resetAppState } from '$lib/testing/appReset';
import { ORG_A } from './rosterFixtures';

export function treeA(): SectionNode[] {
	return [
		{ id: 'sec-alto', name: 'Alto', displayOrder: 1, parentId: null, dbEntityId: ORG_A, depth: 0, children: [] }
	];
}

export const originalClipboardDesc = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

export function setClipboard(value: unknown): void {
	Object.defineProperty(navigator, 'clipboard', {
		value,
		configurable: true,
		writable: true
	});
}

export function cleanupRestoreClipboard(): void {
	cleanup();
	vi.clearAllMocks();
	if (originalClipboardDesc) {
		Object.defineProperty(navigator, 'clipboard', originalClipboardDesc);
	} else {
		Reflect.deleteProperty(navigator, 'clipboard');
	}
	resetAppState();
	resetAdmin();
}

export function installWriteText(): ReturnType<typeof vi.fn> {
	const writeText = vi.fn().mockResolvedValue(undefined);
	setClipboard({ writeText });
	return writeText;
}

// (*MVOX:Josquin*)
