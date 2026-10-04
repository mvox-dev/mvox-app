// @vitest-environment happy-dom
// The page-level new-section entry on /roster.
import { render, fireEvent, waitFor } from '@testing-library/svelte';
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

import { type AdminState } from '$lib/nav/adminStore';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { assignMock, createSectionMock } from '$lib/testing/mocks/sections';
import {
	EFK_ALTO,
	EFK_SOPRANO,
	ORG_EFK,
	SIREEN_SOPRANO_II
} from '$lib/testing/pages/rosterFixtures';
import {
	CFG,
	cleanupResetCreateSectionMocks,
	seedCreateSectionMocks,
	submit,
	typeName
} from '$lib/testing/pages/roster';
import { renderReady } from '$lib/testing/pages/rosterRender';
import { q } from '$lib/testing/pages/dom';

beforeEach(seedCreateSectionMocks);

afterEach(cleanupResetCreateSectionMocks);

async function renderArrangeReady(admin: AdminState = 'admin') {
	const container = await renderReady(admin);
	const arrangeChip = q(container, 'roster-view-chip-arrange') as HTMLElement | null;
	if (arrangeChip) {
		await fireEvent.click(arrangeChip);
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});
	}
	return container;
}

async function openPageForm(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'roster-new-section') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-new-section-form')).not.toBeNull();
	});
}

describe('/roster — the "+ New section" control lives in Arrange mode (finding F1, structural, relocated #155/S4)', () => {
	it('admin, Arrange mode: roster-new-section renders inside the arrange screen, outside the row list and outside any member row — and merely rendering writes nothing', async () => {
		const container = await renderArrangeReady();

		const control = q(container, 'roster-new-section');
		expect(control).not.toBeNull();
		expect(control!.closest('[data-testid^="roster-row-"]')).toBeNull();
		expect(container.querySelector('[data-testid^="section-picker-menu-"]')).toBeNull();
		const list = q(container, 'roster-arrange-list') as HTMLElement;
		expect(list.contains(control)).toBe(false);

		expect(createSectionMock).not.toHaveBeenCalled();
		expect(assignMock).not.toHaveBeenCalled();
	});

	it('Collapsed/Expanded (display-only) views: roster-new-section does NOT render — it lives exclusively in Arrange mode now', async () => {
		const container = await renderReady();
		expect(q(container, 'roster-new-section')).toBeNull();

		const expandedChip = q(container, 'roster-view-chip-expanded') as HTMLElement;
		await fireEvent.click(expandedChip);
		await waitFor(() => {
			expect(container.querySelector('[data-testid^="roster-row-"]')).not.toBeNull();
		});
		expect(q(container, 'roster-new-section')).toBeNull();
	});

	it('non-admin: roster-new-section does not render (same fail-closed gate as every other admin control — and the Arrange chip itself is unreachable)', async () => {
		const container = await renderArrangeReady('not-admin');
		expect(q(container, 'roster-new-section')).toBeNull();
	});

	it('tapping it opens roster-new-section-form: name input AUTO-FOCUSED, parent select present defaulting to "(top level)" — nothing written by opening', async () => {
		const container = await renderArrangeReady();

		await openPageForm(container);
		const name = q(container, 'roster-new-section-name') as HTMLInputElement;
		expect(name).not.toBeNull();
		await waitFor(() => {
			expect(document.activeElement).toBe(name);
		});
		const parent = q(container, 'roster-new-section-parent') as HTMLSelectElement;
		expect(parent).not.toBeNull();
		expect(parent.value).toBe('');

		expect(createSectionMock).not.toHaveBeenCalled();
	});

	it('cancel closes the form; nothing was written', async () => {
		const container = await renderArrangeReady();

		await openPageForm(container);
		await fireEvent.click(q(container, 'roster-new-section-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'roster-new-section-form')).toBeNull();
		});
		expect(createSectionMock).not.toHaveBeenCalled();
	});
});

describe('/roster — page-level create: type name, submit, the section appears in the arrange list', () => {
	it("top-level create: createSection(cfg, { name, parentId: null, dbEntityId: <viewer's org> }) fires ONCE; the new row renders TITLED with the name; success is ANNOUNCED (role=status non-empty); NO member assigned; NO refetch", async () => {
		const container = await renderArrangeReady();

		await openPageForm(container);
		await typeName(container, 'Tenor 2');
		await submit(container);

		await waitFor(() => {
			expect(createSectionMock).toHaveBeenCalledTimes(1);
		});
		expect(createSectionMock).toHaveBeenCalledWith(CFG, {
			name: 'Tenor 2',
			parentId: null,
			dbEntityId: ORG_EFK
		});

		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-new-1')).not.toBeNull();
		});
		expect(q(container, 'arrange-rename-sec-new-1')?.textContent).toContain('Tenor 2');
		expect(q(container, 'arrange-row-sec-new-1')?.getAttribute('aria-label')).toBe('Tenor 2 (0)');

		const status = q(container, 'roster-section-create-status');
		expect(status).not.toBeNull();
		expect(status?.getAttribute('role')).toBe('status');
		await waitFor(() => {
			expect(status?.textContent?.trim()).not.toBe('');
		});

		expect(assignMock).not.toHaveBeenCalled();
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
		expect(listSectionsMock).toHaveBeenCalledTimes(1);
	});

	it("duplicate of the viewer's OWN org's root ('Alto') is refused: roster-new-section-error shows, no write", async () => {
		const container = await renderArrangeReady();

		await openPageForm(container);
		await typeName(container, 'Alto');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'roster-new-section-error')).not.toBeNull();
		});
		expect(createSectionMock).not.toHaveBeenCalled();
	});

	it("ANOTHER org's flat 'Soprano II' does NOT block a top-level EFK 'Soprano II' — no error, the write fires (the global duplicate check was the original live bug)", async () => {
		const container = await renderArrangeReady();

		await openPageForm(container);
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
});

describe('/roster — page-level create of a SUB-SECTION (finding F2)', () => {
	it("parent select offers ONLY the viewer's own org's sections — EFK's roots yes, Sireen's 'Soprano II' NO (a foreign org's section must not be offered as a parent)", async () => {
		const container = await renderArrangeReady();

		await openPageForm(container);
		const parent = q(container, 'roster-new-section-parent') as HTMLSelectElement;
		const values = Array.from(parent.querySelectorAll('option')).map((o) => o.value);
		expect(values).toContain(''); // "(top level)"
		expect(values).toContain(EFK_SOPRANO);
		expect(values).toContain(EFK_ALTO);
		expect(values).not.toContain(SIREEN_SOPRANO_II);
	});

	it("name 'Soprano II', parent Soprano: not refused by the foreign flat 'Soprano II'; createSection(cfg, { name, parentId: Soprano, dbEntityId }) fires; the new row renders NESTED under Soprano's row at data-depth 1", async () => {
		const container = await renderArrangeReady();

		await openPageForm(container);
		await typeName(container, 'Soprano II');
		await fireEvent.change(q(container, 'roster-new-section-parent') as HTMLElement, {
			target: { value: EFK_SOPRANO }
		});
		await submit(container);

		expect(q(container, 'roster-new-section-error')).toBeNull();
		await waitFor(() => {
			expect(createSectionMock).toHaveBeenCalledTimes(1);
		});
		expect(createSectionMock).toHaveBeenCalledWith(CFG, {
			name: 'Soprano II',
			parentId: EFK_SOPRANO,
			dbEntityId: ORG_EFK
		});

		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-new-1')).not.toBeNull();
		});
		const newRow = q(container, 'arrange-row-sec-new-1') as HTMLElement;
		expect(newRow.getAttribute('data-depth')).toBe('1');
		expect(listSectionsMock).toHaveBeenCalledTimes(1);
	});
});

// (*MVOX:Tallis*) (*MVOX:Palestrina*)
