// @vitest-environment happy-dom
//
// #388 RED — RedactedText: the shared DISPLAY marker. RedactedField (#357)
// wraps an <input>; /roster also renders personal values as plain element
// content (the collapsed row's name and email, the sr-only edit label's name,
// the inactive-members row name), and those need the same marker without an
// input. #361 builds a name component on top of this one next, so it stays
// GENERIC — nothing name-specific in it.
//
// CONTRACT (GREEN implements src/lib/components/RedactedText.svelte, Svelte 5
// runes):
//
//   <span {REDACT_ATTR} {...rest}>{@render children()}</span>
//
//   PROPS  children: Snippet (required) — the value to mark
//          ...rest spread onto the <span> (data-testid, class, …)
//
//   THE MARKER attribute name is imported from $lib/redact/redact — never a
//   literal — so the existing html[data-redacting] [data-redact] CSS rule
//   (app.css) blanks it. DEFAULT-INERT: no effect without the root toggle.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRawSnippet } from 'svelte';
import { REDACT_ATTR } from '$lib/redact/redact';

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

	it('the component source imports the marker name from $lib/redact/redact — no hand-typed literal', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/RedactedText.svelte'),
			'utf-8'
		);
		expect(source).toMatch(/import\s*\{[^}]*\bREDACT_ATTR\b[^}]*\}\s*from\s*'\$lib\/redact\/redact'/);
		expect(source).not.toMatch(/['"]data-redact['"]/);
	});
});

// (*MVOX:Tallis* — #388 RED: RedactedText, the shared display marker)
