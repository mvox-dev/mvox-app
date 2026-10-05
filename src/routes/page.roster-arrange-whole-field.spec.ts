// @vitest-environment happy-dom
import { render, fireEvent, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('raw')
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
import { adminStore } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import {
	assignMock,
	createMock,
	deleteMock,
	renameMock,
	reorderMock,
	reparentMock,
	unassignMock
} from '$lib/testing/mocks/sections';
import { cleanupResetRenameMocks, setAuthedWithOneCollective } from '$lib/testing/pages/roster';
import { dropZone, makeDataTransfer } from '$lib/testing/pages/rosterArrange';
import { q } from '$lib/testing/pages/dom';

function fixtureTree(): SectionNode[] {
	return [
		{ id: 'sec-sop', name: 'Soprano', displayOrder: 1, parentId: null, depth: 0, children: [] },
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, depth: 0, children: [] },
		{ id: 'sec-bass', name: 'Bass', displayOrder: 3, parentId: null, depth: 0, children: [] }
	];
}

function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-eva',
			personId: 'p-eva',
			name: 'Eva Green',
			email: 'eva@x.com',
			sectionIds: ['sec-sop']
		},
		{
			memberId: 'm-bea',
			personId: 'p-bea',
			name: 'Bea Noe',
			email: '',
			sectionIds: ['sec-alto']
		}
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
	reparentMock.mockResolvedValue(undefined);
	renameMock.mockResolvedValue(undefined);
});

afterEach(cleanupResetRenameMocks);

async function renderArrangeReady(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'roster-groups')).not.toBeNull();
	});
	const arrangeChip = q(container, 'roster-view-chip-arrange') as HTMLElement;
	expect(arrangeChip).not.toBeNull();
	await fireEvent.click(arrangeChip);
	await waitFor(() => {
		expect(q(container, 'roster-arrange-list')).not.toBeNull();
	});
	return container;
}

describe('#205 — /roster arrange: whole-field rename activator', () => {
	it('arrange-rename-<id> is a native button WRAPPING the section name — the name area is the activator, not a bare pencil', async () => {
		const container = await renderArrangeReady();

		const btn = q(container, 'arrange-rename-sec-alto') as HTMLElement;
		expect(btn).not.toBeNull();
		expect(btn.tagName).toBe('BUTTON');
		expect(
			btn.getAttribute('tabindex'),
			'the rename activator must stay in the tab order (rule-4 addendum + #155/S3 asymmetry pin)'
		).not.toBe('-1');
		expect((btn as HTMLButtonElement).disabled).toBe(false);

		expect(
			btn.textContent,
			'the visible section name must live INSIDE the rename button'
		).toContain('Alto');
	});

	it('layout guard (happy-dom cannot measure size): the rename activator is 44px tall and spans the name area', async () => {
		const container = await renderArrangeReady();

		const classes = Array.from((q(container, 'arrange-rename-sec-alto') as HTMLElement).classList);
		expect(classes, 'the rename activator must reserve a 44px-tall touch target').toContain(
			'min-h-11'
		);
		expect(
			classes.some((c) => c === 'w-full' || c === 'grow' || c === 'flex-1'),
			`the activator must span the name area, not shrink-wrap the glyph (got: ${classes.join(' ')})`
		).toBe(true);
	});

	it('the button carries an sr-only ACTION label alongside the visible name', async () => {
		const container = await renderArrangeReady();

		const btn = q(container, 'arrange-rename-sec-alto') as HTMLElement;
		const srOnly = btn.querySelector('.sr-only');
		expect(srOnly, 'the rename activator must carry an sr-only action label').not.toBeNull();
		expect((srOnly as HTMLElement).textContent?.trim()).not.toBe('');
	});

	it('clicking the NAME text opens the rename editor, pre-filled', async () => {
		const container = await renderArrangeReady();

		const btn = q(container, 'arrange-rename-sec-alto') as HTMLElement;
		const nameNode = Array.from(btn.querySelectorAll<HTMLElement>('*')).find((el) =>
			(el.textContent ?? '').includes('Alto')
		);
		expect(nameNode, 'no element inside the rename button shows the section name').toBeTruthy();
		await fireEvent.click(nameNode as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-alto')).not.toBeNull();
		});
		expect((q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement).value).toBe('Alto');
		expect(renameMock).not.toHaveBeenCalled();
		expect(reorderMock).not.toHaveBeenCalled();
	});

	it('a rename through the whole-field activator still saves via renameSection, and the new name shows back inside the button', async () => {
		const container = await renderArrangeReady();

		await fireEvent.click(q(container, 'arrange-rename-sec-alto') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-alto')).not.toBeNull();
		});
		const input = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'Alto Voices' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledWith(
				expect.objectContaining({ db: 'sampledb' }),
				'sec-alto',
				'Alto Voices'
			);
		});
		await waitFor(() => {
			expect(q(container, 'arrange-rename-sec-alto')?.textContent).toContain('Alto Voices');
		});
	});

	it('the reorder row is still the drag surface: draggable, role=button, keyboard grab → ArrowDown reorders', async () => {
		const container = await renderArrangeReady();

		const row = q(container, 'arrange-row-sec-alto') as HTMLElement;
		expect(row).not.toBeNull();
		expect(row.getAttribute('role')).toBe('button');
		expect(row.getAttribute('draggable')).toBe('true');
		const renameBtn = q(container, 'arrange-rename-sec-alto') as HTMLElement;
		expect(row.contains(renameBtn)).toBe(false);
		expect(renameBtn.contains(row)).toBe(false);

		row.focus();
		await fireEvent.keyDown(row, { key: 'Enter' });
		await waitFor(() => {
			expect(row.getAttribute('data-grabbed')).toBe('true');
		});
		await fireEvent.keyDown(q(container, 'arrange-row-sec-alto') as HTMLElement, {
			key: 'ArrowDown'
		});
		expect(reorderMock).not.toHaveBeenCalled(); // provisional — no write yet
		await fireEvent.keyDown(q(container, 'arrange-row-sec-alto') as HTMLElement, {
			key: 'Enter'
		});
		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderMock).toHaveBeenCalledWith(expect.objectContaining({ db: 'sampledb' }), [
			'sec-sop',
			'sec-bass',
			'sec-alto'
		]);
		expect(renameMock).not.toHaveBeenCalled();
	});
});

describe('#205 review — /roster arrange: no duplicate name, no shrunken drop target', () => {
	it('the section name renders EXACTLY ONCE per row — the reorder row keeps the "(n)" roll-up and states the pair as its own label', async () => {
		const container = await renderArrangeReady();

		const visible = (dropZone(container, 'sec-alto').textContent ?? '')
			.replace(/\s+/g, ' ')
			.trim();
		expect(visible.match(/Alto/g)?.length ?? 0, `row reads "${visible}"`).toBe(1);

		const row = q(container, 'arrange-row-sec-alto') as HTMLElement;
		expect((row.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe('');
		expect((q(container, 'arrange-count-sec-alto')?.textContent ?? '').trim()).toBe('(1)');
		expect(row.getAttribute('aria-label')).toBe('Alto (1)');
	});

	it('F1 (round 2) — a row READS "grip ✎ name (n)": the count follows the name, and the depth indent sits ahead of both', async () => {
		const container = await renderArrangeReady();

		const zone = dropZone(container, 'sec-alto');
		const order = [...zone.querySelectorAll('[data-testid]')]
			.map((el) => el.getAttribute('data-testid') ?? '')
			.filter((t) =>
				['arrange-row-sec-alto', 'arrange-rename-sec-alto', 'arrange-count-sec-alto'].includes(t)
			);
		expect(order).toEqual([
			'arrange-row-sec-alto',
			'arrange-rename-sec-alto',
			'arrange-count-sec-alto'
		]);
	});

	it('layout guard (happy-dom cannot measure width): the grip does not grow, the name carries no indent', async () => {
		const container = await renderArrangeReady();

		const row = q(container, 'arrange-row-sec-alto') as HTMLElement;
		expect(row.className).toContain('shrink-0');
		expect(row.className.split(/\s+/)).not.toContain('grow');
		const nested = q(container, 'arrange-rename-sec-alto') as HTMLElement;
		expect(nested.className).not.toMatch(/\bpl-\d/);
	});

	it("the activator's ACCESSIBLE NAME is the action verb then the name — it does not stutter", async () => {
		const container = await renderArrangeReady();

		const btn = q(container, 'arrange-rename-sec-alto') as HTMLElement;
		const action = (btn.querySelector('.sr-only')?.textContent ?? '').replace(/\s+/g, ' ').trim();
		expect(action).toBe('roster_section_rename_action');
		expect(within(container).getByRole('button', { name: `${action} Alto` })).toBe(btn);
	});

	it('F3 — a NATIVE drop released over the rename activator still reorders: the drop target spans the whole visual row', async () => {
		const container = await renderArrangeReady();
		const dataTransfer = makeDataTransfer();

		await fireEvent.dragStart(q(container, 'arrange-row-sec-bass') as HTMLElement, {
			dataTransfer
		});
		const overActivator = q(container, 'arrange-rename-sec-alto') as HTMLElement;
		await fireEvent.dragOver(overActivator, { dataTransfer });
		await waitFor(() => {
			expect(q(container, 'section-drop-indicator')).not.toBeNull();
		});
		await fireEvent.drop(overActivator, { dataTransfer });

		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderMock).toHaveBeenCalledWith(expect.objectContaining({ db: 'sampledb' }), [
			'sec-sop',
			'sec-bass',
			'sec-alto'
		]);
		expect(renameMock).not.toHaveBeenCalled();
	});

	it('F3 — the TOUCH hit-test resolves a finger over the rename activator to that row, so the drop is not lost mid-gesture', async () => {
		const container = await renderArrangeReady();
		const TOUCH = { pointerType: 'touch', pointerId: 1, isPrimary: true } as const;

		const spy = vi
			.spyOn(document, 'elementFromPoint')
			.mockImplementation((_x: number, y: number) =>
				y === 10
					? container.querySelector('[data-testid="arrange-grip-sec-bass"]')
					: container.querySelector('[data-testid="arrange-rename-sec-alto"]')
			);
		try {
			const grip = q(container, 'arrange-grip-sec-bass') as HTMLElement;
			await fireEvent.pointerDown(grip, { ...TOUCH, clientX: 10, clientY: 10 });
			await waitFor(() => {
				expect(q(container, 'arrange-row-sec-bass')?.getAttribute('data-grabbed')).toBe('true');
			});

			await fireEvent.pointerMove(grip, { ...TOUCH, clientX: 10, clientY: 90 });
			await waitFor(() => {
				expect(q(container, 'section-drop-indicator')).not.toBeNull();
			});
			await fireEvent.pointerUp(grip, { ...TOUCH, clientX: 10, clientY: 90 });

			await waitFor(() => {
				expect(reorderMock).toHaveBeenCalledTimes(1);
			});
			expect(reorderMock).toHaveBeenCalledWith(expect.objectContaining({ db: 'sampledb' }), [
				'sec-sop',
				'sec-bass',
				'sec-alto'
			]);
			expect(renameMock).not.toHaveBeenCalled();
		} finally {
			spy.mockRestore();
		}
	});
});

describe('#205 review F2 (round 3) — the grip is legible, the focus ring is row-sized', () => {
	it('layout guard (happy-dom cannot measure ring extent): the focus ring encloses the whole row', async () => {
		const container = await renderArrangeReady();

		const zone = dropZone(container, 'sec-alto');
		const zoneClasses = zone.className;

		expect(
			zoneClasses,
			'the wrapper must show a focus indicator when focus lands anywhere inside the row'
		).toContain('focus-within:ring-2');
		expect(zoneClasses).toMatch(/focus-within:ring-[a-z]/);

		const row = q(container, 'arrange-row-sec-alto') as HTMLElement;
		expect(
			row.className,
			'the grip-sized outline must give way to the row-sized ring'
		).toContain('focus:outline-none');
	});

	it('layout guard (happy-dom cannot measure size): the grip is 44px tall', async () => {
		const container = await renderArrangeReady();

		const grip = q(container, 'arrange-grip-sec-alto') as HTMLElement;
		expect(grip, 'the grip must render').not.toBeNull();

		expect(grip.className, 'the grip hit surface must span the row height').toContain('min-h-11');
	});

	it('the grip stays the touch pickup zone and the ONLY drag start — the decision that grip-only is intended', async () => {
		const container = await renderArrangeReady();

		const grip = q(container, 'arrange-grip-sec-alto') as HTMLElement;
		expect(grip.getAttribute('style')).toContain('touch-action: none');
		const row = q(container, 'arrange-row-sec-alto') as HTMLElement;
		expect(row.getAttribute('style')).toContain('touch-action: pan-y');

		expect(grip.textContent?.trim()).toBe('');
		expect(grip.getAttribute('aria-hidden')).toBe('true');
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
