// @vitest-environment happy-dom
//
// #214 RED — INTEGRATION: event type filter chips above the agenda.
//
// Real +page.svelte + real AgendaList; only the data seams are mocked (same
// harness family as page.agenda-event-types.spec.ts). Gama's rulings on the
// issue (2026-09-02, all three comments) pin the contract:
//
//   - Chip set derived from the event types PRESENT in the rendered agenda
//     (recent + upcoming, all seasons the list spans), recomputed whenever
//     the list changes. Not the canonical 8, not "current season" literally.
//   - Single-select toggle with an explicit "All" chip (polyphony.uk pattern,
//     standing rule 3): tap a chip = only that type; tap the active chip
//     again = all.
//   - The filter applies to the WHOLE agenda, Recent section included.
//   - Free-text or empty event_type values group under the "other" chip for
//     FILTERING; the row badge keeps showing the raw string (visibly wrong
//     beats invisibly blank). The "other" chip appears only when such events,
//     or canonical `other` events, exist in the list.
//   - If the active type disappears from the list, the chip is removed and
//     the filter resets to "all" — never an empty list under a filter the
//     user can no longer see.
//   - Filter state resets on collective switch.
//   - Visual scheme = #211's eventTypeBadgeClass (active chip hued/filled;
//     inactive chips quiet, no hued classes).
//
// Structure pinned (GREEN implements in src/routes/+page.svelte, immediately
// above <AgendaList>):
//   - a native <div role="group" aria-label={m.agenda_filter_group_label()}>
//     of native <button type="button" aria-pressed> elements (standing rules
//     1/2 — no hand-rolled widgets),
//   - data-testid="agenda-filter-all" / "agenda-filter-<type>", in
//     CANONICAL_EVENT_TYPES order, only types present, "All" first,
//   - chip text via the SHARED eventTypeLabel map (localized),
//   - filtering happens at PAGE level: items/recentItems are pre-filtered
//     before being passed to AgendaList, so the component's "never filters by
//     type" contract (AgendaList.event-type.spec.ts) stays untouched,
//   - a filter yielding ZERO upcoming rows renders a DISTINCT message
//     data-testid="agenda-filter-empty" (key agenda_filter_empty) instead of
//     AgendaList's agenda-empty ("No upcoming events." would be a lie — the
//     collective HAS events, the filter hid them),
//   - the chip row is hidden entirely when the agenda has no events at all,
//   - new keys agenda_filter_all / agenda_filter_group_label /
//     agenda_filter_empty in all four locales (en 'All' / et 'Kõik' verbatim).
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgendaItem } from '$lib/agenda/types';
// #211's ONE scheme — the chips must consume the same map the badges do,
// never a second hand-typed copy.
import { eventTypeBadgeClass } from '$lib/events/eventTypeStyles';

vi.mock('$lib/paraglide/messages.js', () => {
	const keys: Record<string, (params?: Record<string, unknown>) => string> = {
		agenda_duration_min: (params) => `${(params as { minutes: number }).minutes} min`,
		// Distinct markers: chip text and the group label must go through
		// paraglide, never raw/hardcoded strings.
		agenda_filter_all: () => '[msg:filter-all]',
		agenda_filter_group_label: () => '[msg:filter-group]',
		agenda_filter_empty: () => '[msg:filter-empty]',
		agenda_filter_recent_empty: () => '[msg:filter-recent-empty]',
		event_type_rehearsal: () => '[msg:rehearsal]',
		event_type_concert: () => '[msg:concert]',
		event_type_social: () => '[msg:social]',
		event_type_other: () => '[msg:other]'
	};
	return {
		m: new Proxy(keys, {
			get: (target, key) => target[String(key)] ?? (() => `[${String(key)}]`)
		})
	};
});

const { loadFullAgendaMock, discoverMock, gotoMock, findMyMemberIdMock, listMyRsvpsMock } =
	vi.hoisted(() => ({
		loadFullAgendaMock: vi.fn(),
		discoverMock: vi.fn(),
		gotoMock: vi.fn(),
		findMyMemberIdMock: vi.fn(),
		listMyRsvpsMock: vi.fn()
	}));
vi.mock('$lib/agenda/agendaData', () => ({
	loadFullAgenda: loadFullAgendaMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn().mockResolvedValue('not-editor')
}));
vi.mock('$lib/collective/databaseEntity', async (importActual) => ({
	...(await importActual<typeof import('$lib/collective/databaseEntity')>()),
	resolveDatabaseEntityId: vi.fn().mockResolvedValue(null)
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: findMyMemberIdMock,
	listMyRsvps: listMyRsvpsMock,
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn() }));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn().mockResolvedValue([]),
	listMyAttendance: vi.fn().mockResolvedValue([]),
	listAllRsvpsForEvent: vi.fn().mockResolvedValue([]),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
}));
vi.mock('$lib/repertoire/workRows', () => ({ loadWorksByEventId: vi.fn().mockResolvedValue({}) }));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';

function setAuthedWithOneCollective() {
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'p1' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'p1' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

function setAuthedWithTwoCollectives() {
	authStore.set({
		status: 'authenticated',
		personIdByDb: { 'org-a': 'p1', 'org-b': 'p1' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [
			{ db: 'org-a', name: 'Org A', personId: 'p1' },
			{ db: 'org-b', name: 'Org B', personId: 'p1' }
		],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('org-a');
}

function item(id: string, name: string, startDatetime: string, eventType: string): AgendaItem {
	return {
		id,
		name,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: [],
		eventType
	} as AgendaItem;
}

// Far-future upcoming dates: the page renders `upcoming` as handed over, but
// AgendaList's relative-day decoration reads the real clock — keep the
// fixtures ahead of it. Recent dates are in the past, as the section implies.
const UP_REHEARSAL = item('up-reh', 'Tavaline proov', '2030-06-10T16:00:00.000Z', 'rehearsal');
const UP_CONCERT = item('up-con', 'Kevadkontsert', '2030-06-12T18:00:00.000Z', 'concert');
const UP_OTHER = item('up-other', 'Muu üritus', '2030-06-15T16:00:00.000Z', 'other');
const UP_FREETEXT = item('up-proov', 'Eriproov', '2030-06-14T16:00:00.000Z', 'proov');
const UP_UNTYPED = item('up-untyped', 'Tüübita üritus', '2030-06-16T16:00:00.000Z', '');
const RECENT_SOCIAL = item('rec-soc', 'Suvepidu', '2026-05-01T18:00:00.000Z', 'social');
const RECENT_CONCERT = item('rec-con', 'Talvekontsert', '2026-04-01T18:00:00.000Z', 'concert');

/** The chip GROUP — pinned as a native role="group" div whose accessible name
 *  is the localized agenda_filter_group_label. */
function chipGroup(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[role="group"][aria-label="[msg:filter-group]"]');
}

/** All chips, in DOM order, as the native <button> elements they must be. */
function chips(container: HTMLElement): HTMLButtonElement[] {
	const group = chipGroup(container);
	return group ? Array.from(group.querySelectorAll('button')) : [];
}

function chipTestids(container: HTMLElement): (string | null)[] {
	return chips(container).map((b) => b.getAttribute('data-testid'));
}

function chipTexts(container: HTMLElement): (string | undefined)[] {
	return chips(container).map((b) => b.textContent?.trim());
}

function chip(container: HTMLElement, testid: string): HTMLButtonElement {
	const el = container.querySelector(`[data-testid="${testid}"]`);
	expect(el, `chip ${testid} must exist`).not.toBeNull();
	return el as HTMLButtonElement;
}

function upcomingRowIds(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll('[data-testid^="agenda-row-"]')).map((el) =>
		(el.getAttribute('data-testid') as string).replace('agenda-row-', '')
	);
}

function recentRowIds(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll('[data-testid^="agenda-recent-row-"]')).map((el) =>
		(el.getAttribute('data-testid') as string).replace('agenda-recent-row-', '')
	);
}

async function renderAgenda(
	upcoming: AgendaItem[],
	recent: AgendaItem[] = []
): Promise<HTMLElement> {
	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ upcoming, recent }));
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="agenda-skeleton"]')).toBeNull();
	});
	return container as HTMLElement;
}

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue([]);

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	// The F3 tests below drive a confirmed member through the completion gate;
	// leaving it 'complete' would leak a member view into every later test.
	resetGate();
});

describe('#214 — chip DERIVATION from the rendered agenda', () => {
	it('renders exactly [All, rehearsal, concert, social] for a rehearsal+concert upcoming and a social recent — canonical order, native buttons, above the agenda', async () => {
		const container = await renderAgenda([UP_REHEARSAL, UP_CONCERT], [RECENT_SOCIAL]);

		// Exactly the types present (recent counts toward derivation — Gama
		// ruling 2), in CANONICAL_EVENT_TYPES order, All first. Full arrays, not
		// objectContaining — partial assertions hid four real bugs already.
		expect(chipTestids(container)).toEqual([
			'agenda-filter-all',
			'agenda-filter-rehearsal',
			'agenda-filter-concert',
			'agenda-filter-social'
		]);
		expect(chipTexts(container)).toEqual([
			'[msg:filter-all]',
			'[msg:rehearsal]',
			'[msg:concert]',
			'[msg:social]'
		]);

		// Native controls (standing rules 1/2): real <button type="button"> with
		// aria-pressed carrying the toggle state; All active by default.
		for (const btn of chips(container)) {
			expect(btn.tagName).toBe('BUTTON');
			expect(btn.getAttribute('type')).toBe('button');
			expect(btn.getAttribute('aria-pressed')).not.toBeNull();
		}
		expect(chip(container, 'agenda-filter-all').getAttribute('aria-pressed')).toBe('true');
		expect(chip(container, 'agenda-filter-rehearsal').getAttribute('aria-pressed')).toBe('false');
		expect(chip(container, 'agenda-filter-concert').getAttribute('aria-pressed')).toBe('false');
		expect(chip(container, 'agenda-filter-social').getAttribute('aria-pressed')).toBe('false');

		// Placement: the chip row precedes the WHOLE agenda — the Recent section
		// included (it renders above the upcoming list, so "above <AgendaList>"
		// means above Recent too).
		const group = chipGroup(container) as HTMLElement;
		const recentSection = container.querySelector('[data-testid="agenda-recent"]') as HTMLElement;
		expect(recentSection).not.toBeNull();
		expect(
			// eslint-disable-next-line no-bitwise
			group.compareDocumentPosition(recentSection) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});

	it("a free-text type ('proov') adds the 'other' chip — grouped, never its own raw-labeled chip", async () => {
		const container = await renderAgenda([UP_REHEARSAL, UP_CONCERT, UP_FREETEXT], [RECENT_SOCIAL]);

		expect(chipTestids(container)).toEqual([
			'agenda-filter-all',
			'agenda-filter-rehearsal',
			'agenda-filter-concert',
			'agenda-filter-social',
			'agenda-filter-other'
		]);
		// No chip carries the raw free-text label — 'proov' lives under 'other'.
		expect(chipTexts(container)).toEqual([
			'[msg:filter-all]',
			'[msg:rehearsal]',
			'[msg:concert]',
			'[msg:social]',
			'[msg:other]'
		]);
	});

	it('no events at all → the chip row is hidden entirely (no group, no All chip)', async () => {
		const container = await renderAgenda([], []);

		expect(container.querySelector('[data-testid="agenda-empty"]')).not.toBeNull();
		expect(chipGroup(container)).toBeNull();
		expect(container.querySelector('[data-testid="agenda-filter-all"]')).toBeNull();
	});
});

describe('#214 — single-select TOGGLE (polyphony.uk pattern)', () => {
	it('tap concert → only concert rows in BOTH sections; tap concert again → all rows back', async () => {
		const container = await renderAgenda(
			[UP_REHEARSAL, UP_CONCERT],
			[RECENT_SOCIAL, RECENT_CONCERT]
		);
		expect(upcomingRowIds(container)).toEqual(['up-reh', 'up-con']);
		expect(recentRowIds(container)).toEqual(['rec-soc', 'rec-con']);

		await fireEvent.click(chip(container, 'agenda-filter-concert'));

		// Exact row sets — the whole agenda filters, Recent included.
		expect(upcomingRowIds(container)).toEqual(['up-con']);
		expect(recentRowIds(container)).toEqual(['rec-con']);
		expect(chip(container, 'agenda-filter-concert').getAttribute('aria-pressed')).toBe('true');
		expect(chip(container, 'agenda-filter-all').getAttribute('aria-pressed')).toBe('false');
		expect(chip(container, 'agenda-filter-rehearsal').getAttribute('aria-pressed')).toBe('false');

		// Tap the ACTIVE chip again = back to all.
		await fireEvent.click(chip(container, 'agenda-filter-concert'));
		expect(upcomingRowIds(container)).toEqual(['up-reh', 'up-con']);
		expect(recentRowIds(container)).toEqual(['rec-soc', 'rec-con']);
		expect(chip(container, 'agenda-filter-all').getAttribute('aria-pressed')).toBe('true');
		expect(chip(container, 'agenda-filter-concert').getAttribute('aria-pressed')).toBe('false');
	});

	it('the explicit All chip clears an active filter too', async () => {
		const container = await renderAgenda([UP_REHEARSAL, UP_CONCERT], [RECENT_SOCIAL]);

		await fireEvent.click(chip(container, 'agenda-filter-rehearsal'));
		expect(upcomingRowIds(container)).toEqual(['up-reh']);
		expect(recentRowIds(container)).toEqual([]);

		await fireEvent.click(chip(container, 'agenda-filter-all'));
		expect(upcomingRowIds(container)).toEqual(['up-reh', 'up-con']);
		expect(recentRowIds(container)).toEqual(['rec-soc']);
		expect(chip(container, 'agenda-filter-all').getAttribute('aria-pressed')).toBe('true');
		expect(chip(container, 'agenda-filter-rehearsal').getAttribute('aria-pressed')).toBe('false');
	});

	it('the Recent section is filtered too (a recent-only type hides under a different filter)', async () => {
		const container = await renderAgenda([UP_CONCERT], [RECENT_SOCIAL, RECENT_CONCERT]);

		await fireEvent.click(chip(container, 'agenda-filter-concert'));

		expect(container.querySelector('[data-testid="agenda-recent-row-rec-soc"]')).toBeNull();
		expect(container.querySelector('[data-testid="agenda-recent-row-rec-con"]')).not.toBeNull();
		expect(upcomingRowIds(container)).toEqual(['up-con']);
	});
});

describe("#214 — the 'other' bucket (free-text and empty types)", () => {
	it("filtering by 'other' shows canonical-other, free-text AND type-less rows; badges keep the raw string", async () => {
		const container = await renderAgenda([UP_REHEARSAL, UP_OTHER, UP_FREETEXT, UP_UNTYPED]);
		expect(chipTestids(container)).toEqual([
			'agenda-filter-all',
			'agenda-filter-rehearsal',
			'agenda-filter-other'
		]);

		await fireEvent.click(chip(container, 'agenda-filter-other'));

		// The bucket, exactly: canonical 'other' + free-text 'proov' + '' — the
		// rehearsal is gone.
		expect(upcomingRowIds(container)).toEqual(['up-other', 'up-proov', 'up-untyped']);

		// The ROW BADGES are untouched by the grouping: the free-text row still
		// shows its raw string (visibly wrong beats invisibly blank), the
		// canonical row its localized label, the type-less row no badge at all.
		expect(
			container.querySelector('[data-testid="event-type-badge-up-proov"]')?.textContent?.trim()
		).toBe('proov');
		expect(
			container.querySelector('[data-testid="event-type-badge-up-other"]')?.textContent?.trim()
		).toBe('[msg:other]');
		expect(container.querySelector('[data-testid="event-type-badge-up-untyped"]')).toBeNull();
	});
});

describe('#214 — chip set RECOMPUTES when the list changes', () => {
	it('the active type disappearing from the list removes its chip and resets the filter to all', async () => {
		loadFullAgendaMock
			.mockResolvedValueOnce(fullAgendaResult({ upcoming: [UP_REHEARSAL, UP_CONCERT] }))
			.mockResolvedValueOnce(fullAgendaResult({ upcoming: [UP_REHEARSAL] }));
		setAuthedWithOneCollective();
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-row-up-con"]')).not.toBeNull();
		});

		await fireEvent.click(chip(container as HTMLElement, 'agenda-filter-concert'));
		expect(upcomingRowIds(container as HTMLElement)).toEqual(['up-con']);

		// The list changes under the active filter: a reload of the SAME
		// collective comes back without any concert (last one deleted). Setting
		// collectiveState with a fresh (identical-db) list re-runs the page's
		// selected-tracking load — the same seam page.agenda-error.spec.ts uses.
		collectiveState.set({
			status: 'ready',
			collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'p1' }],
			erroredDbs: []
		});

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-row-up-reh"]')).not.toBeNull();
		});

		// Chip gone, filter reset — never an empty list under a filter the user
		// can no longer see (Gama ruling 1, consequence 2).
		expect(chipTestids(container as HTMLElement)).toEqual([
			'agenda-filter-all',
			'agenda-filter-rehearsal'
		]);
		expect(chip(container as HTMLElement, 'agenda-filter-all').getAttribute('aria-pressed')).toBe(
			'true'
		);
		expect(upcomingRowIds(container as HTMLElement)).toEqual(['up-reh']);
		expect(container.querySelector('[data-testid="agenda-filter-empty"]')).toBeNull();
	});
});

describe('#214 — filtered-empty state', () => {
	it('a filter yielding ZERO upcoming rows shows agenda-filter-empty, NOT agenda-empty', async () => {
		const container = await renderAgenda([UP_REHEARSAL], [RECENT_SOCIAL]);

		await fireEvent.click(chip(container, 'agenda-filter-social'));

		expect(upcomingRowIds(container)).toEqual([]);
		const filterEmpty = container.querySelector('[data-testid="agenda-filter-empty"]');
		expect(filterEmpty).not.toBeNull();
		expect(filterEmpty?.textContent?.trim()).toBe('[msg:filter-empty]');
		// "No upcoming events." would be a lie — the collective HAS events, the
		// filter hid them. The plain empty state must NOT render here.
		expect(container.querySelector('[data-testid="agenda-empty"]')).toBeNull();
		// The whole-agenda filter still lets the matching RECENT row through —
		// which is exactly why the copy is UPCOMING-scoped (review F2): the
		// screen would otherwise claim "no events match" directly above a
		// matching event.
		expect(recentRowIds(container)).toEqual(['rec-soc']);
	});
});

// Review F3 — the #85 season summary is a WHOLE-season figure (computed from
// the UNFILTERED recentItems and not type-scoped at all). AgendaList gates the
// entire Recent section — header and summary included — on recentItems.length,
// so page-level filtering silently took the summary off screen for any type
// with no past events yet.
describe('#214 review F3 — a type filter never hides the season summary', () => {
	async function renderAsMember(
		upcoming: AgendaItem[],
		recent: AgendaItem[]
	): Promise<HTMLElement> {
		findMyMemberIdMock.mockResolvedValue('m-me');
		completionGateStore.set('complete');
		const container = await renderAgenda(upcoming, recent);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="season-summary"]')).not.toBeNull();
		});
		return container;
	}

	it('a member filtering to a type with zero matching RECENT rows still sees the summary', async () => {
		const container = await renderAsMember([UP_REHEARSAL], [RECENT_SOCIAL]);

		await fireEvent.click(chip(container, 'agenda-filter-rehearsal'));

		// The social recent row is filtered out, but the section, its header and
		// the season summary stay — with the recent list's OWN scoped message.
		expect(recentRowIds(container)).toEqual([]);
		expect(container.querySelector('[data-testid="agenda-recent"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="season-summary"]')).not.toBeNull();
		expect(
			container.querySelector('[data-testid="agenda-recent-filter-empty"]')?.textContent?.trim()
		).toBe('[msg:filter-recent-empty]');
	});

	it('with no recent events at all, a filter does not conjure an empty Recent section', async () => {
		const container = await renderAgenda([UP_REHEARSAL, UP_CONCERT], []);

		await fireEvent.click(chip(container, 'agenda-filter-concert'));

		expect(container.querySelector('[data-testid="agenda-recent"]')).toBeNull();
		expect(container.querySelector('[data-testid="agenda-recent-filter-empty"]')).toBeNull();
	});
});

describe('#214 — collective switch resets the filter', () => {
	it('an active filter does not survive into the next collective', async () => {
		loadFullAgendaMock
			.mockResolvedValueOnce(fullAgendaResult({ upcoming: [UP_REHEARSAL, UP_CONCERT] }))
			.mockResolvedValueOnce(
				fullAgendaResult({
					upcoming: [
						item('b-reh', 'B proov', '2030-07-10T16:00:00.000Z', 'rehearsal'),
						item('b-con', 'B kontsert', '2030-07-12T18:00:00.000Z', 'concert')
					]
				})
			);
		setAuthedWithTwoCollectives();
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-row-up-con"]')).not.toBeNull();
		});

		await fireEvent.click(chip(container as HTMLElement, 'agenda-filter-concert'));
		expect(upcomingRowIds(container as HTMLElement)).toEqual(['up-con']);

		selectedCollectiveDbStore.set('org-b');

		// BOTH org-b rows visible — a stale concert filter would have hidden
		// b-reh. All is the pressed chip again.
		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-row-b-reh"]')).not.toBeNull();
		});
		expect(upcomingRowIds(container as HTMLElement)).toEqual(['b-reh', 'b-con']);
		expect(chip(container as HTMLElement, 'agenda-filter-all').getAttribute('aria-pressed')).toBe(
			'true'
		);
		expect(
			chip(container as HTMLElement, 'agenda-filter-concert').getAttribute('aria-pressed')
		).toBe('false');
	});
});

describe("#214 — visual scheme: #211's eventTypeBadgeClass on the ACTIVE chip only", () => {
	it('the active chip carries the shared scheme classes for its type; inactive chips do not', async () => {
		const container = await renderAgenda([UP_REHEARSAL, UP_CONCERT]);

		const concertClasses = eventTypeBadgeClass('concert').split(/\s+/).filter(Boolean);
		const rehearsalClasses = eventTypeBadgeClass('rehearsal').split(/\s+/).filter(Boolean);
		expect(concertClasses.length).toBeGreaterThan(0);

		// Before any tap: no type chip is active, so neither carries its hued
		// scheme classes (inactive = quiet outline).
		for (const cls of concertClasses) {
			expect(
				chip(container, 'agenda-filter-concert').classList.contains(cls),
				`inactive concert chip must not carry ${cls}`
			).toBe(false);
		}

		await fireEvent.click(chip(container, 'agenda-filter-concert'));

		// Active chip: hued/filled per the SHARED #211 map — every class token,
		// verbatim from eventTypeBadgeClass (never a re-typed copy).
		for (const cls of concertClasses) {
			expect(
				chip(container, 'agenda-filter-concert').classList.contains(cls),
				`active concert chip must carry ${cls}`
			).toBe(true);
		}
		// The inactive rehearsal chip carries NONE of its own hued classes.
		for (const cls of rehearsalClasses) {
			expect(
				chip(container, 'agenda-filter-rehearsal').classList.contains(cls),
				`inactive rehearsal chip must not carry ${cls}`
			).toBe(false);
		}
	});

	// Review F1 — the hue ALONE cannot be the pressed affordance. #211 maps
	// social and other (and every free-text type, which buckets into 'other')
	// to the quiet DEFAULT_CLASS 'text-ink-2 border-ink-4' — byte-identical to
	// the inactive chip style, so tapping those chips shortened the agenda while
	// nothing on screen looked selected and the All chip lost its fill. The two
	// hued types the test above probes could never catch it.
	it('EVERY chip — hued or quiet — is visibly different when active, social and other included', async () => {
		const container = await renderAgenda([UP_REHEARSAL, UP_OTHER], [RECENT_SOCIAL]);

		for (const type of ['rehearsal', 'social', 'other']) {
			const testid = `agenda-filter-${type}`;
			const inactive = new Set(chip(container, testid).classList);

			await fireEvent.click(chip(container, testid));

			expect(chip(container, testid).getAttribute('aria-pressed')).toBe('true');
			const active = new Set(chip(container, testid).classList);
			const added = [...active].filter((cls) => !inactive.has(cls));
			expect(
				added.length,
				`the active ${type} chip must carry at least one class its inactive self does not`
			).toBeGreaterThan(0);

			// Toggle back to All so the next chip starts from the inactive style.
			await fireEvent.click(chip(container, testid));
			expect(chip(container, testid).getAttribute('aria-pressed')).toBe('false');
		}
	});
});

describe('#214 — the new keys exist in all four locales', () => {
	const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
	const NEW_KEYS = [
		'agenda_filter_all',
		'agenda_filter_group_label',
		'agenda_filter_empty',
		// Review F3 — the Recent list's own filtered-empty line.
		'agenda_filter_recent_empty'
	];

	function messages(locale: (typeof LOCALES)[number]): Record<string, unknown> {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as Record<string, unknown>;
	}

	it.each(LOCALES)('%s carries all three keys, non-empty', (locale) => {
		const file = messages(locale);
		for (const key of NEW_KEYS) {
			expect(file[key], `${locale}.json must define ${key}`).toBeDefined();
			expect(typeof file[key]).toBe('string');
			expect((file[key] as string).trim().length).toBeGreaterThan(0);
		}
	});

	it("agenda_filter_all is the verbatim copy: en 'All', et 'Kõik'", () => {
		expect(messages('en').agenda_filter_all).toBe('All');
		expect(messages('et').agenda_filter_all).toBe('Kõik');
	});

	// Review F2 — each filtered-empty line governs ONE list, and must claim no
	// more emptiness than actually holds: the upcoming line renders while a
	// matching Recent row can be visible directly above it (and vice versa).
	it('each filtered-empty copy names the list it governs, in every locale', () => {
		expect(messages('en').agenda_filter_empty).toBe('No upcoming events match this filter.');
		expect(messages('en').agenda_filter_recent_empty).toBe('No recent events match this filter.');
		expect(messages('et').agenda_filter_empty).toBe(
			'Ükski eelseisev sündmus ei vasta sellele filtrile.'
		);
		expect(messages('et').agenda_filter_recent_empty).toBe(
			'Ükski hiljutine sündmus ei vasta sellele filtrile.'
		);
		// The two lines must never be the same sentence in any locale — that is
		// exactly the whole-agenda claim this fix removed.
		for (const locale of LOCALES) {
			const file = messages(locale);
			expect(file.agenda_filter_empty, locale).not.toBe(file.agenda_filter_recent_empty);
		}
	});
});

// (*MVOX:Tallis* — #214 RED)
