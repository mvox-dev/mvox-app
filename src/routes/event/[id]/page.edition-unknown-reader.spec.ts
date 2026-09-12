// @vitest-environment happy-dom
//
// #331 (event-page half) — the READER's unknown branch must be reachable, and
// the flag that reaches it must be PRODUCED, not handed over.
//
// Same defect as the agenda half (page.edition-unknown-reader.spec.ts), by
// this page's own route to the same false claim: `pickableEditionsPartial` is
// fed from `libraryEditionsPartial`, which is only ever ASSIGNED inside
// `loadManagePickers` — "only fetched for a rights-holder". A viewer with no
// manage rights keeps its `false` default forever, so `rowEditionUnknown`'s
// `if (!partial) return false` gate closes the reader branch RepertoireElement
// carries for exactly her, and a truncated read's blank `editionName` renders
// as "No pinned edition" — a stated negative the read cannot back.
//
// Settled fix (do not re-fork): the flag rides each row as the optional
// `WorkRow.truncated`, set by `loadWorksByEventId` from the edition read it
// already makes.
//
// INTEGRATION posture, and deliberately the STRICTER of the two reader suites
// (#331 review, finding 1): the agenda half mocks `loadWorksByEventId` at its
// module seam and hands `truncated` to the page by hand — which means it cannot
// observe whether the producer sets that field at all. This suite mocks
// NOTHING in the repertoire path. The REAL page runs the REAL data layer
// (loadEventDetail, resolveEventWorksBatch, loadWorksByEventId) against a wire
// `fetch` stub, exactly like the #329 sibling page.edition-unknown.spec.ts, and
// the truncation is built where production builds it: a collective-wide
// `listAllEditions` response whose `count` exceeds the rows it returned. So one
// test spans `listAllEditions.truncated` -> `WorkRow.truncated` ->
// `readerEditionUnknown` -> `repertoire_edition_unknown`, and dropping the
// `truncated` ride in workRows.ts turns it red here.
//
// The discriminating row is the UNPINNED one. A row holding a pin the read
// could not name is unknown for a reader either way (#331 item 4 —
// `unnameablePinNeedsNoTruncation`), so it says nothing about `truncated`;
// "nothing pinned" is the shape whose wording flips with the flag, and it is
// the shape RepertoireElement's terminal `{:else}` would otherwise print
// `repertoire_no_edition` for.
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Pin "now" before the fixture event (2026-09-01) — only Date is faked.
const NOW = new Date('2026-08-20T10:00:00.000Z');
beforeEach(() => {
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
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

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

/** The viewer p-viewer holds NOTHING here: the season's `_editor` names
 *  someone else, the event names nobody. `loadManagePickers` never runs for
 *  her, so `libraryEditionsPartial` keeps its `false` default — the exact
 *  route by which the editor-side flag can never reach a reader's rows. */
function seasonEntity() {
	return {
		_id: 'season1',
		name: [{ string: '2026/27' }],
		start_date: [{ date: '2026-08-01' }],
		_editor: [{ reference: 'p-someone-else' }]
	};
}

// The three reader shapes, all `status: active` (a reader's fallback read drops
// retired/dropped — `includeInactive` is an editor-only option):
//   ri-1  nothing pinned            — the flag-discriminating row
//   ri-2  pinned to an edition the collective-wide read DID return
//   ri-3  pinned to ed-9, which that read never returns (past the cap when it
//         truncated; a dangling reference when it did not)
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

/**
 * `editionCount` is the ONLY knob: present and above the returned row count, the
 * collective-wide edition read is TRUNCATED exactly as production reports it
 * (`deriveListRead`: `count > entities.length`); absent, the read is complete.
 * Nothing in this file hands the page a `truncated` field — `loadWorksByEventId`
 * has to derive it from this response and put it on every row.
 */
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
		personIdByDb: { polyphony: 'p-viewer' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'p-viewer' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
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
		// Wait out the scoped-read effect: it is keyed off `libraryEditionsPartial`
		// (the manage read a reader never triggers), so it must have had every
		// chance to fire before "it did not" is an assertion.
		for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
		expect(
			workRowOf(container, 'Old warhorse').querySelector('[data-testid="work-edition-unknown"]')
		).not.toBeNull();

		// Exactly ONE edition read, the collective-wide label lookup inside
		// `loadWorksByEventId` — and no SCOPED per-work read (its own URL pattern,
		// `_parent.reference=`, matched only among edition reads: every
		// _parent-scoped read on this page also carries that fragment, e.g. the
		// RSVP and schedule_item reads it makes regardless of edition state).
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

	it('a DANGLING pin under a complete read is still a pin — unknown wording, not a claim of absence (#331 item 4)', async () => {
		const { container } = await renderAsReader({});
		const li = workRowOf(container, 'Spem in alium');
		const unknown = li.querySelector('[data-testid="work-edition-unknown"]');
		expect(unknown, 'work-edition-unknown on the reader’s row').not.toBeNull();
		expect(unknown!.textContent).toContain('[repertoire_edition_unknown]');
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(li.textContent).not.toContain('[repertoire_no_edition]');
	});
});

// (*MVOX:Tallis* — #331 RED)
// (*MVOX:Josquin* — #331 review, finding 1: producer no longer mocked; the
// truncation is built at the wire so the whole chain is under test)
