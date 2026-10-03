// @vitest-environment happy-dom
// The RSVP tally line folds out who answered what.
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

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

const { gotoMock, discoverMock, listAllRsvpsForEventMock, loadRosterMock } = vi.hoisted(() => ({
	gotoMock: vi.fn(),
	discoverMock: vi.fn(),
	listAllRsvpsForEventMock: vi.fn(),
	loadRosterMock: vi.fn()
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/attendance/attendanceData', async (importActual) => ({
	...(await importActual<typeof import('$lib/attendance/attendanceData')>()),
	listAllRsvpsForEvent: listAllRsvpsForEventMock
}));
vi.mock('$lib/roster/rosterData', async (importActual) => ({
	...(await importActual<typeof import('$lib/roster/rosterData')>()),
	loadRoster: loadRosterMock,
	loadRosterRead: loadRosterMock
}));

import Page from './+page.svelte';

function futureEvent(over: Partial<Record<string, unknown>> = {}) {
	return {
		_id: 'ev1',
		name: [{ _id: 'val-name-1', string: 'Tuesday Rehearsal' }],
		event_type: [{ _id: 'val-type-1', string: 'rehearsal' }],
		start_datetime: [{ _id: 'val-start-1', datetime: '2026-09-01T16:00:00.000Z' }],
		duration_minutes: [{ _id: 'val-dur-1', number: 90 }],
		location: [{ _id: 'val-loc-1', string: 'Rehearsal Hall' }],
		capacity: [{ _id: 'val-cap-1', number: 20 }],
		_parent: [{ reference: 'org1', entity_type: 'organization' }],
		...over
	};
}

function pastEvent() {
	return futureEvent({
		start_datetime: [{ _id: 'val-start-1', datetime: '2026-08-01T16:00:00.000Z' }]
	});
}

const RSVP_ROWS = [
	{ rsvpId: 'rsvp-77', memberId: 'member-1', status: 'going' },
	{ rsvpId: 'r-2', memberId: 'm-2', status: 'going' },
	{ rsvpId: 'r-3', memberId: 'm-3', status: 'not_going' },
	{ rsvpId: 'r-4', memberId: 'm-4', status: 'maybe' },
	{ rsvpId: 'r-5', memberId: 'm-5', status: 'late' }
] as const;

const ACTIVE_MEMBER_IDS = ['member-1', 'm-2', 'm-3', 'm-4', 'm-5', 'm-6', 'm-7'] as const;

const ACTIVE_MEMBER_ENTITIES = ACTIVE_MEMBER_IDS.map((id) => ({
	_id: id,
	person: [{ reference: `p-${id}` }]
}));

const NAME_BY_MEMBER: Record<string, string> = {
	'member-1': 'Anna Alt',
	'm-2': 'Bruno Bass',
	'm-3': 'Cecilia Cantor',
	'm-4': 'Diana Descant',
	'm-5': 'Erik Echo',
	'm-6': 'Frida Fauxbourdon',
	'm-7': 'Georg Gamba'
};

const ARCHIVED_MEMBER_ID = 'm-gone';
const ARCHIVED_PERSON_ID = 'p-m-gone';
const ARCHIVED_NAME = 'Helena Hymnal';

const ARCHIVED_MEMBER_ENTITIES = [
	{ _id: ARCHIVED_MEMBER_ID, person: [{ reference: ARCHIVED_PERSON_ID }] }
];

const ROSTER_READ = {
	items: ACTIVE_MEMBER_IDS.map((id) => ({
		memberId: id,
		personId: `p-${id}`,
		name: NAME_BY_MEMBER[id],
		profileName: NAME_BY_MEMBER[id],
		email: `${id}@example.invalid`,
		sectionIds: []
	})),
	total: ACTIVE_MEMBER_IDS.length,
	truncated: false
};

function wireStub(event: Record<string, unknown>, opts: { activeMembersCount?: number } = {}) {
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
			return json(
				opts.activeMembersCount === undefined
					? { entities: ACTIVE_MEMBER_ENTITIES }
					: { entities: ACTIVE_MEMBER_ENTITIES, count: opts.activeMembersCount }
			);
		if (url.includes('_type.string=member') && url.includes('status.string=archived'))
			return json({ entities: ARCHIVED_MEMBER_ENTITIES });
		if (url.includes('_type.string=profile') && url.includes(ARCHIVED_PERSON_ID))
			return json({
				entities: [
					{
						_id: 'profile-gone',
						name: [{ string: ARCHIVED_NAME }],
						_sharing: [{ string: 'domain' }]
					}
				]
			});
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
	loadRosterMock.mockResolvedValue(structuredClone(ROSTER_READ));
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	vi.resetAllMocks();
	localStorage.clear();
	resetAppState();
});

function renderPage(event: Record<string, unknown>, opts: { activeMembersCount?: number } = {}) {
	const stub = wireStub(event, opts);
	vi.stubGlobal('fetch', stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithSampledb();
	return { ...render(Page), fetchStub: stub };
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

const TALLY_ORDER = ['going', 'not_going', 'maybe', 'late', 'not_responded'] as const;

function countOf(el: HTMLElement | null): number {
	const match = el?.textContent?.match(/"count":(\d+)/);
	return match ? Number(match[1]) : NaN;
}

async function openCard(container: HTMLElement): Promise<HTMLElement> {
	const toggle = await waitFor(() => {
		const t = q(container, 'event-detail-tally-toggle');
		expect(t, 'tally line activator not rendered').not.toBeNull();
		return t!;
	});
	await fireEvent.click(toggle);
	await waitFor(() => {
		expect(q(container, 'event-detail-tally-card'), 'card did not fold out').not.toBeNull();
	});
	return toggle;
}

describe('#344 — future event, plain member: the line carries five counts', () => {
	it('renders going · not_going · maybe · late · not_responded, full shape, from the rows + active-members fixtures', async () => {
		const { container } = renderPage(futureEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally')).not.toBeNull();
			expect(
				q(container, 'event-detail-tally-not_responded'),
				'fifth count (not responded) missing from the line'
			).not.toBeNull();
		});
		const counts = Object.fromEntries(
			TALLY_ORDER.map((s) => [s, countOf(q(container, `event-detail-tally-${s}`))])
		);
		expect(counts).toEqual({ going: 2, not_going: 1, maybe: 1, late: 1, not_responded: 2 });
		const text = q(container, 'event-detail-tally')!.textContent!;
		const indices = TALLY_ORDER.map((s) => text.indexOf(`[event_detail_tally_${s} `));
		for (const [i, s] of TALLY_ORDER.entries()) {
			expect(indices[i], `${s} not rendered on the line`).toBeGreaterThanOrEqual(0);
		}
		expect([...indices].sort((a, b) => a - b)).toEqual(indices);
	});
});

describe('#344 — past event: four counts, no not-responded group', () => {
	it('renders no fifth span on the line and no not-responded group in the card', async () => {
		const { container } = renderPage(pastEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally')).not.toBeNull();
		});
		expect(
			q(container, 'event-detail-tally-not_responded'),
			'a past tally must not grow a fifth count'
		).toBeNull();
		expect(countOf(q(container, 'event-detail-tally-going'))).toBe(2);
		expect(countOf(q(container, 'event-detail-tally-late'))).toBe(1);
		await openCard(container);
		expect(
			q(container, 'event-detail-tally-card-group-not_responded'),
			'a past card must not carry a not-responded group'
		).toBeNull();
		const groups = Array.from(
			container.querySelectorAll('[data-testid^="event-detail-tally-card-group-"]')
		).map((el) => el.getAttribute('data-testid'));
		expect(groups).toEqual([
			'event-detail-tally-card-group-going',
			'event-detail-tally-card-group-not_going',
			'event-detail-tally-card-group-maybe',
			'event-detail-tally-card-group-late'
		]);
	});
});

describe('#344 — the whole tally line activates the card (rule 4/4b)', () => {
	it('the activator is a native <button type="button"> wrapping the whole line, sr-only label, NO aria-label', async () => {
		const { container } = renderPage(futureEvent());
		const toggle = await waitFor(() => {
			const t = q(container, 'event-detail-tally-toggle');
			expect(t).not.toBeNull();
			return t!;
		});
		expect(toggle.tagName).toBe('BUTTON');
		expect(toggle.getAttribute('type')).toBe('button');
		for (const s of TALLY_ORDER) {
			expect(
				toggle.contains(q(container, `event-detail-tally-${s}`)),
				`${s} span outside the activator — the whole line must be tappable`
			).toBe(true);
		}
		expect(toggle.getAttribute('aria-label')).toBeNull();
		const srOnly = toggle.querySelector('.sr-only');
		expect(srOnly, 'sr-only action label missing on the activator').not.toBeNull();
		expect(srOnly!.textContent?.trim()).toBe('[event_detail_tally_card_expand_label]');
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(q(container, 'event-detail-tally-card')).toBeNull();
	});

	it('click folds the card out below the line, aria-expanded flips, focus stays on the activator; second click folds in', async () => {
		const { container } = renderPage(futureEvent());
		const toggle = await waitFor(() => {
			const t = q(container, 'event-detail-tally-toggle');
			expect(t).not.toBeNull();
			return t!;
		});
		toggle.focus();
		await fireEvent.click(toggle);
		const card = await waitFor(() => {
			const c = q(container, 'event-detail-tally-card');
			expect(c).not.toBeNull();
			return c!;
		});
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(toggle.querySelector('.sr-only')!.textContent?.trim()).toBe(
			'[event_detail_tally_card_collapse_label]'
		);
		const section = q(container, 'event-detail-rsvp')!;
		expect(section.contains(card)).toBe(true);
		const tallyEl = q(container, 'event-detail-tally')!;
		expect(
			Boolean(tallyEl.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING),
			'card must fold out BELOW the tally line'
		).toBe(true);
		expect(document.activeElement).toBe(toggle);
		await fireEvent.click(toggle);
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-card')).toBeNull();
		});
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(toggle);
	});

	it('keyboard activation: the click a native button synthesizes from Enter/Space (detail 0) toggles the card', async () => {
		const { container } = renderPage(futureEvent());
		const toggle = await waitFor(() => {
			const t = q(container, 'event-detail-tally-toggle');
			expect(t).not.toBeNull();
			return t!;
		});
		toggle.focus();
		await fireEvent.click(toggle, { detail: 0 });
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-card')).not.toBeNull();
		});
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(document.activeElement).toBe(toggle);
		await fireEvent.click(toggle, { detail: 0 });
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-card')).toBeNull();
		});
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
	});
});

describe('#344 — the card lists profile names per group, resolved once per open', () => {
	it('groups follow the tally order and carry the names from loadRoster', async () => {
		const { container } = renderPage(futureEvent());
		await openCard(container);
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-card-group-not_responded')).not.toBeNull();
		});
		const groups = Array.from(
			container.querySelectorAll('[data-testid^="event-detail-tally-card-group-"]')
		).map((el) => el.getAttribute('data-testid'));
		expect(groups).toEqual(TALLY_ORDER.map((s) => `event-detail-tally-card-group-${s}`));
		for (const s of TALLY_ORDER) {
			expect(q(container, `event-detail-tally-card-group-${s}`)!.textContent).toContain(
				`[rsvp_status_${s}]`
			);
		}
		const expectNames = (testid: string, names: string[]) => {
			const el = q(container, testid)!;
			for (const n of names) {
				expect(el.textContent, `${n} missing from ${testid}`).toContain(n);
			}
		};
		expectNames('event-detail-tally-card-group-going', ['Anna Alt', 'Bruno Bass']);
		expectNames('event-detail-tally-card-group-not_going', ['Cecilia Cantor']);
		expectNames('event-detail-tally-card-group-maybe', ['Diana Descant']);
		expectNames('event-detail-tally-card-group-late', ['Erik Echo']);
		expectNames('event-detail-tally-card-group-not_responded', [
			'Frida Fauxbourdon',
			'Georg Gamba'
		]);
		expect(q(container, 'event-detail-tally-card-group-going')!.textContent).not.toContain(
			'Frida'
		);
	});

	it('loadRoster runs ZERO times before the card opens, exactly ONCE per open — never once per row', async () => {
		const { container } = renderPage(futureEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally')).not.toBeNull();
		});
		expect(loadRosterMock).not.toHaveBeenCalled();
		await openCard(container);
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-card-group-not_responded')).not.toBeNull();
		});
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
		expect(loadRosterMock).toHaveBeenCalledWith(expect.objectContaining({ db: 'sampledb' }));
	});
});

describe("#344 — the card follows the tally's own visibility (#363 gate)", () => {
	it('a plain member with NO grant on the event gets the activator and the card', async () => {
		const { container } = renderPage(futureEvent());
		const toggle = await openCard(container);
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
	});

	it('zero rows back on a FUTURE event → the activator renders and the card carries the not-responded names', async () => {
		listAllRsvpsForEventMock.mockResolvedValue([]);
		const { container } = renderPage(futureEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally')).not.toBeNull();
		});
		expect(countOf(q(container, 'event-detail-tally-not_responded'))).toBe(7);
		await openCard(container);
		const group = await waitFor(() => {
			const g = q(container, 'event-detail-tally-card-group-not_responded');
			expect(g, 'the not-responded group must be reachable with zero answers').not.toBeNull();
			expect(g!.querySelector('li'), 'names not resolved').not.toBeNull();
			return g!;
		});
		for (const name of Object.values(NAME_BY_MEMBER)) {
			expect(group.textContent, `${name} missing from the not-responded group`).toContain(name);
		}
		expect(q(container, 'event-detail-tally-card-group-going')!.querySelector('li')).toBeNull();
	});

	it('zero rows back on a PAST event → the tally renders (#363 pin) but NO card activator', async () => {
		listAllRsvpsForEventMock.mockResolvedValue([]);
		const { container } = renderPage(pastEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally')).not.toBeNull();
		});
		expect(q(container, 'event-detail-tally-toggle')).toBeNull();
		expect(q(container, 'event-detail-tally-card')).toBeNull();
	});

	it('read REJECTS (tallyError) → error line, no tally, no activator, no card', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		listAllRsvpsForEventMock.mockRejectedValue(new Error('boom'));
		const { container } = renderPage(futureEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-error')).not.toBeNull();
		});
		expect(q(container, 'event-detail-tally')).toBeNull();
		expect(q(container, 'event-detail-tally-toggle')).toBeNull();
		expect(q(container, 'event-detail-tally-card')).toBeNull();
		errorSpy.mockRestore();
	});
});

describe('#344 — the card is a fold-out, not a navigation', () => {
	it('opening the card calls goto ZERO times and the activator is no link', async () => {
		const { container } = renderPage(futureEvent());
		const toggle = await openCard(container);
		expect(gotoMock).not.toHaveBeenCalled();
		expect(toggle.closest('a')).toBeNull();
	});
});

describe('#344 — #105/#363 pins survive the fold-out', () => {
	it('event-detail-tally keeps its testid and aria-live=polite, closed AND open', async () => {
		const { container } = renderPage(futureEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally')).not.toBeNull();
		});
		expect(q(container, 'event-detail-tally')!.getAttribute('aria-live')).toBe('polite');
		await openCard(container);
		const tallyEl = q(container, 'event-detail-tally');
		expect(tallyEl, 'the tally line must survive the card opening').not.toBeNull();
		expect(tallyEl!.getAttribute('aria-live')).toBe('polite');
	});
});

describe('#344 review F1 — a past card names the member who has since left', () => {
	it('resolves an ARCHIVED answerer through the archived roster, never printing her raw member id', async () => {
		listAllRsvpsForEventMock.mockResolvedValue([
			...RSVP_ROWS,
			{ rsvpId: 'r-gone', memberId: ARCHIVED_MEMBER_ID, status: 'going' }
		]);
		const { container } = renderPage(pastEvent());
		await openCard(container);
		const going = await waitFor(() => {
			const g = q(container, 'event-detail-tally-card-group-going')!;
			expect(g.querySelector('li'), 'names not resolved').not.toBeNull();
			return g;
		});
		expect(going.textContent, 'the archived answerer is not named').toContain(ARCHIVED_NAME);
		expect(going.textContent, 'a raw member id reached the screen').not.toContain(
			ARCHIVED_MEMBER_ID
		);
		expect(going.textContent).toContain('Anna Alt');
	});
});

describe('#344 review F2 — an unresolvable member gets a placeholder, never her id', () => {
	it('an active member the #28 completeness gate dropped renders the translated placeholder', async () => {
		loadRosterMock.mockResolvedValue({
			...structuredClone(ROSTER_READ),
			items: structuredClone(ROSTER_READ).items.filter((r) => r.memberId !== 'm-7')
		});
		const { container } = renderPage(futureEvent());
		await openCard(container);
		const group = await waitFor(() => {
			const g = q(container, 'event-detail-tally-card-group-not_responded')!;
			expect(g.querySelector('li')).not.toBeNull();
			return g;
		});
		expect(group.textContent).toContain('Frida Fauxbourdon');
		expect(group.textContent, 'the nameless member is missing from the group').toContain(
			'[event_detail_tally_name_unavailable]'
		);
		expect(group.textContent, 'a raw member id reached the screen').not.toContain('m-7');
	});
});

describe('#344 review F3 — the name read fails LOUDLY, with a retry', () => {
	it('a rejected roster read says so inside the card, shows no names, and the Retry re-reads', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		loadRosterMock.mockRejectedValueOnce(new Error('boom'));
		const { container } = renderPage(futureEvent());
		await openCard(container);
		const errorLine = await waitFor(() => {
			const e = q(container, 'event-detail-tally-card-names-error');
			expect(e, 'a failed name read must be said on screen').not.toBeNull();
			return e!;
		});
		expect(errorLine.textContent).toContain('[event_detail_tally_names_error]');
		expect(container.querySelector('[data-testid="event-detail-tally-card"] li')).toBeNull();
		expect(q(container, 'event-detail-tally-card')!.textContent).not.toContain('member-1');

		loadRosterMock.mockResolvedValue(structuredClone(ROSTER_READ));
		await fireEvent.click(q(container, 'event-detail-tally-card-names-retry')!);
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-card-names-error')).toBeNull();
			expect(q(container, 'event-detail-tally-card-group-going')!.textContent).toContain(
				'Anna Alt'
			);
		});
		errorSpy.mockRestore();
	});

	it('a TRUNCATED active-member read says so NEXT TO THE LINE, card still closed (#344 review F2)', async () => {
		const { container } = renderPage(futureEvent(), { activeMembersCount: 900 });
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-not_responded')).not.toBeNull();
		});
		expect(q(container, 'event-detail-tally-card'), 'card must still be closed').toBeNull();
		const notice = await waitFor(() => {
			const n = q(container, 'event-detail-tally-partial-notice');
			expect(n, 'a truncated member read under-reports the fifth count unsaid').not.toBeNull();
			return n!;
		});
		expect(notice.textContent).toContain('[picker_partial_members_notice]');
	});

	it('an UNtruncated active-member read raises no line notice', async () => {
		const { container } = renderPage(futureEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-not_responded')).not.toBeNull();
		});
		expect(q(container, 'event-detail-tally-partial-notice')).toBeNull();
	});

	it('a PAST event carries no line notice — it shows no fifth count to under-report', async () => {
		const { container } = renderPage(pastEvent(), { activeMembersCount: 900 });
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-going')).not.toBeNull();
		});
		expect(q(container, 'event-detail-tally-not_responded')).toBeNull();
		expect(q(container, 'event-detail-tally-partial-notice')).toBeNull();
	});

	it('a TRUNCATED member read raises the partial-members notice inside the card (#321)', async () => {
		loadRosterMock.mockResolvedValue({ ...structuredClone(ROSTER_READ), truncated: true });
		const { container } = renderPage(futureEvent());
		await openCard(container);
		await waitFor(() => {
			expect(
				q(container, 'event-detail-tally-card-partial-notice'),
				'a short member read reads as "she is not a member" unless stated'
			).not.toBeNull();
		});
		expect(q(container, 'event-detail-tally-card-partial-notice')!.textContent).toContain(
			'[picker_partial_members_notice]'
		);
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Josquin*)
