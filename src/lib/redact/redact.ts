export const REDACT_ATTR = 'data-redact';
export const REDACT_TOGGLE_ATTR = 'data-redacting';

// Leaves a toggle someone set by hand in devtools as it was.
export async function withRedaction<T>(run: () => Promise<T>): Promise<T> {
	const root = document.documentElement;
	const wasEngaged = root.hasAttribute(REDACT_TOGGLE_ATTR);
	root.setAttribute(REDACT_TOGGLE_ATTR, '');
	try {
		return await run();
	} finally {
		if (!wasEngaged) root.removeAttribute(REDACT_TOGGLE_ATTR);
	}
}
