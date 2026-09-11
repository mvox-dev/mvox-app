// @vitest-environment happy-dom
//
// #329 RED (event-page half, site (b)) — the work-edition picker says UNKNOWN.
//
// Same ruling, same contract as page.edition-unknown.spec.ts (the agenda
// half): a zero-match row under a TRUNCATED `listAllEditions` read renders
// the UNKNOWN state (new key `repertoire_edition_unknown`), never the
// known-absent wording; the picker is NOT gated out on unknown; the page reads
// `listEditions(workId)` SCOPED for that one work and the row becomes a stated
// fact the moment it lands COMPLETE (review round — a scoped read truncated
// against its own cap leaves the row unknown); matched rows and complete-read
// known-absent stay byte-identical to today. The event detail page runs its OWN
// copy of the `editionsByWorkId` join + the `options.length > 0` gate (the
// second #321 residual site), so the pins run here too — a fix on one page must
// not leave the other printing the negative.
//
// INTEGRATION posture (page.spec.ts family): the REAL page + REAL data layer
// (loadEventDetail, loadWorksByEventId, loadManagePickers), only global fetch
// stubbed at the wire. i18n presence for the new key is pinned once, in the
// agenda half.
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

/** The viewer holds `_editor` on the SEASON — the rights surface the
 *  pin-edition picker (repertoire context) is gated on. */
function seasonEntity() {
	return {
		_id: 'season1',
		name: [{ string: '2026/27' }],
		start_date: [{ date: '2026-08-01' }],
		_editor: [{ reference: 'p-viewer' }]
	};
}

// ri-1 (Spem, w-1) has TWO editions in the read — the MATCHED row. ri-2
// (Old warhorse, w-2) has ZERO matches — known-absent when the read is
// complete, UNKNOWN when it is truncated.
const REPERTOIRE_ITEMS = [
	{
		_id: 'ri-1',
		name: [{ string: 'Spem in alium' }],
		work: [{ reference: 'w-1' }],
		edition: [{ reference: 'ed-1' }],
		status: [{ string: 'active' }]
	},
	{
		_id: 'ri-2',
		name: [{ string: 'Old warhorse' }],
		work: [{ reference: 'w-2' }],
		status: [{ string: 'active' }]
	}
];

const WORKS = [
	{ _id: 'w-1', name: [{ string: 'Spem in alium' }], composer: [{ string: 'Thomas Tallis' }] },
	{ _id: 'w-2', name: [{ string: 'Old warhorse' }], composer: [{ string: 'Anon' }] }
];

const EDITIONS = [
	{
		_id: 'ed-1',
		name: [{ string: '40-part original' }],
		_parent: [{ reference: 'w-1', entity_type: 'work' }]
	},
	{
		_id: 'ed-2',
		name: [{ string: 'Bärenreiter urtext' }],
		_parent: [{ reference: 'w-1', entity_type: 'work' }]
	}
];

/** The one w-2 edition that fell past the collective-wide cap — only the SCOPED
 *  per-work read can see it. */
const SCOPED_W2_EDITIONS = [
	{
		_id: 'ed-9',
		name: [{ string: 'Peters, 1904' }],
		_parent: [{ reference: 'w-2', entity_type: 'work' }]
	}
];

type ScopedMode = 'editions' | 'none' | 'fail' | 'partial-empty' | 'partial-some';

function wireStub(opts: { editionCount?: number; scoped?: ScopedMode } = {}) {
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
		// The SCOPED per-work read (#329 review) — matched BEFORE the
		// collective-wide one below, which its url also looks like.
		if (url.includes('_type.string=edition') && url.includes('_parent.reference=w-2')) {
			if (opts.scoped === 'fail') return json({ error: 'boom' }, 500);
			// `count` above the returned rows = this scoped read is ITSELF partial.
			if (opts.scoped === 'partial-empty') return json({ count: 900, entities: [] });
			if (opts.scoped === 'partial-some') return json({ count: 900, entities: SCOPED_W2_EDITIONS });
			return json({ entities: opts.scoped === 'none' ? [] : SCOPED_W2_EDITIONS });
		}
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

async function renderWorks(opts: { editionCount?: number; scoped?: ScopedMode } = {}) {
	const fetchStub = wireStub(opts);
	vi.stubGlobal('fetch', fetchStub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthed();
	const rendered = render(Page);
	await waitFor(() => {
		expect(rendered.container.querySelector('[data-testid="event-detail-works"]')).not.toBeNull();
		expect(rendered.container.querySelectorAll('[data-testid="work-row"]').length).toBe(2);
	});
	// The MATCHED row's picker proves the edition read (loadManagePickers) has
	// settled — only then is any absence on the other row an answer.
	await waitFor(() => {
		expect(
			workRowOf(rendered.container, 'Spem in alium').querySelector(
				'[data-testid="work-edition-picker"]'
			)
		).not.toBeNull();
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

function pickerOptions(row: HTMLElement) {
	const select = row.querySelector('[data-testid="work-edition-picker"]') as HTMLSelectElement;
	expect(select, 'work-edition-picker').not.toBeNull();
	return Array.from(select.options).map((o) => ({
		value: o.value,
		label: o.textContent?.trim(),
		disabled: o.disabled
	}));
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

describe('/event/[id] #329 — a zero-match row under a TRUNCATED edition read says UNKNOWN', () => {
	it('the unknown state stands while the scoped read has not answered — wording and picker both', async () => {
		// The scoped read FAILS: nothing is learned, so nothing is claimed.
		const { container, fetchStub } = await renderWorks({ editionCount: 4000, scoped: 'fail' });
		await waitFor(() => {
			expect(
				fetchStub.mock.calls.some((c) => String(c[0]).includes('_parent.reference=w-2'))
			).toBe(true);
		});
		const li = workRowOf(container, 'Old warhorse');
		expect(
			li.querySelector('[data-testid="work-edition-unknown"]')!.textContent
		).toContain('[repertoire_edition_unknown]');
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(li.textContent).not.toContain('[repertoire_no_edition]');

		const picker = li.querySelector('[data-testid="work-edition-picker"]');
		expect(picker, 'work-edition-picker on the unknown row').not.toBeNull();
		expect((picker as HTMLElement).tagName).toBe('SELECT');
		expect((picker as HTMLSelectElement).disabled).toBe(false);
	});

	it('reads that ONE work scoped and turns unknown into a fact — the picker names its editions', async () => {
		const { container, fetchStub } = await renderWorks({ editionCount: 4000 });
		await waitFor(() => {
			expect(pickerOptions(workRowOf(container, 'Old warhorse')).length).toBe(2);
		});
		const scoped = fetchStub.mock.calls
			.map((c) => String(c[0]))
			.filter((u) => u.includes('_parent.reference=w-2'));
		expect(scoped.length).toBe(1);
		expect(scoped[0]).toContain('_type.string=edition');

		const li = workRowOf(container, 'Old warhorse');
		expect(pickerOptions(li)).toEqual([
			{ value: '', label: '[repertoire_pin_edition_label]', disabled: false },
			{ value: 'ed-9', label: 'Peters, 1904', disabled: false }
		]);
		expect(li.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
	});

	it('a scoped read that comes back EMPTY and COMPLETE is a known absence — that read has a reachable cap', async () => {
		const { container } = await renderWorks({ editionCount: 4000, scoped: 'none' });
		await waitFor(() => {
			expect(
				workRowOf(container, 'Old warhorse').querySelector('[data-testid="work-no-edition"]')
			).not.toBeNull();
		});
		const li = workRowOf(container, 'Old warhorse');
		expect(li.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-edition-picker"]')).toBeNull();
	});

	it('a MATCHED row is untouched by the truncation — full option shape, no unknown wording', async () => {
		const { container } = await renderWorks({ editionCount: 4000 });
		const li = workRowOf(container, 'Spem in alium');
		expect(pickerOptions(li)).toEqual([
			{ value: '', label: '[repertoire_pin_edition_label]', disabled: false },
			{ value: 'ed-1', label: '40-part original', disabled: false },
			{ value: 'ed-2', label: 'Bärenreiter urtext', disabled: false }
		]);
		expect(li.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
	});
});

/** Wait for the scoped read to have been made, then let its promise chain and
 *  the render queue drain. The assertions that follow are about a state change
 *  that must NOT happen, so it has to have had every chance to happen first. */
async function settleScopedRead(
	fetchStub: ReturnType<typeof wireStub>,
	urlFragment: string
): Promise<void> {
	await waitFor(() => {
		expect(fetchStub.mock.calls.some((c) => String(c[0]).includes(urlFragment))).toBe(true);
	});
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("/event/[id] #329 review — the scoped read's OWN truncation is not a fact either", () => {
	it('a scoped read that comes back PARTIAL is not a known absence — unknown stands', async () => {
		const { container, fetchStub } = await renderWorks({
			editionCount: 4000,
			scoped: 'partial-empty'
		});
		await settleScopedRead(fetchStub, '_parent.reference=w-2');

		const li = workRowOf(container, 'Old warhorse');
		expect(li.querySelector('[data-testid="work-edition-unknown"]')!.textContent).toContain(
			'[repertoire_edition_unknown]'
		);
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(li.textContent).not.toContain('[repertoire_no_edition]');
		const picker = li.querySelector('[data-testid="work-edition-picker"]');
		expect(picker, 'work-edition-picker on the unknown row').not.toBeNull();
		expect((picker as HTMLSelectElement).disabled).toBe(false);
	});

	it('a PARTIAL scoped read never marks the work resolved — a short page is not that work’s edition list', async () => {
		const { container, fetchStub } = await renderWorks({
			editionCount: 4000,
			scoped: 'partial-some'
		});
		await settleScopedRead(fetchStub, '_parent.reference=w-2');

		const li = workRowOf(container, 'Old warhorse');
		expect(li.querySelector('[data-testid="work-edition-unknown"]')).not.toBeNull();
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		// The partial page never entered `scopedEditionsByWorkId`: the picker holds
		// its placeholder and nothing else, and the row is still owed a real answer.
		expect(pickerOptions(li)).toEqual([
			{ value: '', label: '[repertoire_pin_edition_label]', disabled: false }
		]);
		// Still one request — an unsettled work is not re-read in a loop.
		expect(
			fetchStub.mock.calls
				.map((c) => String(c[0]))
				.filter((u) => u.includes('_parent.reference=w-2')).length
		).toBe(1);
	});
});

describe('/event/[id] #329 — known-absent under a COMPLETE read is unchanged', () => {
	it("zero editions for the work, read complete → today's wording, no unknown state, no picker", async () => {
		const { container, fetchStub } = await renderWorks({});
		const li = workRowOf(container, 'Old warhorse');
		const noEdition = li.querySelector('[data-testid="work-no-edition"]');
		expect(noEdition, 'work-no-edition').not.toBeNull();
		expect(noEdition!.textContent).toContain('[repertoire_no_edition]');
		expect(li.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-edition-picker"]')).toBeNull();
		// And NO scoped read is owed: a complete read already IS the fact.
		expect(fetchStub.mock.calls.some((c) => String(c[0]).includes('_parent.reference=w-2'))).toBe(
			false
		);
	});
});

// (*MVOX:Tallis* — #329 RED)
