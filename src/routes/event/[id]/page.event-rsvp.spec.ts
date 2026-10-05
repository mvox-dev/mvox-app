// @vitest-environment happy-dom
// The event page's RSVP control: tally, capacity, past events and a collective switch.
import { render, waitFor, fireEvent } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/paraglide/runtime.js', async () =>
	(await import('$lib/testing/mocks/session')).localeRuntimeModule()
);
vi.mock('$app/state', async () => (await import('$lib/testing/mocks/events')).appStateModule());
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
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { signIn } from '$lib/testing/session';
import { pageStub } from '$lib/testing/mocks/events';
import {
	eventEntity,
	type Fixtures,
	renderWithFetch,
	rsvpWireStub,
	useEventPage
} from '$lib/testing/pages/eventDetail';

useEventPage();

function editorEvent(over: Partial<Record<string, unknown>> = {}) {
	return eventEntity({ _editor: [{ reference: 'p-viewer' }], ...over });
}

function renderRsvpPage(fixtures: Fixtures = {}, opts: { myRsvp?: boolean } = {}) {
	return renderWithFetch(rsvpWireStub(fixtures, opts));
}

function rsvpButtons(container: HTMLElement): HTMLButtonElement[] {
	return ['going', 'not_going', 'maybe', 'late'].map(
		(s) => container.querySelector(`[data-testid="rsvp-btn-${s}"]`) as HTMLButtonElement
	);
}

describe('/event/[id] — RSVP control (integration: same RsvpControl, same rsvp entity as the agenda)', () => {
	it('renders the RsvpControl — all four status buttons + the msg line — inside the RSVP section', async () => {
		const { container } = renderRsvpPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-rsvp"]')).not.toBeNull();
		});
		const section = container.querySelector('[data-testid="event-detail-rsvp"]')!;
		expect(section.querySelector('[data-testid="rsvp-control"]')).not.toBeNull();
		for (const s of ['going', 'not_going', 'maybe', 'late']) {
			expect(
				section.querySelector(`[data-testid="rsvp-btn-${s}"]`),
				`rsvp-btn-${s} missing`
			).not.toBeNull();
		}
		expect(section.querySelector('[data-testid="rsvp-msg-line"]')).not.toBeNull();
	});

	it('enables the buttons for an active member (findMyMemberId resolved over the wire) — no non-member hint', async () => {
		const { container, fetchStub } = renderRsvpPage();
		await waitFor(() => {
			const btn = container.querySelector(
				'[data-testid="rsvp-btn-going"]'
			) as HTMLButtonElement | null;
			expect(btn).not.toBeNull();
			expect(btn!.disabled).toBe(false);
		});
		expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).toBeNull();
		const urls = fetchStub.mock.calls.map((c) => String(c[0]));
		expect(urls.some((u) => u.includes('_type.string=member') && u.includes('p-viewer'))).toBe(
			true
		);
	});
});

describe('/event/[id] — tally + capacity render from the domain rsvp read for EVERY member (#363)', () => {
	it('capacity is hidden when the event has none — the tally still renders', async () => {
		const { container } = renderRsvpPage({ event: editorEvent({ capacity: undefined }) });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-tally"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="event-detail-capacity"]')).toBeNull();
	});

	it('integration: the RSVP section holds the control AND the tally + capacity together (editor view)', async () => {
		const { container } = renderRsvpPage({ event: editorEvent() });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-rsvp"]')).not.toBeNull();
			expect(container.querySelector('[data-testid="event-detail-tally"]')).not.toBeNull();
		});
		const section = container.querySelector('[data-testid="event-detail-rsvp"]')!;
		expect(section.querySelector('[data-testid="rsvp-control"]')).not.toBeNull();
		expect(section.querySelector('[data-testid="event-detail-tally"]')).not.toBeNull();
		expect(section.querySelector('[data-testid="event-detail-capacity"]')).not.toBeNull();
	});
});

describe('/event/[id] — RSVP control while membership is still unresolved (#372 supersedes #102 review F2)', () => {
	function stallingMemberWire(opts: { myRsvp?: boolean } = {}) {
		const base = rsvpWireStub({}, opts);
		return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).includes('_type.string=member')) return new Promise<Response>(() => {});
			return base(input, init);
		});
	}

	function lateMemberWire() {
		const base = rsvpWireStub({}, { myRsvp: false });
		let memberCalls = 0;
		return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? 'GET';
			if (url.includes('_type.string=member')) {
				memberCalls += 1;
				if (memberCalls === 1) return new Promise<Response>(() => {});
				return json({ entities: [{ _id: 'member-1' }] });
			}
			if (url.includes('_type.string=entity') && url.includes('name.string=rsvp'))
				return json({ entities: [{ _id: 'type-rsvp' }] });
			if (method === 'POST' && /\/entity$/.test(url.split('?')[0])) return json({ _id: 'rsvp-new' });
			return base(input, init);
		});
	}

	function failingMemberWire() {
		const base = rsvpWireStub({}, { myRsvp: false });
		return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).includes('_type.string=member'))
				return new Response('boom', { status: 500 });
			return base(input, init);
		});
	}

	function noMemberWire() {
		const base = rsvpWireStub({}, { myRsvp: false });
		return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).includes('_type.string=member')) return json({ entities: [] });
			return base(input, init);
		});
	}

	function postCalls(fetchStub: ReturnType<typeof vi.fn>) {
		return fetchStub.mock.calls.filter(
			(c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'POST'
		);
	}

	it('ENABLES on the grant alone — membership staying unresolved decides nothing, no non-member hint', async () => {
		const { container } = renderWithFetch(stallingMemberWire());
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
			).toBe('true');
		});
		await waitFor(() => {
			for (const btn of rsvpButtons(container)) expect(btn.disabled).toBe(false);
		});
		expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).toBeNull();
		expect(container.querySelector('[data-testid="rsvp-save-failed"]')).toBeNull();
	});

	it('a first tap RESOLVES the member id at write time when the load-time lookup never answered — the create lands', async () => {
		const { container, fetchStub } = renderWithFetch(lateMemberWire());
		const btn = await waitFor(() => {
			const b = container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
			expect(b).not.toBeNull();
			expect(b!.disabled).toBe(false);
			return b!;
		});
		await fireEvent.click(btn);

		const post = await waitFor(() => {
			const posts = postCalls(fetchStub);
			expect(posts.length).toBe(1);
			return posts[0];
		});
		const body = JSON.parse(String((post[1] as RequestInit).body)) as Array<Record<string, unknown>>;
		expect(body).toContainEqual({ type: 'member', reference: 'member-1' });
		expect(body).toContainEqual({ type: 'event', reference: 'ev1' });
		expect(container.querySelector('[data-testid="rsvp-save-failed"]')).toBeNull();
		expect(
			container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
		).toBe('true');
	});

	it('a write-time lookup that REJECTS fails safely — revert + save-failed, no POST ever issued', async () => {
		const { container, fetchStub } = renderWithFetch(failingMemberWire());
		const btn = await waitFor(() => {
			const b = container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
			expect(b).not.toBeNull();
			expect(b!.disabled).toBe(false);
			return b!;
		});
		await fireEvent.click(btn);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="rsvp-save-failed"]')).not.toBeNull();
		});
		expect(postCalls(fetchStub)).toEqual([]);
		expect(
			container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
		).toBe('false');
	});

	it('a confirmed non-member never gets the control at all — the hint stands in its place', async () => {
		const { container, fetchStub } = renderWithFetch(noMemberWire());
		await waitFor(() => {
			expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="rsvp-control"]')).toBeNull();
		expect(postCalls(fetchStub)).toEqual([]);
	});
});

describe('/event/[id] — a past event is read-only (#102 review F3)', () => {
	function pastEvent(over: Partial<Record<string, unknown>> = {}) {
		return eventEntity({
			start_datetime: [{ datetime: '2026-08-19T16:00:00.000Z' }],
			...over
		});
	}

	it('disables all four buttons for an event that has already started', async () => {
		const { container } = renderRsvpPage({ event: pastEvent() });
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
			).toBe('true');
		});
		for (const btn of rsvpButtons(container)) expect(btn.disabled).toBe(true);
		expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).toBeNull();
	});

	it('a tap on a past event writes nothing', async () => {
		const { container, fetchStub } = renderRsvpPage({ event: pastEvent() });
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
			).toBe('true');
		});
		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-maybe"]')!);
		const posts = fetchStub.mock.calls.filter(
			(c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'POST'
		);
		expect(posts).toEqual([]);
	});

	it('an UPCOMING event stays interactive (the past gate is the clock, not a blanket disable)', async () => {
		const { container } = renderRsvpPage(); // fixture starts 2026-09-01, after NOW
		await waitFor(() => {
			const going = container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement;
			expect(going.disabled).toBe(false);
		});
	});

	it('an event with no parseable start is NOT treated as past (unknown ≠ over)', async () => {
		const { container } = renderRsvpPage({ event: eventEntity({ start_datetime: [] }) });
		await waitFor(() => {
			const going = container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement;
			expect(going.disabled).toBe(false);
		});
	});
});

describe('/event/[id] — a write that settles after a collective switch never lands (#102 review round 2, F1)', () => {
	function switchedCollectiveWire() {
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const poly = rsvpWireStub({}, { myRsvp: true });
		const vox = rsvpWireStub({}, { myRsvp: false });
		const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.includes('/entity/rsvp-77') && (init?.method ?? 'GET') === 'POST') {
				await gate;
				return json({});
			}
			return url.includes('/vox/') ? vox(input, init) : poly(input, init);
		});
		return { fetchStub, release: () => release() };
	}

	function renderWithTwoCollectives(fetchStub: ReturnType<typeof vi.fn>) {
		vi.stubGlobal('fetch', fetchStub);
		pageStub.params = { id: 'ev1' };
		pageStub.url = new URL('http://localhost/event/ev1');
		signIn({
			token: 'jwt-editor',
			collectives: [
				{ db: 'sampledb', name: 'Sampledb', personId: 'p-viewer' },
				{ db: 'vox', name: 'Vox', personId: 'p-viewer' }
			]
		});
		return { ...render(Page), fetchStub };
	}

	it('the stale reconcile does not seed the control — and the next tap never rewrites the OTHER db rsvp entity', async () => {
		const { fetchStub, release } = switchedCollectiveWire();
		const { container } = renderWithTwoCollectives(fetchStub);

		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
			).toBe('true');
			const maybe = container.querySelector('[data-testid="rsvp-btn-maybe"]') as HTMLButtonElement;
			expect(maybe.disabled).toBe(false);
		});
		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-maybe"]')!);

		selectedCollectiveDbStore.set('vox');
		await waitFor(() => {
			const going = container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement;
			expect(going.disabled).toBe(false);
			for (const btn of rsvpButtons(container))
				expect(btn.getAttribute('aria-pressed')).toBe('false');
		});

		release();
		await new Promise((r) => setTimeout(r, 30));
		for (const btn of rsvpButtons(container))
			expect(btn.getAttribute('aria-pressed'), 'a superseded write seeded the control').toBe(
				'false'
			);

		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-going"]')!);
		await new Promise((r) => setTimeout(r, 30));
		const urls = fetchStub.mock.calls.map((c) => String(c[0]));
		expect(
			urls.filter((u) => u.includes('rsvp-77')).every((u) => u.includes('/sampledb/')),
			'rsvp-77 was touched in the vox db'
		).toBe(true);
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
