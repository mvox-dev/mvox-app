// @vitest-environment happy-dom
// #633: one labelled field for the create and convert forms; a disabled field dims everywhere.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';

import Field from './Field.svelte';

afterEach(() => {
	cleanup();
});

const control = createRawSnippet((attrs: () => { class: string; disabled: boolean }) => ({
	render: () =>
		`<input data-testid="control" class="${attrs().class}"${attrs().disabled ? ' disabled' : ''} />`
}));

function renderField(props: Record<string, unknown>) {
	const { container } = render(Field, { props: { label: 'Name', children: control, ...props } });
	const input = container.querySelector('[data-testid="control"]') as HTMLInputElement;
	return { container, input };
}

describe('Field', () => {
	it('dims a disabled field: the control is disabled and carries the dim style', () => {
		const { input } = renderField({ disabled: true });
		expect(input.disabled).toBe(true);
		expect(input.className.split(' ')).toContain('disabled:opacity-50');
	});

	it('leaves an enabled field enabled, with the same control style', () => {
		const { input } = renderField({});
		expect(input.disabled).toBe(false);
		expect(input.className).toBe(
			'w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50'
		);
	});

	it('wraps the caption and the control in one label', () => {
		const { container, input } = renderField({ labelTestid: 'name-label' });
		const label = container.querySelector('label') as HTMLLabelElement;
		expect(label.contains(input)).toBe(true);
		const caption = container.querySelector('[data-testid="name-label"]') as HTMLElement;
		expect(caption.textContent).toBe('Name');
		expect(label.className).toBe('flex flex-col gap-0.5 w-full');
	});

	it('grows instead of taking the full width when asked', () => {
		const { container } = renderField({ grow: true });
		const label = container.querySelector('label') as HTMLLabelElement;
		expect(label.className).toBe('flex flex-col gap-0.5 min-w-0 flex-1');
	});
});
