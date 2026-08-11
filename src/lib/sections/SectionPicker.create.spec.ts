// @vitest-environment happy-dom
//
// TS.3/#97 RED — SectionPicker.svelte's INLINE NEW-SECTION FORM, unit. The
// component stays PRESENTATIONAL: a valid "Create + assign" submit fires
// `oncreate({ name, parentId })` ONCE — the two writes (createSection, then
// assignMemberSection with the returned id) are the PAGE's job
// (page.roster-create-section.spec.ts). These specs pin the component's own
// contract on top of the TS.2 picker contract (SectionPicker.spec.ts — all of
// which must KEEP passing).
//
// Pinned testid contract (GREEN must implement):
//   section-picker-new              '+ New section…' button, LAST in the menu
//                                   (after section-picker-option-unassigned);
//                                   label = m.roster_new_section()
//   section-create-form             the inline form; menu OPTIONS are gone
//                                   while it shows (the dropdown TRANSFORMS)
//   section-create-name             name text input; REQUIRED; AUTO-FOCUSED
//   section-create-parent           parent <select>: first option value ''
//                                   labeled m.roster_new_section_top_level()
//                                   ("(top level)" = child of org, the DEFAULT),
//                                   then one option per section, value = the
//                                   section id, PRE-ORDER over the tree
//   section-create-submit           'Create + assign' (m.roster_create_assign())
//   section-create-cancel           'Cancel' (m.roster_cancel()) → BACK to the
//                                   option list, nothing fired
//   section-create-error            inline error region; shows
//                                   m.roster_section_name_required() on an
//                                   empty/whitespace submit and
//                                   m.roster_section_duplicate() when the
//                                   trimmed name case-insensitively equals an
//                                   EXISTING section's name (anywhere in the
//                                   tree — the duplicate check is LOCAL, the
//                                   component already holds the whole tree)
//
// A VALID submit fires oncreate ONCE ({ name: trimmed, parentId: id | null })
// and closes the WHOLE picker (menu gone, aria-expanded=false) — same
// close-after-action semantics as onpick.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
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

// Soprano (order 1) ▸ Soprano 1; Alto (order 2) — same shape as the TS.2 specs.
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

function renderPicker(selectedIds: string[] = [], oncreate = vi.fn(), onpick = vi.fn()) {
	const { container } = render(SectionPicker, {
		props: { memberId: 'm-1', sections: fixtureTree(), selectedIds, onpick, oncreate }
	});
	return { container, oncreate, onpick };
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function openMenu(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'section-picker-trigger-m-1') as HTMLElement);
}

async function openForm(container: HTMLElement): Promise<void> {
	await openMenu(container);
	await fireEvent.click(q(container, 'section-picker-new') as HTMLElement);
}

async function typeName(container: HTMLElement, value: string): Promise<void> {
	await fireEvent.input(q(container, 'section-create-name') as HTMLElement, {
		target: { value }
	});
}

async function submit(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'section-create-submit') as HTMLElement);
}

describe("SectionPicker — '+ New section…' entry point", () => {
	it('the open menu carries section-picker-new LAST — after every section option AND after Unassigned — labeled with the roster_new_section key', async () => {
		const { container } = renderPicker(['sec-sop']);
		await openMenu(container);

		const menu = q(container, 'section-picker-menu-m-1') as HTMLElement;
		const buttons = [...menu.querySelectorAll('button')].map((el) =>
			el.getAttribute('data-testid')
		);
		expect(buttons).toEqual([
			'section-picker-option-sec-sop',
			'section-picker-option-sec-sop1',
			'section-picker-option-sec-alto',
			'section-picker-option-unassigned',
			'section-picker-new'
		]);
		expect(q(container, 'section-picker-new')?.textContent).toContain('roster_new_section');
		// The form is NOT rendered until the entry point is tapped.
		expect(q(container, 'section-create-form')).toBeNull();
	});

	it('tapping it TRANSFORMS the dropdown: section options and Unassigned are GONE, the inline form is present, and NOTHING was fired', async () => {
		const { container, oncreate, onpick } = renderPicker(['sec-sop']);
		await openForm(container);

		expect(q(container, 'section-create-form')).not.toBeNull();
		expect(container.querySelector('[data-testid^="section-picker-option-"]')).toBeNull();
		expect(oncreate).not.toHaveBeenCalled();
		expect(onpick).not.toHaveBeenCalled();
	});
});

describe('SectionPicker — form fields: auto-focused name + parent picker', () => {
	it('the name input renders empty and AUTO-FOCUSED (document.activeElement)', async () => {
		const { container } = renderPicker();
		await openForm(container);

		const name = q(container, 'section-create-name') as HTMLInputElement;
		expect(name).not.toBeNull();
		expect(name.value).toBe('');
		await waitFor(() => {
			expect(document.activeElement).toBe(name);
		});
	});

	it("the parent <select> lists '(top level)' FIRST (value '', the roster_new_section_top_level key, DEFAULT-selected) then every section PRE-ORDER by id, labeled by name", async () => {
		const { container } = renderPicker();
		await openForm(container);

		const select = q(container, 'section-create-parent') as HTMLSelectElement;
		expect(select).not.toBeNull();
		const options = [...select.querySelectorAll('option')];
		expect(options.map((o) => o.value)).toEqual(['', 'sec-sop', 'sec-sop1', 'sec-alto']);
		expect(options[0].textContent).toContain('roster_new_section_top_level');
		expect(options[1].textContent).toContain('Soprano');
		expect(options[2].textContent).toContain('Soprano 1');
		expect(options[3].textContent).toContain('Alto');
		// Default: top level.
		expect(select.value).toBe('');
	});

	it('submit and cancel buttons carry their message keys (roster_create_assign / roster_cancel)', async () => {
		const { container } = renderPicker();
		await openForm(container);
		expect(q(container, 'section-create-submit')?.textContent).toContain('roster_create_assign');
		expect(q(container, 'section-create-cancel')?.textContent).toContain('roster_cancel');
	});
});

describe('SectionPicker — valid submit fires oncreate once and closes the picker', () => {
	it("top-level: oncreate({ name: 'Tenor', parentId: null }) exactly once; whole picker closes (menu gone, aria-expanded=false); onpick untouched", async () => {
		const { container, oncreate, onpick } = renderPicker();
		await openForm(container);
		await typeName(container, 'Tenor');
		await submit(container);

		expect(oncreate).toHaveBeenCalledTimes(1);
		expect(oncreate).toHaveBeenCalledWith({ name: 'Tenor', parentId: null });
		expect(onpick).not.toHaveBeenCalled();
		expect(q(container, 'section-create-form')).toBeNull();
		expect(q(container, 'section-picker-menu-m-1')).toBeNull();
		expect(q(container, 'section-picker-trigger-m-1')?.getAttribute('aria-expanded')).toBe('false');
	});

	it('with a parent selected: parentId = that section id', async () => {
		const { container, oncreate } = renderPicker();
		await openForm(container);
		await typeName(container, 'Soprano 2');
		await fireEvent.change(q(container, 'section-create-parent') as HTMLElement, {
			target: { value: 'sec-sop' }
		});
		await submit(container);

		expect(oncreate).toHaveBeenCalledTimes(1);
		expect(oncreate).toHaveBeenCalledWith({ name: 'Soprano 2', parentId: 'sec-sop' });
	});

	it('the submitted name is TRIMMED', async () => {
		const { container, oncreate } = renderPicker();
		await openForm(container);
		await typeName(container, '  Tenor  ');
		await submit(container);
		expect(oncreate).toHaveBeenCalledWith({ name: 'Tenor', parentId: null });
	});
});

describe('SectionPicker — validation: name required, duplicate name', () => {
	it.each(['', '   '])(
		'submitting name %j shows the roster_section_name_required error inline; oncreate NOT fired; the form STAYS open',
		async (value) => {
			const { container, oncreate } = renderPicker();
			await openForm(container);
			if (value !== '') await typeName(container, value);
			await submit(container);

			const error = q(container, 'section-create-error');
			expect(error).not.toBeNull();
			expect(error?.textContent).toContain('roster_section_name_required');
			expect(oncreate).not.toHaveBeenCalled();
			expect(q(container, 'section-create-form')).not.toBeNull();
		}
	);

	it('a name equal to an EXISTING section (trimmed, case-insensitive — "  soprano 1 " vs "Soprano 1", a NESTED section) shows roster_section_duplicate; oncreate NOT fired; form stays', async () => {
		const { container, oncreate } = renderPicker();
		await openForm(container);
		await typeName(container, '  soprano 1 ');
		await submit(container);

		const error = q(container, 'section-create-error');
		expect(error).not.toBeNull();
		expect(error?.textContent).toContain('roster_section_duplicate');
		expect(oncreate).not.toHaveBeenCalled();
		expect(q(container, 'section-create-form')).not.toBeNull();
	});

	it('no error region is rendered before any invalid submit', async () => {
		const { container } = renderPicker();
		await openForm(container);
		expect(q(container, 'section-create-error')).toBeNull();
	});
});

describe('SectionPicker — Cancel returns to the picker', () => {
	it('Cancel: back to the OPTION LIST (menu still open, options + Unassigned + section-picker-new all present, form gone); nothing fired', async () => {
		const { container, oncreate, onpick } = renderPicker(['sec-sop']);
		await openForm(container);
		await fireEvent.click(q(container, 'section-create-cancel') as HTMLElement);

		expect(q(container, 'section-create-form')).toBeNull();
		expect(q(container, 'section-picker-menu-m-1')).not.toBeNull();
		expect(q(container, 'section-picker-option-sec-sop')).not.toBeNull();
		expect(q(container, 'section-picker-option-unassigned')).not.toBeNull();
		expect(q(container, 'section-picker-new')).not.toBeNull();
		expect(oncreate).not.toHaveBeenCalled();
		expect(onpick).not.toHaveBeenCalled();
	});

	it('reopening the form after Cancel starts CLEAN — the previously typed name is not retained', async () => {
		const { container } = renderPicker();
		await openForm(container);
		await typeName(container, 'Tenor');
		await fireEvent.click(q(container, 'section-create-cancel') as HTMLElement);
		await fireEvent.click(q(container, 'section-picker-new') as HTMLElement);

		expect((q(container, 'section-create-name') as HTMLInputElement).value).toBe('');
	});
});

// (*MVOX:Tallis* — TS.3/#97 RED)
