// @vitest-environment happy-dom
//
// #331 RED (agenda half) — the READER's unknown branch must be reachable.
//
// #329 built the non-editor unknown state (RepertoireElement's reader branch)
// and page.edition-unknown.spec.ts pinned the whole chain — FOR AN EDITOR.
// For a reader with no manage rights anywhere the chain's flag never arrives:
// `rowEditionUnknown` opens with `if (!partial) return false`, and `partial`
// reaches the component as `worksManage?.pickableEditionsPartial ?? false`
// (AgendaList) — with `worksManage` $derived UNDEFINED for a rights-less
// reader by its own docstring. So the branch whose comment names "a
// non-editor viewer" cannot fire for one, and a reader whose pinned edition
// fell past the cap of a truncated collective read is told "No pinned
// edition" — the stated negative this family of issues exists to remove.
//
// The reader's flag is computed and DISCARDED one link earlier:
// `loadWorksByEventId` reads `listAllEditions` and drops `.truncated`. The
// settled fix (do not re-fork): the flag rides each row as the OPTIONAL
// `WorkRow.truncated` field — workRows.spec.ts pins the producer end; THIS
// suite pins the page end, on the real +page.svelte route, with the producer
// mocked at its module seam (`$lib/repertoire/workRows`) so a row can arrive
// exactly as a truncated read will deliver it.
//
// Fences ridden along: `repertoire_no_edition` under a complete read with
// nothing pinned stays byte-identical; a resolvable pin's NAME renders under
// truncated and complete reads alike (truncation poisons negatives, never
// positives); the reader gets NO picker and owes NO read — not the scoped
// per-work read either ("No new read is issued on any path").
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkRow } from '$lib/repertoire/types';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get: (_target, key) => () => `[${String(key)}]`
	})
}));

const { loadFullAgendaMock, loadWorksByEventIdMock, discoverMock, gotoMock, listMyRsvpsMock } =
	vi.hoisted(() => ({
		loadFullAgendaMock: vi.fn(),
		loadWorksByEventIdMock: vi.fn(),
		discoverMock: vi.fn(),
		gotoMock: vi.fn(),
		listMyRsvpsMock: vi.fn()
	}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
// The producer, mocked at ITS seam — the page still runs its real wiring from
// `worksByEventId` through AgendaList into RepertoireElement, which is the
// integration under test. `collectSources`/`buildWorkRows` stay real (the
// page imports them for the #234 panel join).
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: loadWorksByEventIdMock
}));
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

/** The viewer holds NO rights anywhere: not on the season, not on any event.
 *  `worksManage` derives to undefined for her — the exact route by which the
 *  editor-side `pickableEditionsPartial` can never reach her rows. */
function setAuthedReader() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p', orlando: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [
			{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' },
			{ db: 'orlando', name: 'Orlando', personId: 'person-p' }
		],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

function agendaEvent(id: string, name: string) {
	return {
		id,
		name,
		startDatetime: future,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: []
	};
}

/** One agenda per collective, rights-less throughout. */
function installAgenda() {
	loadFullAgendaMock.mockImplementation(async () =>
		fullAgendaResult(
			get(selectedCollectiveDbStore) === 'orlando'
				? {
						seasons: [],
						upcoming: [agendaEvent('or-ev', 'Orlando rehearsal')],
						recent: [],
						seasonId: 'season-or',
						seasonConductors: [],
						seasonOwners: [],
						seasonEditors: []
					}
				: {
						seasons: [],
						upcoming: [agendaEvent('pv-ev', 'Polyphony rehearsal')],
						recent: [],
						seasonId: 'season-1',
						seasonConductors: [],
						seasonOwners: [],
						seasonEditors: []
					}
		)
	);
}

/** Exactly what `loadWorksByEventId` delivers for a reader whose collective's
 *  edition read TRUNCATED and whose pin fell past the cap: the id is real,
 *  the label lookup came back empty, and the read says so on the row. */
function workRow(overrides: Partial<WorkRow> = {}): WorkRow {
	return {
		id: 'ri-1',
		kind: 'repertoire',
		workId: 'work-1',
		editionId: 'ed-9',
		workName: 'Old warhorse',
		composer: 'Anon.',
		status: 'active',
		editionName: '',
		ordinal: null,
		fileId: '',
		externalLinks: [],
		canBorrow: false,
		notes: '',
		truncated: true,
		...overrides
	};
}

/** Wire fallback for whatever the page still reads directly (type cache and
 *  friends) — everything answers empty. The `fetchMock` doubles as the
 *  no-new-read instrument: a reader's row must never cost an edition read,
 *  scoped or collective-wide. */
function stubWire() {
	const fetchMock = vi.fn(
		async (_input: RequestInfo | URL, _init?: RequestInit) =>
			new Response(JSON.stringify({ entities: [] }))
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

async function renderExpandedAsReader(rowsByEvent: Record<string, WorkRow[]>) {
	loadWorksByEventIdMock.mockImplementation(async (cfg: { db: string }) =>
		cfg.db === 'orlando' ? { 'or-ev': [workRow({ id: 'ri-or' })] } : rowsByEvent
	);
	setAuthedReader();
	const rendered = render(Page);
	await waitFor(() => {
		expect(rendered.container.querySelector('[data-testid="works-line"]')).not.toBeNull();
	});
	await fireEvent.click(rendered.container.querySelector('[data-testid="works-line"]')!);
	await waitFor(() => {
		expect(rendered.container.querySelector('[data-testid="work-row"]')).not.toBeNull();
	});
	return rendered;
}

function workRowOf(container: HTMLElement, workName: string): HTMLElement {
	const li = Array.from(container.querySelectorAll('[data-testid="work-row"]')).find(
		(el) => el.querySelector('[data-testid="work-name"]')?.textContent?.trim() === workName
	);
	expect(li, `work-row for ${workName}`).not.toBeUndefined();
	return li as HTMLElement;
}

beforeEach(() => {
	resetTypeIdCache();
	installAgenda();
	listMyRsvpsMock.mockResolvedValue({ items: [], total: 0, truncated: false });
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadFullAgendaMock.mockReset();
	loadWorksByEventIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('#331 agenda — a rights-less reader under a TRUNCATED edition read', () => {
	it('a pin the truncated read could not name says UNKNOWN, never "no pinned edition"', async () => {
		const fetchMock = stubWire();
		const { container } = await renderExpandedAsReader({ 'pv-ev': [workRow()] });
		const li = workRowOf(container, 'Old warhorse');

		// The reader branch #329 wrote for exactly this viewer must fire.
		const unknown = li.querySelector('[data-testid="work-edition-unknown"]');
		expect(unknown, 'work-edition-unknown on the reader\u2019s row').not.toBeNull();
		expect(unknown!.textContent).toContain('[repertoire_edition_unknown]');
		// The stated negative must be GONE — not softened, not captioned: absent.
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(li.textContent).not.toContain('[repertoire_no_edition]');

		// A reader still gets NO management surface — the wording changes, the
		// editor-only picker does not appear (editor behaviour byte-identical).
		expect(li.querySelector('[data-testid="work-edition-picker"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-manage-row"]')).toBeNull();

		// And she owes NO read for it: not the scoped per-work read (its own URL
		// pattern, `_parent.reference=work-1` — page.edition-unknown.spec.ts's
		// established check, not a bare `_parent.reference=`, which every
		// _parent-scoped read on the page also matches, e.g. this test's own
		// schedule_item bulk read), not a second edition read — the flag she
		// needed was already computed.
		expect(
			fetchMock.mock.calls.some((c) => String(c[0]).includes('_type.string=edition'))
		).toBe(false);
		expect(
			fetchMock.mock.calls.some((c) => String(c[0]).includes('_parent.reference=work-1'))
		).toBe(false);
	});

	it('a pin the read DID name keeps its name — under truncated and complete reads alike', async () => {
		stubWire();
		const { container } = await renderExpandedAsReader({
			'pv-ev': [
				workRow({ id: 'ri-named-t', editionName: 'Peters, 1904', truncated: true }),
				workRow({
					id: 'ri-named-c',
					workId: 'work-2',
					workName: 'Mass in B minor',
					editionName: 'Bärenreiter BA 5103',
					truncated: false
				})
			]
		});

		const truncatedRow = workRowOf(container, 'Old warhorse');
		expect(truncatedRow.querySelector('[data-testid="work-edition"]')!.textContent).toContain(
			'Peters, 1904'
		);
		expect(truncatedRow.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();

		const completeRow = workRowOf(container, 'Mass in B minor');
		expect(completeRow.querySelector('[data-testid="work-edition"]')!.textContent).toContain(
			'Bärenreiter BA 5103'
		);
		expect(completeRow.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
	});
});

describe('#331 agenda — the reader\'s COMPLETE read keeps every stated fact', () => {
	it('nothing pinned, read complete → "no pinned edition", byte-identical to today', async () => {
		stubWire();
		const { container } = await renderExpandedAsReader({
			'pv-ev': [workRow({ editionId: '', truncated: false })]
		});
		const li = workRowOf(container, 'Old warhorse');
		const noEdition = li.querySelector('[data-testid="work-no-edition"]');
		expect(noEdition, 'work-no-edition').not.toBeNull();
		expect(noEdition!.textContent).toContain('[repertoire_no_edition]');
		expect(li.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
	});

	it('a DANGLING pin under a complete read is still a pin — unknown wording, not a claim of absence (#331 item 4)', async () => {
		stubWire();
		// The flag is absent entirely — the complete-read shape every hand-built
		// row already has. The pin's id resolves to nothing: not the row's own
		// label lookup, and (the read being complete) not anything a re-read
		// could find. "No pinned edition" is false either way.
		const { container } = await renderExpandedAsReader({
			'pv-ev': [workRow({ truncated: undefined })]
		});
		const li = workRowOf(container, 'Old warhorse');
		const unknown = li.querySelector('[data-testid="work-edition-unknown"]');
		expect(unknown, 'work-edition-unknown on the reader\u2019s row').not.toBeNull();
		expect(unknown!.textContent).toContain('[repertoire_edition_unknown]');
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(li.textContent).not.toContain('[repertoire_no_edition]');
	});
});

describe('#331 agenda — a collective switch carries no stale unknown state across', () => {
	it('truncated rows left behind never caption the next collective\'s complete rows', async () => {
		stubWire();
		loadWorksByEventIdMock.mockImplementation(async (cfg: { db: string }) =>
			cfg.db === 'orlando'
				? {
						'or-ev': [
							workRow({
								id: 'ri-or',
								workId: 'work-or',
								workName: 'Fresh piece',
								editionName: 'Carus 40.688',
								truncated: false
							})
						]
					}
				: { 'pv-ev': [workRow()] }
		);
		setAuthedReader();
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="works-line"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="work-row"]')).not.toBeNull();
		});

		selectedCollectiveDbStore.set('orlando');
		await waitFor(() => {
			expect(container.textContent).toContain('Fresh piece');
		});
		if (container.querySelector('[data-testid="work-row"]') === null) {
			await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);
		}
		await waitFor(() => {
			expect(
				workRowOf(container, 'Fresh piece').querySelector('[data-testid="work-edition"]')
			).not.toBeNull();
		});

		// The complete collective renders complete: its pin by name, no unknown
		// wording anywhere on the page — the flag lives ON the rows, and the
		// rows it rode out on are gone.
		expect(
			workRowOf(container, 'Fresh piece').querySelector('[data-testid="work-edition"]')!
				.textContent
		).toContain('Carus 40.688');
		expect(container.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		expect(container.textContent).not.toContain('[repertoire_edition_unknown]');
		expect(container.textContent).not.toContain('Old warhorse');
	});
});

// (*MVOX:Tallis* — #331 RED)
