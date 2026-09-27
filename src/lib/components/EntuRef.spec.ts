// @vitest-environment happy-dom
//
// #487 RED — EntuRef: a clickable reference to an entity in the Entu app,
// showing a short form of its `_id` instead of any personal value (no name,
// no email), so a screen capture of the message leaks nothing.
//
// CONTRACT (GREEN implements src/lib/components/EntuRef.svelte, Svelte 5 runes):
//
//   PROPS  id: string (required) — the full 24-char Entu `_id`
//          db?: string — the Entu database; when omitted the component reads
//                        the signed-in db from `selectedDbStore`
//                        (src/lib/collectives/store.ts) — dual mode, like
//                        InviteSurface.svelte's controlled/standalone split.
//          ...rest spread onto the root element (data-testid etc.), like
//          DeleteTrigger.
//
//   WITH a db: exactly one native
//     <a href="https://entu.app/{db}/{id}" target="_blank"
//        rel="noopener noreferrer" title={id}
//        aria-label={m.entu_ref_aria_label({ short })} class="font-mono …">
//   whose visible text is ONLY shortEntuId(id) (last 6 chars).
//
//   WITHOUT a db (no prop, store null): a plain <span title={id}> with the
//   short id — NO href, NO link role. No guessed db, no link to a wrong
//   database.
//
//   No Entu API call, no rights read. No caller in this slice — wiring into
//   roster_record_damaged / roster_member_deactivate_failed is #388.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

// (*MVOX:Tallis* — #487 RED)
