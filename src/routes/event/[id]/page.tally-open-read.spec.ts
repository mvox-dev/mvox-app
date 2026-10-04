// @vitest-environment happy-dom
// canSeeTally answers whether the person can see the tally, not manage the event.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';
import { signIn } from '$lib/testing/session';

beforeEach(fakeDateAtNow);

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
vi.mock('$lib/attendance/attendanceData', async (importOriginal) =>
	(await import('$lib/testing/mocks/events')).attendanceReadsModule(importOriginal, 'rsvps')
);

import Page from './+page.svelte';
import { listAllRsvpsForEventMock } from '$lib/testing/mocks/events';
import { cleanupResetAllMocks, fakeDateAtNow } from '$lib/testing/pages/event';
import { q } from '$lib/testing/pages/dom';

function nonEditorEvent(over: Partial<Record<string, unknown>> = {}) {
	return {
		_id: 'ev1',
		event_name: [{ _id: 'val-name-1', string: 'Tuesday Rehearsal' }],
		event_type: [{ _id: 'val-type-1', string: 'rehearsal' }],
		start_datetime: [{ _id: 'val-start-1', datetime: '2026-09-01T16:00:00.000Z' }],
		duration_minutes: [{ _id: 'val-dur-1', number: 90 }],
		location: [{ _id: 'val-loc-1', string: 'Rehearsal Hall' }],
		capacity: [{ _id: 'val-cap-1', number: 20 }],
		_parent: [{ reference: 'org1', entity_type: 'organization' }],
		...over
	};
}

function editorEvent(over: Partial<Record<string, unknown>> = {}) {
	return nonEditorEvent({ _editor: [{ reference: 'p-viewer' }], ...over });
}

const RSVP_ROWS = [
	{ rsvpId: 'rsvp-77', memberId: 'member-1', status: 'going' },
	{ rsvpId: 'r-2', memberId: 'm-2', status: 'going' },
	{ rsvpId: 'r-3', memberId: 'm-3', status: 'not_going' },
	{ rsvpId: 'r-4', memberId: 'm-4', status: 'maybe' }
] as const;

const ACTIVE_MEMBER_ENTITIES = ['member-1', 'm-2', 'm-3', 'm-4'].map((id) => ({
	_id: id,
	person: [{ reference: `p-${id}` }]
}));

function wireStub(event: Record<string, unknown>) {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/')) return json({ deleted: true });
		if (url.includes('/entity/p-viewer') && url.includes('props=_owner')) {
			return json({ entity: { _id: 'p-viewer', _editor: [{ reference: 'p-viewer' }] } });
		}
		if (url.includes('/entity/ev1')) return json({ entity: event });
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
		if (url.includes('_type.string=member') && url.includes('person.reference=p-viewer'))
			return json({ entities: [{ _id: 'member-1' }] });
		if (url.includes('_type.string=member') && url.includes('status.string=active'))
			return json({ entities: ACTIVE_MEMBER_ENTITIES });
		if (url.includes('_type.string=rsvp') && url.includes('_parent.reference=p-viewer'))
			return json({
				entities: [{ _id: 'rsvp-77', event: [{ reference: 'ev1' }], status: [{ string: 'going' }] }]
			});
		return json({ entities: [] });
	});
}

function setAuthedWithSampledb() {
	signIn({
		token: 'jwt-token',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p-viewer' }]
	});
}

beforeEach(() => {
	listAllRsvpsForEventMock.mockResolvedValue([...RSVP_ROWS]);
});

afterEach(cleanupResetAllMocks);

function renderPage(event: Record<string, unknown>) {
	const stub = wireStub(event);
	vi.stubGlobal('fetch', stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithSampledb();
	return { ...render(Page), fetchStub: stub };
}

describe('#363 — a plain member (no grant on the event) gets the tally', () => {
	it('issues the rsvp read exactly once and renders the full count shape + capacity', async () => {
		const { container } = renderPage(nonEditorEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally'), 'tally not rendered for a non-editor').not.toBeNull();
		});
		expect(listAllRsvpsForEventMock).toHaveBeenCalledTimes(1);
		expect(listAllRsvpsForEventMock).toHaveBeenCalledWith(
			expect.objectContaining({ db: 'sampledb' }),
			'ev1'
		);
		expect(q(container, 'event-detail-tally-going')!.textContent).toContain('"count":2');
		expect(q(container, 'event-detail-tally-not_going')!.textContent).toContain('"count":1');
		expect(q(container, 'event-detail-tally-maybe')!.textContent).toContain('"count":1');
		expect(q(container, 'event-detail-tally-late')!.textContent).toContain('"count":0');
		const cap = q(container, 'event-detail-capacity');
		expect(cap, 'capacity not rendered for a non-editor').not.toBeNull();
		expect(cap!.textContent).toContain('"going":2');
		expect(cap!.textContent).toContain('"capacity":20');
		expect(q(container, 'event-detail-tally-error')).toBeNull();
	});
});

describe("#363 — the tally is a function of the read's result (non-editor viewer)", () => {
	it('rows back → the counts show (pinned above); ZERO rows back → the tally still renders, all four buckets at 0 (0 is a COUNT, not an absence)', async () => {
		listAllRsvpsForEventMock.mockResolvedValue([]);
		const { container } = renderPage(nonEditorEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally')).not.toBeNull();
		});
		for (const s of ['going', 'not_going', 'maybe', 'late']) {
			expect(q(container, `event-detail-tally-${s}`)!.textContent).toContain('"count":0');
		}
		expect(q(container, 'event-detail-tally-error')).toBeNull();
	});

	it('read REJECTS → the error line + Retry show to the non-editor (RULED: the failure of a read she issued is hers to be told about), counts dropped', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		listAllRsvpsForEventMock.mockRejectedValue(new Error('boom'));
		const { container } = renderPage(nonEditorEvent());
		await waitFor(() => {
			expect(
				q(container, 'event-detail-tally-error'),
				'tally error not shown to a non-editor'
			).not.toBeNull();
		});
		expect(q(container, 'event-detail-tally-retry')).not.toBeNull();
		expect(q(container, 'event-detail-tally')).toBeNull();
		errorSpy.mockRestore();
	});
});

describe('#363 — retry and the post-write re-fetch are not editor-gated either', () => {
	it('Retry re-issues the read for a non-editor: fail once, click Retry, counts render — two spy calls', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		listAllRsvpsForEventMock.mockRejectedValueOnce(new Error('boom'));
		const { container } = renderPage(nonEditorEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-error')).not.toBeNull();
		});
		expect(listAllRsvpsForEventMock).toHaveBeenCalledTimes(1);
		await fireEvent.click(q(container, 'event-detail-tally-retry')!);
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-going')?.textContent).toContain('"count":2');
		});
		expect(listAllRsvpsForEventMock).toHaveBeenCalledTimes(2);
		expect(q(container, 'event-detail-tally-error')).toBeNull();
		errorSpy.mockRestore();
	});

	it("a non-editor's OWN rsvp write re-reads the counts (#102 F4 re-fetch, no longer behind the rights gate): two spy calls", async () => {
		const { container, fetchStub } = renderPage(nonEditorEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally')).not.toBeNull();
			expect(q(container, 'rsvp-btn-going')?.getAttribute('aria-pressed')).toBe('true');
			const maybe = q(container, 'rsvp-btn-maybe') as HTMLButtonElement | null;
			expect(maybe).not.toBeNull();
			expect(maybe!.disabled).toBe(false);
		});
		expect(listAllRsvpsForEventMock).toHaveBeenCalledTimes(1);

		await fireEvent.click(q(container, 'rsvp-btn-maybe')!);

		await waitFor(() => {
			expect(listAllRsvpsForEventMock).toHaveBeenCalledTimes(2);
		});
		const posts = fetchStub.mock.calls.filter(
			(c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'POST'
		);
		expect(posts.length).toBeGreaterThan(0);
		for (const c of posts) expect(String(c[0])).toContain('/entity/rsvp-77');
	});
});

describe('#363 — every management gate still asks manageRightsFrom, exactly as before', () => {
	const MANAGEMENT_TESTIDS = [
		'event-edit-btn-event_type',
		'event-schedule-add',
		'event-detail-danger-zone'
	] as const;

	it('a NON-editor sees the tally, yet NONE of the management controls', async () => {
		const { container } = renderPage(nonEditorEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally')).not.toBeNull();
			expect(q(container, 'event-detail-name')?.textContent).toContain('Tuesday Rehearsal');
		});
		for (const testid of MANAGEMENT_TESTIDS) {
			expect(q(container, testid), `${testid} leaked to a non-editor`).toBeNull();
		}
	});

	it('an `_editor` keeps all three controls AND the tally', async () => {
		const { container } = renderPage(editorEvent());
		await waitFor(() => {
			for (const testid of MANAGEMENT_TESTIDS) {
				expect(q(container, testid), `${testid} missing for an editor`).not.toBeNull();
			}
			expect(q(container, 'event-detail-tally')).not.toBeNull();
		});
	});
});

describe('#363 — canSeeTally no longer exists under that lying name', () => {
	it('no definition or call site of canSeeTally survives in +page.svelte (the tally has no seeing-predicate at all — the read is the predicate)', () => {
		const src = readFileSync(resolve('src/routes/event/[id]/+page.svelte'), 'utf8');
		expect(src).not.toMatch(/canSeeTally\s*\(/);
	});
});

// (*MVOX:Tallis*)
