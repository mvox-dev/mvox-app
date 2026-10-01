// Create-form keys: one listener on the form wrapper, so a field added later inherits them.
export interface FormKeyActions {
	close: () => void;
	submit: () => void;
}

const NOT_SINGLE_LINE = new Set([
	'button',
	'checkbox',
	'color',
	'file',
	'image',
	'radio',
	'range',
	'reset',
	'submit'
]);

// A textarea, select or button keeps its own Enter.
function isSingleLineField(target: EventTarget | null): boolean {
	return target instanceof HTMLInputElement && !NOT_SINGLE_LINE.has(target.type);
}

export function formKeydown(event: KeyboardEvent, { close, submit }: FormKeyActions): void {
	if (event.key === 'Escape') {
		event.preventDefault();
		close();
		return;
	}
	if (event.key !== 'Enter' || !isSingleLineField(event.target)) return;
	event.preventDefault();
	submit();
}
