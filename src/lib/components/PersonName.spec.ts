// @vitest-environment happy-dom
// PersonName: the one way a bare member name renders, inside RedactedText's marker.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REDACT_ATTR } from '$lib/redact/redact';

// A probe marker name: the component must follow the module, not a hand-typed literal.
vi.mock('$lib/redact/redact', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/redact/redact')>()),
	REDACT_ATTR: 'data-redact-probe'
}));

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

	it('the marker is the redact module\'s REDACT_ATTR, not a hand-typed literal', () => {
		const { container } = render(PersonName, { props: { name: 'Berta Bass' } });
		expect(REDACT_ATTR).toBe('data-redact-probe');
		expect(container.querySelectorAll('[data-redact-probe]')).toHaveLength(1);
		expect(container.querySelector('[data-redact]')).toBeNull();
	});
});

// (*MVOX:Tallis* — #361 RED: PersonName, the one way a member name renders)
