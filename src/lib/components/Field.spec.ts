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
	it('disables the control when the field is disabled', () => {
		const { input } = renderField({ disabled: true });
		expect(input.disabled).toBe(true);
	});

	it('gives an enabled and a disabled control the same style, so both forms match', () => {
		const { input: enabled } = renderField({});
		const { input: disabled } = renderField({ disabled: true });
		expect(enabled.disabled).toBe(false);
		expect(enabled.className).not.toBe('');
		expect(disabled.className).toBe(enabled.className);
	});

	it('wraps the caption and the control in one label', () => {
		const { container, input } = renderField({ labelTestid: 'name-label' });
		const label = container.querySelector('label') as HTMLLabelElement;
		expect(label.contains(input)).toBe(true);
		const caption = container.querySelector('[data-testid="name-label"]') as HTMLElement;
		expect(caption.textContent).toBe('Name');
	});

	it('layout guard (happy-dom cannot measure width): full width by default, grows when asked', () => {
		const tokens = (props: Record<string, unknown>) =>
			Array.from((renderField(props).container.querySelector('label') as HTMLElement).classList);
		expect(tokens({})).toContain('w-full');
		expect(tokens({ grow: true })).toEqual(expect.arrayContaining(['min-w-0', 'flex-1']));
		expect(tokens({ grow: true })).not.toContain('w-full');
	});
});
