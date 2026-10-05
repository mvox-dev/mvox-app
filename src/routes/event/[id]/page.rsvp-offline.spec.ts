// @vitest-environment happy-dom

// Offline, the event page's RSVP buttons are disabled, the section says why, and a click
// sends nothing; back online they write again. Only the wire fetch is stubbed.
import { render, waitFor, fireEvent } from '@testing-library/svelte';
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
import {
	goOffline,
	goOnline,
	resetOnLine,
	settle,
	expectVisibleReason,
	nonGetCalls
} from '$lib/testing/networkSignal';
import { REASON, cleanupRealTimersResetTypes, editorTokenAtNow } from '$lib/testing/pages/event';
import {
	NO_GRANT,
	RIGHTS_URL,
	SELF_EDITOR,
	seasonEntity,
	setAuthed,
	waitForRsvpSection
} from '$lib/testing/pages/eventRsvp';
import { eventEntity } from '$lib/testing/pages/eventFixtures';

// ── fixtures ──────────────────────────────────────────────────────────────────

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

function renderPage(opts: WireOpts = {}) {
	const fetchStub = wireStub(opts);
	vi.stubGlobal('fetch', fetchStub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthed();
	const rendered = render(Page);
	return { ...rendered, fetchStub };
}

afterEach(cleanupRealTimersResetTypes);

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

// (*MVOX:Tallis*)
