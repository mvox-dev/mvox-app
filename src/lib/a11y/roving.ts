// Arrow, Home and End navigation shared by every roving-tabindex group in the app.

// Both axes move and it always wraps; -1 means a key it ignores, so no preventDefault.
export function rovingNextIndex(key: string, idx: number, length: number): number {
	if (length === 0) return -1;
	if (key === 'ArrowRight' || key === 'ArrowDown') return (idx + 1) % length;
	if (key === 'ArrowLeft' || key === 'ArrowUp') return (idx - 1 + length) % length;
	if (key === 'Home') return 0;
	if (key === 'End') return length - 1;
	return -1;
}

export interface RovingOptions {
	selector?: string;
	beforeFocus?: (member: HTMLElement) => boolean | void;
}

// beforeFocus runs after preventDefault; returning false leaves focus where it is.
export function rovingKeydown(e: KeyboardEvent, opts: RovingOptions = {}): void {
	const group = e.currentTarget as HTMLElement;
	const members = Array.from(group.querySelectorAll<HTMLElement>(opts.selector ?? 'button'));
	const idx = members.indexOf(e.target as HTMLElement);
	if (idx < 0) return;
	const next = rovingNextIndex(e.key, idx, members.length);
	if (next < 0) return;
	e.preventDefault();
	if (opts.beforeFocus?.(members[next]) === false) return;
	members[next].focus();
}
