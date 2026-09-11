// @vitest-environment happy-dom
//
// #328 RED — the SCHEDULE ITEMS leg of the partials trio: the event detail
// page's schedule section (scheduleQueue) surfaces failure per row
// (event-schedule-error-{id} role="alert", its own #262 review fix) and says
// NOTHING when a write lands. The saved state gets its own cue.
//
// INTEGRATION posture: the REAL page (+page.svelte) with the REAL data layer
// running — only the global fetch is stubbed at the wire (the
// page.schedule.spec.ts harness family).
//
// CONTRACT (issue #328 + Gama's one-shape/one-node-per-surface ruling,
// #328 comment 5637755878):
//   - CUE SHAPE — the family shape (#324/#325/#326/#327): a PERSISTENT
//     role="status" aria-live="polite" region, mounted (empty) with the
//     editor's schedule section, text set only when a row/key's write
//     RECONCILES (scheduleQueue.reconcile — add, per-row edit, remove all
//     announce), cleared by the time the next attempt is in flight — never on
//     a timer. Visible vs sr-only is GREEN's stated choice (the family holds
//     both); these specs pin the live-region mechanics, not the class.
//   - OWN NODE — data-testid="event-schedule-status", ONE region for the
//     schedule surface, and NOT the event-field leg's event-edit-status nor
//     #324's repertoire-manage-status: three queues on one page, three
//     regions — a shared node would announce another queue's settle.
//   - TEXT — event_schedule_saved (mirrors this surface's own failure key
//     event_schedule_save_error; four-locale copy pinned by
//     src/lib/i18n/trioSavedKeys.spec.ts).
//   - LATE-SETTLE GUARD (stated choice per the PO build note, #328 review
//     R2-F1: this surface FOLLOWS the page's own generation capture-compare —
//     `writeGenerations`/`attendanceWriteGenerations`, the same answer #325
//     threads on the season leg and the event-field leg now threads too, not a
//     fourth invention). Each write records the load `generation` it STARTED
//     under in `scheduleWriteGenerations` (in `setPending`) and the reconcile
//     announces only when that still matches: `resetComposeState` blanks the
//     region AT a collective/event switch, but cannot stop a write already in
//     flight.
//   - REFUSAL CLEARS (#328 review R2-F2) — a pre-write refusal (an emptied row
//     name, the add form's missing name/datetime) is an attempt too: it clears
//     the region rather than letting an earlier write's "saved" stand beside it.
//   - FAILURE BYTE-PRESERVED — the per-row rollback + event-schedule-error-{id}
//     role="alert" (event_schedule_save_error) semantics are the #262 review
//     fix and stay byte-identical; a revert earns NO saved announcement, and
//     another row's reconcile never clears a standing row alert.
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
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
import { fillDateTime } from '$lib/testing/timeControls';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

// ── Entu fixtures (the page.schedule family's editor view) ────────────────────

function eventEntity() {
	return {
		_id: 'ev1',
		name: [{ _id: 'val-name-1', string: 'Tuesday Rehearsal' }],
		event_type: [{ _id: 'val-type-1', string: 'rehearsal' }],
		start_datetime: [{ _id: 'val-start-1', datetime: '2026-09-01T16:00:00.000Z' }],
		duration_minutes: [{ _id: 'val-dur-1', number: 90 }],
		location: [{ _id: 'val-loc-1', string: 'Rehearsal Hall' }],
		description: [{ _id: 'val-desc-1', string: 'Come 15 minutes early.' }],
		capacity: [{ _id: 'val-cap-1', number: 20 }],
		_editor: [{ reference: 'p-viewer' }],
		_parent: [
			{ reference: 'org1', entity_type: 'organization' },
			{ reference: 'season1', entity_type: 'season' },
			{ reference: 'series1', entity_type: 'event_series' }
		]
	};
}

function seasonEntity() {
	return {
		_id: 'season1',
		name: [{ string: '2026/27' }],
		start_date: [{ date: '2026-08-01' }],
		conductor: [{ reference: 'p-mihkel' }]
	};
}

function seriesEntity() {
	return {
		_id: 'series1',
		name: [{ string: 'Tuesday Series' }],
		duration_minutes: [{ number: 120 }]
	};
}

const PROFILES: Record<string, unknown[]> = {
	'p-mihkel': [
		{ _id: 'prof-m', name: [{ string: 'Mihkel Putrinš' }], _sharing: [{ string: 'domain' }] }
	]
};

function scheduleEntity(id: string, name: string, iso: string) {
	return {
		_id: id,
		name: [{ _id: `val-${id}-name`, string: name }],
		datetime: [{ _id: `val-${id}-dt`, datetime: iso }]
	};
}

function defaultScheduleEntities() {
	return [
		scheduleEntity('si1', 'kogunemine', '2026-09-01T14:30:00.000Z'), // 17:30 Tallinn
		scheduleEntity('si2', 'proov', '2026-09-01T15:00:00.000Z') // 18:00 Tallinn
	];
}

/** Per-test mutable wire controls, read AT CALL TIME — one rendered page can
 *  carry a failing write, then a clean one, then a held one. */
type WireControls = {
	/** While true, the ITEM-scoped writes (replace-choreography POST and the
	 *  entity DELETE) answer 500 — the #262 failItemWrites shape. */
	failItemWrites: boolean;
	/** While set, every item-scoped POST awaits this gate. */
	holdItemPost: Promise<void> | null;
};

function scheduleWireStub(controls: WireControls) {
	const event = eventEntity();
	const season = seasonEntity();
	const series = seriesEntity();
	let schedule: Array<Record<string, unknown>> = defaultScheduleEntities();
	const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
		if (method === 'DELETE' && url.includes('/entity/')) {
			if (controls.failItemWrites) return json({ error: 'nope' }, 500);
			const id = url.match(/\/entity\/([^/?]+)/)?.[1] ?? '';
			schedule = schedule.filter((s) => s._id !== id);
			return json({ deleted: true });
		}
		if (url.includes('name.string=schedule_item')) {
			return json({ entities: [{ _id: 'type-schedule-item' }] });
		}
		if (url.includes('_type.string=schedule_item')) {
			return json({ entities: schedule });
		}
		if (method === 'POST' && /\/entity(\?|$)/.test(url)) {
			// A create — apply it so the reconcile's refetch sees the new item.
			const props = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
			const name = props.find((p) => p.type === 'name');
			const datetime = props.find((p) => p.type === 'datetime');
			schedule = [
				...schedule,
				scheduleEntity('si-new', String(name?.string ?? ''), String(datetime?.datetime ?? ''))
			];
			return json({ _id: 'si-new' });
		}
		if (method === 'POST' && url.includes('/entity/')) {
			if (controls.holdItemPost) await controls.holdItemPost;
			if (controls.failItemWrites) return json({ error: 'nope' }, 500);
			const id = url.match(/\/entity\/([^/?]+)/)?.[1] ?? '';
			const props = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
			schedule = schedule.map((s) => {
				if (s._id !== id) return s;
				const next = { ...s };
				for (const prop of props) {
					const { type, ...valueParts } = prop;
					next[String(type)] = [{ _id: `val-${id}-${String(type)}-new`, ...valueParts }];
				}
				return next;
			});
			return json({});
		}
		if (url.includes('/entity/ev1')) return json({ entity: event });
		if (url.includes('/entity/si')) {
			const id = url.match(/\/entity\/([^/?]+)/)?.[1] ?? '';
			return json({ entity: schedule.find((s) => s._id === id) ?? {} });
		}
		if (url.includes('/entity/season1')) return json({ entity: season });
		if (url.includes('/entity/series1')) return json({ entity: series });
		if (url.includes('_type.string=profile')) {
			for (const [personId, list] of Object.entries(PROFILES)) {
				if (url.includes(personId) || url.includes(encodeURIComponent(personId)))
					return json({ entities: list });
			}
			return json({ entities: [] });
		}
		if (url.includes('_type.string=season')) return json({ entities: [season] });
		if (url.includes('_type.string=event_series')) return json({ entities: [series] });
		if (url.includes('_type.string=event')) return json({ entities: [event] });
		return json({ entities: [] });
	});
	return stub;
}

/** `dbs` — the page.schedule.spec.ts shape: a SECOND collective makes a
 *  subject switch reachable (the reactive half of the page's one load effect).
 *  The wire answers both dbs from the same fixture set; what the switch changes
 *  is the load `generation`, which is the thing under test. */
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

function renderSchedulePage(dbs: string[] = ['polyphony']) {
	const controls: WireControls = { failItemWrites: false, holdItemPost: null };
	const stub = scheduleWireStub(controls);
	vi.stubGlobal('fetch', stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthed(dbs);
	const rendered = render(Page);
	return { ...rendered, fetchStub: stub, controls };
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	resetTypeIdCache();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function scheduleSection(container: HTMLElement): HTMLElement | null {
	return q(container, 'event-detail-schedule');
}

async function waitReady(container: HTMLElement) {
	await waitFor(() => {
		expect(q(container, 'event-detail-name')?.textContent).toContain('Tuesday Rehearsal');
	});
}

async function openRowEditor(container: HTMLElement, id: string): Promise<void> {
	await waitFor(() => {
		expect(q(container, `event-schedule-edit-${id}`)).not.toBeNull();
	});
	await fireEvent.click(q(container, `event-schedule-edit-${id}`)!);
	await waitFor(() => {
		expect(q(container, `event-schedule-edit-name-${id}`)).not.toBeNull();
	});
}

async function commitRowNameEdit(container: HTMLElement, id: string, value: string): Promise<void> {
	await openRowEditor(container, id);
	const nameInput = q(container, `event-schedule-edit-name-${id}`)!;
	await fireEvent.input(nameInput, { target: { value } });
	await fireEvent.blur(nameInput);
}

/** A gate the test opens by hand — the in-flight window under test. */
function gate(): { promise: Promise<void>; release: () => void } {
	let release!: () => void;
	const promise = new Promise<void>((r) => {
		release = r;
	});
	return { promise, release };
}

// ── the region: persistent, own node, empty at rest — and THREE distinct nodes ─

describe('#328 schedule items — the saved-cue region exists from first render', () => {
	it('editor view: a PERSISTENT empty role="status" aria-live="polite" region (event-schedule-status) is mounted BEFORE any write, exactly one', async () => {
		const { container } = renderSchedulePage();
		await waitReady(container);
		await waitFor(() => {
			expect(scheduleSection(container)).not.toBeNull();
		});

		const status = q(container, 'event-schedule-status');
		expect(status, 'expected the persistent event-schedule-status region').not.toBeNull();
		expect(status!.getAttribute('role')).toBe('status');
		expect(status!.getAttribute('aria-live')).toBe('polite');
		expect(status!.textContent?.trim()).toBe('');
		expect(container.querySelectorAll('[data-testid="event-schedule-status"]')).toHaveLength(1);
	});

	it('one node per SURFACE (Gama’s ruling): event-schedule-status, event-edit-status and #324’s repertoire-manage-status are three DISTINCT nodes on this one page', async () => {
		const { container } = renderSchedulePage();
		await waitReady(container);
		await waitFor(() => {
			expect(q(container, 'event-schedule-status')).not.toBeNull();
			expect(q(container, 'event-edit-status')).not.toBeNull();
			expect(q(container, 'repertoire-manage-status')).not.toBeNull();
		});
		const nodes = [
			q(container, 'event-schedule-status'),
			q(container, 'event-edit-status'),
			q(container, 'repertoire-manage-status')
		];
		expect(new Set(nodes).size, 'three queues, three regions — never a shared node').toBe(3);
	});
});

// ── the cue: every write kind's reconcile announces ────────────────────────────

describe('#328 schedule items — a write that reconciles announces saved', () => {
	it('row name edit: NOTHING announced while the POST is held open; the settle sets event_schedule_saved into event-schedule-status; no row alert', async () => {
		const { container, controls } = renderSchedulePage();
		await waitReady(container);

		const g = gate();
		controls.holdItemPost = g.promise;
		await commitRowNameEdit(container, 'si1', 'kutse');

		// The write is in flight — the cue must NOT have fired yet.
		await new Promise((r) => setTimeout(r, 10));
		expect(q(container, 'event-schedule-status')?.textContent?.trim()).toBe('');

		g.release();
		controls.holdItemPost = null;
		await waitFor(() => {
			expect(q(container, 'event-schedule-status')?.textContent).toContain(
				'[event_schedule_saved]'
			);
		});
		expect(q(container, 'event-schedule-error-si1')).toBeNull();
	});

	it('ADD: submitting the add form announces once the create reconciles (the refetch-and-close reconcile path announces too)', async () => {
		const { container } = renderSchedulePage();
		await waitReady(container);
		await waitFor(() => {
			expect(q(container, 'event-schedule-add')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'event-schedule-add')!);
		await waitFor(() => {
			expect(q(container, 'event-schedule-add-name')).not.toBeNull();
		});
		await fireEvent.input(q(container, 'event-schedule-add-name')!, {
			target: { value: 'kontsert' }
		});
		await fillDateTime(container, 'event-schedule-add-datetime', '2026-09-01', '19:00');
		await fireEvent.click(q(container, 'event-schedule-add-submit')!);

		await waitFor(() => {
			expect(q(container, 'event-schedule-status')?.textContent).toContain(
				'[event_schedule_saved]'
			);
		});
		// The reconcile's own choreography stands byte-identical: refetched row
		// on screen, form closed.
		await waitFor(() => {
			expect(scheduleSection(container)!.textContent).toContain('kontsert');
		});
		expect(q(container, 'event-schedule-add-name')).toBeNull();
	});

	it('REMOVE: confirming a removal announces once the delete reconciles', async () => {
		const { container } = renderSchedulePage();
		await waitReady(container);
		await waitFor(() => {
			expect(q(container, 'event-schedule-remove-si2')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'event-schedule-remove-si2')!);
		await waitFor(() => {
			expect(q(container, 'event-schedule-remove-confirm-si2')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'event-schedule-remove-confirm-si2')!);

		await waitFor(() => {
			expect(q(container, 'event-schedule-status')?.textContent).toContain(
				'[event_schedule_saved]'
			);
		});
		await waitFor(() => {
			expect(scheduleSection(container)!.textContent).not.toContain('proov');
		});
	});
});

// ── failure: the #262 per-row alerts byte-preserved, and NO cue ────────────────

describe('#328 schedule items — failure handling stays byte-identical', () => {
	it('a rejected name edit still rolls the row back and renders event-schedule-error-si1 role="alert" (event_schedule_save_error) — and event-schedule-status announces NOTHING', async () => {
		const { container, controls } = renderSchedulePage();
		await waitReady(container);
		controls.failItemWrites = true;

		await commitRowNameEdit(container, 'si1', 'kutse');
		await waitFor(() => {
			const alert = q(container, 'event-schedule-error-si1');
			expect(alert, 'the #262 per-row alert must stand, unchanged').not.toBeNull();
			expect(alert!.getAttribute('role')).toBe('alert');
			expect(alert!.textContent).toContain('[event_schedule_save_error]');
		});
		// The rollback still happened — the row shows its ORIGINAL name.
		expect(scheduleSection(container)!.textContent).toContain('kogunemine');
		expect(scheduleSection(container)!.textContent).not.toContain('kutse');
		// Failure and saved are mutually exclusive.
		expect(q(container, 'event-schedule-status')?.textContent?.trim()).toBe('');
	});

	it('PER-ROW + latest-write: si1’s standing alert survives si2’s successful edit, which announces saved; a NEXT attempt starts with the region blank again', async () => {
		const { container, controls } = renderSchedulePage();
		await waitReady(container);

		// 1 — si1 fails: its row alert stands.
		controls.failItemWrites = true;
		await commitRowNameEdit(container, 'si1', 'kutse');
		await waitFor(() => {
			expect(q(container, 'event-schedule-error-si1')).not.toBeNull();
		});

		// 2 — si2 succeeds: ITS reconcile announces, si1's alert stays.
		controls.failItemWrites = false;
		await commitRowNameEdit(container, 'si2', 'peaproov');
		await waitFor(() => {
			expect(q(container, 'event-schedule-status')?.textContent).toContain(
				'[event_schedule_saved]'
			);
		});
		expect(
			q(container, 'event-schedule-error-si1'),
			'another row’s reconcile must not clear this row’s alert'
		).not.toBeNull();

		// 3 — a fresh attempt clears the stale cue at its start: hold si2's next
		// write open and check the region is blank while it is in flight.
		const g = gate();
		controls.holdItemPost = g.promise;
		await commitRowNameEdit(container, 'si2', 'kindralproov');
		await new Promise((r) => setTimeout(r, 10));
		expect(q(container, 'event-schedule-status')?.textContent?.trim()).toBe('');
		g.release();
		controls.holdItemPost = null;
		await waitFor(() => {
			expect(q(container, 'event-schedule-status')?.textContent).toContain(
				'[event_schedule_saved]'
			);
		});
	});
});

// ── the cue belongs to the event it was announced over ────────────────────────
//
// #328 review R2-F1 — `resetComposeState` blanks `scheduleStatus` AT a subject
// switch, but it cannot stop a write already in flight. The reconcile therefore
// carries the page's own generation capture-compare
// (`scheduleWriteGenerations`, the twin of `writeGenerations`/
// `attendanceWriteGenerations`/`editWriteGenerations`) so a settle belonging to
// the event being LEFT announces nothing on the one now on screen.

describe('#328 schedule items — a late settle never announces onto the NEXT event', () => {
	it('a row name edit still IN FLIGHT when the editor switches collectives announces NOTHING when it lands: the region stays blank', async () => {
		const { container, controls } = renderSchedulePage(['polyphony', 'crede']);
		await waitReady(container);
		await waitFor(() => {
			expect(scheduleSection(container)?.textContent).toContain('kogunemine');
		});

		const g = gate();
		controls.holdItemPost = g.promise;
		await commitRowNameEdit(container, 'si1', 'sissejuhatus');
		// The write is open — nothing announced yet, by construction.
		expect(q(container, 'event-schedule-status')?.textContent?.trim()).toBe('');

		selectedCollectiveDbStore.set('crede');
		await waitFor(() => {
			expect(scheduleSection(container)?.textContent).toContain('kogunemine');
		});
		expect(q(container, 'event-schedule-status')?.textContent?.trim()).toBe('');

		// …and only NOW does the polyphony write land.
		controls.holdItemPost = null;
		g.release();
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));

		expect(
			q(container, 'event-schedule-status')?.textContent?.trim(),
			'a late settle must not announce “saved” onto the event the editor has moved to'
		).toBe('');
		expect(q(container, 'event-schedule-error-si1')).toBeNull();
	});
});

// ── a refusal is an attempt too ───────────────────────────────────────────────

describe('#328 schedule items — a pre-write refusal clears the region', () => {
	it('#328 review R2-F2 — an emptied row name is REFUSED before any write, and the region no longer reads “saved” from the earlier write beside it', async () => {
		const { container, fetchStub } = renderSchedulePage();
		await waitReady(container);

		// A real write first, so the region genuinely reads "saved".
		await commitRowNameEdit(container, 'si1', 'sissejuhatus');
		await waitFor(() => {
			expect(q(container, 'event-schedule-status')?.textContent).toContain(
				'[event_schedule_saved]'
			);
		});
		const postsBefore = fetchStub.mock.calls.filter(
			(c) => (c[1] as RequestInit | undefined)?.method === 'POST'
		).length;

		// Now empty si2's name — a refusal, no wire call (#262 review F4).
		await commitRowNameEdit(container, 'si2', '   ');
		await waitFor(() => {
			expect(q(container, 'event-schedule-error-si2')?.textContent).toContain(
				'[event_schedule_name_required]'
			);
		});
		expect(
			fetchStub.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST')
		).toHaveLength(postsBefore);
		expect(q(container, 'event-schedule-status')?.textContent?.trim()).toBe('');
	});

	it('#328 review R2-F2 — the ADD form’s own refusals clear the region the same way', async () => {
		const { container } = renderSchedulePage();
		await waitReady(container);

		await commitRowNameEdit(container, 'si1', 'sissejuhatus');
		await waitFor(() => {
			expect(q(container, 'event-schedule-status')?.textContent).toContain(
				'[event_schedule_saved]'
			);
		});

		await fireEvent.click(q(container, 'event-schedule-add')!);
		await waitFor(() => {
			expect(q(container, 'event-schedule-add-name')).not.toBeNull();
		});
		// Name left blank — refused, naming its own box.
		await fireEvent.click(q(container, 'event-schedule-add-submit')!);
		await waitFor(() => {
			expect(q(container, 'event-schedule-add-error')?.textContent).toContain(
				'[event_schedule_name_required]'
			);
		});
		expect(q(container, 'event-schedule-status')?.textContent?.trim()).toBe('');
	});
});

// (*MVOX:Tallis* — #328 RED; late-settle + refusal cases *MVOX:Byrd* — #328 review R2)
