// Event page edition-unknown fixtures: the reader-side setup its specs had word for word.
import { expect } from 'vitest';

// The viewer holds nothing here, so the editor-side pickers never load for them.
export function seasonEntity() {
	return {
		_id: 'season1',
		name: [{ string: '2026/27' }],
		start_date: [{ date: '2026-08-01' }],
		_editor: [{ reference: 'p-someone-else' }]
	};
}

// ed-9 is missing on purpose: the label lookup cannot name that edition.
export const EDITIONS = [
	{
		_id: 'ed-1',
		name: [{ string: 'Bärenreiter BA 5103' }],
		_parent: [{ reference: 'w-2', entity_type: 'work' }]
	}
];

export function workRowOf(container: HTMLElement, workName: string): HTMLElement {
	const li = Array.from(container.querySelectorAll('[data-testid="work-row"]')).find(
		(el) => el.querySelector('[data-testid="work-name"]')?.textContent?.trim() === workName
	);
	expect(li, `work-row for ${workName}`).not.toBeUndefined();
	return li as HTMLElement;
}

export function pickerOptions(row: HTMLElement) {
	const select = row.querySelector('[data-testid="work-edition-picker"]') as HTMLSelectElement;
	expect(select, 'work-edition-picker').not.toBeNull();
	return Array.from(select.options).map((o) => ({
		value: o.value,
		label: o.textContent?.trim(),
		disabled: o.disabled
	}));
}

// (*MVOX:Josquin*)
