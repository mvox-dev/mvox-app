// @vitest-environment happy-dom
//
// #337 — a reader's PROGRAM row with an unnameable pin must say UNKNOWN, never
// "No pinned edition".
//
// On /event/[id] program rows are the PRIMARY shape (buildWorkRows' 'program'
// branch): a program_item's `edition` is a REQUIRED reference, so `editionId`
// is non-empty by construction, and `editionName` degrades to '' whenever the
// collective-wide `listAllEditions` label lookup did not carry that edition —
// truncated past its limit=500 cap, or the edition unreadable/deleted. Today
// `editionUnknown()`'s `row.kind !== 'repertoire'` gate excludes program rows
// before any logic, so such a row falls to RepertoireElement's terminal
// `{:else}` and renders `repertoire_no_edition` — a claim of absence a program
// row cannot express (#331 review, finding 2; the gate is #329's and is a gap,
// not a ruling — see editionUnknown.ts's header).
//
// Sibling of page.edition-unknown-reader.spec.ts, same INTEGRATION posture and
// the same harness: nothing in the repertoire path is mocked. The REAL page
// runs the REAL data layer (loadEventDetail, resolveEventWorksBatch,
// loadWorksByEventId) against a wire `fetch` stub, and the truncation is built
// where production builds it — a `listAllEditions` response whose `count`
// exceeds the rows it returned, flowing through the real `deriveListRead`.
// Nothing in this file hands the page a `truncated` field (the issue's
// done-when forbids it). The one fixture difference from the sibling: the
// stubbed event HAS program_items, so the page renders the 'program' branch —
// the sibling stubs that read empty and so could never see this defect.
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
		name: [{ string: 'Season Concert' }],
		event_type: [{ string: 'concert' }],
		start_datetime: [{ datetime: '2026-09-01T16:00:00.000Z' }],
		duration_minutes: [{ number: 90 }],
		location: [{ string: 'Concert Hall' }],
		_parent: [
			{ reference: 'org1', entity_type: 'organization' },
			{ reference: 'season1', entity_type: 'season' }
		]
	};
}

/** The viewer p-viewer holds NOTHING here: the season's `_editor` names
 *  someone else, the event names nobody. `loadManagePickers` never runs for
 *  her, so the editor-side flag can never reach her rows. */
function seasonEntity() {
	return {
		_id: 'season1',
		name: [{ string: '2026/27' }],
		start_date: [{ date: '2026-08-01' }],
		_editor: [{ reference: 'p-someone-else' }]
	};
}

// The event HAS a programme — the 'program' branch renders, no season
// fallback. Two shapes:
//   pi-1  edition ed-1, which the collective-wide read DID return — the
//         resolving pin, must keep its name byte-identical to today
//   pi-2  edition ed-9, which that read never returns (past the cap when it
//         truncated; a dangling/unreadable reference when it did not). The
//         edition reference is REQUIRED on a program_item, so this row holds
//         a real pin whose label nothing resolves — the #337 shape.
const PROGRAM_ITEMS = [
	{
		_id: 'pi-1',
		name: [{ string: 'Mass in B minor' }],
		edition: [{ reference: 'ed-1' }],
		ordinal: [{ number: 1 }]
	},
	{
		_id: 'pi-2',
		name: [{ string: 'Ghost piece' }],
		edition: [{ reference: 'ed-9' }],
		ordinal: [{ number: 2 }]
	}
];

const WORKS = [{ _id: 'w-2', name: [{ string: 'Mass in B minor' }], composer: [{ string: 'J. S. Bach' }] }];

/** What the collective-wide `listAllEditions` read returns. ed-9 is NOT in it —
 *  that is the whole fixture: the label lookup cannot name pi-2's edition. */
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
 * has to derive it from this response and put it on every row, program rows
 * included (it already does: the flag is mapped onto rows uniformly).
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
		if (url.includes('_type.string=repertoire_item')) return json({ entities: [] });
		if (url.includes('_type.string=program_item')) return json({ entities: PROGRAM_ITEMS });
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
			PROGRAM_ITEMS.length
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

describe("/event/[id] #337 — a reader's PROGRAM rows under a TRUNCATED edition read", () => {
	it('a program row whose pin fell past the cap says UNKNOWN, never "no pinned edition"', async () => {
		const { container } = await renderAsReader({ editionCount: 4000 });
		const li = workRowOf(container, 'Ghost piece');

		const unknown = li.querySelector('[data-testid="work-edition-unknown"]');
		expect(unknown, 'work-edition-unknown on the reader’s program row').not.toBeNull();
		expect(unknown!.textContent).toContain('[repertoire_edition_unknown]');
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		// Every row on this page is a program row, so the claim of absence must
		// be gone from the whole works region, not just this <li>.
		expect(container.textContent).not.toContain('[repertoire_no_edition]');

		// Still a READER: the wording changes, no management surface appears.
		expect(li.querySelector('[data-testid="work-edition-picker"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-manage-row"]')).toBeNull();
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

	it('costs her no extra read — the unknown wording came out of the label lookup she already got', async () => {
		const { container, fetchStub } = await renderAsReader({ editionCount: 4000 });
		// Give any scoped-read effect every chance to fire before "it did not"
		// is an assertion (same guard as the sibling suite).
		for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
		expect(
			workRowOf(container, 'Ghost piece').querySelector('[data-testid="work-edition-unknown"]')
		).not.toBeNull();

		// Exactly ONE edition read, the collective-wide label lookup inside
		// `loadWorksByEventId` — and no SCOPED per-work read (`_parent.reference=`
		// matched only among edition reads; the program_item read on this page
		// carries that fragment too, legitimately).
		const reads = editionReads(fetchStub);
		expect(reads.length).toBe(1);
		expect(reads.some((u) => u.includes('_parent.reference='))).toBe(false);
	});
});

describe("/event/[id] #337 — the reader's COMPLETE read", () => {
	it('a DANGLING pin under a complete read is still a pin — unknown wording, not a claim of absence (#342 wording)', async () => {
		// No `count` — the read is complete; ed-9 is simply not in it (deleted or
		// unreadable). Mirrors the sibling suite's ri-3/ed-9 repertoire case
		// (#331 item 4): the unnameable-pin shape never needed truncation.
		// #342 — and because nothing here is incomplete, the wording is the NEW
		// key, never the truncated state's incompleteness claim.
		const { container } = await renderAsReader({});
		const li = workRowOf(container, 'Ghost piece');
		const unknown = li.querySelector('[data-testid="work-edition-unknown"]');
		expect(unknown, 'work-edition-unknown on the reader’s program row').not.toBeNull();
		expect(unknown!.textContent).toContain('[repertoire_edition_unknown_pinned]');
		expect(li.textContent).not.toContain('[repertoire_edition_unknown]');
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(container.textContent).not.toContain('[repertoire_no_edition]');
	});

	it('a resolvable pin under a complete read renders its name, byte-identical to today', async () => {
		const { container } = await renderAsReader({});
		const li = workRowOf(container, 'Mass in B minor');
		expect(li.querySelector('[data-testid="work-edition"]')!.textContent).toContain(
			'Bärenreiter BA 5103'
		);
		expect(li.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
	});
});

// (*MVOX:Tallis* — #337 RED)
