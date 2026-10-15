// @vitest-environment happy-dom
// /roster section controls check the right on the entity they write, not on the database entity.
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
	(await import('$lib/testing/mocks/sections')).sectionActionsModule(['reparent', 'rename'])
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
import { dbEditRight } from '$lib/nav/dbRights';
import { toListRead } from '$lib/testing/listReadFixtures';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { assignMock, reorderMock, reparentMock } from '$lib/testing/mocks/sections';
import { cleanupResetRenameMocks, setAuthedWithOneCollective } from '$lib/testing/pages/roster';
import { q } from '$lib/testing/pages/dom';

const ME = 'person-p';
type Grant = 'owner' | 'editor' | 'expander' | 'none';

function granted(grant: Grant): Pick<SectionNode, 'ownerIds' | 'editorIds' | 'expanderIds'> {
	return {
		ownerIds: grant === 'owner' ? [ME] : ['someone-else'],
		editorIds: grant === 'editor' ? [ME] : [],
		expanderIds: grant === 'expander' ? [ME] : []
	};
}

type Grants = Partial<Record<'sop' | 'sop1' | 'sop2' | 'alto' | 'bass', Grant>>;

function tree(g: Grants): SectionNode[] {
	const at = (k: keyof Grants) => granted(g[k] ?? 'owner');
	return [
		{
			id: 'sec-sop', name: 'Soprano', displayOrder: 1, parentId: null, depth: 0, ...at('sop'),
			children: [
				{ id: 'sec-sop1', name: 'Soprano 1', displayOrder: 1, parentId: 'sec-sop', depth: 1, children: [], ...at('sop1') },
				{ id: 'sec-sop2', name: 'Soprano 2', displayOrder: 2, parentId: 'sec-sop', depth: 1, children: [], ...at('sop2') }
			]
		},
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, depth: 0, children: [], ...at('alto') },
		{ id: 'sec-bass', name: 'Bass', displayOrder: 3, parentId: null, depth: 0, children: [], ...at('bass') }
	];
}

function rows(memberOwners: string[] = [ME]): RosterRow[] {
	return [
		{ memberId: 'm-eva', personId: 'p-eva', name: 'Eva Green', email: 'eva@x.com', sectionIds: ['sec-sop1'], ownerIds: memberOwners },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: '', sectionIds: ['sec-alto'], ownerIds: memberOwners }
	];
}

async function renderPage(g: Grants, mode: 'arrange' | 'expanded', memberOwners?: string[]) {
	listSectionsMock.mockResolvedValue(tree(g));
	loadRosterMock.mockResolvedValue(toListRead(rows(memberOwners)));
	setAuthedWithOneCollective();
	dbEditRight.set('editor');
	const { container } = render(Page);
	await waitFor(() => expect(q(container, 'roster-groups')).not.toBeNull());
	await fireEvent.click(q(container, `roster-view-chip-${mode}`) as HTMLElement);
	const ready = mode === 'arrange' ? 'roster-arrange-list' : 'roster-row-m-eva';
	await waitFor(() => expect(q(container, ready)).not.toBeNull());
	return container;
}

const has = (c: HTMLElement, id: string) => q(c, id) !== null;

beforeEach(() => {
	reorderMock.mockResolvedValue(undefined);
	reparentMock.mockResolvedValue(undefined);
	assignMock.mockResolvedValue(undefined);
});
afterEach(cleanupResetRenameMocks);

describe('#914 — arrange controls, for a db editor, follow the right on each section', () => {
	it('rename shows only on a section the person can edit', async () => {
		const c = await renderPage({ alto: 'expander', bass: 'editor' }, 'arrange');
		expect(has(c, 'arrange-rename-sec-alto')).toBe(false);
		expect(has(c, 'arrange-rename-sec-bass')).toBe(true);
	});

	it('reorder (the grip) shows only when the person can edit every sibling the renumber writes', async () => {
		const c = await renderPage({ alto: 'expander' }, 'arrange');
		for (const id of ['sec-sop', 'sec-alto', 'sec-bass']) {
			expect(has(c, `arrange-grip-${id}`), id).toBe(false);
		}
		expect(has(c, 'arrange-grip-sec-sop1')).toBe(true);
		expect(has(c, 'arrange-grip-sec-sop2')).toBe(true);
	});

	it('a keyboard move of a section whose siblings the person cannot all edit writes nothing', async () => {
		const c = await renderPage({ alto: 'expander' }, 'arrange');
		const row = q(c, 'arrange-row-sec-bass') as HTMLElement;
		await fireEvent.keyDown(row, { key: ' ' });
		await fireEvent.keyDown(row, { key: 'ArrowUp' });
		await fireEvent.keyDown(row, { key: ' ' });
		expect(reorderMock).not.toHaveBeenCalled();
	});

	it('delete shows only to the _owner of the section; an _editor does not see it', async () => {
		const editor = await renderPage({ bass: 'editor' }, 'arrange');
		expect(has(editor, 'section-remove-sec-bass')).toBe(false);
		cleanupResetRenameMocks();
		const owner = await renderPage({ bass: 'owner' }, 'arrange');
		expect(has(owner, 'section-remove-sec-bass')).toBe(true);
	});

	it('indent needs _owner on the moved section: an _editor on it does not see indent', async () => {
		const c = await renderPage({ bass: 'editor', alto: 'owner' }, 'arrange');
		expect(has(c, 'arrange-indent-sec-bass')).toBe(false);
	});

	it('indent needs _expander or better on the new parent: _owner on the section alone is not enough', async () => {
		const none = await renderPage({ bass: 'owner', alto: 'none' }, 'arrange');
		expect(has(none, 'arrange-indent-sec-bass')).toBe(false);
		cleanupResetRenameMocks();
		const expander = await renderPage({ bass: 'owner', alto: 'expander' }, 'arrange');
		expect(has(expander, 'arrange-indent-sec-bass')).toBe(true);
	});

	it('indent needs the edit right on every child of the new parent: the move renumbers them', async () => {
		const blocked = await renderPage({ alto: 'owner', sop: 'owner', sop1: 'expander' }, 'arrange');
		expect(has(blocked, 'arrange-indent-sec-alto')).toBe(false);
		cleanupResetRenameMocks();
		const open = await renderPage({ alto: 'owner', sop: 'owner' }, 'arrange');
		expect(has(open, 'arrange-indent-sec-alto')).toBe(true);
	});

	it('unindent to the top level shows to the section _owner when the top-level siblings are editable', async () => {
		const c = await renderPage({ sop2: 'owner' }, 'arrange');
		expect(has(c, 'arrange-unindent-sec-sop2')).toBe(true);
		cleanupResetRenameMocks();
		const editorOnly = await renderPage({ sop2: 'editor' }, 'arrange');
		expect(has(editorOnly, 'arrange-unindent-sec-sop2')).toBe(false);
	});
});

describe('#914 — member section assign checks the member and the target section', () => {
	it('an _editor-only person on the member sees no section control on it', async () => {
		const c = await renderPage({}, 'expanded', ['someone-else']);
		expect((q(c, 'roster-row-m-eva') as HTMLElement).querySelector('[data-testid^="section-picker-"]')).toBeNull();
	});

	it('_owner on the member without _expander on a section: that section is not offered, nor its held select', async () => {
		const c = await renderPage({ sop: 'none', sop1: 'none', sop2: 'none', alto: 'none', bass: 'expander' }, 'expanded');
		expect(has(c, 'section-picker-select-m-bea-sec-alto')).toBe(false);
		await fireEvent.click(q(c, 'section-picker-add-m-bea') as HTMLElement);
		const blank = q(c, 'section-picker-select-m-bea-blank') as HTMLSelectElement;
		expect(Array.from(blank.options).map((o) => o.value)).toEqual(['', 'sec-bass']);
	});

	it('no section the person may expand: no [+] at all', async () => {
		const c = await renderPage({ sop: 'none', sop1: 'none', sop2: 'none', alto: 'none', bass: 'none' }, 'expanded');
		expect(has(c, 'section-picker-add-m-bea')).toBe(false);
	});
});

// (*MVOX:Josquin*)
