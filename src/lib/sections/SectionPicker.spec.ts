// @vitest-environment happy-dom
//
// TS.2/#96 RED — SectionPicker.svelte, unit. The component is PRESENTATIONAL
// (no fetch, no cfg): the write dispatch + optimistic state live in the roster
// page's wiring (page.roster-picker.spec.ts), same split as the attendance
// panel. These specs pin the component's own contract:
//
//   props: { memberId, sections (tree from listSections), selectedIds
//            (current section ids, [] = unassigned), onpick(id | null) }
//
// Pinned testid contract (GREEN must implement):
//   section-picker-trigger-<memberId>   trigger button; aria-expanded; label =
//                                       current section names (', '-joined) or
//                                       m.roster_unassigned() when none
//   section-picker-menu-<memberId>      open menu (absent while closed)
//   section-picker-option-<sectionId>   one per section, flattened PRE-ORDER
//                                       over the tree; data-depth="<n>";
//                                       aria-pressed = currently assigned
//                                       (several may be pressed — multi-section)
//   section-picker-option-unassigned    LAST option; fires onpick(null)
//
// Toggle semantics: tapping ANY section option fires onpick(sectionId) — the
// CALLER maps it to assign (not in selectedIds) or unassign (already in). The
// menu closes after every pick (per-tap immediate write, no select-then-save).
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — any key resolves to itself; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

import SectionPicker from './SectionPicker.svelte';
import type { SectionNode } from './sectionData';

afterEach(() => {
	cleanup();
});

// Soprano (order 1) ▸ Soprano 1; Alto (order 2) — same shape as the TS.1 specs.
function fixtureTree(): SectionNode[] {
	const sop1: SectionNode = {
		id: 'sec-sop1',
		name: 'Soprano 1',
		displayOrder: 1,
		parentId: 'sec-sop',
		depth: 1,
		children: []
	};
	return [
		{ id: 'sec-sop', name: 'Soprano', displayOrder: 1, parentId: null, depth: 0, children: [sop1] },
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, depth: 0, children: [] }
	];
}

function renderPicker(selectedIds: string[], onpick = vi.fn()) {
	const { container } = render(SectionPicker, {
		props: { memberId: 'm-1', sections: fixtureTree(), selectedIds, onpick }
	});
	return { container, onpick };
}

function trigger(container: HTMLElement): HTMLElement {
	return container.querySelector('[data-testid="section-picker-trigger-m-1"]') as HTMLElement;
}

function menu(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[data-testid="section-picker-menu-m-1"]');
}

async function open(container: HTMLElement): Promise<void> {
	await fireEvent.click(trigger(container));
}

describe('SectionPicker — closed state and trigger label', () => {
	it('renders CLOSED by default: trigger present with aria-expanded="false", menu absent', () => {
		const { container } = renderPicker(['sec-sop']);
		const t = trigger(container);
		expect(t).not.toBeNull();
		expect(t.getAttribute('aria-expanded')).toBe('false');
		expect(menu(container)).toBeNull();
	});

	it("trigger label shows ALL current section names for a multi-section member (', '-joined)", () => {
		const { container } = renderPicker(['sec-sop', 'sec-alto']);
		const label = trigger(container).textContent ?? '';
		expect(label).toContain('Soprano');
		expect(label).toContain('Alto');
	});

	it('trigger label falls back to m.roster_unassigned() (the EXISTING TS.1 key — no new key) when selectedIds is empty', () => {
		const { container } = renderPicker([]);
		expect(trigger(container).textContent).toContain('roster_unassigned');
	});
});

describe('SectionPicker — open menu: hierarchical options, Unassigned last', () => {
	it('clicking the trigger opens the menu (aria-expanded="true") with one option per section in PRE-ORDER plus Unassigned LAST', async () => {
		const { container } = renderPicker(['sec-sop']);
		await open(container);

		expect(trigger(container).getAttribute('aria-expanded')).toBe('true');
		expect(menu(container)).not.toBeNull();
		const optionIds = [...container.querySelectorAll('[data-testid^="section-picker-option-"]')].map(
			(el) => el.getAttribute('data-testid')
		);
		expect(optionIds).toEqual([
			'section-picker-option-sec-sop',
			'section-picker-option-sec-sop1',
			'section-picker-option-sec-alto',
			'section-picker-option-unassigned'
		]);
	});

	it('sub-sections carry data-depth (0 / 1 / 0) — indentation is DATA the DOM exposes, and option labels show the section names', async () => {
		const { container } = renderPicker([]);
		await open(container);
		const opt = (id: string) =>
			container.querySelector(`[data-testid="section-picker-option-${id}"]`) as HTMLElement;
		expect(opt('sec-sop').getAttribute('data-depth')).toBe('0');
		expect(opt('sec-sop1').getAttribute('data-depth')).toBe('1');
		expect(opt('sec-alto').getAttribute('data-depth')).toBe('0');
		expect(opt('sec-sop').textContent).toContain('Soprano');
		expect(opt('sec-sop1').textContent).toContain('Soprano 1');
		expect(opt('sec-alto').textContent).toContain('Alto');
	});

	it('CURRENT sections are pre-selected — aria-pressed="true" on EVERY selected id (member may have several), "false" on the rest', async () => {
		const { container } = renderPicker(['sec-sop', 'sec-alto']);
		await open(container);
		const pressed = (id: string) =>
			container
				.querySelector(`[data-testid="section-picker-option-${id}"]`)
				?.getAttribute('aria-pressed');
		expect(pressed('sec-sop')).toBe('true');
		expect(pressed('sec-alto')).toBe('true');
		expect(pressed('sec-sop1')).toBe('false');
	});
});

describe('SectionPicker — onpick payloads and close-after-pick', () => {
	it('tapping an UNSELECTED section fires onpick(thatSectionId) once and closes the menu', async () => {
		const { container, onpick } = renderPicker(['sec-sop']);
		await open(container);
		await fireEvent.click(
			container.querySelector('[data-testid="section-picker-option-sec-alto"]') as HTMLElement
		);
		expect(onpick).toHaveBeenCalledTimes(1);
		expect(onpick).toHaveBeenCalledWith('sec-alto');
		expect(menu(container)).toBeNull();
		expect(trigger(container).getAttribute('aria-expanded')).toBe('false');
	});

	it('tapping an ALREADY-SELECTED section fires onpick(thatSectionId) too — toggle semantics; the caller maps it to unassign', async () => {
		const { container, onpick } = renderPicker(['sec-sop']);
		await open(container);
		await fireEvent.click(
			container.querySelector('[data-testid="section-picker-option-sec-sop"]') as HTMLElement
		);
		expect(onpick).toHaveBeenCalledTimes(1);
		expect(onpick).toHaveBeenCalledWith('sec-sop');
		expect(menu(container)).toBeNull();
	});

	it('tapping Unassigned fires onpick(null) and closes the menu', async () => {
		const { container, onpick } = renderPicker(['sec-sop', 'sec-alto']);
		await open(container);
		await fireEvent.click(
			container.querySelector('[data-testid="section-picker-option-unassigned"]') as HTMLElement
		);
		expect(onpick).toHaveBeenCalledTimes(1);
		expect(onpick).toHaveBeenCalledWith(null);
		expect(menu(container)).toBeNull();
	});
});

describe('SectionPicker — F2 code-review fix: non-destructive dismissal', () => {
	it('Escape closes the open menu WITHOUT firing onpick (every option is an immediate live write — there must be a way out that writes nothing)', async () => {
		const { container, onpick } = renderPicker(['sec-sop']);
		await open(container);
		expect(menu(container)).not.toBeNull();

		await fireEvent.keyDown(document.body, { key: 'Escape' });

		expect(menu(container)).toBeNull();
		expect(trigger(container).getAttribute('aria-expanded')).toBe('false');
		expect(onpick).not.toHaveBeenCalled();
	});

	it('a click OUTSIDE the picker closes the open menu without firing onpick', async () => {
		const { container, onpick } = renderPicker(['sec-sop']);
		await open(container);

		await fireEvent.click(document.body);

		expect(menu(container)).toBeNull();
		expect(onpick).not.toHaveBeenCalled();
	});

	it('a click INSIDE the menu that is not an option (the menu container itself) leaves it open', async () => {
		const { container, onpick } = renderPicker(['sec-sop']);
		await open(container);

		await fireEvent.click(menu(container) as HTMLElement);

		expect(menu(container)).not.toBeNull();
		expect(onpick).not.toHaveBeenCalled();
	});

	it('Escape while CLOSED is a no-op (handler is registered unconditionally; it must not do anything)', async () => {
		const { container, onpick } = renderPicker([]);
		await fireEvent.keyDown(document.body, { key: 'Escape' });
		expect(menu(container)).toBeNull();
		expect(trigger(container).getAttribute('aria-expanded')).toBe('false');
		expect(onpick).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis* — TS.2/#96 RED)
