// @vitest-environment happy-dom
//
// #205 RED — whole-field + tab activation on the arrange view's section RENAME.
//
// Standing UX rule 4 (Mihkel 2026-09-01) + the tab-to-activate addendum: the
// rename activator must cover the whole NAME area of the row, as a native,
// Tab-reachable <button> — not the ~12px SVG pencil sitting after the row.
//
// CHOSEN SHAPE (the season/admin whole-field pattern, adapted to a row that is
// ALSO a drag/reorder control):
//   • the section NAME moves INSIDE `arrange-rename-<id>` — the button wraps
//     pencil AND value, so tapping the name (the field area) opens the rename
//     editor. Same containment fact the admin reference and the season panel
//     pin: the value inside the button IS the whole-field activation.
//   • the reorder row (`arrange-row-<id>`) keeps the grip and the "(n)"
//     member-count roll-up and REMAINS the full reorder surface: draggable,
//     role="button", keyboard grab → arrows. Nothing nests inside anything
//     (the #155/S3 R2/F1 nested-interactive fix stays intact — the rename
//     button is still a SIBLING of the row, it just now owns the name).
//     page.roster-arrange-crud.spec.ts's "row textContent contains the name"
//     assertions are amended in this same commit — the name's home moved.
//   • the button keeps `roster_section_rename` ({name}) as its sr-only action
//     label — no new locale keys needed; the visible name inside the button
//     keeps the value exposed to AT alongside the action.
//   • rename semantics unchanged: input pre-filled, Enter saves via
//     renameSection, Escape cancels (pinned in page.roster-arrange-crud.spec.ts).
//
// Integration posture: real src/routes/roster/+page.svelte (the actual /roster
// route), arrange mode entered through the real view chips; only data seams
// mocked. Scaffolding inherited from page.roster-arrange-crud.spec.ts.
import { render, cleanup, fireEvent, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy(
		{},
		{
			get:
				(_target, key) =>
				(params?: Record<string, unknown>) =>
					params === undefined ? String(key) : `${String(key)} ${JSON.stringify(params)}`
		}
	)
}));

const {
	loadRosterMock,
	listSectionsMock,
	assignMock,
	unassignMock,
	createMock,
	reorderMock,
	deleteMock,
	reparentMock,
	renameMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	assignMock: vi.fn(),
	unassignMock: vi.fn(),
	createMock: vi.fn(),
	reorderMock: vi.fn(),
	deleteMock: vi.fn(),
	reparentMock: vi.fn(),
	renameMock: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
vi.mock('$lib/sections/sectionActions', () => ({
	assignMemberSection: assignMock,
	unassignMemberSection: unassignMock,
	createSection: createMock,
	reorderSections: reorderMock,
	deleteSection: deleteMock,
	reparentSection: reparentMock,
	renameSection: renameMock
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

// ── fixtures (same family as page.roster-arrange-crud.spec.ts) ─────────────────

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
	listSectionsMock.mockResolvedValue(fixtureTree());
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createMock.mockResolvedValue('sec-created');
	reorderMock.mockResolvedValue(undefined);
	deleteMock.mockResolvedValue(undefined);
	reparentMock.mockResolvedValue(undefined);
	renameMock.mockResolvedValue(undefined);
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
	renameMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

/** #205 review F3 — the arrange row's LAYOUT wrapper, which owns the DROP
 *  semantics (the rename activator is a sibling of `arrange-row-*`, so the row
 *  alone no longer spans what a user sees as "the row"). */
function dropZone(container: HTMLElement, id: string): HTMLElement {
	const el = container.querySelector<HTMLElement>(`[data-drop-row="${id}"]`);
	expect(el, `drop zone for ${id}`).not.toBeNull();
	return el as HTMLElement;
}

/** Minimal DataTransfer stand-in — happy-dom has no native one. */
function makeDataTransfer() {
	const data: Record<string, string> = {};
	return {
		setData: (k: string, v: string) => {
			data[k] = v;
		},
		getData: (k: string) => data[k] ?? '',
		effectAllowed: '',
		dropEffect: ''
	};
}

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

// ── whole-field rename activator ───────────────────────────────────────────────

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

		// The VALUE — the section name — lives inside the button. That is the
		// structural fact that turns "tap the pencil" into "tap the name".
		expect(
			btn.textContent,
			'the visible section name must live INSIDE the rename button'
		).toContain('Alto');

		// Touch target: 44px tall, and grown to cover the name area rather than
		// glyph-sized (the #165 F3 width-collapse trap, arrange-row flavour:
		// inside a flex row `w-full` OR `grow`/`flex-1` is the non-collapsed shape).
		const classes = Array.from(btn.classList);
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
		// Find the node actually showing the name and click THAT — pre-#205 the
		// name sat in the reorder row, where this click would GRAB the row
		// instead of opening the editor.
		const nameNode = Array.from(btn.querySelectorAll<HTMLElement>('*')).find((el) =>
			(el.textContent ?? '').includes('Alto')
		);
		expect(nameNode, 'no element inside the rename button shows the section name').toBeTruthy();
		await fireEvent.click(nameNode as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-alto')).not.toBeNull();
		});
		expect((q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement).value).toBe('Alto');
		// Opening the editor is not a structural write.
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
				expect.objectContaining({ db: 'polyphony' }),
				'sec-alto',
				'Alto Voices'
			);
		});
		await waitFor(() => {
			expect(q(container, 'arrange-rename-sec-alto')?.textContent).toContain('Alto Voices');
		});
	});

	// ── drag/reorder must SURVIVE the retrofit (the SPIKE's compatibility finding) ──

	it('the reorder row is still the drag surface: draggable, role=button, keyboard grab → ArrowDown reorders', async () => {
		const container = await renderArrangeReady();

		const row = q(container, 'arrange-row-sec-alto') as HTMLElement;
		expect(row).not.toBeNull();
		expect(row.getAttribute('role')).toBe('button');
		expect(row.getAttribute('draggable')).toBe('true');
		// The rename button is NOT inside the reorder row (nested-interactive
		// stays fixed) and the row is NOT inside the button (the row must keep
		// receiving its own clicks/drags).
		const renameBtn = q(container, 'arrange-rename-sec-alto') as HTMLElement;
		expect(row.contains(renameBtn)).toBe(false);
		expect(renameBtn.contains(row)).toBe(false);

		// Keyboard reorder path, end to end: grab, move down (provisional),
		// Enter drops and commits the write.
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
		expect(reorderMock).toHaveBeenCalledWith(expect.objectContaining({ db: 'polyphony' }), [
			'sec-sop',
			'sec-bass',
			'sec-alto'
		]);
		// The move never leaks into a rename.
		expect(renameMock).not.toHaveBeenCalled();
	});
});

// ── the name renders ONCE, and the drop target still spans the visual row ─────

describe('#205 review — /roster arrange: no duplicate name, no shrunken drop target', () => {
	it('the section name renders EXACTLY ONCE per row — the reorder row keeps the "(n)" roll-up and states the pair as its own label', async () => {
		const container = await renderArrangeReady();

		// F2 — the first GREEN left `{row.name} ({row.memberCount})` in the reorder
		// row while the new activator rendered a second copy beside it, so every
		// row visibly read "≡ Alto (1)  ✎ Alto".
		const visible = (dropZone(container, 'sec-alto').textContent ?? '')
			.replace(/\s+/g, ' ')
			.trim();
		expect(visible.match(/Alto/g)?.length ?? 0, `row reads "${visible}"`).toBe(1);

		const row = q(container, 'arrange-row-sec-alto') as HTMLElement;
		// F1 (round 2) — the "(n)" roll-up moved out of the row as well, to its own
		// span AFTER the activator, so the row renders no visible text at all.
		expect((row.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe('');
		expect((q(container, 'arrange-count-sec-alto')?.textContent ?? '').trim()).toBe('(1)');
		// The roll-up + name pair the #155/S2 F1 fix defends survives as the row's
		// accessible name; with nothing visible inside the row, WCAG 2.5.3 holds
		// vacuously.
		expect(row.getAttribute('aria-label')).toBe('Alto (1)');
	});

	it('F1 (round 2) — a row READS "grip ✎ name (n)": the count follows the name, and the depth indent sits ahead of both', async () => {
		const container = await renderArrangeReady();

		// The first fix left the count inside the reorder row while the name lived in
		// the activator BESIDE it, so every row reversed to "≡ (1) ✎ Alto" — and the
		// `grow` row next to a `flex-1` activator split the free width between them,
		// stranding the name near the middle of the column.
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

		// The row must not stretch: `grow` on it (basis auto) beside the activator's
		// `flex-1` (basis 0) is what pushed the name to mid-row.
		const row = q(container, 'arrange-row-sec-alto') as HTMLElement;
		expect(row.className).toContain('shrink-0');
		expect(row.className.split(/\s+/)).not.toContain('grow');
		// The depth indent stays on the row, i.e. AHEAD of the name — so a nested
		// row's name shifts by the full step, and the tree cue attaches to the name.
		const nested = q(container, 'arrange-rename-sec-alto') as HTMLElement;
		expect(nested.className).not.toMatch(/\bpl-\d/);
	});

	it("the activator's ACCESSIBLE NAME is the action verb then the name — it does not stutter", async () => {
		const container = await renderArrangeReady();

		const btn = q(container, 'arrange-rename-sec-alto') as HTMLElement;
		// F2 — a parameterised `roster_section_rename({ name })` sr-only label
		// beside the now-visible name computed to "Rename Alto Alto".
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
		// The right half of the Alto row IS the rename activator now. Bound on the
		// row alone, `ondragover`/`ondrop` never fired here and the drop was
		// silently discarded.
		const overActivator = q(container, 'arrange-rename-sec-alto') as HTMLElement;
		await fireEvent.dragOver(overActivator, { dataTransfer });
		await waitFor(() => {
			expect(dropZone(container, 'sec-alto').className).toContain('bg-ink-5');
		});
		await fireEvent.drop(overActivator, { dataTransfer });

		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderMock).toHaveBeenCalledWith(expect.objectContaining({ db: 'polyphony' }), [
			'sec-sop',
			'sec-bass',
			'sec-alto'
		]);
		expect(renameMock).not.toHaveBeenCalled();
	});

	it('F3 — the TOUCH hit-test resolves a finger over the rename activator to that row, so the drop is not lost mid-gesture', async () => {
		const container = await renderArrangeReady();
		const TOUCH = { pointerType: 'touch', pointerId: 1, isPrimary: true } as const;

		// happy-dom has no layout, so `elementFromPoint` is stubbed with an explicit
		// y → element map. y=90 lands on the rename ACTIVATOR — a SIBLING of
		// `arrange-row-*`, which `closest` could not resolve before the wrapper
		// grew its `data-drop-row` hook.
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
				expect(dropZone(container, 'sec-alto').className).toContain('bg-ink-5');
			});
			await fireEvent.pointerUp(grip, { ...TOUCH, clientX: 10, clientY: 90 });

			await waitFor(() => {
				expect(reorderMock).toHaveBeenCalledTimes(1);
			});
			expect(reorderMock).toHaveBeenCalledWith(expect.objectContaining({ db: 'polyphony' }), [
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

// ── F2 (round 3): focus, hold and drop must enclose the same rectangle ────────

// Round 2 moved the HOLD affordances (`outline-dashed`, `bg-indigo-soft`,
// `opacity-50`) and the DROP affordance (`bg-ink-5`) onto the wrapper, so both
// paint the full visual row. The two things left behind on `arrange-row-*` —
// which since #205 spans the ~16px grip alone — were the DRAG surface and, with
// it, the browser's focus outline. So a keyboard user tabbing to a row saw a
// ring around a bare grip glyph, then pressed Space and watched a dashed
// outline appear around something four times as wide. Focus and hold disagreed
// about what a row is.
//
// TEAM DECISION (recorded on #205): grip-only drag STAYS — it matches the touch
// pickup zone and keeps the drag gesture from competing with the rename
// activator's click. The fix is legibility, not reach: give the grip a visible
// hover/active affordance so the drag surface announces itself, and lift the
// focus indicator onto the same wrapper that already owns hold and drop.
describe('#205 review F2 (round 3) — the grip is legible, the focus ring is row-sized', () => {
	it('the wrapper paints the focus ring, so focus encloses the same rectangle as hold and drop', async () => {
		const container = await renderArrangeReady();

		const zone = dropZone(container, 'sec-alto');
		const zoneClasses = zone.className;

		// The wrapper already owns hold (`outline-dashed` when held) and drop
		// (`bg-ink-5`); focus joins them. A `ring-*` and not an `outline-*`
		// deliberately: the held state paints a DASHED outline on this same
		// element, and two outline-style utilities on one element fight.
		expect(
			zoneClasses,
			'the wrapper must show a focus indicator when focus lands anywhere inside the row'
		).toContain('focus-within:ring-2');
		expect(zoneClasses).toMatch(/focus-within:ring-[a-z]/);

		// ...and the row stops painting its own grip-sized one, or the two ring
		// the same focus at two different sizes.
		const row = q(container, 'arrange-row-sec-alto') as HTMLElement;
		expect(
			row.className,
			'the grip-sized outline must give way to the row-sized ring'
		).toContain('focus:outline-none');
	});

	it('the grip carries a visible hover/active affordance — the drag surface says where it is', async () => {
		const container = await renderArrangeReady();

		const grip = q(container, 'arrange-grip-sec-alto') as HTMLElement;
		expect(grip, 'the grip must render').not.toBeNull();

		const classes = grip.className;
		// Before this fix the grip was three static bars at `text-ink-2` with no
		// state at all: nothing told a pointer user that this 16px strip — and
		// only this strip — starts a drag.
		expect(classes, 'the grip must react to hover').toMatch(/hover:/);
		expect(classes, 'the grip must react to press').toMatch(/active:/);
		expect(classes, 'the grip must name itself as a drag surface').toContain('cursor-grab');

		// The hover surface spans the row's full height rather than the ~18px the
		// bars occupy, so the affordance and the drag zone are the same shape.
		expect(classes, 'the grip hit/hover surface must span the row height').toContain('min-h-11');
	});

	it('the grip stays the touch pickup zone and the ONLY drag start — the decision that grip-only is intended', async () => {
		const container = await renderArrangeReady();

		// touch-action: none stays ZONED to the grip (the #155/S2 F4 scroll fix):
		// widening the affordance must not widen the no-scroll region to the row.
		const grip = q(container, 'arrange-grip-sec-alto') as HTMLElement;
		expect(grip.getAttribute('style')).toContain('touch-action: none');
		const row = q(container, 'arrange-row-sec-alto') as HTMLElement;
		expect(row.getAttribute('style')).toContain('touch-action: pan-y');

		// The grip still carries no text of its own — the row's aria-label is what
		// names it, and a text node here would leak into textContent assertions.
		expect(grip.textContent?.trim()).toBe('');
		expect(grip.getAttribute('aria-hidden')).toBe('true');
	});
});

// (*MVOX:Tallis* — #205 RED; review-fix additions *MVOX:Josquin*)
