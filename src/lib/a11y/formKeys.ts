// Inline create-form keys. Wired on every control, not the wrapper: a keydown listener
// on a non-interactive element is an a11y violation.
export interface FormKeyActions {
	close: () => void;
	submit: () => void;
}

export function escapeKeydown(event: KeyboardEvent, close: () => void): void {
	if (event.key !== 'Escape') return;
	event.preventDefault();
	close();
}

// Text fields only: Enter on a button keeps its native click.
export function fieldKeydown(event: KeyboardEvent, { close, submit }: FormKeyActions): void {
	if (event.key === 'Escape') {
		escapeKeydown(event, close);
		return;
	}
	if (event.key !== 'Enter') return;
	event.preventDefault();
	submit();
}
