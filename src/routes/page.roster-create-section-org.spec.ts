// @vitest-environment happy-dom
//
// TU.1/#109 RED — findings #10 + #8 at the PAGE level (integration: actual
// /roster route component, real SectionPicker, real groupBySection; only the
// data-fetch/write seams are mocked — same harness as
// page.roster-create-section.spec.ts).
//
// Two pinned wiring contracts:
//
// 1. ORG THREADING (finding #10, root cause A): the page must hand
//    `createSection` the member's OWN organization id (`RosterRow.dbEntityId`,
//    carried from the member's `_parent` — see rosterData.org.spec.ts) so the
//    data layer never falls back to the live-verifiably-wrong `limit=1`
//    first-org guess (which returns the umbrella federation "Eesti
//    Kammerkooride Liit", not the collective). Pinned call shape:
//    `createSection(cfg, { name, parentId, dbEntityId })` on EVERY create — the data
//    layer ignores dbEntityId when parentId is set, so uniform threading is correct
//    and simplest.
//
// 2. LIVE-SHAPED CREATE → NESTED RENDER (findings #10 root cause B + #8): on
//    the real live tree (all four test orgs' sections FLAT — every standard
//    voice name taken somewhere), an admin creating "Soprano II" under Soprano
//    must actually go through (the TS.3 GLOBAL duplicate check refused it —
//    that is what "creation doesn't work in live" was) and the new section must
//    render NESTED inside Soprano's group. This is also the app-level path by
//    which finding #8's "Soprano II under Soprano" comes to exist at all: the
//    live db has NO section-parented section today (data, not rendering —
//    see page.roster-sections-live-wire.spec.ts for the rendering evidence).
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const { loadRosterMock, listSectionsMock, assignMock, unassignMock, createSectionMock } =
	vi.hoisted(() => ({
		loadRosterMock: vi.fn(),
		listSectionsMock: vi.fn(),
		assignMock: vi.fn(),
		unassignMock: vi.fn(),
		createSectionMock: vi.fn()
	}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
vi.mock('$lib/sections/sectionActions', () => ({
	assignMemberSection: assignMock,
	unassignMemberSection: unassignMock,
	createSection: createSectionMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import type { SectionNode } from '$lib/sections/sectionData';
import type { RosterRow } from '$lib/roster/rosterData';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── fixtures ────────────────────────────────────────────────────────────────────

/** Real live entity ids (2026-08-12 probe of polyphony). */
const ORG_EFK = '69c7f8718489bfcb0e81b065';
const ORG_SIREEN = '69c7f8788489bfcb0e81b1a9';
const EFK_SOPRANO = '69c7f8728489bfcb0e81b07b';
const SIREEN_SOPRANO_II = '69c7f8798489bfcb0e81b207';

/** LIVE-SHAPED tree: four test orgs' sections, ALL FLAT ROOTS (abbreviated to
 *  the rows this spec asserts against — the point is that a flat "Soprano II"
 *  ALREADY EXISTS while Soprano has no children). Each root carries its OWNING
 *  ORG (TU.1/#109 review — `SectionNode.dbEntityId`, read off the organization
 *  `_parent`), which is what keeps Sireen's roots out of EFK's sibling set. */
function liveShapedTree(): SectionNode[] {
	return [
		{
			id: EFK_SOPRANO,
			name: 'Soprano',
			displayOrder: 1,
			parentId: null,
			dbEntityId: ORG_EFK,
			depth: 0,
			children: []
		},
		{
			id: SIREEN_SOPRANO_II,
			name: 'Soprano II',
			displayOrder: 3,
			parentId: null,
			dbEntityId: ORG_SIREEN,
			depth: 0,
			children: []
		},
		{
			id: 'sec-alto',
			name: 'Alto',
			displayOrder: 4,
			parentId: null,
			dbEntityId: ORG_EFK,
			depth: 0,
			children: []
		}
	];
}

/** Rows carry the member's org (TU.1 contract — rosterData.org.spec.ts). */
function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-ada',
			personId: 'p-ada',
			name: 'Ada Lovelace',
			email: 'ada@x.com',
			sectionIds: [EFK_SOPRANO],
			dbEntityId: ORG_EFK
		},
		{
			memberId: 'm-pete',
			personId: 'p-pete',
			name: 'Pete Wilson',
			email: 'pete@x.com',
			sectionIds: [],
			dbEntityId: ORG_EFK
		}
	];
}

const CFG = { db: 'polyphony', token: 'jwt-abc' };

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
	loadRosterMock.mockResolvedValue(fixtureRows());
	listSectionsMock.mockResolvedValue(liveShapedTree());
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createSectionMock.mockResolvedValue('sec-new-1');
});

afterEach(() => {
	cleanup();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	assignMock.mockReset();
	unassignMock.mockReset();
	createSectionMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetAdmin();
});

async function renderReady() {
	setAuthedWithOneCollective();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="roster-groups"]')).not.toBeNull();
	});
	// TU.2/#110 finding #9 — sections default COLLAPSED now (member rows, and
	// this file's picker triggers, don't render until expanded); this file's
	// concern is org threading into createSection, not the collapse default,
	// so expand everything up front via the same toggle-all control #9 shipped.
	const toggleAll = container.querySelector('[data-testid="roster-view-chip-expanded"]') as HTMLElement | null;
	if (toggleAll) {
		await fireEvent.click(toggleAll);
		await waitFor(() => {
			expect(container.querySelector('[data-testid^="roster-row-"]')).not.toBeNull();
		});
	}
	return container;
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function openForm(container: HTMLElement, memberId: string): Promise<void> {
	await fireEvent.click(q(container, `section-picker-trigger-${memberId}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `section-picker-menu-${memberId}`)).not.toBeNull();
	});
	await fireEvent.click(q(container, 'section-picker-new') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'section-create-form')).not.toBeNull();
	});
}

async function typeName(container: HTMLElement, value: string): Promise<void> {
	await fireEvent.input(q(container, 'section-create-name') as HTMLElement, {
		target: { value }
	});
}

async function submit(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'section-create-submit') as HTMLElement);
}

// ── 1. org threading: the page passes the member's own org ──────────────────────

describe("/roster — 'Create + assign' threads the MEMBER'S org id into createSection (finding #10)", () => {
	it("top-level create for m-pete: createSection(cfg, { name, parentId: null, dbEntityId: <m-pete's org> }) — the page, which KNOWS the org, must say it; the data layer must not guess", async () => {
		const container = await renderReady();

		await openForm(container, 'm-pete');
		await typeName(container, 'Tenor');
		await submit(container);

		await waitFor(() => {
			expect(createSectionMock).toHaveBeenCalledTimes(1);
		});
		expect(createSectionMock).toHaveBeenCalledWith(CFG, {
			name: 'Tenor',
			parentId: null,
			dbEntityId: ORG_EFK
		});
	});

	it("TU.1/#109 review — a TOP-LEVEL 'Soprano II' for an EFK member is NOT refused by Kammernaiskoor Sireen's root of the same name: the page hands the picker the member's org, so cross-org roots are not siblings", async () => {
		const container = await renderReady();

		await openForm(container, 'm-pete');
		await typeName(container, 'Soprano II');
		await submit(container);

		expect(q(container, 'section-create-error')).toBeNull();
		await waitFor(() => {
			expect(createSectionMock).toHaveBeenCalledTimes(1);
		});
		expect(createSectionMock).toHaveBeenCalledWith(CFG, {
			name: 'Soprano II',
			parentId: null,
			dbEntityId: ORG_EFK
		});
	});

	it("a TOP-LEVEL duplicate of EFK's OWN root ('Alto') is still refused for an EFK member — no write, error shown", async () => {
		const container = await renderReady();

		await openForm(container, 'm-pete');
		await typeName(container, 'Alto');
		await submit(container);

		expect(q(container, 'section-create-error')?.textContent).toContain(
			'roster_section_duplicate'
		);
		expect(createSectionMock).not.toHaveBeenCalled();
	});

	it('sub-section create: dbEntityId rides along uniformly (the data layer ignores it when parentId is set) — createSection(cfg, { name, parentId: Soprano, dbEntityId })', async () => {
		const container = await renderReady();

		await openForm(container, 'm-pete');
		await typeName(container, 'Soprano II');
		await fireEvent.change(q(container, 'section-create-parent') as HTMLElement, {
			target: { value: EFK_SOPRANO }
		});
		await submit(container);

		await waitFor(() => {
			expect(createSectionMock).toHaveBeenCalledTimes(1);
		});
		expect(createSectionMock).toHaveBeenCalledWith(CFG, {
			name: 'Soprano II',
			parentId: EFK_SOPRANO,
			dbEntityId: ORG_EFK
		});
	});
});

// ── 2. the live-shaped repro: Soprano II under Soprano must go through ──────────

describe('/roster on the LIVE-SHAPED tree — creating "Soprano II" under Soprano works and renders NESTED (findings #10 + #8)', () => {
	it("admin submits name 'Soprano II', parent Soprano — ANOTHER org's flat 'Soprano II' must NOT block it: createSection fires, the new group renders nested inside Soprano's group (data-depth 1) with m-pete's row in it", async () => {
		const container = await renderReady();

		await openForm(container, 'm-pete');
		await typeName(container, 'Soprano II');
		await fireEvent.change(q(container, 'section-create-parent') as HTMLElement, {
			target: { value: EFK_SOPRANO }
		});
		await submit(container);

		// The submit was VALID — no duplicate refusal, the write fired.
		expect(q(container, 'section-create-error')).toBeNull();
		await waitFor(() => {
			expect(createSectionMock).toHaveBeenCalledTimes(1);
		});

		// …and the new section appears NESTED under Soprano (finding #8's target
		// shape), member row inside, without any refetch.
		await waitFor(() => {
			expect(
				q(container, `section-group-${EFK_SOPRANO}`)?.querySelector(
					'[data-testid="section-group-sec-new-1"]'
				)
			).not.toBeNull();
		});
		const newGroup = q(container, 'section-group-sec-new-1') as HTMLElement;
		expect(newGroup.getAttribute('data-depth')).toBe('1');
		expect(newGroup.querySelector('[data-testid="roster-row-m-pete"]')).not.toBeNull();
		expect(listSectionsMock).toHaveBeenCalledTimes(1);
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
	});
});

// (*MVOX:Tallis* — TU.1/#109 RED, findings #10 + #8: org threading + live-shaped create-nested flow)
