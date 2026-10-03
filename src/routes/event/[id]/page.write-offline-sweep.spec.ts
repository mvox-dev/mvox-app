// @vitest-environment happy-dom

// The structural offline fence: for a viewer holding every right, go offline, operate every
// enabled control, and assert no non-GET reached the wire. A missed control fails here
// instead of passing silently. Only the global fetch is stubbed.
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

const NOW = new Date('2026-08-20T10:00:00.000Z');
beforeEach(() => {
	setToken('jwt-editor');
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	fakeByteStore.current = createFakeByteStore();
});

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
// happy-dom has no IndexedDB; the page's file-presence/retention duties reach
// persistence only through getAppByteStore(). The shared in-memory double the
// other page-wiring specs use stands in, so this file's console stays clean.
const { fakeByteStore } = vi.hoisted(() => ({ fakeByteStore: { current: null as unknown } }));
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore.current }));

import Page from './+page.svelte';
import { createFakeByteStore } from '$lib/testing/byteStoreFakes';
import { setToken } from '$lib/auth/storage';
import {
	goOffline,
	goOnline,
	resetOnLine,
	settle,
	nonGetCalls,
	isWriteDisabled,
	exerciseEveryEnabledControl
} from '$lib/testing/networkSignal';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

// ── fixtures ──────────────────────────────────────────────────────────────────
// The viewer (`p-viewer`) is `_owner` on the event and `_editor` on the season, so every
// gated surface renders.

const EVENT = {
	_id: 'ev1',
	event_name: [{ _id: 'val-name-1', string: 'Tuesday Rehearsal' }],
	event_type: [{ _id: 'val-type-1', string: 'rehearsal' }],
	start_datetime: [{ _id: 'val-start-1', datetime: '2026-09-01T16:00:00.000Z' }],
	duration_minutes: [{ _id: 'val-dur-1', number: 90 }],
	location: [{ _id: 'val-loc-1', string: 'Rehearsal Hall' }],
	description: [{ _id: 'val-desc-1', string: 'Come early.' }],
	capacity: [{ _id: 'val-cap-1', number: 20 }],
	_owner: [{ reference: 'p-viewer' }],
	_editor: [{ reference: 'p-viewer' }],
	_parent: [
		{ reference: 'org1', entity_type: 'organization' },
		{ reference: 'season1', entity_type: 'season' }
	]
};

const SEASON = {
	_id: 'season1',
	name: [{ string: '2026/27' }],
	start_date: [{ date: '2026-08-01' }],
	end_date: [{ date: '2027-06-30' }],
	_owner: [{ reference: 'p-viewer' }],
	_editor: [{ reference: 'p-viewer' }]
};

const SERIES = {
	_id: 'series1',
	name: [{ string: 'Tuesday Series' }],
	duration_minutes: [{ number: 120 }],
	default_location: [{ string: 'Church Hall' }],
	_owner: [{ reference: 'p-viewer' }],
	_parent: [{ reference: 'season1', entity_type: 'season' }]
};

const SCHEDULE_ITEM = {
	_id: 'sch1',
	name: [{ _id: 'val-sch-name', string: 'Warm-up' }],
	datetime: [{ _id: 'val-sch-dt', datetime: '2026-09-01T15:30:00.000Z' }],
	_parent: [{ reference: 'ev1', entity_type: 'event' }]
};

const WORK = { _id: 'work1', name: [{ string: 'Missa Brevis' }], composer: [{ string: 'Palestrina' }] };
const EDITION = {
	_id: 'ed1',
	name: [{ string: 'Carus 1998' }],
	publisher: [{ string: 'Carus' }],
	_parent: [{ reference: 'work1', entity_type: 'work' }]
};
const REPERTOIRE_ITEM = {
	_id: 'rep1',
	work: [{ reference: 'work1', string: 'Missa Brevis' }],
	status: [{ string: 'active' }],
	_parent: [{ reference: 'season1', entity_type: 'season' }]
};
const PROGRAM_ITEM = {
	_id: 'prog1',
	edition: [{ reference: 'ed1', string: 'Carus 1998' }],
	ordinal: [{ number: 0 }],
	_parent: [{ reference: 'ev1', entity_type: 'event' }]
};
const MEMBER = {
	_id: 'mem1',
	person: [{ reference: 'p-viewer', string: 'Viewer' }],
	_parent: [{ reference: 'org1', entity_type: 'organization' }]
};

/** A liberal read router keyed on the url. Any non-GET is recorded and answered 200:
 *  failing it would hide the very calls this fence exists to see. */
function wireStub() {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = (init?.method ?? 'GET').toUpperCase();
		if (method !== 'GET') return json({});
		if (url.includes('/entity/ev1')) return json({ entity: EVENT });
		if (url.includes('/entity/season1')) return json({ entity: SEASON });
		if (url.includes('/entity/series1')) return json({ entity: SERIES });
		if (url.includes('/entity/work1')) return json({ entity: WORK });
		if (url.includes('/entity/ed1')) return json({ entity: EDITION });
		if (url.includes('_type.string=schedule_item')) return json({ entities: [SCHEDULE_ITEM] });
		if (url.includes('_type.string=repertoire_item')) return json({ entities: [REPERTOIRE_ITEM] });
		if (url.includes('_type.string=program_item')) return json({ entities: [PROGRAM_ITEM] });
		if (url.includes('_type.string=event_series')) return json({ entities: [SERIES] });
		if (url.includes('_type.string=season')) return json({ entities: [SEASON] });
		if (url.includes('_type.string=event')) return json({ entities: [EVENT] });
		if (url.includes('_type.string=work')) return json({ entities: [WORK] });
		if (url.includes('_type.string=edition')) return json({ entities: [EDITION] });
		if (url.includes('_type.string=member')) return json({ entities: [MEMBER] });
		return json({ entities: [] });
	});
}

function renderEventPage() {
	const stub = wireStub();
	vi.stubGlobal('fetch', stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	signIn({
		token: 'jwt-editor',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p-viewer' }]
	});
	return { ...render(Page), fetchStub: stub };
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	resetOnLine();
	resetAppState();
});

describe('/event/[id] — no write control reaches the wire offline (#434 slice 6 fence)', () => {
	it('offline: operating every enabled control issues no non-GET', async () => {
		await goOnline();
		const { container, fetchStub } = renderEventPage();
		// The page is fully loaded when its own editor affordances are up.
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-btn-name"]')).not.toBeNull();
			expect(container.querySelector('[data-testid="event-detail-delete"]')).not.toBeNull();
		});
		await settle();

		await goOffline();
		await settle();
		const before = fetchStub.mock.calls.length;

		const touched = await exerciseEveryEnabledControl(container);

		// Not a vacuous pass: the sweep really did find live controls to operate
		// (the read-only ones — collapse toggles, view switches — are enabled by
		// design and are most of this count).
		expect(touched.length).toBeGreaterThan(5);
		expect(nonGetCalls(fetchStub)).toEqual([]);
		// Every gated write control is a control the sweep SKIPPED, so the page
		// must still be showing at least one offline reason for them.
		expect(
			container.querySelectorAll('[data-testid$="-write-unavailable"]').length
		).toBeGreaterThan(0);
		// Reads may keep happening (the read layer is not gated); writes may not.
		expect(fetchStub.mock.calls.length).toBeGreaterThanOrEqual(before);
	});

	it('the controls the review found live are disabled offline, and say why', async () => {
		await goOnline();
		const { container } = renderEventPage();
		await waitFor(() =>
			expect(container.querySelector('[data-testid="event-detail-delete"]')).not.toBeNull()
		);
		await goOffline();

		// Named, so a regression reads as "the event delete came back" rather than
		// "the sweep went red somewhere".
		await waitFor(() => {
			for (const testid of [
				'event-detail-delete',
				'event-series-select',
				'event-schedule-edit-sch1',
				'event-schedule-remove-sch1'
			]) {
				const el = container.querySelector(`[data-testid="${testid}"]`);
				expect(el, testid).not.toBeNull();
				expect(isWriteDisabled(el!), testid).toBe(true);
			}
		});
		// …and the schedule section says why, once.
		expect(
			container.querySelectorAll('[data-testid="event-schedule-write-unavailable"]')
		).toHaveLength(1);
	});
});

// (*MVOX:Josquin*)
