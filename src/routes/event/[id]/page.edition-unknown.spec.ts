// @vitest-environment happy-dom

// The work-edition picker says unknown for a zero-match row under a truncated
// `listAllEditions` read, then states the fact once that work's scoped read lands complete.
// Real page and data layer; only the wire fetch is stubbed.
import { render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

beforeEach(editorTokenAtNow);

// Full-fallback paraglide mock — every key renders `[key {params}]`.
vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const pageStub = vi.hoisted(() => ({
	params: { id: 'ev1' } as Record<string, string>,
	url: new URL('http://localhost/event/ev1')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './+page.svelte';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { cleanupRealTimersReset, editorTokenAtNow } from '$lib/testing/pages/event';
import { setAuthed } from '$lib/testing/pages/eventRsvp';
import { pickerOptions, workRowOf } from '$lib/testing/pages/eventEdition';

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

beforeEach(() => {
	resetTypeIdCache();
});

afterEach(cleanupRealTimersReset);

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
