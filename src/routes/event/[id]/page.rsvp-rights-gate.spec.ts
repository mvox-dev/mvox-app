// @vitest-environment happy-dom

// RSVP enablement comes from `_owner`/`_editor` on the singer's own person entity
// (GET entity/{personId}?props=_owner,_editor). Membership drives only the non-member hint
// and the write's memberId. Real page and data layer; only the wire fetch is stubbed.
import { render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

beforeEach(editorTokenAtNow);

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
import { cleanupRealTimersResetTypes, editorTokenAtNow } from '$lib/testing/pages/event';
import {
	NO_GRANT,
	RIGHTS_URL,
	SELF_EDITOR,
	seasonEntity,
	setAuthed,
	waitForRsvpSection
} from '$lib/testing/pages/eventRsvp';
import { bareEventEntity } from '$lib/testing/pages/eventFixtures';

// ── fixtures ──────────────────────────────────────────────────────────────────

const SELF_OWNER_ONLY = { _id: 'p-viewer', _owner: [{ reference: 'p-viewer' }] };

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
		if (url.includes('/entity/ev1')) return json({ entity: bareEventEntity() });
		if (url.includes('/entity/season1')) return json({ entity: seasonEntity() });
		if (url.includes('_type.string=member') && url.includes('person.reference=p-viewer')) {
			if (memberEntities === 'hold') return new Promise<Response>(() => {});
			return json({ entities: memberEntities });
		}
		return json({ entities: [] });
	});
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

afterEach(cleanupRealTimersResetTypes);

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
