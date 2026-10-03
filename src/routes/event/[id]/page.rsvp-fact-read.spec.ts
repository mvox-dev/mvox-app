// @vitest-environment happy-dom
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setToken } from '$lib/auth/storage';
import { json } from '$lib/testing/entuFetchKit';

const NOW = new Date('2026-08-20T10:00:00.000Z');
beforeEach(() => {
	setToken('jwt-editor');
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
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

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

const MY_RSVP_ROW = { _id: 'rsvp-77', event: [{ reference: 'ev1' }], status: [{ string: 'going' }] };

function truncatedLifetimeBody() {
	return {
		count: 600,
		entities: [
			{ _id: 'rsvp-old-1', event: [{ reference: 'ev-old-1' }], status: [{ string: 'going' }] },
			{ _id: 'rsvp-old-2', event: [{ reference: 'ev-old-2' }], status: [{ string: 'maybe' }] }
		]
	};
}

type WireOpts = {
	scopedEntities?: unknown[];
	scopedCount?: number;
};

function wireStub(opts: WireOpts = {}) {
	const scopedEntities = opts.scopedEntities ?? [MY_RSVP_ROW];
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
		if (url.includes('/entity/p-viewer') && url.includes('props=_owner')) {
			return json({ entity: { _id: 'p-viewer', _editor: [{ reference: 'p-viewer' }] } });
		}
		if (url.includes('/entity/rsvp-77')) {
			if (method === 'POST') return json({});
			return json({
				entity: {
					_id: 'rsvp-77',
					status: [{ _id: 'val-status-1' }],
					event: [{ reference: 'ev1' }],
					going_ref: [{ _id: 'val-sentinel-1' }]
				}
			});
		}
		if (url.includes('/entity/ev1')) return json({ entity: eventEntity() });
		if (url.includes('/entity/season1')) return json({ entity: seasonEntity() });
		if (url.includes('_type.string=member') && url.includes('person.reference=p-viewer'))
			return json({ entities: [{ _id: 'member-1' }] });
		if (url.includes('_type.string=rsvp')) {
			if (url.includes('_parent.reference=p-viewer') && url.includes('event.reference=ev1')) {
				return json(
					opts.scopedCount === undefined
						? { entities: scopedEntities }
						: { count: opts.scopedCount, entities: scopedEntities }
				);
			}
			if (url.includes('_parent.reference=p-viewer')) {
				return json(truncatedLifetimeBody());
			}
			return json({ entities: [] });
		}
		return json({ entities: [] });
	});
}

function setAuthed() {
	signIn({
		token: 'jwt-editor',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p-viewer' }]
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

const SCOPED_QUERY =
	'_type.string=rsvp&_parent.reference=p-viewer&event.reference=ev1&props=status&limit=1';

function rsvpQueries(fetchStub: ReturnType<typeof wireStub>): string[] {
	return fetchStub.mock.calls
		.map((c) => String(c[0]))
		.filter((u) => u.includes('_type.string=rsvp') && u.includes('_parent.reference='));
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	resetTypeIdCache();
	resetAppState();
});

describe('/event/[id] — the own-answer state comes from the scoped FACT read (#329)', () => {
	it('(a) her answer EXISTS: shown even though the lifetime read truncated it away — and the wire saw the exact scoped query', async () => {
		const { container, fetchStub } = renderPage();
		await waitFor(() => {
			expect(
				container
					.querySelector('[data-testid="rsvp-btn-going"]')
					?.getAttribute('aria-pressed')
			).toBe('true');
		});
		expect(
			fetchStub.mock.calls.map((c) => String(c[0])).some((u) => u.split('?')[1] === SCOPED_QUERY)
		).toBe(true);
	});

	it('(b) genuinely NO answer: the scoped read confirms empty and "not answered" stands', async () => {
		const { container, fetchStub } = renderPage({ scopedEntities: [], scopedCount: 0 });
		await waitFor(() => {
			expect(
				fetchStub.mock.calls
					.map((c) => String(c[0]))
					.some((u) => u.split('?')[1] === SCOPED_QUERY)
			).toBe(true);
		});
		await waitFor(() => {
			for (const status of ['going', 'not_going', 'maybe', 'late']) {
				expect(
					container
						.querySelector(`[data-testid="rsvp-btn-${status}"]`)
						?.getAttribute('aria-pressed'),
					`rsvp-btn-${status}`
				).toBe('false');
			}
		});
	});

	it('the person-LIFETIME read no longer decides this page: every own-rsvp query is event-scoped', async () => {
		const { container, fetchStub } = renderPage();
		await waitFor(() => {
			expect(
				container
					.querySelector('[data-testid="rsvp-btn-going"]')
					?.getAttribute('aria-pressed')
			).toBe('true');
		});
		const queries = rsvpQueries(fetchStub);
		expect(queries.length).toBeGreaterThan(0);
		for (const url of queries) {
			expect(url, `own-rsvp query without an event scope: ${url}`).toContain(
				'event.reference=ev1'
			);
		}
	});

	it('a status change writes to the entity the FACT read returned — update rsvp-77, never a create', async () => {
		const { container, fetchStub } = renderPage();
		await waitFor(() => {
			const btn = container.querySelector(
				'[data-testid="rsvp-btn-going"]'
			) as HTMLButtonElement | null;
			expect(btn?.getAttribute('aria-pressed')).toBe('true');
			expect(btn?.disabled).toBe(false);
		});
		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-not_going"]')!);
		await waitFor(() => {
			const posts = fetchStub.mock.calls.filter(
				([url, init]) =>
					String(url).includes('/entity/rsvp-77') &&
					(init as RequestInit | undefined)?.method === 'POST'
			);
			expect(
				posts.some(([, init]) =>
					String((init as RequestInit).body).includes('"string":"not_going"')
				)
			).toBe(true);
		});
	});
});

// (*MVOX:Tallis* — #329 RED)
