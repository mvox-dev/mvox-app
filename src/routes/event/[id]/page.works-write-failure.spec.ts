// @vitest-environment happy-dom
//
// #324 RED — repertoire/programme writes on the EVENT DETAIL page: failure
// reaches the user (and success is distinguishable from silence).
//
// The defect (issue #324, delta-verified in research-323-328-delta.json): this
// page's `repertoireQueue` (createRepertoireWriteQueue consumer) applies every
// write kind — status change, pin edition, remove, move, add work, add
// program item — OPTIMISTICALLY, and on rejection its `revert()` does only
// `console.error` + a silent `refreshWorks()`. The rolled-back row snaps back
// (or waits for the refetch) with nothing said to the person who tapped.
//
// INTEGRATION posture: the REAL +page.svelte with the REAL data layer
// (workRows.ts / repertoireData / repertoireActions) running — only the global
// fetch is stubbed at the wire, same harness family as page.schedule.spec.ts.
// This is what forces GREEN to wire the signals into the route, not into an
// isolated component.
//
// CONTRACT (defined HERE, implemented in GREEN):
//
//   FAILURE — the agenda page's own #91 precedent PROPAGATED to this page
//   (src/routes/+page.svelte:8197-8201 is the in-file reference shape; that
//   agenda-side wiring itself stays BYTE-UNTOUCHED — it is already correct):
//     • [data-testid="repertoire-manage-error"], role="alert", rendering
//       m.repertoire_manage_error() (the existing four-locale key — same text
//       family the agenda surface uses, truthfully naming that the change was
//       not saved), INSIDE [data-testid="event-detail-works"].
//     • Absent until a write fails. Appears for EVERY rejected write kind on
//       both surfaces this page's queue serves: status change / pin edition /
//       remove / add work (repertoire context), move / remove / add to
//       programme (programme context).
//     • The on-screen value after the failure is what the SERVER holds — the
//       existing rollback+refetch semantics are pinned by VALUE (row status,
//       pinned edition, row presence, programme order), not by mechanism.
//     • A FRESH attempt clears the previous failure (the agenda precedent:
//       trying again retires the old alert).
//
//   SAVED — the queue's reconcile is silent today; the minimum honest saved
//   cue per the #267 shape (profile/+page.svelte:1005-1012 precedent):
//     • [data-testid="repertoire-manage-status"], role="status",
//       aria-live="polite", MOUNTED as soon as the works section renders
//       (a live region announces only CHANGES — inserting it already
//       populated announces nothing, the #197/#298 rule), textually blank
//       until a write settles.
//     • On a successful settle it carries m.repertoire_manage_saved() — a NEW
//       key, all four locales (en/et/lv/uk), pinned below.
//     • Never a stale "saved" beside a failure alert: once a later attempt
//       fails, the saved text is gone.
//
//   BOUNDARY (stated per the task pins): #324 owns the saved/failure signals
//   of the two REPERTOIRE queues — this page's `repertoireQueue` and the
//   season panel's `panelQueue` (page.season-repertoire-write-failure.spec.ts,
//   this file's sibling). The page's OTHER two createRepertoireWriteQueue
//   instances — `scheduleQueue` and `editWriteQueue` — already surface their
//   failures and belong to #328's saved-cue trio; nothing here touches them.
//
//   PRIMITIVE (stated per the task pins): the wiring is PER CALL SITE. The
//   queue primitive's callback contract (repertoireActions.ts
//   RepertoireWriteQueueCallbacks: setPending/reconcile/revert) is NOT
//   widened — the alert/status state lives in the page, set inside the
//   existing revert()/reconcile() callbacks exactly as the agenda's
//   `manageError` does. repertoireActions.spec.ts stays green byte-for-byte;
//   #328 shares the same unwidened interface.
//
//   RepertoireElement.svelte is NOT touched: no `failed` prop exists (grep:
//   zero occurrences) and none is required — the alert is page-authored, the
//   agenda precedent's own placement. (#321's pickableWorksPartial/
//   pickableEditionsPartial and #329's scoped-edition props are adjacent in
//   that component, not overlapping.)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — every key renders `[key]`; assertions pin KEYS, the
// copy itself is Comenius's (locale-file pins below).
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
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

// ── fixtures ─────────────────────────────────────────────────────────────────

/** ISO instant `offsetDays` from now — keeps the fixtures time-bomb-free. */
function isoAt(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString();
}

type EntityRaw = Record<string, unknown>;

/** A FUTURE event (works section, no attendance section). The viewer holds
 *  `_editor` on the event — the programme-management gate. */
function eventEntity(): EntityRaw {
	return {
		_id: 'ev1',
		name: [{ _id: 'val-name-1', string: 'Tuesday Rehearsal' }],
		start_datetime: [{ _id: 'val-start-1', datetime: isoAt(7) }],
		duration_minutes: [{ _id: 'val-dur-1', number: 90 }],
		_parent: [
			{ reference: 'org1', entity_type: 'organization' },
			{ reference: 'season1', entity_type: 'season' }
		],
		_editor: [{ reference: 'p-viewer' }]
	};
}

/** The viewer holds `_editor` on the SEASON — the repertoire-management gate. */
function seasonEntity(): EntityRaw {
	return {
		_id: 'season1',
		name: [{ string: '2026/27' }],
		start_date: [{ date: isoAt(-30).slice(0, 10) }],
		_editor: [{ reference: 'p-viewer' }]
	};
}

const WORKS: EntityRaw[] = [
	{ _id: 'w-1', name: [{ string: 'Bogoróditse Djévo' }], composer: [{ string: 'Arvo Pärt' }] },
	{ _id: 'w-2', name: [{ string: 'Locus iste' }], composer: [{ string: 'Anton Bruckner' }] },
	{ _id: 'w-3', name: [{ string: 'Nunc dimittis' }], composer: [{ string: 'Arvo Pärt' }] }
];

const EDITIONS: EntityRaw[] = [
	{ _id: 'ed-1', name: [{ string: 'Urtext' }], _parent: [{ reference: 'w-1', entity_type: 'work' }] },
	{
		_id: 'ed-2',
		name: [{ string: 'Bärenreiter' }],
		_parent: [{ reference: 'w-1', entity_type: 'work' }]
	},
	{ _id: 'ed-3', name: [{ string: 'Carus' }], _parent: [{ reference: 'w-2', entity_type: 'work' }] }
];

/** Season repertoire (repertoire context — the event has NO program_items):
 *  ri-1 active + pinned to ed-1, ri-2 learning + unpinned. w-3 stays pickable. */
function repertoireItemsFixture(): EntityRaw[] {
	return [
		{
			_id: 'ri-1',
			name: [{ string: 'Bogoróditse Djévo' }],
			work: [{ reference: 'w-1' }],
			edition: [{ reference: 'ed-1' }],
			status: [{ string: 'active' }]
		},
		{
			_id: 'ri-2',
			name: [{ string: 'Locus iste' }],
			work: [{ reference: 'w-2' }],
			status: [{ string: 'learning' }]
		}
	];
}

/** Tonight's programme (programme context): ed-1 (w-1) then ed-3 (w-2).
 *  ed-2 stays pickable for "Add to programme". */
function programItemsFixture(): EntityRaw[] {
	return [
		{
			_id: 'pi-1',
			name: [{ string: 'Bogoróditse Djévo' }],
			edition: [{ reference: 'ed-1' }],
			ordinal: [{ number: 0 }]
		},
		{
			_id: 'pi-2',
			name: [{ string: 'Locus iste' }],
			edition: [{ reference: 'ed-3' }],
			ordinal: [{ number: 1 }]
		}
	];
}

/** #324 review F1 — the OTHER collective's answer for the same event id: a
 *  different name (so "the switch happened" is readable off the page) and a
 *  single, different repertoire row (so the works section it renders is
 *  unmistakably not the one the failure was raised over). */
function credeEventEntity(): EntityRaw {
	return { ...eventEntity(), name: [{ _id: 'cval-name-1', string: 'Crede Rehearsal' }] };
}
const CREDE_REPERTOIRE: EntityRaw[] = [
	{
		_id: 'cri-1',
		name: [{ string: 'Nunc dimittis' }],
		work: [{ reference: 'w-3' }],
		status: [{ string: 'active' }]
	}
];

// ── the Entu stand-in ─────────────────────────────────────────────────────────

interface WorldOptions {
	repertoireItems?: EntityRaw[];
	programItems?: EntityRaw[];
	/** Consulted per WRITE (entity create POST, property-replace POST, entity
	 *  DELETE): while true every write answers 500. Reads stay healthy, so the
	 *  revert-path refetch always serves the server's (unchanged) truth. */
	failWrites?: () => boolean;
}

/** Db-aware stateful wire: successful writes MUTATE the state, so any refetch
 *  (reconcile or revert path alike) serves post-write truth — the pins accept
 *  optimistic-hold or refetch mechanics, value over choreography. */
function installWorld(options: WorldOptions = {}) {
	const failWrites = options.failWrites ?? (() => false);
	let repertoireItems = options.repertoireItems ?? repertoireItemsFixture();
	let programItems = options.programItems ?? [];
	let createSeq = 0;

	const applyProps = (item: EntityRaw, props: Array<Record<string, unknown>>) => {
		for (const prop of props) {
			const { type, _id: _old, ...valueParts } = prop;
			if (type === 'status' || type === 'edition' || type === 'ordinal') {
				item[String(type)] = [{ _id: `val-${String(type)}-new`, ...valueParts }];
			}
		}
	};

	const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';

		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });

		if (method === 'DELETE' && url.includes('/entity/')) {
			if (failWrites()) return json({ error: 'nope' }, 500);
			const id = url.match(/\/entity\/([^/?]+)/)?.[1] ?? '';
			repertoireItems = repertoireItems.filter((e) => e._id !== id);
			programItems = programItems.filter((e) => e._id !== id);
			return json({ deleted: true });
		}

		if (method === 'POST' && /\/entity(\?|$)/.test(url)) {
			// Entity CREATE — repertoire_item or program_item, told apart by props.
			if (failWrites()) return json({ error: 'nope' }, 500);
			const props = JSON.parse(String(init?.body ?? '[]')) as Array<Record<string, unknown>>;
			const workRef = props.find((p) => p.type === 'work')?.reference;
			const id = `created-${++createSeq}`;
			if (workRef !== undefined) {
				repertoireItems = [
					...repertoireItems,
					{
						_id: id,
						name: [],
						work: [{ reference: workRef }],
						status: [{ string: String(props.find((p) => p.type === 'status')?.string ?? 'active') }]
					}
				];
			} else {
				programItems = [
					...programItems,
					{
						_id: id,
						name: [],
						edition: [{ reference: props.find((p) => p.type === 'edition')?.reference ?? '' }],
						ordinal: [{ number: Number(props.find((p) => p.type === 'ordinal')?.number ?? 0) }]
					}
				];
			}
			return json({ _id: id });
		}

		if (method === 'POST' && url.includes('/entity/')) {
			// replaceEntityProperty's ONE atomic POST (status / edition / ordinal).
			if (failWrites()) return json({ error: 'nope' }, 500);
			const id = url.match(/\/entity\/([^/?]+)/)?.[1] ?? '';
			const props = JSON.parse(String(init?.body ?? '[]')) as Array<Record<string, unknown>>;
			for (const item of [...repertoireItems, ...programItems]) {
				if (item._id === id) applyProps(item, props);
			}
			return json({ _id: id });
		}

		// replaceEntityProperty's pre-write value-id lookups.
		if (url.includes('?props=status')) {
			const item = repertoireItems.find((e) => url.includes(`/entity/${e._id}?`));
			return json({ entity: { status: item ? [{ _id: `val-status-${item._id}` }] : [] } });
		}
		if (url.includes('?props=edition')) {
			const item = repertoireItems.find((e) => url.includes(`/entity/${e._id}?`));
			const pinned = (item?.edition as Array<{ reference: string }> | undefined) ?? [];
			return json({
				entity: { edition: pinned.length > 0 ? [{ _id: `val-edition-${item?._id}` }] : [] }
			});
		}
		if (url.includes('?props=ordinal')) return json({ entity: { ordinal: [{ _id: 'val-ord' }] } });

		// Type-definition lookups (creates resolve `_type` to a reference).
		if (url.includes('name.string=repertoire_item')) return json({ entities: [{ _id: 'type-ri' }] });
		if (url.includes('name.string=program_item')) return json({ entities: [{ _id: 'type-pi' }] });

		// The OTHER collective answers the SAME ids its own way — what makes a
		// collective switch on this page a genuine subject change (#324 review F1:
		// the cues must not ride across it). Reads only; no test writes under it.
		if (url.includes('/crede/')) {
			if (url.includes('/entity/ev1')) return json({ entity: credeEventEntity() });
			if (url.includes('_type.string=repertoire_item')) return json({ entities: CREDE_REPERTOIRE });
			if (url.includes('_type.string=program_item')) return json({ entities: [] });
		}

		if (url.includes('/entity/ev1')) return json({ entity: eventEntity() });
		if (url.includes('/entity/season1')) return json({ entity: seasonEntity() });

		if (url.includes('_type.string=program_item')) return json({ entities: programItems });
		if (url.includes('_type.string=repertoire_item')) return json({ entities: repertoireItems });
		if (url.includes('_type.string=work')) return json({ entities: WORKS });
		if (url.includes('_type.string=edition')) {
			// The scoped per-work read (#329) filters by _parent; the collective-wide
			// listAllEditions does not.
			const workId = url.match(/_parent\.reference=([^&]+)/)?.[1];
			return json({
				entities:
					workId === undefined
						? EDITIONS
						: EDITIONS.filter((e) =>
								(e._parent as Array<{ reference: string }>).some(
									(p) => p.reference === decodeURIComponent(workId)
								)
							)
			});
		}
		if (url.includes('_type.string=copy')) return json({ entities: [] });
		if (url.includes('_type.string=member') && url.includes('person.reference'))
			return json({ entities: [{ _id: 'member-1' }] });
		if (url.includes('_type.string=member')) return json({ entities: [] });

		// Everything else this page reads on the side (rsvp, attendance, schedule,
		// series options, profiles, database) — empty is a valid, quiet answer.
		return json({ entities: [] });
	});

	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function setAuthed(dbs: string[] = ['polyphony']) {
	authStore.set({
		status: 'authenticated',
		personIdByDb: Object.fromEntries(dbs.map((db) => [db, 'p-viewer'])),
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: dbs.map((db) => ({ db, name: db, personId: 'p-viewer' })),
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(dbs[0]);
}

function renderPage(dbs: string[] = ['polyphony']) {
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthed(dbs);
	return render(Page);
}

function q(scope: ParentNode, testid: string): HTMLElement | null {
	return scope.querySelector(`[data-testid="${testid}"]`);
}
function qa(scope: ParentNode, testid: string): HTMLElement[] {
	return Array.from(scope.querySelectorAll(`[data-testid="${testid}"]`));
}

async function worksSection(container: HTMLElement, rowCount: number): Promise<HTMLElement> {
	await waitFor(() => {
		const section = q(container, 'event-detail-works');
		expect(section).not.toBeNull();
		expect(qa(section!, 'work-row').length).toBe(rowCount);
	});
	return q(container, 'event-detail-works')!;
}

function rowByName(scope: ParentNode, workName: string): HTMLElement {
	const row = qa(scope, 'work-row').find(
		(el) => q(el, 'work-name')?.textContent?.trim() === workName
	);
	if (!row) throw new Error(`no work-row named '${workName}'`);
	return row;
}

/** The #324 failure alert, scoped to the works section. */
function manageAlert(section: HTMLElement): HTMLElement | null {
	return q(section, 'repertoire-manage-error');
}
/** The #324 saved-status live region, scoped to the works section. */
function manageStatus(section: HTMLElement): HTMLElement | null {
	return q(section, 'repertoire-manage-status');
}
/** Safe text of the saved region — '' while GREEN has not mounted it yet, so
 *  a RED failure reads as an assertion, never a null-deref. */
function savedText(section: HTMLElement): string {
	return manageStatus(section)?.textContent ?? '';
}

type FetchMock = ReturnType<typeof installWorld>;
function writeAttempts(fetchMock: FetchMock, method: 'POST' | 'DELETE', fragment: string) {
	return fetchMock.mock.calls.filter(
		([url, init]) =>
			String(url).includes(fragment) && (init as RequestInit | undefined)?.method === method
	);
}
function createAttempts(fetchMock: FetchMock) {
	return fetchMock.mock.calls.filter(
		([url, init]) =>
			/\/entity(\?|$)/.test(String(url)) && (init as RequestInit | undefined)?.method === 'POST'
	);
}
/** The tap really reached the wire — pins that a RED here is "the failure was
 *  swallowed", never "the control was inert in this harness". */
async function expectWriteAttempted(probe: () => number): Promise<void> {
	await waitFor(() => {
		expect(probe(), 'the tap must actually fire the write').toBeGreaterThan(0);
	});
}

async function expectFailureSurfaced(section: HTMLElement): Promise<HTMLElement> {
	await waitFor(() => {
		expect(manageAlert(section), 'the failed write must be said out loud').not.toBeNull();
	});
	const alert = manageAlert(section)!;
	expect(alert.getAttribute('role')).toBe('alert');
	expect(alert.textContent).toContain('[repertoire_manage_error]');
	return alert;
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	resetTypeIdCache();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	gotoMock.mockReset();
	discoverMock.mockReset();
});

// ═════════════════════════════════════════════════════════════════════════════
// 1 — repertoire context: every rejected write speaks, and the screen shows
//     the server's value
// ═════════════════════════════════════════════════════════════════════════════

describe('#324 — event page, repertoire surface: a rejected write reaches the user', () => {
	it('status change: no alert before, role=alert naming the failure after — and the row shows the status the server still holds', async () => {
		const fetchMock = installWorld({ failWrites: () => true });
		const { container } = renderPage();
		const section = await worksSection(container, 2);

		// Nothing has failed yet — no alert anywhere in the section.
		expect(manageAlert(section)).toBeNull();

		const row = rowByName(section, 'Bogoróditse Djévo');
		await fireEvent.click(q(row, 'work-status-retired')!);

		await expectWriteAttempted(() => writeAttempts(fetchMock, 'POST', '/entity/ri-1').length);
		await expectFailureSurfaced(section);
		// The server still holds 'active' — the reverted on-screen value is the
		// server's truth, not the optimistic tap.
		await waitFor(() => {
			const after = rowByName(section, 'Bogoróditse Djévo');
			expect(after.getAttribute('data-status')).toBe('active');
			expect(q(after, 'work-status-active')?.getAttribute('aria-pressed')).toBe('true');
			expect(q(after, 'work-status-retired')?.getAttribute('aria-pressed')).toBe('false');
		});
	});

	it('pin edition: the rejected re-pin surfaces the alert and the picker shows the edition the server still holds', async () => {
		const fetchMock = installWorld({ failWrites: () => true });
		const { container } = renderPage();
		const section = await worksSection(container, 2);

		const row = rowByName(section, 'Bogoróditse Djévo');
		const picker = q(row, 'work-edition-picker') as HTMLSelectElement;
		expect(picker).not.toBeNull();
		expect(picker.value).toBe('ed-1');
		await fireEvent.change(picker, { target: { value: 'ed-2' } });

		await expectWriteAttempted(() => writeAttempts(fetchMock, 'POST', '/entity/ri-1').length);
		await expectFailureSurfaced(section);
		await waitFor(() => {
			const after = q(rowByName(section, 'Bogoróditse Djévo'), 'work-edition-picker');
			expect((after as HTMLSelectElement).value).toBe('ed-1');
		});
	});

	it('remove: the rejected delete surfaces the alert and the row stays listed', async () => {
		const fetchMock = installWorld({ failWrites: () => true });
		const { container } = renderPage();
		const section = await worksSection(container, 2);

		await fireEvent.click(q(rowByName(section, 'Bogoróditse Djévo'), 'work-manage-remove')!);

		await expectWriteAttempted(() => writeAttempts(fetchMock, 'DELETE', '/entity/ri-1').length);
		await expectFailureSurfaced(section);
		await waitFor(() => {
			expect(qa(section, 'work-row').length).toBe(2);
		});
		expect(rowByName(section, 'Bogoróditse Djévo')).not.toBeNull();
	});

	it('add work: the rejected create surfaces the alert, no phantom row appears, and the work stays pickable', async () => {
		const fetchMock = installWorld({ failWrites: () => true });
		const { container } = renderPage();
		const section = await worksSection(container, 2);

		const select = q(section, 'work-manage-add-work-select') as HTMLSelectElement;
		expect(select).not.toBeNull();
		await fireEvent.change(select, { target: { value: 'w-3' } });
		await fireEvent.click(q(section, 'work-manage-add-work-button')!);

		await expectWriteAttempted(() => createAttempts(fetchMock).length);
		await expectFailureSurfaced(section);
		await waitFor(() => {
			expect(qa(section, 'work-row').length).toBe(2);
		});
		// Still offered — the create did not happen.
		const options = Array.from(
			(q(section, 'work-manage-add-work-select') as HTMLSelectElement).querySelectorAll('option')
		).map((o) => o.value);
		expect(options).toContain('w-3');
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 — programme context: same queue, same contract
// ═════════════════════════════════════════════════════════════════════════════

describe('#324 — event page, programme surface: a rejected write reaches the user', () => {
	it('move: the rejected reorder surfaces the alert and the programme keeps its server order', async () => {
		const fetchMock = installWorld({ programItems: programItemsFixture(), failWrites: () => true });
		const { container } = renderPage();
		const section = await worksSection(container, 2);

		// Second row up — a real two-write renumber.
		await fireEvent.click(q(rowByName(section, 'Locus iste'), 'work-manage-move-up')!);

		await expectWriteAttempted(() => writeAttempts(fetchMock, 'POST', '/entity/pi-').length);
		await expectFailureSurfaced(section);
		await waitFor(() => {
			const names = qa(section, 'work-name').map((el) => el.textContent?.trim());
			expect(names).toEqual(['Bogoróditse Djévo', 'Locus iste']);
		});
	});

	it('remove from tonight: the rejected delete surfaces the alert and the row stays on the programme', async () => {
		const fetchMock = installWorld({ programItems: programItemsFixture(), failWrites: () => true });
		const { container } = renderPage();
		const section = await worksSection(container, 2);

		await fireEvent.click(q(rowByName(section, 'Bogoróditse Djévo'), 'work-manage-remove')!);

		await expectWriteAttempted(() => writeAttempts(fetchMock, 'DELETE', '/entity/pi-1').length);
		await expectFailureSurfaced(section);
		await waitFor(() => {
			expect(qa(section, 'work-row').length).toBe(2);
		});
	});

	it('add to programme: the rejected create surfaces the alert and the programme is unchanged', async () => {
		const fetchMock = installWorld({ programItems: programItemsFixture(), failWrites: () => true });
		const { container } = renderPage();
		const section = await worksSection(container, 2);

		const select = q(section, 'work-manage-add-programme-select') as HTMLSelectElement;
		expect(select).not.toBeNull();
		await fireEvent.change(select, { target: { value: 'ed-2' } });
		await waitFor(() => {
			expect(q(section, 'work-manage-add-programme-button')).not.toBeNull();
		});
		await fireEvent.click(q(section, 'work-manage-add-programme-button')!);

		await expectWriteAttempted(() => createAttempts(fetchMock).length);
		await expectFailureSurfaced(section);
		await waitFor(() => {
			expect(qa(section, 'work-row').length).toBe(2);
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 — saved is distinguishable: the #267-shape live region
// ═════════════════════════════════════════════════════════════════════════════

describe('#324 — event page: a settled write is distinguishable from silence', () => {
	it('the status live region is MOUNTED with the section (role=status, aria-live=polite, blank) and carries the saved message once a status change settles — with no alert', async () => {
		installWorld();
		const { container } = renderPage();
		const section = await worksSection(container, 2);

		// Mounted BEFORE any write — a live region announces only changes.
		const status = manageStatus(section);
		expect(status, 'the saved live region must mount with the section').not.toBeNull();
		expect(status!.getAttribute('role')).toBe('status');
		expect(status!.getAttribute('aria-live')).toBe('polite');
		expect(status!.textContent?.trim()).toBe('');

		await fireEvent.click(q(rowByName(section, 'Bogoróditse Djévo'), 'work-status-retired')!);

		// The write itself lands (harness evidence, passes today)…
		await waitFor(() => {
			expect(rowByName(section, 'Bogoróditse Djévo').getAttribute('data-status')).toBe('retired');
		});
		// …and the settle must SAY so (the #324 cue).
		await waitFor(() => {
			expect(savedText(section)).toContain('[repertoire_manage_saved]');
		});
		expect(manageAlert(section)).toBeNull();
	});

	it('a settled ADD WORK says saved too — alongside the refetched row', async () => {
		installWorld();
		const { container } = renderPage();
		const section = await worksSection(container, 2);

		const select = q(section, 'work-manage-add-work-select') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'w-3' } });
		await fireEvent.click(q(section, 'work-manage-add-work-button')!);

		// The create lands and the refetch shows it (harness evidence)…
		await waitFor(() => {
			expect(qa(section, 'work-row').length).toBe(3);
		});
		// …and the settle must SAY so.
		await waitFor(() => {
			expect(savedText(section)).toContain('[repertoire_manage_saved]');
		});
		expect(manageAlert(section)).toBeNull();
	});

	it('a fresh attempt clears the old alert; its success says saved — never a stale alert, never a stale saved beside a failure', async () => {
		let failing = true;
		installWorld({ failWrites: () => failing });
		const { container } = renderPage();
		const section = await worksSection(container, 2);

		await fireEvent.click(q(rowByName(section, 'Bogoróditse Djévo'), 'work-status-retired')!);
		await expectFailureSurfaced(section);
		// The failed attempt must never read as saved.
		expect(savedText(section)).not.toContain('[repertoire_manage_saved]');

		failing = false;
		await waitFor(() => {
			// rollback settled — the control is live again.
			expect(
				(q(rowByName(section, 'Bogoróditse Djévo'), 'work-status-retired') as HTMLButtonElement)
					.disabled
			).toBe(false);
		});
		await fireEvent.click(q(rowByName(section, 'Bogoróditse Djévo'), 'work-status-retired')!);

		await waitFor(() => {
			expect(manageAlert(section), 'trying again retires the old alert').toBeNull();
			expect(savedText(section)).toContain('[repertoire_manage_saved]');
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 — the cues belong to the event they were raised over
// ═════════════════════════════════════════════════════════════════════════════
//
// #324 review F1 — both signals are per-SUBJECT claims, so they go down with
// the rest of the compose state in `resetComposeState` (the page's own
// `resetSeriesState` clears `seriesError`/`seriesStatus` for exactly this
// reason). A subject switch here is a COLLECTIVE switch — the reactive half of
// the page's one load effect (`void selected; void eventId`), the same probe
// page.series-picker.spec.ts uses; the route-param half runs the identical
// teardown.

describe('#324 — the failure/saved cues do not outlive their event', () => {
	it('a rejected write does not caption the NEXT event’s works section', async () => {
		installWorld({ failWrites: () => true });
		const { container } = renderPage(['polyphony', 'crede']);
		const section = await worksSection(container, 2);

		await fireEvent.click(q(rowByName(section, 'Bogoróditse Djévo'), 'work-status-retired')!);
		await expectFailureSurfaced(section);

		selectedCollectiveDbStore.set('crede');
		await waitFor(() => {
			expect(q(container, 'event-detail-name')?.textContent).toContain('Crede Rehearsal');
		});
		const next = await worksSection(container, 1);
		expect(q(next, 'work-name')?.textContent?.trim()).toBe('Nunc dimittis');

		expect(manageAlert(next), 'the event being left takes its failure with it').toBeNull();
		expect(savedText(next).trim()).toBe('');
	});

	it('a settled write’s saved cue does not follow the viewer to the next event either', async () => {
		installWorld();
		const { container } = renderPage(['polyphony', 'crede']);
		const section = await worksSection(container, 2);

		await fireEvent.click(q(rowByName(section, 'Bogoróditse Djévo'), 'work-status-retired')!);
		await waitFor(() => {
			expect(savedText(section)).toContain('[repertoire_manage_saved]');
		});

		selectedCollectiveDbStore.set('crede');
		await waitFor(() => {
			expect(q(container, 'event-detail-name')?.textContent).toContain('Crede Rehearsal');
		});
		const next = await worksSection(container, 1);

		expect(
			savedText(next).trim(),
			'the live region must not still read “saved” for an older event'
		).toBe('');
		expect(manageAlert(next)).toBeNull();
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 5 — locales: the saved key is NEW (four locales); the failure key already
//     exists and must keep existing
// ═════════════════════════════════════════════════════════════════════════════

describe('#324 — locale files', () => {
	it.each(['en', 'et', 'lv', 'uk'] as const)(
		'%s.json carries repertoire_manage_saved (new) and repertoire_manage_error (existing), both non-empty',
		(locale) => {
			const messages = JSON.parse(
				readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
			) as Record<string, unknown>;
			for (const key of ['repertoire_manage_saved', 'repertoire_manage_error']) {
				const value = messages[key];
				expect(typeof value, `${locale}.json must carry ${key}`).toBe('string');
				expect((value as string).trim().length, `${locale} ${key} must be non-empty`).toBeGreaterThan(
					0
				);
			}
		}
	);
});

// (*MVOX:Tallis* — #324 RED: repertoire/programme write failure + saved cue on
// the event detail page; sibling suite: page.season-repertoire-write-failure.spec.ts)
