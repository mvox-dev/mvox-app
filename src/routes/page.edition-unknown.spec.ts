// @vitest-environment happy-dom
//
// #329 RED (agenda half, site (b)) — the work-edition picker says UNKNOWN.
//
// The ruling: a negative derived from a truncated read is not a fact — get
// the fact or say you don't have it, never print the negative. Truncation
// poisons NEGATIVES, never positives.
//
// Pre-#329 (the #321 residual this replaces): the pin-edition picker
// (`work-edition-picker`) is a closed set over the `listAllEditions` read
// (limit=500) joined per work (`editionsByWorkId`), and its control gates out
// entirely on `options.length > 0` — so under a TRUNCATED edition read a work
// whose editions ALL fall past the cap loses the picker, and with it (#125
// F5b) the row's only edition line, which then reads as "no edition" for a
// work that HAS one.
//
// Ruled fix, pinned here on the REAL agenda route:
//   • matched rows unchanged — a truncated read poisons only negatives;
//   • a zero-match row under a TRUNCATED read renders the UNKNOWN state (a
//     NEW i18n key — known-absent and not-known are different states), never
//     the known-absent wording;
//   • the picker is NOT gated out on unknown — present and openable;
//   • known-absent (COMPLETE read, zero matches) keeps today's wording and
//     today's behaviour byte-identically.
//
// Review round: opening the picker was only half of it — "let it open and read
// that one work THERE, where it is one request and scoped". So the page reads
// `listEditions(workId)` for every unknown row's work, and the unknown state
// lasts exactly as long as that read is unanswered:
//   • it comes back with editions → they fill the picker, wording gone;
//   • it comes back EMPTY and COMPLETE → a genuine known-absence, today's
//     wording;
//   • it FAILS, or comes back TRUNCATED against its own cap → unknown stands.
//     A read that did not answer is not an absence.
//
// Harness: page.repertoire-status-edition.spec.ts family — the real
// +page.svelte, agenda loader mocked, network stubbed at `fetch`.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { isMessageEmpty, messagePatterns, type MessageFile } from '$lib/testing/messageFile.js';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get: (_target, key) => () => `[${String(key)}]`
	})
}));

const { loadFullAgendaMock, discoverMock, gotoMock, listMyRsvpsMock } = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	listMyRsvpsMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: vi.fn().mockResolvedValue('member-1'),
	findMyRsvpForEvent: vi.fn().mockResolvedValue(null),
	listMyRsvps: listMyRsvpsMock,
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn() }));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn(),
	listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllRsvpsForEvent: vi.fn(),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
}));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

// ri-1 (Spem, work-1) has TWO editions in the (possibly truncated) read — the
// MATCHED row, which truncation must never touch. ri-2 (Old warhorse, work-2)
// has ZERO matches — the row whose meaning flips with the read's completeness:
// complete → known-absent (today's wording); truncated → UNKNOWN.
const REPERTOIRE_ITEMS = [
	{
		_id: 'ri-1',
		name: [{ string: 'Spem in alium' }],
		work: [{ reference: 'work-1' }],
		edition: [{ reference: 'ed-1' }],
		status: [{ string: 'active' }]
	},
	{
		_id: 'ri-2',
		name: [{ string: 'Old warhorse' }],
		work: [{ reference: 'work-2' }],
		status: [{ string: 'retired' }]
	}
];

/** The one work-2 edition that fell past the collective-wide cap — only the
 *  SCOPED per-work read can see it. */
const SCOPED_WORK_2_EDITIONS = [
	{
		_id: 'ed-9',
		name: [{ string: 'Peters, 1904' }],
		_parent: [{ reference: 'work-2', entity_type: 'work' }]
	}
];

/** person-p holds `_editor` on the season, so the pin-edition surface renders. */
function installWorld(
	options: {
		editionCount?: number;
		scoped?: 'editions' | 'none' | 'fail' | 'partial-empty' | 'partial-some';
	} = {}
) {
	loadFullAgendaMock.mockResolvedValue(
		fullAgendaResult({
			seasons: [],
			upcoming: [
				{
					id: 'ev-1',
					name: 'Rehearsal',
					startDatetime: future,
					durationMinutes: 90,
					location: '',
					conductors: [],
					owners: [],
					editors: []
				}
			],
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [],
			seasonOwners: [],
			seasonEditors: ['person-p']
		})
	);

	const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (method === 'DELETE') return json({ deleted: true });
		if (method === 'POST') return json({ _id: 'new-1' });
		if (url.includes('?props=status')) return json({ entity: { status: [{ _id: 'val-status' }] } });
		if (url.includes('?props=edition')) return json({ entity: { edition: [] } });
		if (url.includes('_type.string=entity')) return json({ entities: [{ _id: 'type-1' }] });
		if (url.includes('_type.string=work')) {
			return json({
				entities: [
					{ _id: 'work-1', name: [{ string: 'Spem in alium' }] },
					{ _id: 'work-2', name: [{ string: 'Old warhorse' }] }
				]
			});
		}
		// The SCOPED per-work read (#329 review) — matched BEFORE the
		// collective-wide one below, which its url also looks like.
		if (url.includes('_type.string=edition') && url.includes('_parent.reference=work-2')) {
			if (options.scoped === 'fail') return json({ error: 'boom' }, 500);
			// `count` above the returned rows = this scoped read is ITSELF partial.
			if (options.scoped === 'partial-empty') return json({ count: 900, entities: [] });
			if (options.scoped === 'partial-some')
				return json({ count: 900, entities: SCOPED_WORK_2_EDITIONS });
			return json({ entities: options.scoped === 'none' ? [] : SCOPED_WORK_2_EDITIONS });
		}
		if (url.includes('_type.string=edition')) {
			return json({
				...(options.editionCount === undefined ? {} : { count: options.editionCount }),
				entities: [
					{
						_id: 'ed-1',
						name: [{ string: '40-part original' }],
						_parent: [{ reference: 'work-1', entity_type: 'work' }]
					},
					{
						_id: 'ed-2',
						name: [{ string: 'Bärenreiter urtext' }],
						_parent: [{ reference: 'work-1', entity_type: 'work' }]
					}
				]
			});
		}
		if (url.includes('_type.string=copy')) return json({ entities: [] });
		if (url.includes('_type.string=program_item')) return json({ entities: [] });
		if (url.includes('_type.string=repertoire_item')) return json({ entities: REPERTOIRE_ITEMS });
		return json({ entities: [] });
	});

	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

/** Open the agenda row's Works disclosure and wait for the management row. */
async function renderExpandedAsEditor() {
	setAuthedWithOneCollective();
	const rendered = render(Page);
	await vi.waitFor(() => {
		expect(rendered.container.querySelector('[data-testid="works-line"]')).not.toBeNull();
	});
	await fireEvent.click(rendered.container.querySelector('[data-testid="works-line"]')!);
	await vi.waitFor(() => {
		expect(rendered.container.querySelector('[data-testid="work-manage-row"]')).not.toBeNull();
	});
	return rendered;
}

/** The <li> rendering the named work. */
function workRowOf(container: HTMLElement, workName: string): HTMLElement {
	const li = Array.from(container.querySelectorAll('[data-testid="work-row"]')).find(
		(el) => el.querySelector('[data-testid="work-name"]')?.textContent?.trim() === workName
	);
	expect(li, `work-row for ${workName}`).not.toBeUndefined();
	return li as HTMLElement;
}

/** Full option shape of a row's pin-edition picker — value/label/disabled. */
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
	listMyRsvpsMock.mockResolvedValue({ items: [], total: 0, truncated: false });
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadFullAgendaMock.mockReset();
	listMyRsvpsMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('#329 agenda — a zero-match row under a TRUNCATED edition read says UNKNOWN', () => {
	it('the unknown state stands while the scoped read has not answered — never the known-absent wording', async () => {
		// The scoped read FAILS: nothing is learned, so nothing is claimed. This
		// is also the shape of the in-flight window, held open.
		const fetchMock = installWorld({ editionCount: 4000, scoped: 'fail' });
		const { container } = await renderExpandedAsEditor();
		await vi.waitFor(() => {
			expect(
				fetchMock.mock.calls.some((c) => String(c[0]).includes('_parent.reference=work-2'))
			).toBe(true);
		});
		const li = workRowOf(container, 'Old warhorse');
		expect(
			li.querySelector('[data-testid="work-edition-unknown"]')!.textContent
		).toContain('[repertoire_edition_unknown]');
		// The known-absent claim must be GONE — not softened, not captioned: absent.
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(li.textContent).not.toContain('[repertoire_no_edition]');
		// And the control is still there to be opened — gating it out is itself
		// the assertion this issue removes.
		const picker = li.querySelector('[data-testid="work-edition-picker"]');
		expect(picker, 'work-edition-picker on the unknown row').not.toBeNull();
		expect((picker as HTMLElement).tagName).toBe('SELECT');
		expect((picker as HTMLSelectElement).disabled).toBe(false);
	});

	it('reads that ONE work scoped and turns unknown into a fact — the picker names its editions', async () => {
		const fetchMock = installWorld({ editionCount: 4000 });
		const { container } = await renderExpandedAsEditor();
		await vi.waitFor(() => {
			expect(pickerOptions(workRowOf(container, 'Old warhorse')).length).toBe(2);
		});
		// One request, scoped to the work — not another collective-wide read.
		const scoped = fetchMock.mock.calls
			.map((c) => String(c[0]))
			.filter((u) => u.includes('_parent.reference=work-2'));
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
		const fetchMock = installWorld({ editionCount: 4000, scoped: 'none' });
		const { container } = await renderExpandedAsEditor();
		await vi.waitFor(() => {
			expect(
				workRowOf(container, 'Old warhorse').querySelector('[data-testid="work-no-edition"]')
			).not.toBeNull();
		});
		const li = workRowOf(container, 'Old warhorse');
		expect(li.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-edition-picker"]')).toBeNull();
		expect(
			fetchMock.mock.calls.some((c) => String(c[0]).includes('_parent.reference=work-2'))
		).toBe(true);
	});

	it('a MATCHED row is untouched by the truncation — full option shape, no unknown wording (truncation poisons negatives, never positives)', async () => {
		installWorld({ editionCount: 4000 });
		const { container } = await renderExpandedAsEditor();
		await vi.waitFor(() => {
			expect(
				workRowOf(container, 'Spem in alium').querySelector(
					'[data-testid="work-edition-picker"]'
				)
			).not.toBeNull();
		});
		const li = workRowOf(container, 'Spem in alium');
		expect(pickerOptions(li)).toEqual([
			{ value: '', label: '[repertoire_pin_edition_label]', disabled: false },
			{ value: 'ed-1', label: '40-part original', disabled: false },
			{ value: 'ed-2', label: 'Bärenreiter urtext', disabled: false }
		]);
		expect(li.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
	});

	it('a MATCHED row renders byte-identically under truncated and complete reads', async () => {
		installWorld({ editionCount: 4000 });
		const truncatedRender = await renderExpandedAsEditor();
		await vi.waitFor(() => {
			expect(
				workRowOf(truncatedRender.container, 'Spem in alium').querySelector(
					'[data-testid="work-edition-picker"]'
				)
			).not.toBeNull();
		});
		const truncatedHtml = workRowOf(truncatedRender.container, 'Spem in alium').outerHTML;
		cleanup();
		vi.unstubAllGlobals();

		installWorld({});
		const completeRender = await renderExpandedAsEditor();
		await vi.waitFor(() => {
			expect(
				workRowOf(completeRender.container, 'Spem in alium').querySelector(
					'[data-testid="work-edition-picker"]'
				)
			).not.toBeNull();
		});
		const completeHtml = workRowOf(completeRender.container, 'Spem in alium').outerHTML;

		expect(truncatedHtml).toBe(completeHtml);
	});
});

/** Wait for the scoped read to have been made, then let its promise chain and
 *  the render queue drain. The assertions that follow are about a state change
 *  that must NOT happen, so it has to have had every chance to happen first. */
async function settleScopedRead(fetchMock: ReturnType<typeof installWorld>, urlFragment: string) {
	await vi.waitFor(() => {
		expect(fetchMock.mock.calls.some((c) => String(c[0]).includes(urlFragment))).toBe(true);
	});
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("#329 review — the scoped read's OWN truncation is not a fact either", () => {
	it('a scoped read that comes back PARTIAL is not a known absence — unknown stands', async () => {
		// A work with more editions than the scoped read's own cap: its empty (or
		// short) page proves nothing, exactly as the collective-wide read's did.
		const fetchMock = installWorld({ editionCount: 4000, scoped: 'partial-empty' });
		const { container } = await renderExpandedAsEditor();
		await settleScopedRead(fetchMock, '_parent.reference=work-2');

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
		const fetchMock = installWorld({ editionCount: 4000, scoped: 'partial-some' });
		const { container } = await renderExpandedAsEditor();
		await settleScopedRead(fetchMock, '_parent.reference=work-2');

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
			fetchMock.mock.calls
				.map((c) => String(c[0]))
				.filter((u) => u.includes('_parent.reference=work-2')).length
		).toBe(1);
	});
});

describe('#329 agenda — known-absent under a COMPLETE read is byte-identical to today', () => {
	it("zero editions for the work, read complete → today's wording, no unknown state, no picker", async () => {
		const fetchMock = installWorld({}); // no count on the wire = complete
		const { container } = await renderExpandedAsEditor();
		// The MATCHED row's picker proves the edition read has settled — only then
		// is "no picker on the zero-match row" an answer rather than a not-yet.
		await vi.waitFor(() => {
			expect(
				workRowOf(container, 'Spem in alium').querySelector(
					'[data-testid="work-edition-picker"]'
				)
			).not.toBeNull();
		});
		const li = workRowOf(container, 'Old warhorse');
		const noEdition = li.querySelector('[data-testid="work-no-edition"]');
		expect(noEdition, 'work-no-edition').not.toBeNull();
		expect(noEdition!.textContent).toContain('[repertoire_no_edition]');
		expect(li.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-edition-picker"]')).toBeNull();
		// And NO scoped read is owed: a complete read already IS the fact, so the
		// per-work requests cost nothing in the ordinary case.
		expect(
			fetchMock.mock.calls.some((c) => String(c[0]).includes('_parent.reference=work-2'))
		).toBe(false);
	});
});

describe('#329 — the lifetime listMyRsvps read keeps its OTHER consumer', () => {
	it('the agenda still seeds its rows from listMyRsvps — this issue moves only the EVENT PAGE off it', async () => {
		installWorld({});
		await renderExpandedAsEditor();
		expect(listMyRsvpsMock).toHaveBeenCalled();
		expect(listMyRsvpsMock.mock.calls.some((c) => c[1] === 'person-p')).toBe(true);
	});
});

// ── i18n — the unknown wording (all four locales) ─────────────────────────────

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;

function localeMessages(locale: string): MessageFile {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

/** Today's known-absent wording, byte-pinned: the ruling says known-absent
 *  KEEPS this — only not-known changes. */
const NO_EDITION_TODAY: Record<(typeof LOCALES)[number], string> = {
	en: 'No pinned edition',
	et: 'Trükiväljaanne valimata',
	lv: 'Izdevums nav norādīts',
	uk: 'Видання не вказано'
};

describe('#329 i18n — repertoire_edition_unknown exists; repertoire_no_edition unchanged', () => {
	it.each(LOCALES)('%s.json carries repertoire_edition_unknown, non-empty', (locale) => {
		const messages = localeMessages(locale);
		expect('repertoire_edition_unknown' in messages, `${locale}.json missing key`).toBe(true);
		expect(isMessageEmpty(messages['repertoire_edition_unknown'])).toBe(false);
	});

	it.each(LOCALES)(
		'%s: unknown and known-absent are DIFFERENT sentences — the two states must not share wording',
		(locale) => {
			const messages = localeMessages(locale);
			const unknown = messagePatterns(messages['repertoire_edition_unknown']).join(' ');
			const noEdition = messagePatterns(messages['repertoire_no_edition']).join(' ');
			expect(unknown).not.toBe('');
			expect(unknown).not.toBe(noEdition);
		}
	);

	it.each(LOCALES)("%s: repertoire_no_edition keeps today's wording byte-identically", (locale) => {
		const messages = localeMessages(locale);
		expect(messages['repertoire_no_edition']).toBe(NO_EDITION_TODAY[locale]);
	});
});

// (*MVOX:Tallis* — #329 RED)
