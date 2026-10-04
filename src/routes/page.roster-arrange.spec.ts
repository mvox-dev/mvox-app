// @vitest-environment happy-dom
import { render, createEvent, fireEvent, waitFor } from '@testing-library/svelte';
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
	(await import('$lib/testing/mocks/sections')).sectionActionsModule()
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
import type { RosterRow } from '$lib/roster/rosterData';
import { toListRead } from '$lib/testing/listReadFixtures';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import {
	assignMock,
	createMock,
	deleteMock,
	reorderMock,
	unassignMock
} from '$lib/testing/mocks/sections';
import { cleanupResetArrangeMocks } from '$lib/testing/pages/roster';
import { fixtureRows } from '$lib/testing/pages/rosterArrange';
import { renderReady } from '$lib/testing/pages/rosterRender';
import { q } from '$lib/testing/pages/dom';

function fixtureTree(): SectionNode[] {
	return [
		{
			id: 'sec-sop',
			name: 'Soprano',
			displayOrder: 1,
			parentId: null,
			depth: 0,
			children: [
				{ id: 'sec-sop1', name: 'Soprano 1', displayOrder: 1, parentId: 'sec-sop', depth: 1, children: [] },
				{ id: 'sec-sop2', name: 'Soprano 2', displayOrder: 2, parentId: 'sec-sop', depth: 1, children: [] }
			]
		},
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, depth: 0, children: [] },
		{ id: 'sec-tenor', name: 'Tenor', displayOrder: 3, parentId: null, depth: 0, children: [] },
		{ id: 'sec-bass', name: 'Bass', displayOrder: 4, parentId: null, depth: 0, children: [] }
	];
}

beforeEach(() => {
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue(fixtureTree());
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createMock.mockResolvedValue('sec-created');
	reorderMock.mockResolvedValue(undefined);
	deleteMock.mockResolvedValue(undefined);
});

afterEach(cleanupResetArrangeMocks);

function chip(container: HTMLElement, mode: 'collapsed' | 'expanded' | 'arrange'): HTMLElement | null {
	return q(container, `roster-view-chip-${mode}`);
}

function pressedStates(container: HTMLElement): Record<string, string | null> {
	return {
		collapsed: chip(container, 'collapsed')?.getAttribute('aria-checked') ?? null,
		expanded: chip(container, 'expanded')?.getAttribute('aria-checked') ?? null,
		arrange: chip(container, 'arrange')?.getAttribute('aria-checked') ?? null
	};
}

async function selectMode(
	container: HTMLElement,
	mode: 'collapsed' | 'expanded' | 'arrange'
): Promise<void> {
	const target = chip(container, mode);
	expect(target, `chip for ${mode}`).not.toBeNull();
	await fireEvent.click(target as HTMLElement);
	await waitFor(() => {
		expect((chip(container, mode) as HTMLElement).getAttribute('aria-checked')).toBe('true');
	});
}

function memberRowCount(container: HTMLElement): number {
	return container.querySelectorAll('[data-testid^="roster-row-"]').length;
}

describe('/roster — the 3-chip view-mode selector replaces the collapse/expand toggle (#155/S1)', () => {
	it('admin: roster-view-modes renders ABOVE the groups with Collapsed, Expanded and Arrange chips in that document order, each with an accessible name', async () => {
		const container = await renderReady('admin');

		const selector = q(container, 'roster-view-modes');
		expect(selector).not.toBeNull();

		const collapsed = chip(container, 'collapsed');
		const expanded = chip(container, 'expanded');
		const arrange = chip(container, 'arrange');
		expect(collapsed).not.toBeNull();
		expect(expanded).not.toBeNull();
		expect(arrange).not.toBeNull();
		for (const c of [collapsed, expanded, arrange]) {
			expect(c?.getAttribute('aria-label') || c?.textContent?.trim()).toBeTruthy();
			expect(selector?.contains(c as HTMLElement)).toBe(true);
		}

		expect(
			(collapsed as HTMLElement).compareDocumentPosition(expanded as HTMLElement) &
				Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		expect(
			(expanded as HTMLElement).compareDocumentPosition(arrange as HTMLElement) &
				Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();

		const groups = q(container, 'roster-groups') as HTMLElement;
		expect(groups).not.toBeNull();
		expect(
			(selector as HTMLElement).compareDocumentPosition(groups) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});

	it('the old sections-toggle-all control is GONE — the chips replace it, they do not sit beside it', async () => {
		const container = await renderReady('admin');
		expect(q(container, 'sections-toggle-all')).toBeNull();
	});

	it('default selection is Collapsed: aria-checked="true" on the Collapsed chip ONLY, and no member row is on screen', async () => {
		const container = await renderReady('admin');

		expect(pressedStates(container)).toEqual({
			collapsed: 'true',
			expanded: 'false',
			arrange: 'false'
		});
		expect(memberRowCount(container)).toBe(0);
	});

	it('clicking Expanded switches the mode radio-style — Expanded becomes the ONE active chip and every section\'s members (sub-sections included) appear', async () => {
		const container = await renderReady('admin');

		await selectMode(container, 'expanded');

		expect(pressedStates(container)).toEqual({
			collapsed: 'false',
			expanded: 'true',
			arrange: 'false'
		});
		await waitFor(() => {
			expect(q(container, 'roster-row-m-ada')).not.toBeNull();
		});
		expect(q(container, 'roster-row-m-eva')).not.toBeNull();
		expect(q(container, 'roster-row-m-sel')).not.toBeNull();
	});

	it('clicking Collapsed after Expanded returns to the collapsed display — one active chip, member rows gone', async () => {
		const container = await renderReady('admin');
		await selectMode(container, 'expanded');
		await waitFor(() => {
			expect(memberRowCount(container)).toBeGreaterThan(0);
		});

		await selectMode(container, 'collapsed');

		expect(pressedStates(container)).toEqual({
			collapsed: 'true',
			expanded: 'false',
			arrange: 'false'
		});
		await waitFor(() => {
			expect(memberRowCount(container)).toBe(0);
		});
	});

	it.each(['not-admin', 'loading', 'error'] as const)(
		'%s: the Arrange chip does NOT render — non-editors get exactly the two display chips (fail closed on unresolved/errored rights)',
		async (state) => {
			const container = await renderReady(state);

			expect(chip(container, 'arrange')).toBeNull();
			expect(chip(container, 'collapsed')).not.toBeNull();
			expect(chip(container, 'expanded')).not.toBeNull();
			expect(
				container.querySelectorAll('[data-testid^="roster-view-chip-"]')
			).toHaveLength(2);
		}
	);
});

describe('/roster — the Arrange chip renders the compact arrange-mode shell (#155/S1)', () => {
	it('activating Arrange makes it the one active chip and swaps roster-groups out for roster-arrange-list', async () => {
		const container = await renderReady('admin');
		expect(q(container, 'roster-arrange-list')).toBeNull();

		await selectMode(container, 'arrange');

		expect(pressedStates(container)).toEqual({
			collapsed: 'false',
			expanded: 'false',
			arrange: 'true'
		});
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});
		expect(q(container, 'roster-groups')).toBeNull();
	});

	it('the list holds ONE row per section — every nesting level — in tree pre-order, each row carrying data-depth for its nesting level', async () => {
		const container = await renderReady('admin');
		await selectMode(container, 'arrange');
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});

		const rows = [
			...(q(container, 'roster-arrange-list') as HTMLElement).querySelectorAll<HTMLElement>(
				'[data-testid^="arrange-row-"]'
			)
		];
		expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
			'arrange-row-sec-sop',
			'arrange-row-sec-sop1',
			'arrange-row-sec-sop2',
			'arrange-row-sec-alto',
			'arrange-row-sec-tenor',
			'arrange-row-sec-bass'
		]);
		expect(rows.map((r) => r.getAttribute('data-depth'))).toEqual(['0', '1', '1', '0', '0', '0']);
	});

	it('each row shows the section NAME and its RECURSIVE member count — the same roll-up the grouped headers show (Soprano 3, its subs 1 each, Bass 0)', async () => {
		const container = await renderReady('admin');
		await selectMode(container, 'arrange');
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});

		const expectRow = (id: string, name: string, count: number) => {
			const row = q(container, `arrange-row-${id}`) as HTMLElement;
			expect(row, `arrange row for ${id}`).not.toBeNull();
			const nameText = q(container, `arrange-rename-${id}`)?.textContent ?? '';
			expect(nameText, `name for ${id}`).toContain(name);
			expect((q(container, `arrange-count-${id}`)?.textContent ?? '').trim()).toBe(
				`(${count})`
			);
			expect(row.getAttribute('aria-label'), `row label for ${id}`).toBe(`${name} (${count})`);
		};
		expectRow('sec-sop', 'Soprano', 3);
		expectRow('sec-sop1', 'Soprano 1', 1);
		expectRow('sec-sop2', 'Soprano 2', 1);
		expectRow('sec-alto', 'Alto', 1);
		expectRow('sec-tenor', 'Tenor', 1);
		expectRow('sec-bass', 'Bass', 0);
	});

	it('nesting is VISIBLE, not just declared: a depth-1 row renders with indentation a depth-0 row does not have (class/style must differ by depth)', async () => {
		const container = await renderReady('admin');
		await selectMode(container, 'arrange');
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});

		const root = q(container, 'arrange-row-sec-sop') as HTMLElement;
		const sub = q(container, 'arrange-row-sec-sop1') as HTMLElement;
		const fingerprint = (el: HTMLElement) => `${el.className}|${el.getAttribute('style') ?? ''}`;
		expect(fingerprint(sub)).not.toBe(fingerprint(root));
	});

	it('COMPACT means compact: no member rows render anywhere while arrange mode is active', async () => {
		const container = await renderReady('admin');
		await selectMode(container, 'arrange');
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});

		expect(memberRowCount(container)).toBe(0);
	});

	it('NO drag-handle/expand-toggle/picker/new-section controls in the S1 shell — S2/S4 add reorder and CRUD respectively (#155/S4: section-remove-/arrange-rename-* are now expected INSIDE the arrange list, tested in page.roster-arrange-crud.spec.ts)', async () => {
		const container = await renderReady('admin');
		await selectMode(container, 'arrange');
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});

		const list = q(container, 'roster-arrange-list') as HTMLElement;
		for (const prefix of ['section-drag-handle-', 'section-toggle-', 'section-picker-']) {
			expect(
				list.querySelectorAll(`[data-testid^="${prefix}"]`),
				`no "${prefix}*" control inside the arrange list`
			).toHaveLength(0);
		}
		expect(list.querySelectorAll('[data-testid^="roster-new-section"]')).toHaveLength(0);
	});

	it('switching BACK to Collapsed resumes normal rendering: arrange list gone, roster-groups back, sections collapsed', async () => {
		const container = await renderReady('admin');
		await selectMode(container, 'arrange');
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});

		await selectMode(container, 'collapsed');

		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).toBeNull();
		});
		expect(q(container, 'roster-groups')).not.toBeNull();
		expect(q(container, 'section-group-sec-sop')).not.toBeNull();
		expect(memberRowCount(container)).toBe(0);
	});

	it('switching from Arrange to Expanded resumes the member-bearing rendering path too', async () => {
		const container = await renderReady('admin');
		await selectMode(container, 'arrange');
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});

		await selectMode(container, 'expanded');

		await waitFor(() => {
			expect(q(container, 'roster-row-m-ada')).not.toBeNull();
		});
		expect(q(container, 'roster-arrange-list')).toBeNull();
		expect(q(container, 'roster-groups')).not.toBeNull();
	});
});

describe('/roster — the view modes are a rendering switch over the one existing load (#155/S1)', () => {
	it('cycling Collapsed → Arrange → Expanded → Collapsed refetches NOTHING: loadRoster and listSections each ran exactly once, at page load', async () => {
		const container = await renderReady('admin');
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
		expect(listSectionsMock).toHaveBeenCalledTimes(1);

		await selectMode(container, 'arrange');
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});
		await selectMode(container, 'expanded');
		await waitFor(() => {
			expect(memberRowCount(container)).toBeGreaterThan(0);
		});
		await selectMode(container, 'collapsed');
		await waitFor(() => {
			expect(memberRowCount(container)).toBe(0);
		});

		expect(loadRosterMock).toHaveBeenCalledTimes(1);
		expect(listSectionsMock).toHaveBeenCalledTimes(1);
	});

	it('the arrange list reflects the LOADED tree, not a hardcoded shape: a different fixture renders its own rows', async () => {
		listSectionsMock.mockResolvedValue([
			{
				id: 'sec-men',
				name: 'Men',
				displayOrder: 1,
				parentId: null,
				depth: 0,
				children: [
					{ id: 'sec-men1', name: 'Men 1', displayOrder: 1, parentId: 'sec-men', depth: 1, children: [] }
				]
			}
		] satisfies SectionNode[]);
		loadRosterMock.mockResolvedValue(toListRead([
			{ memberId: 'm-tara', personId: 'p-tara', name: 'Tara Oja', email: 'tara@x.com', sectionIds: ['sec-men1'] }
		] satisfies RosterRow[]));
		const container = await renderReady('admin');

		await selectMode(container, 'arrange');
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});

		const rows = [
			...(q(container, 'roster-arrange-list') as HTMLElement).querySelectorAll<HTMLElement>(
				'[data-testid^="arrange-row-"]'
			)
		];
		expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
			'arrange-row-sec-men',
			'arrange-row-sec-men1'
		]);
		expect((q(container, 'arrange-count-sec-men') as HTMLElement).textContent).toContain('(1)');
		expect(q(container, 'arrange-row-sec-sop')).toBeNull();
	});
});

describe('/roster — view-mode chips: roving tabindex (#156)', () => {
	function chips(container: HTMLElement): HTMLButtonElement[] {
		return Array.from(
			container.querySelectorAll<HTMLButtonElement>('[data-testid^="roster-view-chip-"]')
		);
	}
	function stops(container: HTMLElement): HTMLButtonElement[] {
		return chips(container).filter((c) => c.getAttribute('tabindex') === '0');
	}

	it('the group is a role="radiogroup" of role="radio" chips, with an accessible name', async () => {
		const container = await renderReady('admin');
		const group = q(container, 'roster-view-modes') as HTMLElement;
		expect(group.getAttribute('role')).toBe('radiogroup');
		expect(group.getAttribute('aria-label')).toBeTruthy();
		for (const c of chips(container)) {
			expect(c.getAttribute('role'), c.getAttribute('data-testid') ?? '').toBe('radio');
			expect(c.closest('[role="radiogroup"]')).toBe(group);
		}
	});

	it('exactly ONE chip is the Tab stop, and it is the checked one', async () => {
		const container = await renderReady('admin');
		expect(stops(container)).toEqual([chip(container, 'collapsed')]);

		await selectMode(container, 'arrange');
		expect(stops(container)).toEqual([chip(container, 'arrange')]);
	});

	it('ArrowRight moves focus AND selects the next chip, wrapping at the end', async () => {
		const container = await renderReady('admin');
		const [collapsed, expanded, arrange] = chips(container);
		expect(chips(container)).toHaveLength(3);

		collapsed.focus();
		await fireEvent.keyDown(collapsed, { key: 'ArrowRight' });
		await waitFor(() => {
			expect(expanded.getAttribute('aria-checked')).toBe('true');
		});
		expect(document.activeElement).toBe(expanded);

		await fireEvent.keyDown(expanded, { key: 'ArrowRight' });
		await waitFor(() => {
			expect(arrange.getAttribute('aria-checked')).toBe('true');
		});

		await fireEvent.keyDown(arrange, { key: 'ArrowRight' });
		await waitFor(() => {
			expect(chip(container, 'collapsed')!.getAttribute('aria-checked')).toBe('true');
		});
	});

	it('ArrowLeft wraps backwards from the first chip to the last', async () => {
		const container = await renderReady('admin');
		const collapsed = chip(container, 'collapsed') as HTMLButtonElement;
		collapsed.focus();
		await fireEvent.keyDown(collapsed, { key: 'ArrowLeft' });
		await waitFor(() => {
			expect(chip(container, 'arrange')!.getAttribute('aria-checked')).toBe('true');
		});
	});

	it('the group is only as wide as it renders — a non-admin has TWO members and the wrap respects that', async () => {
		const container = await renderReady('not-admin');
		expect(chips(container)).toHaveLength(2);
		const collapsed = chip(container, 'collapsed') as HTMLButtonElement;
		collapsed.focus();
		await fireEvent.keyDown(collapsed, { key: 'ArrowLeft' });
		await waitFor(() => {
			expect(chip(container, 'expanded')!.getAttribute('aria-checked')).toBe('true');
		});
	});

	it('Tab, Enter and Space are NOT preventDefault-ed — focus leaves the group and the chip still activates', async () => {
		const container = await renderReady('admin');
		const c = chip(container, 'collapsed') as HTMLButtonElement;
		for (const key of ['Tab', 'Enter', ' ']) {
			const event = createEvent.keyDown(c, { key });
			fireEvent(c, event);
			expect(event.defaultPrevented, `${key} must not be swallowed`).toBe(false);
		}
	});
});

// (*MVOX:Tallis* — #155/S1 RED)
