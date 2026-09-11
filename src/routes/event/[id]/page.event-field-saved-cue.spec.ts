// @vitest-environment happy-dom
//
// #328 RED — the EVENT INLINE FIELD leg of the partials trio: the detail
// page's pencil/blur field edits (editWriteQueue) reconcile by clearing the
// field's error and settling focus — with no cue that the write LANDED. The
// saved state gets its own cue.
//
// INTEGRATION posture: the REAL page (+page.svelte) with the REAL data layer
// running — only the global fetch is stubbed at the wire (the
// page.event-editing.spec.ts harness family). This is what forces GREEN to
// wire the cue into the actual route, not a satellite component.
//
// CONTRACT (issue #328 + Gama's one-shape/one-node-per-surface ruling,
// #328 comment 5637755878):
//   - CUE SHAPE — the family shape (#324 repertoire-manage-status, #325
//     season-manage-conductor-status, #326 rsvp-saved-status, #327
//     attendance): a PERSISTENT role="status" aria-live="polite" region,
//     mounted (empty) from first render of the editor's view, text set only
//     when a field's write RECONCILES (editWriteQueue.reconcile — per FIELD
//     key), cleared by the time the next attempt is in flight — never on a
//     timer. Visible vs sr-only is GREEN's stated choice (both live in the
//     family); these specs pin the live-region mechanics, not the class.
//   - OWN NODE — data-testid="event-edit-status", ONE region for the whole
//     inline-field surface (all six fields), and NOT the #324
//     repertoire-manage-status node nor the schedule section's (#328's other
//     leg): a live region announces changes to ITS contents, so a shared node
//     would announce another queue's settle.
//   - TEXT — event_edit_saved (mirrors this surface's own failure key
//     event_edit_save_error; four-locale copy pinned by
//     src/lib/i18n/trioSavedKeys.spec.ts).
//   - PER-KEY — reconcile/revert are keyed per field; the cue follows the key
//     that settled and NEVER disturbs another field's standing error (the
//     existing per-field error independence stays byte-preserved).
//   - LATE-SETTLE GUARD (stated choice per the PO build note, #328 review
//     R2-F1: this surface FOLLOWS the page's own generation capture-compare —
//     `writeGenerations`/`attendanceWriteGenerations` — which is the same
//     answer #325 threads on the season leg, not a fourth invention). The
//     field write records the load `generation` it STARTED under in
//     `editWriteGenerations` (in `setPending`) and the reconcile announces
//     only when that still matches: `resetComposeState` blanks the region AT
//     a collective/event switch, but cannot stop a write already in flight, so
//     without the capture a save made on the event being LEFT announces
//     "saved" onto the one the editor has since moved to.
//   - REFUSAL CLEARS (#328 review R2-F2) — a pre-write refusal (the
//     duration_minutes range check) is an attempt too: it clears the region
//     rather than letting an earlier write's "saved" stand beside it.
//   - FAILURE BYTE-PRESERVED — a rejected write still reverts the display and
//     renders the same event-edit-error-{field} role="alert"; a revert earns
//     NO saved announcement.
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Pin "now" before the fixture event (2026-09-01) — same hygiene as
// page.event-editing.spec.ts: only Date is faked, timers stay real.
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
import { commitDateTime, fillDateTime } from '$lib/testing/timeControls';
import { authStore } from '$lib/auth/session';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

// ── Entu fixtures (the page.event-editing family's editor view) ───────────────

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

/** #328 review F1 — the OTHER collective's answer for the same event id: a
 *  different name, so "the switch happened" is readable off the page and the
 *  header it renders is unmistakably not the one the cue was announced over.
 *  Reads only; no test writes under it. */
function credeEventEntity() {
	return { ...eventEntity(), name: [{ _id: 'cval-name-1', string: 'Crede Rehearsal' }] };
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

/** Per-test mutable wire controls, read AT CALL TIME — so one rendered page
 *  can carry a held write, then a failing one, then a clean one. */
type WireControls = {
	/** While set, every edit POST against entity/ev1 awaits this gate. */
	holdEditPost: Promise<void> | null;
	/** While true, every edit POST against entity/ev1 answers 500. */
	failEditPost: boolean;
};

function editWireStub(controls: WireControls) {
	const event: Record<string, unknown> = eventEntity();
	const season = seasonEntity();
	const series = seriesEntity();
	const crede: Record<string, unknown> = credeEventEntity();
	const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		// The OTHER collective answers the SAME ids its own way — what makes a
		// collective switch on this page a genuine subject change (the reactive
		// half of the page's one load effect; the route-param half runs the
		// identical teardown).
		if (url.includes('/crede/')) {
			if (url.includes('/entity/ev1')) return json({ entity: crede });
			if (url.includes('/entity/season1')) return json({ entity: season });
			if (url.includes('/entity/series1')) return json({ entity: series });
			if (url.includes('_type.string=event')) return json({ entities: [crede] });
			return json({ entities: [] });
		}
		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
		if (url.includes('/entity/ev1') && method === 'POST') {
			if (controls.holdEditPost) await controls.holdEditPost;
			if (controls.failEditPost) return json({ message: 'boom' }, 500);
			const props = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
			for (const prop of props) {
				const { type, ...valueParts } = prop;
				event[String(type)] = [{ _id: `val-${String(type)}-new`, ...valueParts }];
			}
			return json({});
		}
		if (url.includes('/entity/ev1')) return json({ entity: event });
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

function setAuthedWithPolyphony(dbs: string[] = ['polyphony']) {
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

function renderEditPage(dbs: string[] = ['polyphony']) {
	const controls: WireControls = { holdEditPost: null, failEditPost: false };
	const stub = editWireStub(controls);
	vi.stubGlobal('fetch', stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithPolyphony(dbs);
	const rendered = render(Page);
	return { ...rendered, fetchStub: stub, controls };
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** Tap the field's pencil and hand back the input it becomes. */
async function beginEdit(
	container: HTMLElement,
	field: 'name' | 'location'
): Promise<HTMLInputElement> {
	await waitFor(() => {
		expect(q(container, `event-edit-btn-${field}`), `event-edit-btn-${field}`).not.toBeNull();
	});
	await fireEvent.click(q(container, `event-edit-btn-${field}`)!);
	return await waitFor(() => {
		const el = q(container, `event-edit-input-${field}`);
		expect(el, `event-edit-input-${field} missing after tapping edit`).not.toBeNull();
		return el as HTMLInputElement;
	});
}

async function commitEdit(
	container: HTMLElement,
	field: 'name' | 'location',
	value: string
): Promise<void> {
	const input = await beginEdit(container, field);
	await fireEvent.input(input, { target: { value } });
	await fireEvent.blur(input);
}

/** A gate the test opens by hand — the in-flight window under test. */
function gate(): { promise: Promise<void>; release: () => void } {
	let release!: () => void;
	const promise = new Promise<void>((r) => {
		release = r;
	});
	return { promise, release };
}

// ── the region: persistent, own node, empty at rest ────────────────────────────

describe('#328 event fields — the saved-cue region exists from first render', () => {
	it('editor view: a PERSISTENT empty role="status" aria-live="polite" region (event-edit-status) is mounted BEFORE any write — its own node, exactly one', async () => {
		const { container } = renderEditPage();
		await waitFor(() => {
			expect(q(container, 'event-edit-btn-name')).not.toBeNull();
		});

		const status = q(container, 'event-edit-status');
		expect(status, 'expected the persistent event-edit-status region').not.toBeNull();
		expect(status!.getAttribute('role')).toBe('status');
		expect(status!.getAttribute('aria-live')).toBe('polite');
		expect(status!.textContent?.trim()).toBe('');
		expect(container.querySelectorAll('[data-testid="event-edit-status"]')).toHaveLength(1);
	});
});

// ── the cue: reconcile announces, per field key ────────────────────────────────

describe('#328 event fields — a write that reconciles announces saved', () => {
	it('name blur-commit: NOTHING announced while the POST is held open; the settle sets event_edit_saved into event-edit-status; no error node', async () => {
		const { container, controls } = renderEditPage();
		const g = gate();
		controls.holdEditPost = g.promise;

		await commitEdit(container, 'name', 'Autumn Sing');
		// Optimistic: the header shows the value, the write is still open —
		// the cue must NOT have fired yet.
		await waitFor(() => {
			expect(q(container, 'event-detail-name')?.textContent).toContain('Autumn Sing');
		});
		expect(q(container, 'event-edit-status')?.textContent?.trim()).toBe('');

		g.release();
		controls.holdEditPost = null;
		await waitFor(() => {
			expect(q(container, 'event-edit-status')?.textContent).toContain('[event_edit_saved]');
		});
		expect(q(container, 'event-edit-error-name')).toBeNull();
	});

	it('the cue describes the LATEST write: blank again by the time a second field’s write is in flight, re-announced on its settle', async () => {
		const { container, controls } = renderEditPage();

		await commitEdit(container, 'name', 'Autumn Sing');
		await waitFor(() => {
			expect(q(container, 'event-edit-status')?.textContent).toContain('[event_edit_saved]');
		});

		const g = gate();
		controls.holdEditPost = g.promise;
		await commitEdit(container, 'location', 'Concert Hall');
		// Cleared at the start of the attempt — never a stale "saved" beside a
		// live write.
		expect(q(container, 'event-edit-status')?.textContent?.trim()).toBe('');

		g.release();
		controls.holdEditPost = null;
		await waitFor(() => {
			expect(q(container, 'event-edit-status')?.textContent).toContain('[event_edit_saved]');
		});
	});

	it('PER-KEY: a location reconcile announces saved while name’s standing error stays untouched (the existing per-field error independence, byte-preserved)', async () => {
		const { container, controls } = renderEditPage();

		// 1 — name fails: the existing per-field alert stands.
		controls.failEditPost = true;
		await commitEdit(container, 'name', 'Autumn Sing');
		await waitFor(() => {
			expect(q(container, 'event-edit-error-name')).not.toBeNull();
		});
		expect(q(container, 'event-edit-status')?.textContent?.trim()).toBe('');

		// 2 — location succeeds: ITS reconcile announces, name's alert stays.
		controls.failEditPost = false;
		await commitEdit(container, 'location', 'Concert Hall');
		await waitFor(() => {
			expect(q(container, 'event-edit-status')?.textContent).toContain('[event_edit_saved]');
		});
		expect(
			q(container, 'event-edit-error-name'),
			'another field’s reconcile must not clear this field’s error'
		).not.toBeNull();
	});
});

// ── failure: byte-preserved, and it earns NO cue ───────────────────────────────

describe('#328 event fields — failure handling stays byte-identical', () => {
	it('a rejected name write still reverts the header and renders event-edit-error-name role="alert" (event_edit_save_error) — and event-edit-status announces NOTHING', async () => {
		const { container, controls } = renderEditPage();
		controls.failEditPost = true;

		await commitEdit(container, 'name', 'Autumn Sing');
		await waitFor(() => {
			const alert = q(container, 'event-edit-error-name');
			expect(alert, 'expected the existing failure node, unchanged').not.toBeNull();
			expect(alert!.getAttribute('role')).toBe('alert');
			expect(alert!.textContent).toContain('[event_edit_save_error]');
		});
		// The revert stands.
		await waitFor(() => {
			expect(q(container, 'event-detail-name')?.textContent).toContain('Tuesday Rehearsal');
		});
		expect(q(container, 'event-detail-name')?.textContent).not.toContain('Autumn Sing');
		// Failure and saved are mutually exclusive.
		await flush();
		expect(q(container, 'event-edit-status')?.textContent?.trim()).toBe('');
	});

	it('#328 review R2-F2 — a pre-write REFUSAL (the #243 duration range check) clears the region: no stale “saved” standing beside the fresh refusal', async () => {
		const { container, fetchStub } = renderEditPage();

		// A real write first, so the region genuinely reads "saved".
		await commitEdit(container, 'name', 'Autumn Sing');
		await waitFor(() => {
			expect(q(container, 'event-edit-status')?.textContent).toContain('[event_edit_saved]');
		});
		const postsBefore = fetchStub.mock.calls.filter(
			(c) => (c[1] as RequestInit | undefined)?.method === 'POST'
		).length;

		// End BEFORE the start (19:00 Tallinn) — refused before any write.
		await waitFor(() => {
			expect(q(container, 'event-edit-btn-duration_minutes')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'event-edit-btn-duration_minutes')!);
		await waitFor(() => {
			expect(q(container, 'event-edit-input-duration_minutes')).not.toBeNull();
		});
		await fillDateTime(container, 'event-edit-input-duration_minutes', '2026-09-01', '18:00');
		await commitDateTime(container, 'event-edit-input-duration_minutes');

		await waitFor(() => {
			expect(q(container, 'event-edit-error-duration_minutes')?.textContent).toContain(
				'[event_end_before_start]'
			);
		});
		await flush();
		// Nothing was written…
		expect(
			fetchStub.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST')
		).toHaveLength(postsBefore);
		// …and the region does not still claim the EARLIER write's success beside it.
		expect(q(container, 'event-edit-status')?.textContent?.trim()).toBe('');
	});
});

// ── the cue belongs to the event it was announced over ────────────────────────
//
// #328 review F1 — the cue is a per-SUBJECT claim, so it goes down with the
// rest of the compose state in `resetComposeState`, exactly as this leg's own
// sibling `scheduleStatus` and #324's `manageStatus` already do. A subject
// switch here is a COLLECTIVE switch — the reactive half of the page's one
// load effect (`void selected; void eventId`); the route-param half runs the
// identical teardown.

describe('#328 event fields — the saved cue does not outlive its event', () => {
	it('a settled name write’s saved cue does not follow the editor to the NEXT event: the region is mounted and BLANK on arrival', async () => {
		const { container } = renderEditPage(['polyphony', 'crede']);

		await commitEdit(container, 'name', 'Autumn Sing');
		await waitFor(() => {
			expect(q(container, 'event-edit-status')?.textContent).toContain('[event_edit_saved]');
		});

		selectedCollectiveDbStore.set('crede');
		await waitFor(() => {
			expect(q(container, 'event-detail-name')?.textContent).toContain('Crede Rehearsal');
		});

		const status = q(container, 'event-edit-status');
		expect(status, 'expected the persistent region on the next event').not.toBeNull();
		expect(
			status!.textContent?.trim(),
			'the live region must not still read “saved” for a write made on an older event'
		).toBe('');
		expect(q(container, 'event-edit-error-name')).toBeNull();
	});

	it('a name write still IN FLIGHT when the editor switches collectives announces NOTHING when it lands: the new event’s region stays blank (editWriteGenerations gates the settle)', async () => {
		const { container, controls } = renderEditPage(['polyphony', 'crede']);
		const g = gate();
		controls.holdEditPost = g.promise;

		await commitEdit(container, 'name', 'Autumn Sing');
		// The write is open — nothing announced yet, by construction.
		await flush();
		expect(q(container, 'event-edit-status')?.textContent?.trim()).toBe('');

		selectedCollectiveDbStore.set('crede');
		await waitFor(() => {
			expect(q(container, 'event-detail-name')?.textContent).toContain('Crede Rehearsal');
		});
		expect(q(container, 'event-edit-status')?.textContent?.trim()).toBe('');

		// …and only NOW does the polyphony write land. `resetComposeState` blanked
		// the region AT the switch but cannot stop a write already in flight — the
		// generation capture-compare must swallow the announcement whole.
		controls.holdEditPost = null;
		g.release();
		await flush();

		expect(
			q(container, 'event-edit-status')?.textContent?.trim(),
			'a late settle must not announce “saved” onto the event the editor has moved to'
		).toBe('');
		expect(q(container, 'event-edit-error-name')).toBeNull();
		expect(q(container, 'event-detail-name')?.textContent).toContain('Crede Rehearsal');
	});
});

// (*MVOX:Tallis* — #328 RED; late-settle case *MVOX:Byrd* — #328 review R2-F1)
