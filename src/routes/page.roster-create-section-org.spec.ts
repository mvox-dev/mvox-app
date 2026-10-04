// @vitest-environment happy-dom
// Section create from the page-level entry: parent choice and the write.
import { cleanup, fireEvent, waitFor } from '@testing-library/svelte';
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
	(await import('$lib/testing/mocks/sections')).sectionCreateModule({ arrange: false })
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

import type { SectionNode } from '$lib/sections/sectionData';
import { resetAdmin } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { assignMock, createSectionMock, unassignMock } from '$lib/testing/mocks/sections';
import {
	EFK_SOPRANO,
	ORG_EFK,
	ORG_SIREEN,
	SIREEN_SOPRANO_II,
	fixtureRows
} from '$lib/testing/pages/rosterFixtures';
import { CFG, submit, typeName } from '$lib/testing/pages/roster';
import { renderArrangeReady } from '$lib/testing/pages/rosterRender';
import { q } from '$lib/testing/pages/dom';

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
	resetAppState();
	resetAdmin();
});

async function openForm(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'roster-new-section') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-new-section-form')).not.toBeNull();
	});
}

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

describe('/roster on the LIVE-SHAPED tree — creating "Soprano II" under Soprano works and renders NESTED (findings #10 + #8, re-driven per #470)', () => {
	it("name 'Soprano II', parent Soprano — the foreign flat 'Soprano II' must NOT block it: createSection fires and the new row renders in the arrange list at data-depth 1, with no refetch", async () => {
		const container = await renderArrangeReady();

		await openForm(container);
		await typeName(container, 'Soprano II');
		await fireEvent.change(q(container, 'roster-new-section-parent') as HTMLElement, {
			target: { value: EFK_SOPRANO }
		});
		await submit(container);

		expect(q(container, 'roster-new-section-error')).toBeNull();
		await waitFor(() => {
			expect(createSectionMock).toHaveBeenCalledTimes(1);
		});

		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-new-1')).not.toBeNull();
		});
		expect(q(container, 'arrange-row-sec-new-1')?.getAttribute('data-depth')).toBe('1');
		expect(listSectionsMock).toHaveBeenCalledTimes(1);
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
	});
});

// (*MVOX:Tallis*)
