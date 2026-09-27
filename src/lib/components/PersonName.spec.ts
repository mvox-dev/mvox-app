// @vitest-environment happy-dom
//
// #361 RED — PersonName: the ONE way a bare member name renders. Built on
// #388's RedactedText, so every member name on a surface that CAN hold a
// marker is blanked in a capture, and a new usage inherits the marker by
// using the component.
//
// CONTRACT (GREEN implements src/lib/components/PersonName.svelte, Svelte 5
// runes):
//
//   <RedactedText {...rest}>{name}</RedactedText>
//
//   PROPS  name: string (required) — the member name, rendered as text
//          ...rest spread onto the marked <span> (data-testid, class, …)
//
//   No new strings; nothing but the name inside the marker.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REDACT_ATTR } from '$lib/redact/redact';

import PersonName from './PersonName.svelte';

afterEach(() => {
	cleanup();
});

describe('#361 — PersonName renders the name inside exactly one marked element', () => {
	it('the name sits inside exactly one element carrying the redact marker, and that element holds exactly the name', () => {
		const { container } = render(PersonName, { props: { name: 'Berta Bass' } });
		const marked = container.querySelectorAll(`[${REDACT_ATTR}]`);
		expect(marked).toHaveLength(1);
		const root = marked[0] as HTMLElement;
		expect(root.tagName).toBe('SPAN');
		expect(root.getAttribute(REDACT_ATTR)).toBe('');
		expect(root.textContent).toBe('Berta Bass');
		expect(container.textContent).toBe('Berta Bass');
	});

	it('spreads ...rest onto the marked element (data-testid, class)', () => {
		const { container } = render(PersonName, {
			props: { name: 'Alice Alto', 'data-testid': 'some-name', class: 'truncate' }
		});
		const byTestid = container.querySelectorAll('[data-testid="some-name"]');
		expect(byTestid).toHaveLength(1);
		expect(byTestid[0].hasAttribute(REDACT_ATTR)).toBe(true);
		expect(byTestid[0].classList.contains('truncate')).toBe(true);
		expect(byTestid[0].textContent).toBe('Alice Alto');
	});

	it('the component is built on RedactedText — the marker is not re-implemented', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/PersonName.svelte'),
			'utf-8'
		);
		expect(source).toMatch(/import\s+RedactedText\s+from\s+'\$lib\/components\/RedactedText\.svelte'|import\s+RedactedText\s+from\s+'\.\/RedactedText\.svelte'/);
		expect(source).toMatch(/<RedactedText\b/);
		expect(source).not.toMatch(/['"]data-redact['"]/);
	});
});

// (*MVOX:Tallis* — #361 RED: PersonName, the one way a member name renders)
