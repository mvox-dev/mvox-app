// @vitest-environment happy-dom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RepertoireElement from './RepertoireElement.svelte';
import type { PickerOption, WorkRow } from '$lib/repertoire/types';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get: (_target, key) => () => `[${String(key)}]`
	})
}));

afterEach(cleanup);

function row(overrides: Partial<WorkRow> = {}): WorkRow {
	return {
		id: 'ri-1',
		kind: 'repertoire',
		workId: 'work-1',
		editionId: '',
		workName: 'Old warhorse',
		composer: 'Anon.',
		status: 'active',
		editionName: '',
		ordinal: null,
		fileId: '',
		fileName: '',
		externalLinks: [],
		canBorrow: false,
		notes: '',
		...overrides
	};
}

function renderRow(
	r: WorkRow,
	opts: {
		options?: PickerOption[];
		resolved?: string[];
		manageRights?: 'editor' | 'not-editor';
		partial?: boolean;
		onpinedition?: (itemId: string, editionId: string) => void;
	} = {}
) {
	return render(RepertoireElement, {
		props: {
			rows: [r],
			expanded: true,
			manageRights: opts.manageRights ?? 'editor',
			context: 'repertoire',
			pickableEditionsPartial: opts.partial ?? true,
			editionOptionsByRowId: opts.options === undefined ? {} : { [r.id]: opts.options },
			editionsResolvedWorkIds: new Set(opts.resolved ?? []),
			onpinedition: opts.onpinedition,
			pendingKeys: new Set<string>()
		}
	});
}

function picker(container: HTMLElement): HTMLSelectElement | null {
	return container.querySelector('[data-testid="work-edition-picker"]');
}

function optionShape(select: HTMLSelectElement) {
	return Array.from(select.options).map((o) => ({
		value: o.value,
		label: o.textContent?.trim(),
		disabled: o.disabled
	}));
}

describe('#329 — unknown edition state, row that DOES hold a pin', () => {
	it('opens the picker and offers no way to erase the pin it cannot name', () => {
		const onpinedition = vi.fn();
		const { container } = renderRow(row({ editionId: 'ed-9' }), { onpinedition });

		expect(container.querySelector('[data-testid="work-edition-unknown"]')).not.toBeNull();
		const select = picker(container);
		expect(select, 'work-edition-picker on the unknown row').not.toBeNull();
		expect(select!.disabled).toBe(false);
		expect(optionShape(select!)).toEqual([
			{ value: '', label: '[repertoire_edition_unknown]', disabled: true }
		]);
		expect(onpinedition).not.toHaveBeenCalled();
	});

	it('never falls back to the known-absent wording — the pin is real, only unnameable', () => {
		const { container } = renderRow(row({ editionId: 'ed-9' }));

		expect(container.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(container.textContent).not.toContain('[repertoire_no_edition]');
		expect(container.textContent).toContain('[repertoire_edition_unknown]');
	});

	it('an unnameable pin alongside SOME matched options is still unknown, and never displays as one of them', () => {
		const { container } = renderRow(row({ editionId: 'ed-2' }), {
			options: [{ id: 'ed-1', label: '40-part original' }]
		});

		expect(container.querySelector('[data-testid="work-edition-unknown"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		const select = picker(container)!;
		expect(optionShape(select)).toEqual([
			{ value: '', label: '[repertoire_edition_unknown]', disabled: true },
			{ value: 'ed-1', label: '40-part original', disabled: false }
		]);
		expect(select.value).toBe('');
	});

	it('a non-editor reading the same row gets the unknown wording, not "no pinned edition"', () => {
		const { container } = renderRow(row({ editionId: 'ed-2' }), {
			manageRights: 'not-editor',
			options: [{ id: 'ed-1', label: '40-part original' }]
		});

		expect(container.querySelector('[data-testid="work-edition-unknown"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(picker(container)).toBeNull();
	});
});

describe('#329 — unknown edition state, row with NOTHING pinned', () => {
	it('keeps the picker open and enabled (the ruling: truncation must not gate it out)', () => {
		const { container } = renderRow(row({ editionId: '' }));

		expect(container.querySelector('[data-testid="work-edition-unknown"]')).not.toBeNull();
		const select = picker(container)!;
		expect(select).not.toBeNull();
		expect(select.tagName).toBe('SELECT');
		expect(select.disabled).toBe(false);
		expect(optionShape(select)).toEqual([
			{ value: '', label: '[repertoire_pin_edition_label]', disabled: false }
		]);
	});
});

describe('#329 review — once the scoped read lands, the row is a stated fact again', () => {
	it('a resolved work with no editions is a known ABSENCE, wording and all', () => {
		const { container } = renderRow(row({ editionId: '' }), { resolved: ['work-1'] });

		expect(container.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-no-edition"]')).not.toBeNull();
		expect(picker(container)).toBeNull();
	});

	it('a resolved work NAMES the pin the truncated read could not, in the picker', () => {
		const { container } = renderRow(row({ editionId: 'ed-9' }), {
			resolved: ['work-1'],
			options: [{ id: 'ed-9', label: 'Peters, 1904' }]
		});

		expect(container.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		const select = picker(container)!;
		expect(select.value).toBe('ed-9');
		expect(optionShape(select)).toEqual([
			{ value: '', label: '[repertoire_pin_edition_label]', disabled: false },
			{ value: 'ed-9', label: 'Peters, 1904', disabled: false }
		]);
	});

	it('a resolved work NAMES the pin for a non-editor too — plain text, no control', () => {
		const { container } = renderRow(row({ editionId: 'ed-9' }), {
			manageRights: 'not-editor',
			resolved: ['work-1'],
			options: [{ id: 'ed-9', label: 'Peters, 1904' }]
		});

		expect(container.querySelector('[data-testid="work-edition"]')!.textContent).toContain(
			'Peters, 1904'
		);
		expect(container.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-no-edition"]')).toBeNull();
	});
});

describe('#331 — the EDITOR under a COMPLETE read keeps every affordance she had', () => {
	it('a pin nothing can name leaves the plain picker, with the unpin choice ENABLED', () => {
		const { container } = renderRow(row({ editionId: 'ed-9' }), {
			partial: false,
			options: [{ id: 'ed-1', label: '40-part original' }]
		});

		expect(container.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		const select = picker(container)!;
		expect(select, 'work-edition-picker on the complete-read row').not.toBeNull();
		expect(optionShape(select)).toEqual([
			{ value: '', label: '[repertoire_pin_edition_label]', disabled: false },
			{ value: 'ed-1', label: '40-part original', disabled: false }
		]);
		expect(select.value).toBe('');
	});

	it('an unpin on that row actually reaches the handler', async () => {
		const onpinedition = vi.fn();
		const { container } = renderRow(row({ editionId: 'ed-9' }), {
			partial: false,
			options: [{ id: 'ed-1', label: '40-part original' }],
			onpinedition
		});

		await fireEvent.change(picker(container)!, { target: { value: '' } });
		expect(onpinedition).toHaveBeenCalledWith('ri-1', '');
	});

	it('nothing pinned under a complete read is a known absence — no picker, no unknown wording', () => {
		const { container } = renderRow(row({ editionId: '' }), { partial: false });

		expect(container.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-no-edition"]')).not.toBeNull();
		expect(picker(container)).toBeNull();
	});

	it('a READER on the same complete read still gets the unknown wording (item 4 is hers)', () => {
		const { container } = renderRow(row({ editionId: 'ed-9' }), {
			partial: false,
			manageRights: 'not-editor',
			options: [{ id: 'ed-1', label: '40-part original' }]
		});

		expect(container.querySelector('[data-testid="work-edition-unknown"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="work-no-edition"]')).toBeNull();
		expect(container.textContent).not.toContain('[repertoire_no_edition]');
		expect(picker(container)).toBeNull();
	});
});

describe('#342 — the reader wording splits: truncated names incompleteness, a dangling pin does not', () => {
	it('a TRUNCATED unknown keeps the incompleteness wording — the old key, not the new one', () => {
		const { container } = renderRow(row({ editionId: 'ed-9', truncated: true }), {
			manageRights: 'not-editor'
		});

		const unknown = container.querySelector('[data-testid="work-edition-unknown"]');
		expect(unknown, 'work-edition-unknown on the truncated reader row').not.toBeNull();
		expect(unknown!.textContent).toContain('[repertoire_edition_unknown]');
		expect(container.textContent).not.toContain('[repertoire_edition_unknown_pinned]');
		expect(container.textContent).not.toContain('[repertoire_no_edition]');
	});

	it('a DANGLING pin under a COMPLETE read gets the NEW wording — no incompleteness claim', () => {
		const { container } = renderRow(row({ editionId: 'ed-9', truncated: false }), {
			manageRights: 'not-editor'
		});

		const unknown = container.querySelector('[data-testid="work-edition-unknown"]');
		expect(unknown, 'work-edition-unknown on the dangling reader row').not.toBeNull();
		expect(unknown!.textContent).toContain('[repertoire_edition_unknown_pinned]');
		expect(container.textContent).not.toContain('[repertoire_edition_unknown]');
		expect(container.textContent).not.toContain('[repertoire_no_edition]');
		expect(picker(container)).toBeNull();
	});

	it('the dangling wording also serves a dangling pin alongside OTHER matched options', () => {
		const { container } = renderRow(row({ editionId: 'ed-2', truncated: false }), {
			manageRights: 'not-editor',
			options: [{ id: 'ed-1', label: '40-part original' }]
		});

		expect(
			container.querySelector('[data-testid="work-edition-unknown"]')!.textContent
		).toContain('[repertoire_edition_unknown_pinned]');
		expect(container.textContent).not.toContain('[repertoire_edition_unknown]');
	});
});

describe('#342 fence — the editor never sees the new wording', () => {
	it("the editor's truncated unknown row keeps the old key everywhere, picker option included", () => {
		const { container } = renderRow(row({ editionId: 'ed-9', truncated: true }));

		expect(
			container.querySelector('[data-testid="work-edition-unknown"]')!.textContent
		).toContain('[repertoire_edition_unknown]');
		expect(optionShape(picker(container)!)).toEqual([
			{ value: '', label: '[repertoire_edition_unknown]', disabled: true }
		]);
		expect(container.textContent).not.toContain('[repertoire_edition_unknown_pinned]');
	});

	it("the editor's complete-read row with an unnameable pin stays a plain picker — no unknown wording of either kind", () => {
		const { container } = renderRow(row({ editionId: 'ed-9', truncated: false }), {
			partial: false,
			options: [{ id: 'ed-1', label: '40-part original' }]
		});

		expect(container.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		expect(container.textContent).not.toContain('[repertoire_edition_unknown]');
		expect(container.textContent).not.toContain('[repertoire_edition_unknown_pinned]');
	});
});

// (*MVOX:Josquin* — #329, #331)
// (*MVOX:Tallis* — #342)
