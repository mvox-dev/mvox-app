// @vitest-environment happy-dom
//
// #372 RED (event-page surface) — the RSVP control asks Entu whether the
// singer may write. Same law, same ONE primitive as the agenda surface
// (routes/page.rsvp-rights-gate.spec.ts — see its header for the paradigm):
// the rsvp write targets a child of the singer's own PERSON entity, so the
// control's enabled state derives from `_owner`/`_editor` on that person,
// read as GET entity/{personId}?props=_owner,_editor. This page carried its
// OWN copy of the membership gate (Gama ruling: both surfaces fixed under
// #372, one primitive) — membership survives only as display (the non-member
// hint) and as the write payload's memberId, never as enablement.
//
// INTEGRATION posture (page.rsvp-fact-read.spec.ts family): the REAL page +
// REAL data layer, only global fetch stubbed at the wire.
import { render, cleanup, waitFor } from '@testing-library/svelte';
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
const SELF_OWNER_ONLY = { _id: 'p-viewer', _owner: [{ reference: 'p-viewer' }] };
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

function rightsCalls(fetchStub: ReturnType<typeof wireStub>) {
	return fetchStub.mock.calls.filter((c) => String(c[0]) === RIGHTS_URL);
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

describe('/event/[id] — RSVP enablement is the Entu grant on the viewer’s own person (#372)', () => {
	it('WIRE: enablement is GET entity/{personId}?props=_owner,_editor — and does NOT wait on the member lookup', async () => {
		// The member lookup NEVER resolves: if enablement consulted it, the
		// control could never enable here. (This is also the "membership
		// `loading` alone never disables anything" pin for this surface.)
		const { container, fetchStub } = renderPage({
			personRights: SELF_EDITOR,
			memberEntities: 'hold'
		});

		await waitFor(() => {
			expect(rightsCalls(fetchStub).length).toBeGreaterThan(0);
		});

		await waitFor(() => {
			const btn = container.querySelector(
				'[data-testid="rsvp-btn-going"]'
			) as HTMLButtonElement | null;
			expect(btn).not.toBeNull();
			expect(btn!.disabled).toBe(false);
		});
	});

	it('self-_owner only -> all four buttons enabled (ownership subsumes editing)', async () => {
		const { container, fetchStub } = renderPage({ personRights: SELF_OWNER_ONLY });

		// Mechanism pin — the grant read happened (RED today: it never does).
		await waitFor(() => {
			expect(rightsCalls(fetchStub).length).toBeGreaterThan(0);
		});
		await waitFor(() => {
			for (const status of ['going', 'not_going', 'maybe', 'late']) {
				const btn = container.querySelector(
					`[data-testid="rsvp-btn-${status}"]`
				) as HTMLButtonElement | null;
				expect(btn, `rsvp-btn-${status}`).not.toBeNull();
				expect(btn!.disabled, `rsvp-btn-${status}`).toBe(false);
			}
		});
	});

	it('no grant (rights props absent) -> NO control renders, even for an active member — #369', async () => {
		const { container, fetchStub } = renderPage({
			personRights: NO_GRANT,
			memberEntities: [{ _id: 'member-1' }] // an ACTIVE member — #369's trap
		});

		await waitForRsvpSection(container);
		await waitFor(() => {
			expect(rightsCalls(fetchStub).length).toBeGreaterThan(0);
		});
		await Promise.resolve();
		await Promise.resolve();

		// Not disabled, not a hint — the control simply is not there.
		expect(container.querySelector('[data-testid="rsvp-control"]')).toBeNull();
		expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).toBeNull();
	});

	it('a confirmed NON-member without the grant: the hint STAYS (display) and the control is NOT rendered — two separate facts', async () => {
		const { container, fetchStub } = renderPage({
			personRights: NO_GRANT,
			memberEntities: [] // confirmed non-member
		});

		await waitForRsvpSection(container);
		await waitFor(() => {
			expect(rightsCalls(fetchStub).length).toBeGreaterThan(0);
		});

		// Fact 1 — the membership DISPLAY survives: the hint shows.
		await waitFor(() => {
			expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).not.toBeNull();
		});
		// Fact 2 — the write-inviting control does not render.
		expect(container.querySelector('[data-testid="rsvp-control"]')).toBeNull();
	});

	it('rights UNRESOLVED (read in flight) -> no enabled button, no hint, no invitation', async () => {
		const { container, fetchStub } = renderPage({
			personRights: 'hold',
			memberEntities: [{ _id: 'member-1' }]
		});

		await waitForRsvpSection(container);
		await waitFor(() => {
			expect(rightsCalls(fetchStub).length).toBeGreaterThan(0);
		});
		await Promise.resolve();
		await Promise.resolve();

		const buttons = Array.from(
			container.querySelectorAll('button[data-testid^="rsvp-btn-"]')
		) as HTMLButtonElement[];
		expect(buttons.every((b) => b.disabled)).toBe(true);
		expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).toBeNull();
	});
});

// (*MVOX:Tallis*)
