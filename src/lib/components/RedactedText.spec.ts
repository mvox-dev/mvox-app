// @vitest-environment happy-dom
// RedactedText: the shared display marker, a span carrying REDACT_ATTR around its children.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import { REDACT_ATTR } from '$lib/redact/redact';

// A probe marker name: the component must follow the module, not a hand-typed literal.
vi.mock('$lib/redact/redact', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/redact/redact')>()),
	REDACT_ATTR: 'data-redact-probe'
}));

import RedactedText from './RedactedText.svelte';

afterEach(() => {
	cleanup();
});

const value = (text: string) =>
	createRawSnippet(() => ({
		render: () => `<span>${text}</span>`
	}));

describe('#388 — RedactedText renders its children inside exactly one marked element', () => {
	it('the children text sits inside exactly one element carrying the redact marker, and that element holds exactly the children text', () => {
		const { container } = render(RedactedText, {
			props: { children: value('Berta Bass') }
		});
		const marked = container.querySelectorAll(`[${REDACT_ATTR}]`);
		expect(marked).toHaveLength(1);
		const root = marked[0] as HTMLElement;
		expect(root.tagName).toBe('SPAN');
		expect(root.getAttribute(REDACT_ATTR)).toBe('');
		expect(root.textContent).toBe('Berta Bass');
		// Nothing rendered outside the marker.
		expect(container.textContent).toBe('Berta Bass');
	});

	it('spreads ...rest onto the marked element (data-testid)', () => {
		const { container } = render(RedactedText, {
			props: { children: value('berta@example.com'), 'data-testid': 'some-value' }
		});
		const byTestid = container.querySelectorAll('[data-testid="some-value"]');
		expect(byTestid).toHaveLength(1);
		expect(byTestid[0].hasAttribute(REDACT_ATTR)).toBe(true);
		expect(byTestid[0].textContent).toBe('berta@example.com');
	});

	it('the marker is the redact module\'s REDACT_ATTR, not a hand-typed literal', () => {
		const { container } = render(RedactedText, { props: { children: value('Berta Bass') } });
		expect(REDACT_ATTR).toBe('data-redact-probe');
		expect(container.querySelectorAll('[data-redact-probe]')).toHaveLength(1);
		expect(container.querySelector('[data-redact]')).toBeNull();
	});
});

// (*MVOX:Tallis* — #388 RED: RedactedText, the shared display marker)
