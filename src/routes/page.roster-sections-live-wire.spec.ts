// @vitest-environment happy-dom
//
// TU.1/#109 — finding #8 INVESTIGATION VERDICT, pinned as tests: "Soprano II
// not showing as subsection of Soprano" is a DATA defect in live polyphony, not
// a rendering bug.
//
// Live probe (2026-08-12, authenticated GET
// `entity?_type.string=section&props=name,display_order,_parent&limit=500`):
// NONE of the 16 live sections carries an `entity_type: 'section'` `_parent`
// entry. "Soprano II" (69c7f8798489bfcb0e81b207) is parented to the
// ORGANIZATION "Kammernaiskoor Sireen" — it is another test org's flat top-level
// section, not EFK Soprano's child. There is no parent relationship for any
// renderer to draw.
//
// These tests close a real coverage gap while pinning that verdict: every
// existing /roster page spec mocks `listSections` with PRE-BUILT SectionNode
// trees, so the REAL wire-payload → listSections → page join had never been
// exercised. Here the fetch seam alone is stubbed with VERBATIM live-shaped
// JSON (rider fields and all) and the real listSections + groupBySection + page
// run end-to-end:
//
//   1. the CURRENT live shape (org-parented everywhere) → flat roots, exactly
//      what Mihkel saw — the rendering is faithfully showing broken data;
//   2. the CORRECTED shape (Soprano II `_parent` → the Soprano SECTION, per
//      v4E `parentConstraint: 'exactly_one_of'`) → Soprano II renders NESTED.
//
// (2) is the acceptance shape for the DATA FIX this task's GREEN half performs
// against live polyphony (reparent or recreate — implementer's call; the
// app-level route to creating it is pinned RED in
// page.roster-create-section-org.spec.ts). If either test here FAILS, the
// verdict was wrong and there IS a rendering bug — fix the code, not the data.
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const { loadRosterMock } = vi.hoisted(() => ({ loadRosterMock: vi.fn() }));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
// sectionData is NOT mocked — the REAL listSections parses the wire fixture.
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import type { RosterRow } from '$lib/roster/rosterData';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── live wire fixtures (verbatim shape from the 2026-08-12 polyphony probe) ─────

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const ORG_SIREEN = '69c7f8788489bfcb0e81b1a9';
const SEC_SOPRANO = '69c7f8728489bfcb0e81b07b';
const SEC_SOPRANO_II = '69c7f8798489bfcb0e81b207';
const SEC_ALTO = '69c7f8748489bfcb0e81b0cd';

type WireParent = {
	_id: string;
	reference: string;
	property_type: string;
	string: string;
	entity_type: string;
};

function wireSection(
	id: string,
	name: string,
	displayOrder: number,
	parent: WireParent
): Record<string, unknown> {
	return {
		_id: id,
		_parent: [parent],
		display_order: [{ _id: `do-${id}`, number: displayOrder }],
		name: [{ _id: `nm-${id}`, string: name }]
	};
}

const orgParent = (orgId: string, orgName: string): WireParent => ({
	_id: `pv-org-${orgId}`,
	reference: orgId,
	property_type: '_parent',
	string: orgName,
	entity_type: 'organization'
});

const sectionParent = (sectionId: string, sectionName: string): WireParent => ({
	_id: `pv-sec-${sectionId}`,
	reference: sectionId,
	property_type: '_parent',
	string: sectionName,
	entity_type: 'section'
});

/** 1. CURRENT live data: every section org-parented — all flat (abbreviated). */
function currentLiveWire(): unknown {
	return {
		entities: [
			wireSection(SEC_SOPRANO, 'Soprano', 1, orgParent(ORG_EFK, 'Eesti Filharmoonia Kammerkoor')),
			wireSection(SEC_SOPRANO_II, 'Soprano II', 3, orgParent(ORG_SIREEN, 'Kammernaiskoor Sireen')),
			wireSection(SEC_ALTO, 'Alto', 4, orgParent(ORG_EFK, 'Eesti Filharmoonia Kammerkoor'))
		],
		count: 3,
		limit: 500,
		skip: 0
	};
}

/** 2. CORRECTED data: Soprano II's `_parent` IS the Soprano section
 *  (v4E exactly_one_of — the org parent is replaced, not accompanied). */
function correctedWire(): unknown {
	return {
		entities: [
			wireSection(SEC_SOPRANO, 'Soprano', 1, orgParent(ORG_EFK, 'Eesti Filharmoonia Kammerkoor')),
			wireSection(SEC_SOPRANO_II, 'Soprano II', 3, sectionParent(SEC_SOPRANO, 'Soprano')),
			wireSection(SEC_ALTO, 'Alto', 4, orgParent(ORG_EFK, 'Eesti Filharmoonia Kammerkoor'))
		],
		count: 3,
		limit: 500,
		skip: 0
	};
}

function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-ada',
			personId: 'p-ada',
			name: 'Ada Lovelace',
			email: 'ada@x.com',
			sectionIds: [SEC_SOPRANO_II],
			orgId: ORG_EFK
		}
	];
}

function stubSectionsFetch(payload: unknown): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn().mockImplementation((url: string) => {
		if (String(url).includes('_type.string=section')) {
			return Promise.resolve(
				new Response(JSON.stringify(payload), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			);
		}
		return Promise.resolve(
			new Response(JSON.stringify({ entities: [], count: 0 }), { status: 200 })
		);
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
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
	loadRosterMock.mockResolvedValue(fixtureRows());
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadRosterMock.mockReset();
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
	return container;
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

describe('/roster over the REAL listSections — current live data: org-parented sections are FLAT (the rendering faithfully shows the broken data)', () => {
	it('Soprano and Soprano II both render as TOP-LEVEL groups (depth 0), Soprano II NOT inside Soprano — exactly what the live gate walk showed', async () => {
		stubSectionsFetch(currentLiveWire());
		const container = await renderReady();

		const soprano = q(container, `section-group-${SEC_SOPRANO}`) as HTMLElement;
		const sopranoII = q(container, `section-group-${SEC_SOPRANO_II}`) as HTMLElement;
		expect(soprano).not.toBeNull();
		expect(sopranoII).not.toBeNull();
		expect(soprano.getAttribute('data-depth')).toBe('0');
		expect(sopranoII.getAttribute('data-depth')).toBe('0');
		expect(
			soprano.querySelector(`[data-testid="section-group-${SEC_SOPRANO_II}"]`)
		).toBeNull();
	});
});

describe('/roster over the REAL listSections — CORRECTED data: a section-parented Soprano II renders NESTED (the acceptance shape for the live data fix)', () => {
	it("Soprano II's group renders INSIDE Soprano's group at data-depth 1, with Ada's row in it; Soprano's header roll-up counts her", async () => {
		stubSectionsFetch(correctedWire());
		const container = await renderReady();

		const soprano = q(container, `section-group-${SEC_SOPRANO}`) as HTMLElement;
		const nested = soprano.querySelector(
			`[data-testid="section-group-${SEC_SOPRANO_II}"]`
		) as HTMLElement;
		expect(nested).not.toBeNull();
		expect(nested.getAttribute('data-depth')).toBe('1');
		expect(nested.querySelector('[data-testid="roster-row-m-ada"]')).not.toBeNull();
		// memberCount is the recursive roll-up — the parent's header counts the
		// sub-section's member.
		expect(q(container, `section-header-${SEC_SOPRANO}`)?.textContent).toContain('(1)');
	});

	it('sections without a section parent stay top level: Alto renders at depth 0, not nested anywhere', async () => {
		stubSectionsFetch(correctedWire());
		const container = await renderReady();

		const alto = q(container, `section-group-${SEC_ALTO}`) as HTMLElement;
		expect(alto).not.toBeNull();
		expect(alto.getAttribute('data-depth')).toBe('0');
		expect(alto.parentElement?.closest('[data-testid^="section-group-"]')).toBeNull();
	});
});

// (*MVOX:Tallis* — TU.1/#109, finding #8 investigation verdict: data defect, rendering correct)
