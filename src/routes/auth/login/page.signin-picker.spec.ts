// @vitest-environment happy-dom
//
// #206 RED — the sign-in page ALWAYS shows the provider picker.
//
// The remembered-provider "fast path" (silent goto to the last provider on
// mount) is retired: a returning user lands on the picker every time, with the
// remembered provider emphasised IN PLACE — never floated to the top, never
// auto-followed. (The old `?picker=1` escape hatch is retired along with the
// redirect; nothing references it any more.)
//
// CONTRACT (for the GREEN implementer):
//   - mounting /auth/login with a remembered provider does NOT goto anywhere;
//   - the picker renders ALL providers, in the canonical AUTH_PROVIDERS order:
//     smart-id, mobile-id, id-card, e-mail, google, apple;
//   - the remembered provider keeps its fixed array position and carries the
//     "· last used" emphasis marker; no other CTA carries it.
//
// This is an integration spec on the REAL route component
// (src/routes/auth/login/+page.svelte) — the order and the no-redirect rule
// must hold on the page users hit, not just in the shared list.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));

// Mutable $app/state stub — same pattern as page.session-expired.spec.ts.
const pageStub = vi.hoisted(() => ({
	url: new URL('http://localhost/auth/login')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

import Page from './+page.svelte';
import { setLastProvider } from '$lib/auth/storage';

const CANONICAL_ORDER = ['smart-id', 'mobile-id', 'id-card', 'e-mail', 'google', 'apple'];

function renderAt(search = '') {
	pageStub.url = new URL(`http://localhost/auth/login${search}`);
	return render(Page);
}

function renderedProviderIds(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll('[data-testid^="provider-"]')).map((el) =>
		(el.getAttribute('data-testid') ?? '').replace(/^provider-/, '')
	);
}

afterEach(() => {
	cleanup();
	gotoMock.mockReset();
	localStorage.clear();
	sessionStorage.clear();
});

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

	it('renders the CTAs in the canonical order (smart-id, mobile-id, id-card, e-mail, google, apple)', () => {
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
