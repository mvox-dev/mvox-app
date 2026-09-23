// @vitest-environment happy-dom
//
// TU.1/#109 findings #10 + #8 at the PAGE level — RE-DRIVEN through the
// page-level `roster-new-section` entry (#470: the picker's inline create form
// is RETIRED — "drop the new section creation" — so the ORG FENCE these pins
// exist for now lives exclusively on the arrange-mode create; harness shape
// from page.roster-create-section-entry.spec.ts). Integration: actual /roster
// route, real groupBySection; only the data-fetch/write seams are mocked.
//
// Two pinned wiring contracts (subjects unchanged from the TU.1 originals):
//
// 1. ORG THREADING (finding #10, root cause A): the page must hand
//    `createSection` the VIEWER's own collective id (`currentDbEntityId`, read
//    off her own roster row) so the data layer never falls back to the
//    live-verifiably-wrong `limit=1` first-org guess. Pinned call shape:
//    `createSection(cfg, { name, parentId, dbEntityId })` on EVERY create.
//
// 2. LIVE-SHAPED CREATE → NESTED RENDER (findings #10 root cause B + #8): on
//    the real live tree (foreign orgs' roots flat, every standard voice name
//    taken somewhere), creating "Soprano II" under Soprano must go through
//    (the old GLOBAL duplicate check refused it) and the new section must
//    render NESTED — in the arrange list, at depth 1.
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
// #269 review F1/F2 — /roster calls the OPT-IN real-names producer.
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
import { toListRead } from '$lib/testing/listReadFixtures';

// ── fixtures ────────────────────────────────────────────────────────────────────

/** Real live entity ids (2026-08-12 probe of the dev/test collective). */
const ORG_EFK = '69c7f8718489bfcb0e81b065';
const ORG_SIREEN = '69c7f8788489bfcb0e81b1a9';
const EFK_SOPRANO = '69c7f8728489bfcb0e81b07b';
const SIREEN_SOPRANO_II = '69c7f8798489bfcb0e81b207';

/** LIVE-SHAPED tree: a flat foreign "Soprano II" ALREADY EXISTS while EFK's
 *  Soprano has no children. Each root carries its OWNING ORG. */
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

/** The VIEWER ('person-p', Pete's own row) is an EFK member — `currentDbEntityId`
 *  reads HER org off HER row, never whichever row sorted first. */
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
			personId: 'person-p',
			name: 'Pete Wilson',
			email: 'pete@x.com',
			sectionIds: [],
			dbEntityId: ORG_EFK
		}
	];
}

const CFG = { db: 'sampledb', token: 'jwt-abc' };

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
}

beforeEach(() => {
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
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

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

// #470 — creation lives in Arrange mode (#155/S4): every case switches into it.
async function renderArrangeReady(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'roster-groups')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'roster-view-chip-arrange') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-arrange-list')).not.toBeNull();
	});
	return container;
}

async function openForm(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'roster-new-section') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-new-section-form')).not.toBeNull();
	});
}

async function typeName(container: HTMLElement, value: string): Promise<void> {
	await fireEvent.input(q(container, 'roster-new-section-name') as HTMLElement, {
		target: { value }
	});
}

async function submit(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'roster-new-section-submit') as HTMLElement);
}

// ── 1. org threading: the page passes the viewer's own org ──────────────────────

describe("/roster — the page-level create threads the VIEWER'S org id into createSection (finding #10, re-driven per #470)", () => {
	it("top-level create: createSection(cfg, { name, parentId: null, dbEntityId: <viewer's org> }) — the page, which KNOWS the org, must say it; the data layer must not guess", async () => {
		const container = await renderArrangeReady();

		await openForm(container);
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

	it("a TOP-LEVEL 'Soprano II' is NOT refused by another org's root of the same name — cross-org roots are not siblings", async () => {
		const container = await renderArrangeReady();

		await openForm(container);
		await typeName(container, 'Soprano II');
		await submit(container);

		expect(q(container, 'roster-new-section-error')).toBeNull();
		await waitFor(() => {
			expect(createSectionMock).toHaveBeenCalledTimes(1);
		});
		expect(createSectionMock).toHaveBeenCalledWith(CFG, {
			name: 'Soprano II',
			parentId: null,
			dbEntityId: ORG_EFK
		});
	});

	it("a TOP-LEVEL duplicate of the viewer's OWN root ('Alto') is still refused — no write, error shown", async () => {
		const container = await renderArrangeReady();

		await openForm(container);
		await typeName(container, 'Alto');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'roster-new-section-error')?.textContent).toContain(
				'roster_section_duplicate'
			);
		});
		expect(createSectionMock).not.toHaveBeenCalled();
	});

	it('sub-section create: dbEntityId rides along uniformly (the data layer ignores it when parentId is set) — createSection(cfg, { name, parentId: Soprano, dbEntityId })', async () => {
		const container = await renderArrangeReady();

		await openForm(container);
		await typeName(container, 'Soprano II');
		await fireEvent.change(q(container, 'roster-new-section-parent') as HTMLElement, {
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

describe('/roster on the LIVE-SHAPED tree — creating "Soprano II" under Soprano works and renders NESTED (findings #10 + #8, re-driven per #470)', () => {
	it("name 'Soprano II', parent Soprano — the foreign flat 'Soprano II' must NOT block it: createSection fires and the new row renders in the arrange list at data-depth 1, with no refetch", async () => {
		const container = await renderArrangeReady();

		await openForm(container);
		await typeName(container, 'Soprano II');
		await fireEvent.change(q(container, 'roster-new-section-parent') as HTMLElement, {
			target: { value: EFK_SOPRANO }
		});
		await submit(container);

		// The submit was VALID — no duplicate refusal, the write fired.
		expect(q(container, 'roster-new-section-error')).toBeNull();
		await waitFor(() => {
			expect(createSectionMock).toHaveBeenCalledTimes(1);
		});

		// …and the new section appears NESTED (finding #8's target shape).
		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-new-1')).not.toBeNull();
		});
		expect(q(container, 'arrange-row-sec-new-1')?.getAttribute('data-depth')).toBe('1');
		expect(listSectionsMock).toHaveBeenCalledTimes(1);
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
	});
});

// (*MVOX:Tallis* — TU.1/#109 RED, findings #10 + #8)
// (*MVOX:Tallis* — #470: re-driven through the page-level roster-new-section
//  entry; the picker's inline create form is retired)
