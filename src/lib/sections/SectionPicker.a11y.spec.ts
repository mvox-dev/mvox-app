// @vitest-environment happy-dom
//
// TS.3/#97 F5 code-review fixes — the inline new-section form's ACCESSIBILITY
// and KEYBOARD contract. Regression cover for three review findings:
//
//   1. the name <input> and the parent <select> had NO accessible name at all
//      (no <label>, no aria-label, no placeholder) — a screen reader announced
//      "edit text" / "combo box"; and the validation error had no live region,
//      so a rejected submit was silent;
//   2. Enter in the auto-focused name field did nothing (the form is a <div> of
//      buttons — no implicit submit), forcing a mouse trip to 'Create + assign';
//   3. the parent <select> rendered the tree flush-left, so a nested section
//      looked like a sibling of its own parent.
//
// The TS.3 contract itself (testids, oncreate payload, validation, close-after-
// action) stays pinned by SectionPicker.create.spec.ts — nothing here restates it.
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

// Soprano (order 1) ▸ Soprano 1; Alto (order 2) — same shape as the TS.2/TS.3 specs.
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

function renderPicker(oncreate = vi.fn()) {
	const { container } = render(SectionPicker, {
		props: {
			memberId: 'm-1',
			sections: fixtureTree(),
			selectedIds: [],
			onpick: vi.fn(),
			oncreate
		}
	});
	return { container, oncreate };
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function openForm(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'section-picker-trigger-m-1') as HTMLElement);
	await fireEvent.click(q(container, 'section-picker-new') as HTMLElement);
}

async function typeName(container: HTMLElement, value: string): Promise<void> {
	await fireEvent.input(q(container, 'section-create-name') as HTMLElement, {
		target: { value }
	});
}

describe('SectionPicker — the inline form’s controls carry accessible names', () => {
	it('the name input has an i18n aria-label (roster_section_name_label), not a bare "edit text"', async () => {
		const { container } = renderPicker();
		await openForm(container);

		const name = q(container, 'section-create-name') as HTMLInputElement;
		expect(name.getAttribute('aria-label')).toBe('roster_section_name_label');
	});

	it('the parent select has an i18n aria-label (roster_section_parent_label)', async () => {
		const { container } = renderPicker();
		await openForm(container);

		const select = q(container, 'section-create-parent') as HTMLSelectElement;
		expect(select.getAttribute('aria-label')).toBe('roster_section_parent_label');
	});
});

describe('SectionPicker — a validation failure is announced, not just painted', () => {
	it('the error region is role="alert", and the input points at it via aria-invalid + aria-describedby', async () => {
		const { container } = renderPicker();
		await openForm(container);
		await fireEvent.click(q(container, 'section-create-submit') as HTMLElement);

		const error = q(container, 'section-create-error') as HTMLElement;
		expect(error).not.toBeNull();
		expect(error.getAttribute('role')).toBe('alert');

		const name = q(container, 'section-create-name') as HTMLInputElement;
		expect(name.getAttribute('aria-invalid')).toBe('true');
		expect(name.getAttribute('aria-describedby')).toBe(error.id);
		expect(error.id).not.toBe('');
	});

	it('with no error showing the input is neither aria-invalid nor described-by anything', async () => {
		const { container } = renderPicker();
		await openForm(container);

		const name = q(container, 'section-create-name') as HTMLInputElement;
		expect(name.getAttribute('aria-invalid')).toBeNull();
		expect(name.getAttribute('aria-describedby')).toBeNull();
	});

	it('the error id is MEMBER-SCOPED, so two pickers on one roster never mint a duplicate DOM id', async () => {
		const { container } = render(SectionPicker, {
			props: {
				memberId: 'm-other',
				sections: fixtureTree(),
				selectedIds: [],
				onpick: vi.fn(),
				oncreate: vi.fn()
			}
		});
		await fireEvent.click(q(container, 'section-picker-trigger-m-other') as HTMLElement);
		await fireEvent.click(q(container, 'section-picker-new') as HTMLElement);
		await fireEvent.click(q(container, 'section-create-submit') as HTMLElement);

		expect((q(container, 'section-create-error') as HTMLElement).id).toContain('m-other');
	});
});

describe('SectionPicker — Enter submits the auto-focused name field', () => {
	it('typing a name and pressing Enter fires oncreate once, with the same payload the button would send', async () => {
		const { container, oncreate } = renderPicker();
		await openForm(container);
		await typeName(container, 'Tenor');
		await fireEvent.keyDown(q(container, 'section-create-name') as HTMLElement, { key: 'Enter' });

		expect(oncreate).toHaveBeenCalledTimes(1);
		expect(oncreate).toHaveBeenCalledWith({ name: 'Tenor', parentId: null });
		// Same close-after-action semantics as the button.
		await waitFor(() => {
			expect(q(container, 'section-picker-menu-m-1')).toBeNull();
		});
	});

	it('Enter runs the SAME validation — an empty name shows the required error and fires nothing', async () => {
		const { container, oncreate } = renderPicker();
		await openForm(container);
		await fireEvent.keyDown(q(container, 'section-create-name') as HTMLElement, { key: 'Enter' });

		expect(oncreate).not.toHaveBeenCalled();
		expect(q(container, 'section-create-error')?.textContent).toContain(
			'roster_section_name_required'
		);
		expect(q(container, 'section-create-form')).not.toBeNull();
	});

	it('an ordinary character keydown submits nothing', async () => {
		const { container, oncreate } = renderPicker();
		await openForm(container);
		await typeName(container, 'Tenor');
		await fireEvent.keyDown(q(container, 'section-create-name') as HTMLElement, { key: 'r' });

		expect(oncreate).not.toHaveBeenCalled();
		expect(q(container, 'section-create-form')).not.toBeNull();
	});
});

describe('SectionPicker — the parent select shows the tree shape', () => {
	it('each option label is indented by its depth (NBSP pair per level), so a child is not flush with its parent', async () => {
		const { container } = renderPicker();
		await openForm(container);

		const options = [
			...(q(container, 'section-create-parent') as HTMLSelectElement).querySelectorAll('option')
		];
		// '(top level)', Soprano (depth 0), Soprano 1 (depth 1), Alto (depth 0)
		expect(options.map((o) => o.textContent)).toEqual([
			'roster_new_section_top_level',
			'Soprano',
			'\u00a0\u00a0Soprano 1',
			'Alto'
		]);
	});
});

// (*MVOX:Palestrina* — TS.3/#97 F5 code-review fixes)
