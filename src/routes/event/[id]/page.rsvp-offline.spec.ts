// @vitest-environment happy-dom
//
// #434 slice 6/6 RED (event-page integration) — the event page's RSVP is
// gated while offline. The SAME RsvpControl the agenda row uses, so the gate
// arrives with the component; this pins that the event page's instance gets it
// too (the real +page.svelte, only global fetch stubbed at the wire, so an
// RSVP write is a real non-GET fetch).
//
// CONTRACT: with the signal ($lib/net/online) offline —
//   • every rsvp-btn-* in event-detail-rsvp is `disabled`;
//   • [data-testid="rsvp-write-unavailable"] = m.write_unavailable_no_signal()
//     is visible inside that section's rsvp-control;
//   • a click issues NO fetch at all;
//   • back online: enabled, the sentence gone, and a click reaches the wire.
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Pin "now" before the fixture event (2026-09-01) so the event is UPCOMING —
// only Date is faked, timers stay real so waitFor keeps polling.
const NOW = new Date('2026-08-20T10:00:00.000Z');
beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
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

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import {
	goOffline,
	goOnline,
	resetOnLine,
	settle,
	expectVisibleReason,
	nonGetCalls
} from '$lib/testing/networkSignal';

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

function seasonEntity() {
	return {
		_id: 'season1',
		name: [{ string: '2026/27' }],
		start_date: [{ date: '2026-08-01' }]
	};
}

/** The exact enablement read for this viewer — full URL, pinned byte-for-byte. */
const RIGHTS_URL = 'https://api.entu-test.invalid/sampledb/entity/p-viewer?props=_owner,_editor';

/** Person-entity rights fixtures — on the PERSON entity, never member rows. */
const SELF_EDITOR = { _id: 'p-viewer', _editor: [{ reference: 'p-viewer' }] };
/** Private-bucket case: a no-grant caller reads NO rights props at all. */
const NO_GRANT = { _id: 'p-viewer' };

type WireOpts = {
	/** The person-entity body the rights read answers with; 'hold' = in flight. */
	personRights?: unknown | 'hold';
	/** The member lookup: a row (member), [] (non-member) or 'hold' (in flight). */
	memberEntities?: unknown[] | 'hold';
};

function wireStub(opts: WireOpts = {}) {
	const memberEntities = opts.memberEntities ?? [{ _id: 'member-1' }];
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		void init;
		if (url === RIGHTS_URL) {
			if (opts.personRights === 'hold') return new Promise<Response>(() => {});
			return json({ entity: opts.personRights ?? NO_GRANT });
		}
		if (url.includes('/entity/ev1')) return json({ entity: eventEntity() });
		if (url.includes('/entity/season1')) return json({ entity: seasonEntity() });
		if (url.includes('_type.string=member') && url.includes('person.reference=p-viewer')) {
			if (memberEntities === 'hold') return new Promise<Response>(() => {});
			return json({ entities: memberEntities });
		}
		return json({ entities: [] });
	});
}

function setAuthed() {
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'p-viewer' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p-viewer' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
}

function renderPage(opts: WireOpts = {}) {
	const fetchStub = wireStub(opts);
	vi.stubGlobal('fetch', fetchStub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthed();
	const rendered = render(Page);
	return { ...rendered, fetchStub };
}

async function waitForRsvpSection(container: HTMLElement): Promise<HTMLElement> {
	return waitFor(() => {
		const section = container.querySelector('[data-testid="event-detail-rsvp"]');
		expect(section).not.toBeNull();
		return section as HTMLElement;
	});
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	resetTypeIdCache();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});


const REASON = '[write_unavailable_no_signal]';

afterEach(() => {
	resetOnLine();
});

async function renderWritable() {
	await goOnline();
	const { container, fetchStub } = renderPage({ personRights: SELF_EDITOR });
	const section = await waitForRsvpSection(container);
	await waitFor(() => {
		const btn = section.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
		expect(btn).not.toBeNull();
		expect(btn!.disabled).toBe(false);
	});
	return { container, section, fetchStub };
}

describe('/event/[id] — RSVP while offline (#434 slice 6)', () => {
	it('offline: the four buttons are disabled and the reason is visible in the RSVP section', async () => {
		const { section } = await renderWritable();
		await goOffline();

		await waitFor(() => {
			for (const status of ['going', 'not_going', 'maybe', 'late']) {
				const btn = section.querySelector(`[data-testid="rsvp-btn-${status}"]`) as HTMLButtonElement;
				expect(btn.disabled, `rsvp-btn-${status}`).toBe(true);
			}
		});
		const control = section.querySelector('[data-testid="rsvp-control"]') as HTMLElement;
		expectVisibleReason(control, 'rsvp-write-unavailable', REASON);
	});

	it('offline: a click issues no fetch at all', async () => {
		const { section, fetchStub } = await renderWritable();
		await goOffline();
		await settle();
		const callsBefore = fetchStub.mock.calls.length;

		await fireEvent.click(section.querySelector('[data-testid="rsvp-btn-going"]') as HTMLElement);
		await settle();

		expect(fetchStub.mock.calls.length).toBe(callsBefore);
		expect(nonGetCalls(fetchStub)).toEqual([]);
	});

	it('back online: enabled, reason gone, and a click reaches the wire again', async () => {
		const { section, fetchStub } = await renderWritable();
		await goOffline();
		await goOnline();
		await settle();
		const callsBefore = fetchStub.mock.calls.length;

		await waitFor(() => {
			const btn = section.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement;
			expect(btn.disabled).toBe(false);
		});
		expect(section.querySelector('[data-testid="rsvp-write-unavailable"]')).toBeNull();
		await fireEvent.click(section.querySelector('[data-testid="rsvp-btn-going"]') as HTMLElement);
		// The write path's first wire step (a lookup, then the write) — the
		// wire stub answers no type row, so the step count is what is pinned.
		await waitFor(() => expect(fetchStub.mock.calls.length).toBeGreaterThan(callsBefore));
	});
});

// (*MVOX:Tallis* — #434 slice 6 RED)
