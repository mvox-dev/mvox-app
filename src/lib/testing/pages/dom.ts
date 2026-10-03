import { expect } from 'vitest';

export function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
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

// (*MVOX:Josquin*)
