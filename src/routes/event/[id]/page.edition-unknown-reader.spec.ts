// @vitest-environment happy-dom

// A reader's unpinned row under a truncated edition read says unknown. The flag comes from
// `loadWorksByEventId` off the wire response, never handed to the page, so dropping the
// `truncated` ride in workRows.ts turns this red.
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

// Pin "now" before the fixture event (2026-09-01) — only Date is faked.
const NOW = new Date('2026-08-20T10:00:00.000Z');
beforeEach(() => {
	setToken('jwt-editor');
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

// Full-fallback paraglide mock — every key renders `[key {params}]`.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const pageStub = vi.hoisted(() => ({
	params: { id: 'ev1' } as Record<string, string>,
	url: new URL('http://localhost/event/ev1')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

const { gotoMock, discoverMock } = vi.hoisted(() => ({ gotoMock: vi.fn(), discoverMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';

// ── fixtures ──────────────────────────────────────────────────────────────────

function eventEntity() {
	return {
		_id: 'ev1',
		name: [{ string: 'Tuesday Rehearsal' }],
		event_type: [{ string: 'rehearsal' }],
		start_datetime: [{ datetime: '2026-09-01T16:00:00.000Z' }],
		duration_minutes: [{ number: 90 }],
		location: [{ string: 'Rehearsal Hall' }],
		_parent: [
			{ reference: 'org1', entity_type: 'organization' },
			{ reference: 'season1', entity_type: 'season' }
		]
	};
}

/** The viewer p-viewer holds nothing here, so `loadManagePickers` never runs and
 *  `libraryEditionsPartial` keeps its `false` default. */
function seasonEntity() {
	return {
		_id: 'season1',
		name: [{ string: '2026/27' }],
		start_date: [{ date: '2026-08-01' }],
		_editor: [{ reference: 'p-someone-else' }]
	};
}

// Three active reader rows: ri-1 nothing pinned (the flag-discriminating row), ri-2 pinned
// to an edition the read returns, ri-3 pinned to ed-9, which the read never returns.
const REPERTOIRE_ITEMS = [
	{
		_id: 'ri-1',
		name: [{ string: 'Old warhorse' }],
		work: [{ reference: 'w-1' }],
		status: [{ string: 'active' }]
	},
	{
		_id: 'ri-2',
		name: [{ string: 'Mass in B minor' }],
		work: [{ reference: 'w-2' }],
		edition: [{ reference: 'ed-1' }],
		status: [{ string: 'active' }]
	},
	{
		_id: 'ri-3',
		name: [{ string: 'Spem in alium' }],
		work: [{ reference: 'w-3' }],
		edition: [{ reference: 'ed-9' }],
		status: [{ string: 'active' }]
	}
];

const WORKS = [
	{ _id: 'w-1', name: [{ string: 'Old warhorse' }], composer: [{ string: 'Anon' }] },
	{ _id: 'w-2', name: [{ string: 'Mass in B minor' }], composer: [{ string: 'J. S. Bach' }] },
	{ _id: 'w-3', name: [{ string: 'Spem in alium' }], composer: [{ string: 'Thomas Tallis' }] }
];

/** What the collective-wide `listAllEditions` read returns. ed-9 is NOT in it —
 *  that is the whole fixture: the label lookup cannot name ri-3's pin. */
const EDITIONS = [
	{
		_id: 'ed-1',
		name: [{ string: 'Bärenreiter BA 5103' }],
		_parent: [{ reference: 'w-2', entity_type: 'work' }]
	}
];

/** `editionCount` above the returned row count makes the collective-wide edition read
 *  truncated, as `deriveListRead` reports it; absent, the read is complete. */
function wireStub(opts: { editionCount?: number } = {}) {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (method === 'DELETE') return json({ deleted: true });
		if (method === 'POST') return json({ _id: 'new-1' });
		if (url.includes('/entity/ev1')) return json({ entity: eventEntity() });
		if (url.includes('/entity/season1')) return json({ entity: seasonEntity() });
		if (url.includes('_type.string=entity')) return json({ entities: [{ _id: 'type-1' }] });
		if (url.includes('_type.string=member') && url.includes('person.reference=p-viewer'))
			return json({ entities: [{ _id: 'member-1' }] });
		if (url.includes('_type.string=repertoire_item')) return json({ entities: REPERTOIRE_ITEMS });
		if (url.includes('_type.string=program_item')) return json({ entities: [] });
		if (url.includes('_type.string=work')) return json({ entities: WORKS });
		if (url.includes('_type.string=edition')) {
			return json({
				...(opts.editionCount === undefined ? {} : { count: opts.editionCount }),
				entities: EDITIONS
			});
		}
		if (url.includes('_type.string=copy')) return json({ entities: [] });
		return json({ entities: [] });
	});
}

function setAuthed() {
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'p-viewer' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p-viewer' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
}

async function renderAsReader(opts: { editionCount?: number } = {}) {
	const fetchStub = wireStub(opts);
	vi.stubGlobal('fetch', fetchStub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthed();
	const rendered = render(Page);
	await waitFor(() => {
		expect(rendered.container.querySelector('[data-testid="event-detail-works"]')).not.toBeNull();
		expect(rendered.container.querySelectorAll('[data-testid="work-row"]').length).toBe(
			REPERTOIRE_ITEMS.length
		);
	});
	return { ...rendered, fetchStub };
}

function workRowOf(container: HTMLElement, workName: string): HTMLElement {
	const li = Array.from(container.querySelectorAll('[data-testid="work-row"]')).find(
		(el) => el.querySelector('[data-testid="work-name"]')?.textContent?.trim() === workName
	);
	expect(li, `work-row for ${workName}`).not.toBeUndefined();
	return li as HTMLElement;
}

function editionReads(fetchStub: ReturnType<typeof wireStub>): string[] {
	return fetchStub.mock.calls
		.map((c) => String(c[0]))
		.filter((u) => u.includes('_type.string=edition'));
}

beforeEach(() => {
	resetTypeIdCache();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('/event/[id] #331 — a rights-less reader under a TRUNCATED edition read', () => {
	it('an unpinned row under a truncated read says UNKNOWN, never "no pinned edition"', async () => {
		// Nothing in this test names `truncated`: the flag is produced by
		// `loadWorksByEventId` off this response's `count`, rides the row, and is
		// the only reason the wording below differs from the complete-read case.
		const { container } = await renderAsReader({ editionCount: 4000 });
		const li = workRowOf(container, 'Old warhorse');

		const unknown = li.querySelector('[data-testid="work-edition-unknown"]');
		expect(unknown, 'work-edition-unknown on the reader’s row').not.toBeNull();
		expect(unknown!.textContent).toContain('[repertoire_edition_unknown]');
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(li.textContent).not.toContain('[repertoire_no_edition]');

		// Still a READER: the wording changes, no management surface appears.
		expect(li.querySelector('[data-testid="work-edition-picker"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-manage-row"]')).toBeNull();
	});

	it('a pin the truncated read could not name says UNKNOWN too', async () => {
		const { container } = await renderAsReader({ editionCount: 4000 });
		const li = workRowOf(container, 'Spem in alium');
		expect(li.querySelector('[data-testid="work-edition-unknown"]')!.textContent).toContain(
			'[repertoire_edition_unknown]'
		);
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-edition-picker"]')).toBeNull();
	});

	it('a pin the read DID name keeps its name — truncation poisons negatives, never positives', async () => {
		const { container } = await renderAsReader({ editionCount: 4000 });
		const li = workRowOf(container, 'Mass in B minor');
		expect(li.querySelector('[data-testid="work-edition"]')!.textContent).toContain(
			'Bärenreiter BA 5103'
		);
		expect(li.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
	});

	it('costs her no extra read — the flag came out of the label lookup she already got', async () => {
		const { container, fetchStub } = await renderAsReader({ editionCount: 4000 });
		// The scoped-read effect is keyed off `libraryEditionsPartial`, so give it every
		// chance to fire before "it did not" is an assertion.
		for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
		expect(
			workRowOf(container, 'Old warhorse').querySelector('[data-testid="work-edition-unknown"]')
		).not.toBeNull();

		// Exactly one edition read (the label lookup in `loadWorksByEventId`) and no scoped
		// per-work read; other _parent-scoped reads on this page carry that fragment too.
		const reads = editionReads(fetchStub);
		expect(reads.length).toBe(1);
		expect(reads.some((u) => u.includes('_parent.reference='))).toBe(false);
	});
});

describe("/event/[id] #331 — the reader's COMPLETE read keeps every stated fact", () => {
	it('nothing pinned, read complete → "no pinned edition", byte-identical to today', async () => {
		const { container } = await renderAsReader({});
		const li = workRowOf(container, 'Old warhorse');
		const noEdition = li.querySelector('[data-testid="work-no-edition"]');
		expect(noEdition, 'work-no-edition').not.toBeNull();
		expect(noEdition!.textContent).toContain('[repertoire_no_edition]');
		expect(li.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
	});

	it('a resolvable pin under a complete read renders its name', async () => {
		const { container } = await renderAsReader({});
		const li = workRowOf(container, 'Mass in B minor');
		expect(li.querySelector('[data-testid="work-edition"]')!.textContent).toContain(
			'Bärenreiter BA 5103'
		);
		expect(li.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
	});

	it('a DANGLING pin under a complete read is still a pin — unknown wording, not a claim of absence (#331 item 4; #342 wording)', async () => {
		// The read finished and ed-9 is simply gone, so the wording is the unknown key,
		// never the truncated state's incompleteness claim.
		const { container } = await renderAsReader({});
		const li = workRowOf(container, 'Spem in alium');
		const unknown = li.querySelector('[data-testid="work-edition-unknown"]');
		expect(unknown, 'work-edition-unknown on the reader’s row').not.toBeNull();
		expect(unknown!.textContent).toContain('[repertoire_edition_unknown_pinned]');
		expect(li.textContent).not.toContain('[repertoire_edition_unknown]');
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(li.textContent).not.toContain('[repertoire_no_edition]');
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Josquin*)
