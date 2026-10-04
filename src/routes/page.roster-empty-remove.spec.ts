// @vitest-environment happy-dom
import { render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);

vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/sections/sectionActions', async () =>
	(await import('$lib/testing/mocks/sections')).sectionCreateModule({ arrange: true })
);
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).entityIdModule(await importOriginal())
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

import Page from './roster/+page.svelte';
import type { SectionNode } from '$lib/sections/sectionData';
import type { RosterRow } from '$lib/roster/rosterData';
import { adminStore } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { signIn } from '$lib/testing/session';
import { listSectionsMock, resolveDatabaseEntityIdMock } from '$lib/testing/moduleHandles';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import {
	assignMock,
	createSectionMock,
	deleteMock,
	reorderMock,
	unassignMock
} from '$lib/testing/mocks/sections';
import {
	EFK_ALTO,
	EFK_BASS,
	EFK_SOPRANO,
	ORG_EFK,
	ORG_SIREEN,
	SIREEN_SOPRANO_II
} from '$lib/testing/pages/rosterFixtures';
import { cleanupResetCreateSectionMocks } from '$lib/testing/pages/roster';
import { q } from '$lib/testing/pages/dom';

const ORG_TAM = '69c7f8868489bfcb0e81b4f0';
const EFK_TENOR = '69c7f8758489bfcb0e81b113';
const TAM_BASS = '69c7f88a8489bfcb0e81b5bc';

function node(id: string, name: string, displayOrder: number, dbEntityId: string): SectionNode {
	return { id, name, displayOrder, parentId: null, dbEntityId, depth: 0, children: [] };
}

function gateWalkTree(): SectionNode[] {
	return [
		node(EFK_SOPRANO, 'Soprano', 1, ORG_EFK),
		node(EFK_ALTO, 'Alto', 4, ORG_EFK),
		node(EFK_TENOR, 'Tenor', 7, ORG_EFK),
		node(EFK_BASS, 'Bass', 15, ORG_EFK),
		node(TAM_BASS, 'Bass', 16, ORG_TAM)
	];
}

function efkRows(): RosterRow[] {
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
			memberId: 'm-bea',
			personId: 'p-bea',
			name: 'Bea Noe',
			email: '',
			sectionIds: [EFK_ALTO],
			dbEntityId: ORG_EFK
		},
		{
			memberId: 'm-pete',
			personId: 'person-p',
			name: 'Pete Wilson',
			email: 'pete@x.com',
			sectionIds: [EFK_TENOR],
			dbEntityId: ORG_EFK
		}
	];
}

const CFG_DB = 'sampledb';

function setAuthedWithOneCollective() {
	signIn({ collectives: [{ db: CFG_DB, name: 'Sampledb', personId: 'person-p' }] });
}

beforeEach(() => {
	loadRosterMock.mockResolvedValue(toListRead(efkRows()));
	listSectionsMock.mockResolvedValue(gateWalkTree());
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createSectionMock.mockResolvedValue('sec-new-1');
	reorderMock.mockResolvedValue(undefined);
	deleteMock.mockResolvedValue(undefined);
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
});

afterEach(cleanupResetCreateSectionMocks);

async function renderReady() {
	setAuthedWithOneCollective();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="roster-groups"]')).not.toBeNull();
	});
	const arrangeChip = container.querySelector<HTMLElement>(
		'[data-testid="roster-view-chip-arrange"]'
	);
	expect(arrangeChip, 'arrange chip').not.toBeNull();
	arrangeChip!.click();
	await waitFor(() => {
		expect(container.querySelector('[data-testid="roster-arrange-list"]')).not.toBeNull();
	});
	return container;
}

function renderedSectionIds(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll('[data-testid^="arrange-row-"]')).map((el) =>
		el.getAttribute('data-testid')!.slice('arrange-row-'.length)
	);
}

describe('/roster — F3: every empty section the page SHOWS offers a WORKING (non-disabled) remove control', () => {
	it('gate repro — with EFK Bass (0) and another org\'s Bass (0) in the whole-db tree, every RENDERED "(0)" leaf row carries an ENABLED section-remove-<id>; never one-with-one-without', async () => {
		const container = await renderReady();

		expect(q(container, 'arrange-count-' + EFK_BASS)?.textContent).toContain('(0)');
		expect((q(container, `section-remove-${EFK_BASS}`) as HTMLButtonElement).disabled).toBe(false);

		for (const id of renderedSectionIds(container)) {
			const row = q(container, `arrange-row-${id}`);
			if (!row) continue;
			if (!q(container, `arrange-count-${id}`)?.textContent?.includes('(0)')) continue;
			const label = (row.closest('[data-drop-row]')?.textContent ?? '').replace(/\s+/g, ' ').trim();
			const button = q(container, `section-remove-${id}`) as HTMLButtonElement | null;
			expect(
				button,
				`rendered empty section "${label}" (${id}) has no remove control — empty sections must not be inconsistent (#114 check 4)`
			).not.toBeNull();
			expect(
				button!.disabled,
				`rendered empty section "${label}" (${id}) has a DISABLED remove control — empty sections must not be inconsistent (#114 check 4)`
			).toBe(false);
		}
	});

	it("a foreign org's section must NEVER carry the destructive control (#110 review F2 stands) — so consistency means TAM's Bass is not rendered here at all", async () => {
		const container = await renderReady();

		expect(q(container, `section-remove-${TAM_BASS}`)).toBeNull();
		expect(q(container, `arrange-row-${TAM_BASS}`)).toBeNull();
	});
});

describe("/roster — F3: the org that gates remove is the AUTHENTICATED VIEWER's, not whoever sorts first", () => {
	it("multi-org roster where a FOREIGN member sorts first alphabetically: the EFK viewer still gets a WORKING ✕ on EFK's empty Bass, and Sireen's empty section gets none rendered at all", async () => {
		loadRosterMock.mockResolvedValue(toListRead([
			{
				memberId: 'm-anna',
				personId: 'p-anna',
				name: 'Anna Aaviksoo',
				email: 'anna@x.com',
				sectionIds: [],
				dbEntityId: ORG_SIREEN
			},
			...efkRows()
		] satisfies RosterRow[]));
		listSectionsMock.mockResolvedValue([
			node(EFK_SOPRANO, 'Soprano', 1, ORG_EFK),
			node(EFK_BASS, 'Bass', 15, ORG_EFK),
			node(SIREEN_SOPRANO_II, 'Soprano II', 3, ORG_SIREEN)
		]);

		const container = await renderReady();

		expect(
			(q(container, `section-remove-${EFK_BASS}`) as HTMLButtonElement | null)?.disabled,
			"EFK viewer's own empty Bass lost its (enabled) remove control — own-org must derive from the viewer, not the first alphabetical row"
		).toBe(false);
		expect(
			q(container, `arrange-row-${SIREEN_SOPRANO_II}`),
			"the foreign org's section rendered as an arrange row at all — destructive affordance surface on a foreign entity (#110 review F2)"
		).toBeNull();
		expect(q(container, `section-remove-${SIREEN_SOPRANO_II}`)).toBeNull();
	});
});

// (*MVOX:Tallis*) (*MVOX:Palestrina*)
