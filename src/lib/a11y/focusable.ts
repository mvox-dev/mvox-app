import { tick } from 'svelte';

export function focusableByTestId(testid: string): HTMLElement | null {
	const el = document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
	return el && !(el as HTMLButtonElement).disabled ? el : null;
}

export function ownsFocus(testid: string): boolean {
	const active = document.activeElement;
	return (
		!active ||
		active === document.body ||
		active === document.querySelector(`[data-testid="${testid}"]`)
	);
}

export function focusOnMount(node: HTMLElement): void {
	node.focus();
}

export async function focusAfterRender(get: () => HTMLElement | null | undefined): Promise<void> {
	await tick();
	get()?.focus();
}

export function focusTestIdAfterRender(testid: string): Promise<void> {
	return focusAfterRender(() => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`));
}
