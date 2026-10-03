import { cleanup } from '@testing-library/svelte';
import { expect, vi } from 'vitest';
import { resetAppState } from '$lib/testing/appReset';

export function q<T extends HTMLElement = HTMLElement>(
	root: ParentNode,
	testid: string
): T | null {
	return root.querySelector<T>(`[data-testid="${testid}"]`);
}

export function qa(container: HTMLElement, testid: string): HTMLElement[] {
	return Array.from(container.querySelectorAll(`[data-testid="${testid}"]`));
}

// happy-dom has no layout, so the class is the contract: min-h-11 = 44px (WCAG 2.5.5).
export function expectTouchTarget(container: HTMLElement, testid: string): void {
	const el = container.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
	expect(el, `${testid} must be in the DOM`).not.toBeNull();
	expect(
		Array.from((el as HTMLElement).classList),
		`${testid} must reserve a 44px-tall touch target (min-h-11)`
	).toContain('min-h-11');
}

export function cleanupReset(): void {
	cleanup();
	resetAppState();
}

export function cleanupClearReset(): void {
	cleanup();
	vi.clearAllMocks();
	resetAppState();
}

// (*MVOX:Josquin*)
