// @vitest-environment happy-dom
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setToken } from '$lib/auth/storage';
import { deferred, json } from '$lib/testing/entuFetchKit';

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
import { selectedCollectiveDbStore } from '$lib/collectives/store';
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

type WireOpts = {
	updatePost?: 'ok' | 'fail' | 'hold';
};

function wireStub(opts: WireOpts = {}) {
	const heldPost = deferred<Response>();
	const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
		if (url.includes('/entity/p-viewer') && url.includes('props=_owner')) {
			return json({ entity: { _id: 'p-viewer', _editor: [{ reference: 'p-viewer' }] } });
		}
		if (url.includes('/entity/rsvp-77')) {
			if (method === 'POST') {
				if (opts.updatePost === 'fail') return json({ error: 'boom' }, 500);
				if (opts.updatePost === 'hold') return heldPost.promise;
				return json({});
			}
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
				return json({ entities: [MY_RSVP_ROW] });
			}
			return json({ entities: [] });
		}
		return json({ entities: [] });
	});
	return {
		stub,
		releasePost: () => heldPost.resolve(json({})),
		failHeldPost: () => heldPost.resolve(json({ error: 'boom' }, 500))
	};
}

function setAuthed(dbs: string[] = ['sampledb']) {
	signIn({
		token: 'jwt-editor',
		collectives: dbs.map((db) => ({ db, name: db, personId: 'p-viewer' }))
	});
}

function renderPage(opts: WireOpts = {}, dbs?: string[]) {
	const wire = wireStub(opts);
	vi.stubGlobal('fetch', wire.stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthed(dbs);
	const rendered = render(Page);
	return { ...rendered, ...wire };
}

function rsvpSection(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[data-testid="event-detail-rsvp"]');
}

function savedText(container: HTMLElement): string {
	return (
		rsvpSection(container)
			?.querySelector('[data-testid="rsvp-saved-status"]')
			?.textContent?.trim() ?? ''
	);
}

async function waitForAnsweredControl(container: HTMLElement) {
	await waitFor(() => {
		const btn = container.querySelector(
			'[data-testid="rsvp-btn-going"]'
		) as HTMLButtonElement | null;
		expect(btn).not.toBeNull();
		expect(btn!.getAttribute('aria-pressed')).toBe('true');
		expect(btn!.disabled).toBe(false);
	});
}

async function flushMicrotasks(times = 6) {
	for (let i = 0; i < times; i++) await Promise.resolve();
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	resetTypeIdCache();
	resetAppState();
});

describe('/event/[id] — the saved cue fires when the WRITE reconciles (#326)', () => {
	it('merely LOADING an existing answer announces nothing — the cue reports a write, never a read (#329 wiring)', async () => {
		const { container } = renderPage();
		await waitForAnsweredControl(container);
		expect(savedText(container)).toBe('');
		expect(container.textContent).not.toContain('[rsvp_saved]');
	});

	it('a settled status change announces saved on this page — persistent role="status" region inside the RSVP section', async () => {
		const { container } = renderPage();
		await waitForAnsweredControl(container);

		const region = rsvpSection(container)?.querySelector('[data-testid="rsvp-saved-status"]');
		expect(region).not.toBeNull();
		expect(region?.getAttribute('role')).toBe('status');
		expect(region?.getAttribute('aria-live')).toBe('polite');

		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-not_going"]')!);

		await waitFor(() => {
			expect(savedText(container)).toContain('[rsvp_saved]');
		});
		expect(
			container.querySelector('[data-testid="rsvp-btn-not_going"]')?.getAttribute('aria-pressed')
		).toBe('true');
	});

	it('while the write is in flight: the PO-ruled SILENT disable is byte-preserved — aria-busy, no saved text, msg line blank', async () => {
		const { container, releasePost } = renderPage({ updatePost: 'hold' });
		await waitForAnsweredControl(container);

		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-not_going"]')!);

		await waitFor(() => {
			expect(
				rsvpSection(container)
					?.querySelector('[data-testid="rsvp-control"]')
					?.getAttribute('aria-busy')
			).toBe('true');
		});
		expect(savedText(container)).toBe('');
		expect(container.textContent).not.toContain('[rsvp_saved]');
		expect(
			rsvpSection(container)
				?.querySelector('[data-testid="rsvp-msg-line"]')
				?.textContent?.trim()
		).toBe('');
		releasePost();
	});

	it('failure path byte-preserved: the value reverts + role=alert error — and NO saved cue', async () => {
		const { container } = renderPage({ updatePost: 'fail' });
		await waitForAnsweredControl(container);

		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-not_going"]')!);

		await waitFor(() => {
			expect(
				rsvpSection(container)?.querySelector('[data-testid="rsvp-save-failed"]')
			).not.toBeNull();
		});
		expect(
			rsvpSection(container)
				?.querySelector('[data-testid="rsvp-save-failed"]')
				?.getAttribute('role')
		).toBe('alert');
		expect(
			container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
		).toBe('true');
		expect(savedText(container)).toBe('');
		expect(container.textContent).not.toContain('[rsvp_saved]');
	});
});

describe('/event/[id] — the cue does not leak across a collective switch (#326 pin 7, hold → switch → settle)', () => {
	it('a write that settles AFTER the switch never paints the saved cue onto the reloaded page', async () => {
		const { container, releasePost } = renderPage({ updatePost: 'hold' }, [
			'sampledb',
			'other-choir'
		]);
		await waitForAnsweredControl(container);

		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-not_going"]')!);
		await waitFor(() => {
			expect(
				rsvpSection(container)
					?.querySelector('[data-testid="rsvp-control"]')
					?.getAttribute('aria-busy')
			).toBe('true');
		});

		selectedCollectiveDbStore.set('other-choir');
		await waitForAnsweredControl(container);

		releasePost();
		await flushMicrotasks();

		expect(savedText(container)).toBe('');
		expect(container.textContent).not.toContain('[rsvp_saved]');
	});
});

// (*MVOX:Tallis* — #326 RED)
