// @vitest-environment happy-dom
// #488: the agenda's two views are named by detail level, rendered from the real locale files.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, expect, it } from 'vitest';
import AgendaViewToggle from './AgendaViewToggle.svelte';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';

afterEach(() => {
	cleanup();
	localStorage.clear();
	overwriteGetLocale(() => 'en');
});

it('in Estonian the view switch reads "Detailne" and "Kompaktne"', () => {
	overwriteGetLocale(() => 'et');
	const { getByTestId } = render(AgendaViewToggle);
	expect(getByTestId('agenda-view-list').textContent?.trim()).toBe('Detailne');
	expect(getByTestId('agenda-view-month').textContent?.trim()).toBe('Kompaktne');
});
