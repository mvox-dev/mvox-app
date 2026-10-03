// @vitest-environment happy-dom
// Indent and unindent in the roster's arrange mode, on the real page.
import { render, cleanup, createEvent, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);

const {
	loadRosterMock,
	assignMock,
	unassignMock,
	createMock,
	reorderMock,
	deleteMock,
	reparentMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	assignMock: vi.fn(),
	unassignMock: vi.fn(),
	createMock: vi.fn(),
	reorderMock: vi.fn(),
	deleteMock: vi.fn(),
	reparentMock: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/sections/sectionActions', () => ({
	assignMemberSection: assignMock,
	unassignMemberSection: unassignMock,
	createSection: createMock,
	reorderSections: reorderMock,
	deleteSection: deleteMock,
	reparentSection: reparentMock
}));
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
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { testCfg } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { listSectionsMock } from '$lib/testing/moduleHandles';

const ORG = 'org-1';

function fixtureTree(): SectionNode[] {
	return [
		{
			id: 'sec-sop',
			name: 'Soprano',
			displayOrder: 1,
			parentId: null,
			dbEntityId: ORG,
			depth: 0,
			children: [
				{ id: 'sec-sop1', name: 'Soprano 1', displayOrder: 1, parentId: 'sec-sop', dbEntityId: null, depth: 1, children: [] },
				{ id: 'sec-sop2', name: 'Soprano 2', displayOrder: 2, parentId: 'sec-sop', dbEntityId: null, depth: 1, children: [] }
			]
		},
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, dbEntityId: ORG, depth: 0, children: [] },
		{ id: 'sec-tenor', name: 'Tenor', displayOrder: 3, parentId: null, dbEntityId: ORG, depth: 0, children: [] }
	];
}

function fixtureRows(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'], dbEntityId: ORG },
		{ memberId: 'm-eva', personId: 'p-eva', name: 'Eva Green', email: 'eva@x.com', sectionIds: ['sec-sop1'], dbEntityId: ORG },
		{ memberId: 'm-sel', personId: 'p-sel', name: 'Selma Otsing', email: 'selma@x.com', sectionIds: ['sec-sop2'], dbEntityId: ORG },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: '', sectionIds: ['sec-alto'], dbEntityId: ORG },
		{ memberId: 'm-tara', personId: 'p-tara', name: 'Tara Oja', email: 'tara@x.com', sectionIds: ['sec-tenor'], dbEntityId: ORG }
	];
}

function fixtureTreeDeep(): SectionNode[] {
	return [
		{
			id: 'sec-sop',
			name: 'Soprano',
			displayOrder: 1,
			parentId: null,
			dbEntityId: ORG,
			depth: 0,
			children: [
				{
					id: 'sec-sop1',
					name: 'Soprano 1',
					displayOrder: 1,
					parentId: 'sec-sop',
					dbEntityId: null,
					depth: 1,
					children: [
						{ id: 'sec-sop1a', name: 'Soprano 1a', displayOrder: 1, parentId: 'sec-sop1', dbEntityId: null, depth: 2, children: [] }
					]
				}
			]
		},
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, dbEntityId: ORG, depth: 0, children: [] }
	];
}

function fixtureRowsDeep(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'], dbEntityId: ORG },
		{ memberId: 'm-eva', personId: 'p-eva', name: 'Eva Green', email: 'eva@x.com', sectionIds: ['sec-sop1'], dbEntityId: ORG },
		{ memberId: 'm-sel', personId: 'p-sel', name: 'Selma Otsing', email: 'selma@x.com', sectionIds: ['sec-sop1a'], dbEntityId: ORG },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: '', sectionIds: ['sec-alto'], dbEntityId: ORG }
	];
}

const CFG = testCfg('sampledb', 'jwt-abc');

let landedReparents: Array<{ id: string; newParentId: string }>;

function sortLevel(nodes: SectionNode[]): SectionNode[] {
	return [...nodes].sort(
		(a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)
	);
}

function withDepth(node: SectionNode, depth: number): SectionNode {
	return { ...node, depth, children: node.children.map((c) => withDepth(c, depth + 1)) };
}

function treeWithLandedMoves(moves: Array<{ id: string; newParentId: string }>): SectionNode[] {
	let roots = fixtureTree();
	for (const mv of moves) {
		let moved: SectionNode | null = null;
		const detach = (nodes: SectionNode[]): SectionNode[] =>
			nodes
				.filter((n) => {
					if (n.id === mv.id) {
						moved = n;
						return false;
					}
					return true;
				})
				.map((n) => ({ ...n, children: detach(n.children) }));
		roots = detach(roots);
		if (!moved) continue;
		const found: SectionNode = moved;
		if (mv.newParentId === ORG) {
			roots = sortLevel([
				...roots,
				withDepth({ ...found, parentId: null, dbEntityId: ORG }, 0)
			]);
		} else {
			const attach = (nodes: SectionNode[], depth: number): SectionNode[] =>
				nodes.map((n) =>
					n.id === mv.newParentId
						? {
								...n,
								children: sortLevel([
									...n.children,
									withDepth({ ...found, parentId: n.id, dbEntityId: null }, depth + 1)
								])
							}
						: { ...n, children: attach(n.children, depth + 1) }
				);
			roots = attach(roots, 0);
		}
	}
	return roots;
}

function setAuthedWithOneCollective() {
	signIn();
}

beforeEach(() => {
	landedReparents = [];
	loadRosterMock.mockImplementation(() => Promise.resolve(toListRead(fixtureRows())));
	listSectionsMock.mockImplementation(() => Promise.resolve(treeWithLandedMoves(landedReparents)));
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createMock.mockResolvedValue('sec-created');
	reorderMock.mockResolvedValue(undefined);
	deleteMock.mockResolvedValue(undefined);
	reparentMock.mockImplementation((_cfg: unknown, id: string, newParentId: string) => {
		landedReparents.push({ id, newParentId });
		return Promise.resolve(undefined);
	});
});

afterEach(() => {
	cleanup();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	assignMock.mockReset();
	unassignMock.mockReset();
	createMock.mockReset();
	reorderMock.mockReset();
	deleteMock.mockReset();
	reparentMock.mockReset();
	resetAppState();
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderInArrangeMode(): Promise<HTMLElement> {
	landedReparents.length = 0;
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

function rowOrder(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-testid^="arrange-row-"]')].map(
		(el) => el.getAttribute('data-testid') ?? ''
	);
}

function row(container: HTMLElement, id: string): HTMLElement {
	return q(container, `arrange-row-${id}`) as HTMLElement;
}

function indentBtn(container: HTMLElement, id: string): HTMLButtonElement {
	const el = q(container, `arrange-indent-${id}`);
	expect(el, `indent button for ${id}`).not.toBeNull();
	return el as HTMLButtonElement;
}

function unindentBtn(container: HTMLElement, id: string): HTMLButtonElement {
	const el = q(container, `arrange-unindent-${id}`);
	expect(el, `unindent button for ${id}`).not.toBeNull();
	return el as HTMLButtonElement;
}

function statusText(container: HTMLElement): string {
	return q(container, 'roster-reorder-status')?.textContent ?? '';
}

describe('/roster — arrange rows carry indent/unindent buttons (#155/S3)', () => {
	it('every arrange row has an arrange-indent-* and arrange-unindent-* button (type="button"), named via roster_section_indent/roster_section_unindent — with NO grab active', async () => {
		const container = await renderInArrangeMode();

		for (const id of ['sec-sop', 'sec-sop1', 'sec-sop2', 'sec-alto', 'sec-tenor']) {
			const ind = indentBtn(container, id);
			const un = unindentBtn(container, id);
			expect(ind.getAttribute('type'), `indent ${id}`).toBe('button');
			expect(un.getAttribute('type'), `unindent ${id}`).toBe('button');
			expect(ind.getAttribute('aria-label'), `indent ${id}`).toContain('roster_section_indent');
			expect(un.getAttribute('aria-label'), `unindent ${id}`).toContain('roster_section_unindent');
		}
		for (const id of ['sec-sop', 'sec-sop1', 'sec-sop2', 'sec-alto', 'sec-tenor']) {
			expect(row(container, id).getAttribute('data-grabbed')).toBeNull();
		}
	});

	it('guards: indent disabled without a PREVIOUS SIBLING; unindent disabled at TOP LEVEL', async () => {
		const container = await renderInArrangeMode();

		expect(indentBtn(container, 'sec-sop').disabled).toBe(true);
		expect(unindentBtn(container, 'sec-sop').disabled).toBe(true);
		expect(indentBtn(container, 'sec-sop1').disabled).toBe(true);
		expect(unindentBtn(container, 'sec-sop1').disabled).toBe(false);
		expect(indentBtn(container, 'sec-sop2').disabled).toBe(false);
		expect(unindentBtn(container, 'sec-sop2').disabled).toBe(false);
		expect(indentBtn(container, 'sec-alto').disabled).toBe(false);
		expect(unindentBtn(container, 'sec-alto').disabled).toBe(true);
		expect(indentBtn(container, 'sec-tenor').disabled).toBe(false);
		expect(unindentBtn(container, 'sec-tenor').disabled).toBe(true);
	});
});

describe('/roster — the nesting buttons are SIBLINGS of the arrange row, not children of it (#155/S3 review R2/F1)', () => {
	const ALL_IDS = ['sec-sop', 'sec-sop1', 'sec-sop2', 'sec-alto', 'sec-tenor'];

	it('no arrange row contains a FOCUSABLE descendant — a `<button>` inside a `role="button"` is the `nested-interactive` violation, and it adds tab stops inside a widget #152 gave ONE roving tab stop', async () => {
		const container = await renderInArrangeMode();

		for (const id of ALL_IDS) {
			const r = row(container, id);
			expect(r.getAttribute('role'), `row ${id} is still the role=button control`).toBe('button');
			expect(
				r.querySelector('button, a[href], input, select, textarea, [tabindex], [contenteditable]'),
				`focusable descendant inside row ${id}`
			).toBeNull();
			expect(
				indentBtn(container, id).closest('[data-testid^="arrange-row-"]'),
				`indent button for ${id} escaped the row subtree`
			).toBeNull();
			expect(
				unindentBtn(container, id).closest('[data-testid^="arrange-row-"]'),
				`unindent button for ${id} escaped the row subtree`
			).toBeNull();
		}
	});

	it('nothing inside a row contributes to its ACCESSIBLE NAME beyond the row\'s own label — no descendant aria-label/title/aria-labelledby, so "Soprano (3)" stays the whole name (WCAG 2.5.3)', async () => {
		const container = await renderInArrangeMode();

		for (const id of ALL_IDS) {
			const r = row(container, id);
			expect(
				r.querySelector('[aria-label], [title], [aria-labelledby]'),
				`name-contributing descendant inside row ${id}`
			).toBeNull();
		}
		expect(row(container, 'sec-sop').getAttribute('aria-label')).toBe('Soprano (3)');
		expect(row(container, 'sec-sop').textContent?.replace(/\s+/g, ' ').trim()).toBe('');
		expect((q(container, 'arrange-count-sec-sop')?.textContent ?? '').trim()).toBe('(3)');
	});
});

describe('/roster — INDENT nests under the immediate previous sibling (#155/S3)', () => {
	it('indent Alto → ONE reparentSection(cfg, "sec-alto", "sec-sop") call; Alto re-renders as Soprano\'s LAST child (depth 1, indent class), Soprano\'s roll-up absorbs Bea → "Soprano (4)", and the DESTINATION sibling group is renumbered so the position survives a reload', async () => {
		const container = await renderInArrangeMode();

		await fireEvent.click(indentBtn(container, 'sec-alto'));

		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		expect(reparentMock).toHaveBeenCalledWith(CFG, 'sec-alto', 'sec-sop');
		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderMock).toHaveBeenCalledWith(CFG, ['sec-sop1', 'sec-sop2', 'sec-alto']);

		await waitFor(() => {
			expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('1');
		});
		expect(rowOrder(container)).toEqual([
			'arrange-row-sec-sop',
			'arrange-row-sec-sop1',
			'arrange-row-sec-sop2',
			'arrange-row-sec-alto',
			'arrange-row-sec-tenor'
		]);
		expect(row(container, 'sec-alto').className).toContain('pl-4');
		expect(row(container, 'sec-sop').getAttribute('aria-label')).toBe('Soprano (4)');
		expect(row(container, 'sec-alto').getAttribute('data-grabbed')).toBeNull();
		expect(statusText(container)).toContain('roster_section_indented');
	});

	it('guards RECALCULATE after the move: the indented Alto can now unindent, and Tenor (whose previous sibling is now Soprano) can still indent', async () => {
		const container = await renderInArrangeMode();

		await fireEvent.click(indentBtn(container, 'sec-alto'));
		await waitFor(() => {
			expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('1');
		});

		expect(unindentBtn(container, 'sec-alto').disabled).toBe(false);
		expect(indentBtn(container, 'sec-tenor').disabled).toBe(false);
		await fireEvent.click(indentBtn(container, 'sec-alto'));
		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(2);
		});
		expect(reparentMock).toHaveBeenLastCalledWith(CFG, 'sec-alto', 'sec-sop2');
	});
});

describe('/roster — UNINDENT promotes one level (#155/S3)', () => {
	it('unindent Soprano 1 (top-level parent) → ONE reparentSection(cfg, "sec-sop1", "<org id>") call — the ORGANIZATION becomes the parent; it lands AFTER Soprano\'s subtree at depth 0, and Soprano\'s roll-up drops Eva → "Soprano (2)"', async () => {
		const container = await renderInArrangeMode();

		await fireEvent.click(unindentBtn(container, 'sec-sop1'));

		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		expect(reparentMock).toHaveBeenCalledWith(CFG, 'sec-sop1', ORG);
		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderMock).toHaveBeenCalledWith(CFG, [
			'sec-sop',
			'sec-sop1',
			'sec-alto',
			'sec-tenor'
		]);

		await waitFor(() => {
			expect(row(container, 'sec-sop1').getAttribute('data-depth')).toBe('0');
		});
		expect(rowOrder(container)).toEqual([
			'arrange-row-sec-sop',
			'arrange-row-sec-sop2',
			'arrange-row-sec-sop1',
			'arrange-row-sec-alto',
			'arrange-row-sec-tenor'
		]);
		expect(row(container, 'sec-sop1').className).toContain('pl-0');
		expect(row(container, 'sec-sop').getAttribute('aria-label')).toBe('Soprano (2)');
		expect(statusText(container)).toContain('roster_section_unindented_top');
		expect(unindentBtn(container, 'sec-sop1').disabled).toBe(true);
	});

	it('unindent a depth-2 section → the GRANDPARENT SECTION becomes the parent: reparentSection(cfg, "sec-sop1a", "sec-sop"), announced with roster_section_unindented (a named parent, not top level)', async () => {
		listSectionsMock.mockImplementation(() => Promise.resolve(fixtureTreeDeep()));
		loadRosterMock.mockImplementation(() => Promise.resolve(toListRead(fixtureRowsDeep())));
		const container = await renderInArrangeMode();
		expect(row(container, 'sec-sop1a').getAttribute('data-depth')).toBe('2');

		await fireEvent.click(unindentBtn(container, 'sec-sop1a'));

		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		expect(reparentMock).toHaveBeenCalledWith(CFG, 'sec-sop1a', 'sec-sop');
		await waitFor(() => {
			expect(row(container, 'sec-sop1a').getAttribute('data-depth')).toBe('1');
		});
		expect(rowOrder(container)).toEqual([
			'arrange-row-sec-sop',
			'arrange-row-sec-sop1',
			'arrange-row-sec-sop1a',
			'arrange-row-sec-alto'
		]);
		expect(statusText(container)).toContain('roster_section_unindented');
		expect(statusText(container)).not.toContain('roster_section_unindented_top');
	});
});

describe('/roster — keyboard ArrowRight indents / ArrowLeft unindents while grabbed (#155/S3)', () => {
	it('grab Alto, ArrowRight → the SAME single reparentSection(cfg, "sec-alto", "sec-sop") write the button makes; the commit is announced ("indented", NEVER "cancelled") and the grab ENDS', async () => {
		const container = await renderInArrangeMode();
		const target = row(container, 'sec-alto');
		target.focus();
		await fireEvent.keyDown(target, { key: ' ' });
		await waitFor(() => expect(target.getAttribute('data-grabbed')).toBe('true'));

		await fireEvent.keyDown(row(container, 'sec-alto'), { key: 'ArrowRight' });

		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		expect(reparentMock).toHaveBeenCalledWith(CFG, 'sec-alto', 'sec-sop');
		await waitFor(() => {
			expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('1');
		});
		expect(row(container, 'sec-alto').getAttribute('data-grabbed')).toBeNull();
		expect(statusText(container)).toContain('roster_section_indented');
		expect(statusText(container)).not.toContain('roster_section_move_cancelled');
	});

	it('grab Soprano 1, ArrowLeft → unindents to top level: reparentSection(cfg, "sec-sop1", "<org id>"), announced, grab ended', async () => {
		const container = await renderInArrangeMode();
		const target = row(container, 'sec-sop1');
		target.focus();
		await fireEvent.keyDown(target, { key: 'Enter' });
		await waitFor(() => expect(target.getAttribute('data-grabbed')).toBe('true'));

		await fireEvent.keyDown(row(container, 'sec-sop1'), { key: 'ArrowLeft' });

		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		expect(reparentMock).toHaveBeenCalledWith(CFG, 'sec-sop1', ORG);
		await waitFor(() => {
			expect(row(container, 'sec-sop1').getAttribute('data-depth')).toBe('0');
		});
		expect(row(container, 'sec-sop1').getAttribute('data-grabbed')).toBeNull();
		expect(statusText(container)).toContain('roster_section_unindented_top');
	});

	it('ArrowRight with NO previous sibling is refused: nothing written, the grab STAYS (same posture as the Up/Down clamp) — and the guard is the same one disabling the button', async () => {
		const container = await renderInArrangeMode();
		expect(indentBtn(container, 'sec-sop').disabled).toBe(true);
		const target = row(container, 'sec-sop');
		target.focus();
		await fireEvent.keyDown(target, { key: ' ' });
		await waitFor(() => expect(target.getAttribute('data-grabbed')).toBe('true'));

		await fireEvent.keyDown(row(container, 'sec-sop'), { key: 'ArrowRight' });

		expect(reparentMock).not.toHaveBeenCalled();
		expect(row(container, 'sec-sop').getAttribute('data-grabbed')).toBe('true');
		expect(rowOrder(container)[0]).toBe('arrange-row-sec-sop');

		await fireEvent.keyDown(row(container, 'sec-sop'), { key: 'Escape' });
	});

	it('ArrowLeft on a grabbed TOP-LEVEL section is refused: nothing written, grab stays — same guard as the disabled unindent button', async () => {
		const container = await renderInArrangeMode();
		expect(unindentBtn(container, 'sec-alto').disabled).toBe(true);
		const target = row(container, 'sec-alto');
		target.focus();
		await fireEvent.keyDown(target, { key: ' ' });
		await waitFor(() => expect(target.getAttribute('data-grabbed')).toBe('true'));

		await fireEvent.keyDown(row(container, 'sec-alto'), { key: 'ArrowLeft' });

		expect(reparentMock).not.toHaveBeenCalled();
		expect(row(container, 'sec-alto').getAttribute('data-grabbed')).toBe('true');
		expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('0');

		await fireEvent.keyDown(row(container, 'sec-alto'), { key: 'Escape' });
	});

	it('idle (ungrabbed) ArrowRight/ArrowLeft write nothing and move nothing — the nesting keys only act on a held row', async () => {
		const container = await renderInArrangeMode();
		expect(indentBtn(container, 'sec-alto')).not.toBeNull();
		const before = rowOrder(container);
		const target = row(container, 'sec-alto');
		target.focus();

		await fireEvent.keyDown(target, { key: 'ArrowRight' });
		await fireEvent.keyDown(target, { key: 'ArrowLeft' });

		expect(reparentMock).not.toHaveBeenCalled();
		expect(rowOrder(container)).toEqual(before);
		expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('0');
	});
});

describe('/roster — reparent writes share the one-outstanding-write guard and the reconcile-on-failure contract (#155/S3)', () => {
	it('while a reparent is in flight EVERY indent/unindent button is disabled; they re-enable (per their own guards) once it lands', async () => {
		let release!: () => void;
		reparentMock.mockImplementation(
			() =>
				new Promise<void>((res) => {
					release = () => res();
				})
		);
		const container = await renderInArrangeMode();

		await fireEvent.click(indentBtn(container, 'sec-alto'));
		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(indentBtn(container, 'sec-tenor').disabled).toBe(true);
		});
		for (const id of ['sec-sop', 'sec-sop1', 'sec-sop2', 'sec-alto', 'sec-tenor']) {
			expect(indentBtn(container, id).disabled, `indent ${id} during flight`).toBe(true);
			expect(unindentBtn(container, id).disabled, `unindent ${id} during flight`).toBe(true);
		}
		await fireEvent.click(indentBtn(container, 'sec-tenor'));
		expect(reparentMock).toHaveBeenCalledTimes(1);

		release();
		await waitFor(() => {
			expect(indentBtn(container, 'sec-tenor').disabled).toBe(false);
		});
	});

	it('a failed reparent reconciles against the server (same AC-8 contract as a failed reorder): console.error, listSections refetch, the server tree renders — Alto back at top level', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderInArrangeMode();
		const listCallsBefore = listSectionsMock.mock.calls.length;
		reparentMock.mockRejectedValue(new Error('reparent boom'));

		await fireEvent.click(indentBtn(container, 'sec-alto'));

		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(listSectionsMock.mock.calls.length).toBeGreaterThan(listCallsBefore);
		});
		await waitFor(() => {
			expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('0');
		});
		expect(rowOrder(container)).toEqual([
			'arrange-row-sec-sop',
			'arrange-row-sec-sop1',
			'arrange-row-sec-sop2',
			'arrange-row-sec-alto',
			'arrange-row-sec-tenor'
		]);
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it('a reparent that LANDS but whose sibling RENUMBER fails reconciles to the TRUTH — the section renders AT ITS NEW PARENT AND DEPTH (the move happened), and the banner SAYS the move happened (#253)', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderInArrangeMode();
		const listCallsBefore = listSectionsMock.mock.calls.length;
		reorderMock.mockRejectedValue({
			code: 'section-reparent-partial',
			step: 'renumber',
			renumberedCount: 1,
			totalCount: 3,
			status: 429,
			body: 'rate limit exceeded'
		});

		await fireEvent.click(indentBtn(container, 'sec-alto'));

		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reparentMock).toHaveBeenCalledTimes(1);
		await waitFor(() => {
			expect(listSectionsMock.mock.calls.length).toBeGreaterThan(listCallsBefore);
		});
		await waitFor(() => {
			expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('1');
		});
		expect(rowOrder(container)).toEqual([
			'arrange-row-sec-sop',
			'arrange-row-sec-sop1',
			'arrange-row-sec-alto',
			'arrange-row-sec-sop2',
			'arrange-row-sec-tenor'
		]);
		await waitFor(() => {
			expect(q(container, 'section-reorder-error')).not.toBeNull();
		});
		const banner = q(container, 'section-reorder-error')?.textContent ?? '';
		expect(banner).toContain('roster_section_reparent_partial');
		expect(banner).not.toContain('roster_section_reorder_failed');
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});

describe('/roster — a failed reparent reports WHAT ACTUALLY LANDED, with the evidence captured (#253)', () => {
	const partialEvidence = {
		code: 'section-reparent-partial',
		step: 'renumber',
		renumberedCount: 1,
		totalCount: 3,
		status: 429,
		body: 'rate limit exceeded'
	};

	it('state (a) — the reparent ITSELF fails: under the #264 atomic contract this NOW MEANS nothing landed (the rejected POST carried the old value id, so the server changed nothing) — roster_section_reorder_failed is HONEST, the tree reverts truthfully, and the evidence reaches console.error', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderInArrangeMode();
		reparentMock.mockRejectedValue({
			code: 'section-reparent-partial',
			step: 'reparent',
			renumberedCount: 0,
			totalCount: 0,
			status: 403,
			body: 'forbidden by rights'
		});

		await fireEvent.click(indentBtn(container, 'sec-alto'));

		await waitFor(() => {
			expect(q(container, 'section-reorder-error')).not.toBeNull();
		});
		const banner = q(container, 'section-reorder-error')?.textContent ?? '';
		expect(banner).toContain('roster_section_reorder_failed');
		expect(banner).not.toContain('roster_section_reparent_partial');
		await waitFor(() => {
			expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('0');
		});
		expect(reorderMock).not.toHaveBeenCalled();
		expect(
			consoleSpy.mock.calls.some((args) =>
				args.some(
					(a) =>
						(a as { status?: unknown })?.status === 403 &&
						(a as { body?: unknown })?.body === 'forbidden by rights'
				)
			)
		).toBe(true);
		consoleSpy.mockRestore();
	});

	it('state (b) — the move LANDED, the renumber did not: the NEW copy renders WITHOUT the renumber depth (k of N stays in the typed error), and the evidence reaches console.error', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderInArrangeMode();
		reorderMock.mockRejectedValue(partialEvidence);

		await fireEvent.click(indentBtn(container, 'sec-alto'));

		await waitFor(() => {
			expect(q(container, 'section-reorder-error')).not.toBeNull();
		});
		await waitFor(() => {
			expect((q(container, 'section-reorder-error')?.textContent ?? '')).toContain(
				'roster_section_reparent_partial'
			);
		});
		const banner = q(container, 'section-reorder-error')?.textContent ?? '';
		expect(banner).not.toContain('renumbered');
		expect(banner).not.toContain('total');
		expect(banner).not.toMatch(/1\s*(of|\/)\s*3/);
		expect(
			consoleSpy.mock.calls.some((args) =>
				args.some(
					(a) =>
						(a as { status?: unknown })?.status === 429 &&
						(a as { body?: unknown })?.body === 'rate limit exceeded'
				)
			)
		).toBe(true);
		consoleSpy.mockRestore();
	});

	for (const [label, rejection] of [
		['a network rejection propagated verbatim by entuFetch', new TypeError('Failed to fetch')],
		['a SyntaxError from a malformed response body', new SyntaxError('Unexpected token < in JSON')],
		['a plain untagged Error', new Error('renumber boom')]
	] as const) {
		it(`state (b) with an UNTYPED rejection — ${label}: the move still landed, so the banner still says so and the section still renders at its new parent`, async () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const container = await renderInArrangeMode();
			reorderMock.mockRejectedValue(rejection);

			await fireEvent.click(indentBtn(container, 'sec-alto'));

			await waitFor(() => {
				expect(q(container, 'section-reorder-error')).not.toBeNull();
			});
			await waitFor(() => {
				expect(q(container, 'section-reorder-error')?.textContent ?? '').toContain(
					'roster_section_reparent_partial'
				);
			});
			expect(q(container, 'section-reorder-error')?.textContent ?? '').not.toContain(
				'roster_section_reorder_failed'
			);
			await waitFor(() => {
				expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('1');
			});
			expect(reparentMock.mock.calls).toEqual([[CFG, 'sec-alto', 'sec-sop']]);
			expect(consoleSpy.mock.calls.some((args) => args.some((a) => a === rejection))).toBe(true);
			consoleSpy.mockRestore();
		});
	}

	it('the reparent phase failing UNTYPED keeps the nothing-landed copy — an untyped rejection is not evidence of a landed move', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderInArrangeMode();
		reparentMock.mockRejectedValue(new TypeError('Failed to fetch'));

		await fireEvent.click(indentBtn(container, 'sec-alto'));

		await waitFor(() => {
			expect(q(container, 'section-reorder-error')).not.toBeNull();
		});
		const banner = q(container, 'section-reorder-error')?.textContent ?? '';
		expect(banner).toContain('roster_section_reorder_failed');
		expect(banner).not.toContain('roster_section_reparent_partial');
		await waitFor(() => {
			expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('0');
		});
		expect(reorderMock).not.toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it('REFUSALS (PO #253): no retry and no automatic unwind — EXACTLY one forward reparent write, exactly one renumber attempt, and never a reverse `_parent` write after the failure', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderInArrangeMode();
		reorderMock.mockRejectedValue(partialEvidence);

		await fireEvent.click(indentBtn(container, 'sec-alto'));

		await waitFor(() => {
			expect(q(container, 'section-reorder-error')).not.toBeNull();
		});
		await waitFor(() => {
			expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('1');
		});
		expect(reparentMock.mock.calls).toEqual([[CFG, 'sec-alto', 'sec-sop']]);
		expect(reorderMock.mock.calls).toEqual([[CFG, ['sec-sop1', 'sec-sop2', 'sec-alto']]]);
		consoleSpy.mockRestore();
	});
});

describe('/roster — the indent/unindent buttons are keyboard-operable in their OWN right (#155/S3 review F1)', () => {
	it('Enter/Space on a focused indent button does NOT drive the row\'s grab machine, and does NOT preventDefault (so the browser\'s native button activation survives)', async () => {
		const container = await renderInArrangeMode();
		const btn = indentBtn(container, 'sec-alto');
		btn.focus();

		for (const key of ['Enter', ' ']) {
			const ev = createEvent.keyDown(btn, { key, bubbles: true, cancelable: true });
			await fireEvent(btn, ev);
			expect(ev.defaultPrevented, `defaultPrevented for ${key}`).toBe(false);
		}

		expect(row(container, 'sec-alto').getAttribute('data-grabbed')).toBeNull();
		expect(row(container, 'sec-alto').getAttribute('aria-grabbed')).toBe('false');
		expect(statusText(container)).not.toContain('roster_section_grabbed');
		await fireEvent.click(btn);
		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		expect(reparentMock).toHaveBeenCalledWith(CFG, 'sec-alto', 'sec-sop');
		expect(row(container, 'sec-alto').getAttribute('aria-grabbed')).toBe('false');
	});

	it('ArrowUp/ArrowDown on a focused indent/unindent button do nothing — focus stays ON THE BUTTON instead of roving to another row', async () => {
		const container = await renderInArrangeMode();
		const btn = unindentBtn(container, 'sec-sop1');
		btn.focus();
		expect(document.activeElement).toBe(btn);

		await fireEvent.keyDown(btn, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(btn);
		await fireEvent.keyDown(btn, { key: 'ArrowUp' });
		expect(document.activeElement).toBe(btn);

		expect(reparentMock).not.toHaveBeenCalled();
		expect(reorderMock).not.toHaveBeenCalled();
		expect(row(container, 'sec-sop1').getAttribute('data-grabbed')).toBeNull();
	});
});

describe('/roster — an unindent with no resolvable organization fails LOUDLY (#155/S3 review F3)', () => {
	function fixtureTreeNoOrg(): SectionNode[] {
		return [
			{
				id: 'sec-sop',
				name: 'Soprano',
				displayOrder: 1,
				parentId: null,
				dbEntityId: null,
				depth: 0,
				children: [
					{ id: 'sec-sop1', name: 'Soprano 1', displayOrder: 1, parentId: 'sec-sop', dbEntityId: null, depth: 1, children: [] }
				]
			},
			{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, dbEntityId: null, depth: 0, children: [] }
		];
	}

	function fixtureRowsNoOrg(): RosterRow[] {
		return [
			{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'] },
			{ memberId: 'm-eva', personId: 'p-eva', name: 'Eva Green', email: 'eva@x.com', sectionIds: ['sec-sop1'] },
			{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: '', sectionIds: ['sec-alto'] }
		];
	}

	it('promote-to-top-level with no known organization id raises the reorder banner and writes NOTHING — never a dead button that silently does nothing', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		listSectionsMock.mockImplementation(() => Promise.resolve(fixtureTreeNoOrg()));
		loadRosterMock.mockImplementation(() => Promise.resolve(toListRead(fixtureRowsNoOrg())));
		const container = await renderInArrangeMode();
		expect(unindentBtn(container, 'sec-sop1').disabled).toBe(false);

		await fireEvent.click(unindentBtn(container, 'sec-sop1'));

		await waitFor(() => {
			expect(q(container, 'section-reorder-error')).not.toBeNull();
		});
		expect(reparentMock).not.toHaveBeenCalled();
		expect(reorderMock).not.toHaveBeenCalled();
		expect(row(container, 'sec-sop1').getAttribute('data-depth')).toBe('1');
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});

describe('/roster — indent/unindent are pointer-only (tabindex="-1"), with the row grab as their keyboard equivalent (#156, checklist item 10)', () => {
	const ALL_IDS = ['sec-sop', 'sec-sop1', 'sec-sop2', 'sec-alto', 'sec-tenor'];

	it('every indent AND unindent button carries tabindex="-1" — no Tab stops for the nesting pair', async () => {
		const container = await renderInArrangeMode();
		for (const id of ALL_IDS) {
			expect(indentBtn(container, id).getAttribute('tabindex'), `indent ${id}`).toBe('-1');
			expect(unindentBtn(container, id).getAttribute('tabindex'), `unindent ${id}`).toBe('-1');
		}
	});

	it('they stay pointer-operable — a click still runs the write (the exclusion removes the TAB STOP, not the control)', async () => {
		const container = await renderInArrangeMode();
		await fireEvent.click(indentBtn(container, 'sec-alto'));
		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		expect(reparentMock).toHaveBeenCalledWith(CFG, 'sec-alto', 'sec-sop');
	});

	it('the row-grab keyboard path produces the IDENTICAL write to the indent button — this is what makes dropping the tab stop safe (WCAG 2.1.1)', async () => {
		const byButton = await renderInArrangeMode();
		await fireEvent.click(indentBtn(byButton, 'sec-alto'));
		await waitFor(() => expect(reparentMock).toHaveBeenCalledTimes(1));
		const buttonCall = reparentMock.mock.calls[0];

		cleanup();
		reparentMock.mockClear();

		const byKeyboard = await renderInArrangeMode();
		const target = row(byKeyboard, 'sec-alto');
		target.focus();
		await fireEvent.keyDown(target, { key: ' ' });
		await waitFor(() => expect(target.getAttribute('data-grabbed')).toBe('true'));
		await fireEvent.keyDown(row(byKeyboard, 'sec-alto'), { key: 'ArrowRight' });
		await waitFor(() => expect(reparentMock).toHaveBeenCalledTimes(1));

		expect(reparentMock.mock.calls[0]).toEqual(buttonCall);
	});

	it('the row-grab keyboard path produces the IDENTICAL write to the unindent button too', async () => {
		const byButton = await renderInArrangeMode();
		await fireEvent.click(unindentBtn(byButton, 'sec-sop1'));
		await waitFor(() => expect(reparentMock).toHaveBeenCalledTimes(1));
		const buttonCall = reparentMock.mock.calls[0];

		cleanup();
		reparentMock.mockClear();

		const byKeyboard = await renderInArrangeMode();
		const target = row(byKeyboard, 'sec-sop1');
		target.focus();
		await fireEvent.keyDown(target, { key: 'Enter' });
		await waitFor(() => expect(target.getAttribute('data-grabbed')).toBe('true'));
		await fireEvent.keyDown(row(byKeyboard, 'sec-sop1'), { key: 'ArrowLeft' });
		await waitFor(() => expect(reparentMock).toHaveBeenCalledTimes(1));

		expect(reparentMock.mock.calls[0]).toEqual(buttonCall);
	});

	it('the ASYMMETRY is deliberate: rename and delete in the SAME wrapper keep their normal tab stops (no row-level equivalent exists for them)', async () => {
		const container = await renderInArrangeMode();
		for (const id of ALL_IDS) {
			const rename = q(container, `arrange-rename-${id}`);
			const remove = q(container, `section-remove-${id}`);
			expect(rename, `rename button for ${id}`).not.toBeNull();
			expect(remove, `remove button for ${id}`).not.toBeNull();
			expect(rename!.getAttribute('tabindex'), `rename ${id} must stay a Tab stop`).toBeNull();
			expect(remove!.getAttribute('tabindex'), `remove ${id} must stay a Tab stop`).toBeNull();
		}
	});
});

const TOUCH_TOKENS = ['min-h-11', 'min-w-11'];

function classTokens(el: Element): string[] {
	return (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}
function hasBareToken(el: Element, token: string): boolean {
	return classTokens(el).includes(token);
}
function hasTokenAnyVariant(el: Element, token: string): boolean {
	return classTokens(el).some((c) => c === token || c.endsWith(`:${token}`));
}

const APPLICABLE_252: Array<{ dir: 'indent' | 'unindent'; id: string }> = [
	{ dir: 'indent', id: 'sec-sop2' },
	{ dir: 'indent', id: 'sec-alto' },
	{ dir: 'indent', id: 'sec-tenor' },
	{ dir: 'unindent', id: 'sec-sop1' },
	{ dir: 'unindent', id: 'sec-sop2' }
];
const INAPPLICABLE_252: Array<{ dir: 'indent' | 'unindent'; id: string }> = [
	{ dir: 'indent', id: 'sec-sop' },
	{ dir: 'indent', id: 'sec-sop1' },
	{ dir: 'unindent', id: 'sec-sop' },
	{ dir: 'unindent', id: 'sec-alto' },
	{ dir: 'unindent', id: 'sec-tenor' }
];
const ALL_IDS_252 = ['sec-sop', 'sec-sop1', 'sec-sop2', 'sec-alto', 'sec-tenor'];

function slot252(
	container: HTMLElement,
	dir: 'indent' | 'unindent',
	id: string
): HTMLElement | null {
	return q(container, `arrange-${dir}-${id}`);
}

function isNonInteractive252(el: HTMLElement): boolean {
	return (
		el.getAttribute('aria-hidden') === 'true' ||
		hasBareToken(el, 'invisible') ||
		hasBareToken(el, 'pointer-events-none') ||
		(el instanceof HTMLButtonElement && el.disabled)
	);
}

describe("/roster — the nesting controls meet the app's own touch-target standard (#252)", () => {
	it('every APPLICABLE direction carries `min-h-11 min-w-11` — the 44px standard the trashcan/gear/create buttons already keep (the glyph inside may stay small)', async () => {
		const container = await renderInArrangeMode();
		for (const { dir, id } of APPLICABLE_252) {
			const el = slot252(container, dir, id);
			expect(el, `${dir} control for ${id}`).not.toBeNull();
			for (const token of TOUCH_TOKENS) {
				expect(
					hasBareToken(el!, token),
					`${dir} ${id} must carry ${token} — a 12px glyph in ~20px of padding is less than half the app's own touch minimum (GH#252 item 1)`
				).toBe(true);
			}
		}
	});

	it("EVERY slot holds the same hit-area box — inapplicable directions included, so a row never jumps when applicability changes (space reserved, GH#252 item 2)", async () => {
		const container = await renderInArrangeMode();
		for (const id of ALL_IDS_252) {
			for (const dir of ['indent', 'unindent'] as const) {
				const el = slot252(container, dir, id);
				expect(
					el,
					`${dir} slot for ${id} must exist — reserving the space is what keeps rows from shifting`
				).not.toBeNull();
				for (const token of TOUCH_TOKENS) {
					expect(
						hasBareToken(el!, token),
						`${dir} ${id}: the slot must hold the ${token} box whether or not the action applies`
					).toBe(true);
				}
			}
		}
	});
});

describe('/roster — only applicable actions present as tappable; an inapplicable one yields interactivity but holds its space (#252)', () => {
	it('no inapplicable direction renders the old opacity-30 ghost — the token is gone bare AND behind variants (`disabled:opacity-30` is still the ghost)', async () => {
		const container = await renderInArrangeMode();
		for (const { dir, id } of INAPPLICABLE_252) {
			const el = slot252(container, dir, id);
			if (el === null) continue; // slot existence is pinned above; this pin is about presentation
			expect(
				hasTokenAnyVariant(el, 'opacity-30'),
				`${dir} ${id}: an action that cannot be taken must not present as a tappable control at 30% opacity (GH#252 item 2, Mihkel's direction — "show only active actions")`
			).toBe(false);
		}
	});

	it('an inapplicable direction is not an interactive control, and clicking its slot writes NOTHING', async () => {
		const container = await renderInArrangeMode();
		for (const { dir, id } of INAPPLICABLE_252) {
			const el = slot252(container, dir, id);
			if (el === null) continue;
			expect(
				isNonInteractive252(el),
				`${dir} ${id}: hidden-from-AT, invisible, pointer-inert or disabled — GREEN's pick which, but never a live control`
			).toBe(true);
			await fireEvent.click(el);
		}
		expect(reparentMock).not.toHaveBeenCalled();
		expect(reorderMock).not.toHaveBeenCalled();
	});

	it("space held ACROSS a state change: after unindenting Soprano 1 to top level, its now-inapplicable unindent slot still holds the row's box and is not a ghost", async () => {
		const container = await renderInArrangeMode();

		await fireEvent.click(slot252(container, 'unindent', 'sec-sop1') as HTMLElement);
		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		expect(reparentMock).toHaveBeenCalledWith(CFG, 'sec-sop1', ORG);

		await waitFor(() => {
			const el = slot252(container, 'unindent', 'sec-sop1');
			expect(el, 'the unindent slot survives the applicability flip').not.toBeNull();
			expect(isNonInteractive252(el!)).toBe(true);
		});
		const el = slot252(container, 'unindent', 'sec-sop1') as HTMLElement;
		for (const token of TOUCH_TOKENS) {
			expect(
				hasBareToken(el, token),
				`the slot must still hold the ${token} box after the move — rows must not jump`
			).toBe(true);
		}
		expect(hasTokenAnyVariant(el, 'opacity-30')).toBe(false);
	});
});

describe('/roster — the two directions are distinguishable at a glance (#252)', () => {
	function pathPoints(d: string): Array<[number, number]> {
		const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
		const pts: Array<[number, number]> = [];
		for (let i = 0; i + 1 < nums.length; i += 2) {
			pts.push([nums[i]!, nums[i + 1]!]);
		}
		return pts;
	}
	function normalizePts(pts: Array<[number, number]>): string {
		return [...pts]
			.map(([x, y]) => `${x},${y}`)
			.sort()
			.join(' ');
	}
	function viewBoxSize(svg: Element | null): [number, number] {
		const vb = (svg?.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
		return vb.length === 4 ? [vb[2]!, vb[3]!] : [16, 16];
	}

	it('indent and unindent (both live on Soprano 2) differ by MORE than a reflection/rotation of one identical glyph — mirror triangles at 12px are the pinned defect (GH#252 item 3; GREEN states its treatment and why)', async () => {
		const container = await renderInArrangeMode();
		const a = slot252(container, 'indent', 'sec-sop2') as HTMLElement;
		const b = slot252(container, 'unindent', 'sec-sop2') as HTMLElement;
		expect(a).not.toBeNull();
		expect(b).not.toBeNull();

		const textDistinguishes = (a.textContent ?? '').trim() !== (b.textContent ?? '').trim();
		const classDistinguishes =
			(a.getAttribute('class') ?? '') !== (b.getAttribute('class') ?? '') ||
			(a.querySelector('svg')?.getAttribute('class') ?? '') !==
				(b.querySelector('svg')?.getAttribute('class') ?? '');

		const aPaths = [...a.querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '');
		const bPaths = [...b.querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '');
		let glyphDistinguishes: boolean;
		if (aPaths.length === 1 && bPaths.length === 1) {
			const [w, h] = viewBoxSize(a.querySelector('svg'));
			const pa = pathPoints(aPaths[0]!);
			const pb = normalizePts(pathPoints(bPaths[0]!));
			const transforms: Array<Array<[number, number]>> = [
				pa, // the identical glyph on both sides is no better
				pa.map(([x, y]) => [w - x, y] as [number, number]), // horizontal mirror — today's defect
				pa.map(([x, y]) => [x, h - y] as [number, number]), // vertical mirror
				pa.map(([x, y]) => [w - x, h - y] as [number, number]) // 180° rotation
			];
			glyphDistinguishes = !transforms.some((t) => normalizePts(t) === pb);
		} else {
			glyphDistinguishes =
				aPaths.length !== bPaths.length || aPaths.join('|') !== bPaths.join('|');
		}

		expect(
			textDistinguishes || classDistinguishes || glyphDistinguishes,
			'side by side at phone size, ▶ and ◀ read as the same shape — the two directions must differ by more than a mirror transform (GH#252 item 3)'
		).toBe(true);
	});
});

describe("/roster — the controls carry the app's normal control tone, not the muted row-metadata ink (#252)", () => {
	it('no APPLICABLE direction uses bare `text-ink-2` as its base tone — the replacement tone is GREEN\'s to pick and state (GH#252 item 4, #238 finding)', async () => {
		const container = await renderInArrangeMode();
		for (const { dir, id } of APPLICABLE_252) {
			const el = slot252(container, dir, id) as HTMLElement;
			expect(el, `${dir} control for ${id}`).not.toBeNull();
			expect(
				hasBareToken(el, 'text-ink-2'),
				`${dir} ${id}: a control the user must LOCATE must not be the quietest thing on the row (GH#252 item 4)`
			).toBe(false);
		}
	});
});

// (*MVOX:Tallis*) (*MVOX:Byrd*)
