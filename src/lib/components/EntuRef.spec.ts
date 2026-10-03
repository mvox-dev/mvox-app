// @vitest-environment happy-dom
// EntuRef links to an entity in the Entu app by a short form of its _id, never a personal value,
// so a screen capture leaks nothing. Without a db it renders a plain span: no guessed link.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Severs the store → entu-config → $env/dynamic/public chain, which throws outside SvelteKit;
// $app/navigation likewise can't run outside an app.
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import EntuRef from './EntuRef.svelte';

const ID = '6a92a3f2ca67df980f4154c4';
const SHORT = '4154c4';

beforeEach(() => {
	localStorage.clear();
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(null);
	collectiveState.set({ status: 'none' });
});

afterEach(() => {
	cleanup();
	collectiveState.set({ status: 'none' });
	selectedCollectiveDbStore.set(null);
});

describe('#487 — EntuRef with an explicit db prop', () => {
	it('renders exactly one link to https://entu.app/{db}/{id}, new tab, full id in title', () => {
		const { getAllByRole, getByRole, container } = render(EntuRef, {
			props: { id: ID, db: 'mvox_crede' }
		});
		const links = getAllByRole('link');
		expect(links).toHaveLength(1);
		const a = links[0] as HTMLAnchorElement;
		expect(a.tagName).toBe('A');
		expect(a.textContent?.trim()).toBe(SHORT);
		expect(a.getAttribute('href')).toBe('https://entu.app/mvox_crede/6a92a3f2ca67df980f4154c4');
		expect(a.getAttribute('title')).toBe(ID);
		expect(a.getAttribute('target')).toBe('_blank');
		expect(a.getAttribute('rel')).toBe('noopener noreferrer');
		expect(a.classList.contains('font-mono')).toBe(true);
		// label-in-name: the accessible name contains the visible short id
		expect(getByRole('link', { name: new RegExp(SHORT) })).toBe(a);
		// nothing identifying beyond the short id
		expect(container.textContent?.trim()).toBe(SHORT);
	});

	it('spreads rest props (data-testid) onto the link', () => {
		const { getByTestId } = render(EntuRef, {
			props: { id: ID, db: 'mvox_crede', 'data-testid': 'entu-ref' }
		});
		expect(getByTestId('entu-ref').tagName).toBe('A');
	});
});

describe('#487 — EntuRef without a db prop reads the signed-in db', () => {
	it('uses selectedDbStore (real store) for the href', () => {
		collectiveState.set({
			status: 'ready',
			collectives: [{ db: 'mvox_other', name: 'Other Choir', personId: 'p-other' }],
			erroredDbs: []
		});
		const { getAllByRole, container } = render(EntuRef, { props: { id: ID } });
		const links = getAllByRole('link');
		expect(links).toHaveLength(1);
		expect(links[0].getAttribute('href')).toBe(
			'https://entu.app/mvox_other/6a92a3f2ca67df980f4154c4'
		);
		expect(links[0].getAttribute('title')).toBe(ID);
		expect(container.textContent?.trim()).toBe(SHORT);
	});

	it('an explicit db prop wins over the signed-in db', () => {
		collectiveState.set({
			status: 'ready',
			collectives: [{ db: 'mvox_other', name: 'Other Choir', personId: 'p-other' }],
			erroredDbs: []
		});
		const { getByRole } = render(EntuRef, { props: { id: ID, db: 'mvox_crede' } });
		expect(getByRole('link').getAttribute('href')).toBe(
			'https://entu.app/mvox_crede/6a92a3f2ca67df980f4154c4'
		);
	});
});

describe('#487 — EntuRef with no db anywhere renders no link', () => {
	it('renders a span with the short id and full-id title, no href, no link role', () => {
		const { queryAllByRole, container } = render(EntuRef, { props: { id: ID } });
		expect(queryAllByRole('link')).toHaveLength(0);
		expect(container.querySelector('a')).toBeNull();
		expect(container.querySelector('[href]')).toBeNull();
		const span = container.querySelector('span[title]') as HTMLSpanElement | null;
		expect(span).not.toBeNull();
		expect(span!.textContent?.trim()).toBe(SHORT);
		expect(span!.getAttribute('title')).toBe(ID);
		expect(container.textContent?.trim()).toBe(SHORT);
	});
});

// (*MVOX:Tallis*)
