// @vitest-environment happy-dom
//
// #205 RED — whole-field + tab activation on the season manage panel's three
// in-situ edit fields (name / start_date / end_date).
//
// Standing UX rule 4 (Mihkel 2026-09-01): an in-situ edit field's WHOLE field
// area is the click activator, not just the ✎ glyph. Rule-4 addendum (Mihkel
// overrule comment on #205): every activator is also TAB-to-activate — a
// native, Tab-reachable <button>.
//
// Reference shape (already live, pinned in page.admin-collective-name.spec.ts
// and admin/+page.svelte:513-540): ONE native <button type="button"> per field,
// `min-h-11 w-full`, the pencil AND the value INSIDE the button, an `sr-only`
// action label, hover pointer cue. Native button semantics give Tab + Enter/
// Space activation for free — which is why these tests assert on the ELEMENT
// (tagName, class list, containment), never on handlers: a div+onclick would
// pass a "does clicking work" probe while silently dropping the keyboard.
//
// CONTRACT (defined HERE, implemented in GREEN) — for each
// field ∈ name | start_date | end_date:
//   • season-edit-btn-<field>   stays the activator testid, but the element is
//     now the WHOLE-FIELD button: `w-full min-h-11`, wrapping BOTH the pencil
//     and the value element. NOT an icon-sized sibling (the pre-#205 shape,
//     retired along with page.agenda-admin.spec.ts's iconOnly pin on these
//     three testids).
//   • season-manage-<field>     stays the value element's testid and now lives
//     INSIDE the button — clicking the value (anywhere in the field area)
//     opens season-edit-input-<field>.
//   • the button carries an `sr-only` action label (reuse the existing
//     season_manage_edit_<field>_label keys — no new locale strings needed
//     here) so the accessible name is "<action label> <value>": action stated
//     for AT, value visible to AT, nothing riding on a title attribute.
//   • edit semantics UNCHANGED: input pre-filled, Enter saves through
//     updateSeasonField, Escape cancels, panel survives (already pinned in
//     page.season-manage.spec.ts — one regression guard here re-runs the save
//     path through the new activator).
//
// Integration posture: real src/routes/+page.svelte (the actual agenda route),
// real season-manage panel; only the data seams are mocked. Scaffolding
// inherited from page.season-manage.spec.ts.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy(
		{},
		{
			get:
				(_target, key) =>
				(params?: Record<string, unknown>) =>
					params === undefined ? String(key) : `${String(key)} ${JSON.stringify(params)}`
		}
	)
}));

const {
	loadFullAgendaMock,
	loadRosterMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock,
	discoverMock,
	gotoMock,
	findMyMemberIdMock,
	listMyRsvpsMock,
	listEventSeriesForSeasonMock,
	listEventsForSeasonMock,
	updateSeasonFieldMock,
	addSeasonConductorMock,
	removeSeasonConductorMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	loadRosterMock: vi.fn(),
	resolveDatabaseEntityIdMock: vi.fn(),
	resolveManageRightsMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	listEventSeriesForSeasonMock: vi.fn(),
	listEventsForSeasonMock: vi.fn(),
	updateSeasonFieldMock: vi.fn(),
	addSeasonConductorMock: vi.fn(),
	removeSeasonConductorMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: updateSeasonFieldMock,
	addSeasonConductor: addSeasonConductorMock,
	removeSeasonConductor: removeSeasonConductorMock
}));
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: vi.fn(),
	createEventSeries: vi.fn(),
	createEvent: vi.fn()
}));
vi.mock('$lib/collective/databaseEntity', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/collective/databaseEntity')>();
	return { ...actual, resolveDatabaseEntityId: resolveDatabaseEntityIdMock };
});
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: resolveManageRightsMock
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: findMyMemberIdMock,
	listMyRsvps: listMyRsvpsMock,
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
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
vi.mock('$lib/library/libraryData', () => ({
	listWorks: vi.fn().mockResolvedValue([]),
	listAllEditions: vi.fn().mockResolvedValue([]),
	listAllCopies: vi.fn().mockResolvedValue([])
}));
vi.mock('$lib/repertoire/repertoireData', () => ({
	listRepertoireItems: vi.fn().mockResolvedValue([])
}));

import Page from './+page.svelte';
import type { Season } from '$lib/seasons/types';
import type { RosterRow } from '$lib/roster/rosterData';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── fixtures (same family as page.season-manage.spec.ts) ───────────────────────

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const CFG = { db: 'polyphony', token: 'jwt-abc' };
const SEASON_ID = 'season-1';

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

const SEASON_START = isoDate(-30);
const SEASON_END = isoDate(60);

function currentSeason(): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: SEASON_START,
		endDate: SEASON_END,
		conductors: ['p-grace'],
		owners: [],
		editors: ['person-p']
	};
}

function agendaResult() {
	const season = currentSeason();
	return fullAgendaResult({
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: [season]
	});
}

function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-grace',
			personId: 'p-grace',
			name: 'Grace Hopper',
			email: 'grace@x.com',
			sectionIds: [],
			dbEntityId: ORG_EFK
		},
		{
			memberId: 'm-pete',
			personId: 'person-p',
			name: 'Pete Wilson',
			email: 'pete@x.com',
			sectionIds: [],
			dbEntityId: ORG_EFK
		}
	];
}

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(fixtureRows());
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue([]);
	listEventSeriesForSeasonMock.mockResolvedValue([]);
	listEventsForSeasonMock.mockResolvedValue([]);
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	resolveDatabaseEntityIdMock.mockReset();
	resolveManageRightsMock.mockReset();
	discoverMock.mockReset();
	gotoMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	listEventSeriesForSeasonMock.mockReset();
	listEventsForSeasonMock.mockReset();
	updateSeasonFieldMock.mockReset();
	addSeasonConductorMock.mockReset();
	removeSeasonConductorMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderReady(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-empty')).not.toBeNull();
	});
	return container;
}

async function openPanel(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(q(container, 'season-manage-gear')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-gear') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-manage-panel')).not.toBeNull();
	});
}

const FIELDS = ['name', 'start_date', 'end_date'] as const;

// ── whole-field shape: ONE full-width button wrapping pencil AND value ─────────

describe('#205 — season manage panel: whole-field activators (name/start_date/end_date)', () => {
	for (const field of FIELDS) {
		it(`${field}: the activator is ONE full-width native <button> that CONTAINS the value — not an icon-sized sibling`, async () => {
			const container = await renderReady();
			await openPanel(container);

			const btn = q(container, `season-edit-btn-${field}`) as HTMLElement;
			expect(btn, `season-edit-btn-${field} must render in the panel`).not.toBeNull();

			// Native button — Tab reachability + Enter/Space activation for free.
			// A div+onclick or a span+role=button hand-rolls (and loses) all three.
			expect(btn.tagName).toBe('BUTTON');
			expect(
				btn.getAttribute('tabindex'),
				'a native button is in the tab order by default — never opt it out'
			).not.toBe('-1');
			expect((btn as HTMLButtonElement).disabled).toBe(false);

			// The whole-field shape (#165 review F3 trap): `min-h-11` alone
			// collapses the width to the ~12px ✎ glyph — `w-full` is what makes
			// the FIELD the target.
			const classes = Array.from(btn.classList);
			expect(classes, 'the activator must reserve a 44px-tall touch target').toContain('min-h-11');
			expect(classes, 'the WHOLE field is the target, not the ✎ glyph').toContain('w-full');

			// The value element lives INSIDE the button — containment is the
			// structural fact that makes "click anywhere in the field" true.
			const value = q(container, `season-manage-${field}`);
			expect(value, `season-manage-${field} (the value element) must render`).not.toBeNull();
			expect(
				btn.contains(value),
				`season-manage-${field} must be INSIDE season-edit-btn-${field} — a flex sibling leaves the value dead to clicks`
			).toBe(true);
		});

		it(`${field}: the button carries an sr-only ACTION label, and the value is part of its own content (visible to AT)`, async () => {
			const container = await renderReady();
			await openPanel(container);

			const btn = q(container, `season-edit-btn-${field}`) as HTMLElement;
			expect(btn).not.toBeNull();

			// The action ("edit the name") is stated in an sr-only child — the
			// admin reference pattern. NOT title-only, NOT aria-label-only-with-
			// the-value-outside: the button's accessible name must carry both
			// the action and the value it acts on.
			const srOnly = btn.querySelector('.sr-only');
			expect(srOnly, 'the activator must carry an sr-only action label').not.toBeNull();
			expect((srOnly as HTMLElement).textContent?.trim()).not.toBe('');
		});

		// #205 review F1 — the `.sr-only`-exists check above structurally CANNOT
		// see whether the label is ever ANNOUNCED. The first GREEN shipped
		// `aria-labelledby="season-manage-<field>-value"` ON the button, and
		// aria-labelledby SUPERSEDES an element's own contents in the accname
		// algorithm — so the computed name was the bare value ("Season 2026") and
		// the action verb was silently dropped, a strict regression on the
		// pre-#205 aria-label. This test resolves the button BY ITS ACCESSIBLE
		// NAME (testing-library runs the real accname algorithm) so only a name
		// carrying BOTH halves can pass.
		it(`${field}: the computed ACCESSIBLE NAME is "<action label> <value>"`, async () => {
			const container = await renderReady();
			await openPanel(container);

			const btn = q(container, `season-edit-btn-${field}`) as HTMLElement;
			const action = (btn.querySelector('.sr-only')?.textContent ?? '')
				.replace(/\s+/g, ' ')
				.trim();
			const value = (q(container, `season-manage-${field}`)?.textContent ?? '')
				.replace(/\s+/g, ' ')
				.trim();
			expect(action, 'action label').not.toBe('');
			expect(value, 'value text').not.toBe('');

			expect(within(container).getByRole('button', { name: `${action} ${value}` })).toBe(btn);
			// Belt-and-braces on the two attributes that would silently override it.
			expect(btn.hasAttribute('aria-labelledby'), 'aria-labelledby supersedes contents').toBe(
				false
			);
			expect(btn.hasAttribute('aria-label'), 'aria-label supersedes contents').toBe(false);
		});
	}

	it('name: clicking the VALUE (not the pencil) opens the editor — the field area activates', async () => {
		const container = await renderReady();
		await openPanel(container);

		// Click lands on the value element itself. Pre-#205 this was a <p>
		// sibling of the pencil button — the click died there.
		const value = q(container, 'season-manage-name') as HTMLElement;
		expect(value.textContent).toContain('Season 2026');
		await fireEvent.click(value);

		await waitFor(() => {
			expect(q(container, 'season-edit-input-name')).not.toBeNull();
		});
		expect((q(container, 'season-edit-input-name') as HTMLInputElement).value).toBe('Season 2026');
	});

	it('start_date: clicking the VALUE opens the date editor', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-manage-start_date') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'season-edit-input-start_date')).not.toBeNull();
		});
		expect((q(container, 'season-edit-input-start_date') as HTMLInputElement).value).toBe(
			SEASON_START
		);
	});

	it('end_date: clicking the VALUE opens the date editor', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-manage-end_date') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'season-edit-input-end_date')).not.toBeNull();
		});
		expect((q(container, 'season-edit-input-end_date') as HTMLInputElement).value).toBe(
			SEASON_END
		);
	});

	it('regression: the save path through the new activator is unchanged — Enter calls updateSeasonField(cfg, seasonId, field, value)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-manage-name') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-name')).not.toBeNull();
		});
		const input = q(container, 'season-edit-input-name') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'Autumn splendour' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(updateSeasonFieldMock).toHaveBeenCalledWith(
				CFG,
				SEASON_ID,
				'name',
				'Autumn splendour'
			);
		});
		// Optimistic local reflect — and the value element is back inside its button.
		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Autumn splendour');
		});
		expect(
			(q(container, 'season-edit-btn-name') as HTMLElement).contains(
				q(container, 'season-manage-name')
			)
		).toBe(true);
	});

	// #205 review round 3 F3 — `w-full` is only half the promise. Both date
	// activators sit in flex ITEMS inside `<div class="flex gap-4">`, and a flex
	// item defaults to `flex: 0 1 auto` — content-sized — so `w-full` resolved
	// against whatever width the formatted date happened to need. The name
	// activator above spanned the panel while its two dates shrink-wrapped, and
	// the two dates disagreed with EACH OTHER whenever their values differed in
	// length. The `w-full` class assertion above structurally cannot see this:
	// it is the containing COLUMN, not the button, that collapses.
	for (const field of ['start_date', 'end_date'] as const) {
		it(`${field}: the activator's COLUMN claims flex basis — a w-full button inside an auto-width flex item is still content-sized`, async () => {
			const container = await renderReady();
			await openPanel(container);

			const btn = q(container, `season-edit-btn-${field}`) as HTMLElement;
			const column = btn.parentElement as HTMLElement;
			expect(column, `the ${field} activator must sit in a column div`).not.toBeNull();

			const row = column.parentElement as HTMLElement;
			expect(
				Array.from(row.classList),
				'sanity: the two date columns share one flex row'
			).toContain('flex');

			expect(
				Array.from(column.classList),
				`the ${field} column must claim flex basis, or its activator's w-full means "as wide as the date text"`
			).toContain('flex-1');
		});
	}

	it('the two date columns claim EQUAL basis — neither is wider for holding a longer value', async () => {
		const container = await renderReady();
		await openPanel(container);

		const startCol = (q(container, 'season-edit-btn-start_date') as HTMLElement).parentElement!;
		const endCol = (q(container, 'season-edit-btn-end_date') as HTMLElement).parentElement!;
		expect(startCol.parentElement, 'siblings in one flex row').toBe(endCol.parentElement);
		const basis = (el: HTMLElement) =>
			Array.from(el.classList).filter((c) => c.startsWith('flex-'));
		// Non-empty on BOTH sides first — two classless columns "agree" vacuously,
		// which is exactly the broken shape this test exists to reject.
		expect(basis(startCol).length).toBeGreaterThan(0);
		expect(basis(endCol)).toEqual(basis(startCol));
	});
});

// (*MVOX:Tallis* — #205 RED; review round-3 date-column width cases *MVOX:Josquin*)
