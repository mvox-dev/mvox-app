export function focusableByTestId(testid: string): HTMLElement | null {
	const el = document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
	return el && !(el as HTMLButtonElement).disabled ? el : null;
}
