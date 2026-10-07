// @vitest-environment happy-dom
// The sign-in page always shows the full provider picker in canonical order, never redirects
// on mount, and marks the remembered provider in place with '· last used'.
import { render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

// Mutable $app/state stub — same pattern as page.session-expired.spec.ts.
const pageStub = vi.hoisted(() => ({
	url: new URL('http://localhost/auth/login')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

import Page from './+page.svelte';
import { setLastProvider } from '$lib/auth/storage';
import { gotoMock } from '$lib/testing/routeMocks';
import { cleanupResetGotoStorage } from '$lib/testing/pages/login';

const CANONICAL_ORDER = [
	'smart-id',
	'mobile-id',
	'id-card',
	'e-mail',
	'google',
	'apple',
	'passkey'
];

function renderAt(search = '') {
	pageStub.url = new URL(`http://localhost/auth/login${search}`);
	return render(Page);
}

function renderedProviderIds(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll('[data-testid^="provider-"]')).map((el) =>
		(el.getAttribute('data-testid') ?? '').replace(/^provider-/, '')
	);
}

afterEach(cleanupResetGotoStorage);

describe('/auth/login — no auto-redirect, picker always renders (#206)', () => {
	it('does NOT auto-redirect on mount when a provider is remembered', () => {
		setLastProvider('google');
		renderAt();

		expect(gotoMock, 'the remembered-provider silent redirect is retired').not.toHaveBeenCalled();
	});

	it('renders the full provider picker even when a provider is remembered', () => {
		setLastProvider('google');
		const { container } = renderAt();

		for (const id of CANONICAL_ORDER) {
			expect(
				container.querySelector(`[data-testid="provider-${id}"]`),
				`provider CTA ${id} must render`
			).not.toBeNull();
		}
	});

	it('renders the CTAs in the canonical order (smart-id, mobile-id, id-card, e-mail, google, apple, passkey)', () => {
		const { container } = renderAt();

		expect(renderedProviderIds(container)).toEqual(CANONICAL_ORDER);
	});
});

describe('/auth/login — last-used provider stays in place (#206)', () => {
	it('keeps the remembered provider in its fixed array position (it does NOT float to the top)', () => {
		setLastProvider('google');
		const { container } = renderAt();

		const ids = renderedProviderIds(container);
		expect(ids, 'order must be position-stable regardless of last-used').toEqual(CANONICAL_ORDER);
		expect(ids[0], 'the remembered provider must not be hoisted first').toBe('smart-id');
		expect(ids.indexOf('google'), 'google keeps its canonical slot').toBe(4);
	});

	it('marks the remembered provider — and ONLY it — with the "· last used" emphasis', () => {
		setLastProvider('e-mail');
		const { container } = renderAt();

		const marked = Array.from(container.querySelectorAll('[data-testid^="provider-"]')).filter(
			(el) => /·\s*last used/i.test(el.textContent ?? '')
		);
		expect(marked, 'exactly one CTA carries the last-used marker').toHaveLength(1);
		expect(marked[0]?.getAttribute('data-testid')).toBe('provider-e-mail');
		// …and it is still sitting in its canonical slot, not on top.
		expect(renderedProviderIds(container)[3]).toBe('e-mail');
	});
});

// (*MVOX:Tallis*)
