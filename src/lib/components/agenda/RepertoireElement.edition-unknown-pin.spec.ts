// @vitest-environment happy-dom
//
// #329 (+ its review) — the UNKNOWN edition state, at the renderer's seam.
//
// `editionName` is a LABEL LOOKUP against the same truncated `listAllEditions`
// read that feeds `editionOptionsByRowId` (workRows.ts), so under truncation a
// row holding a REAL `editionId` can arrive with `editionName: ''` — and the
// work can be missing from the join entirely, or present with only SOME of its
// editions. None of those emptinesses is a fact, and the renderer says so:
//
//   • the unknown wording, never the known-absent wording;
//   • the picker is PRESENT either way — gating it out is itself the false
//     assertion the ruling is about (#329: "let it open and read that one work
//     there"), and the caller's scoped `listEditions(workId)` read is what
//     fills it;
//   • on a row whose pin we cannot name, the '' (= unpin) choice is replaced by
//     a DISABLED option that says unknown: the control opens and re-pins, but
//     nothing in it can erase a value we cannot show;
//   • once the caller's scoped read lands (`editionsResolvedWorkIds`), the row
//     is a stated fact again — a named pin, or a genuine known-absence.
import { render, cleanup } from '@testing-library/svelte';
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
		externalLinks: [],
		canBorrow: false,
		notes: '',
		...overrides
	};
}

/** Season editor on the repertoire surface, edition read TRUNCATED. */
function renderRow(
	r: WorkRow,
	opts: {
		options?: PickerOption[];
		resolved?: string[];
		manageRights?: 'editor' | 'not-editor';
		onpinedition?: (itemId: string, editionId: string) => void;
	} = {}
) {
	return render(RepertoireElement, {
		props: {
			rows: [r],
			expanded: true,
			manageRights: opts.manageRights ?? 'editor',
			context: 'repertoire',
			pickableEditionsPartial: true,
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
		// The leading option states the unknown and cannot be chosen — there is
		// no enabled '' (= unpin) entry anywhere in the list.
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
		// Review finding 3 — the work HAS a matched edition in the truncated read
		// (ed-1), but the row pins ed-2, which fell past the cap. Zero-match is not
		// the only unknown shape: an unresolvable PIN is one too.
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
		// NOT 'ed-2' (which matches nothing) — an unmatched value would render as
		// the first option, i.e. as a claim that ed-1 is what's pinned.
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
		// The ordinary placeholder, enabled: choosing it on a row with no pin is a
		// no-op, and the caller's scoped read is what puts real editions under it.
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
		// Nothing to pick from, exactly as under a complete collective-wide read.
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

// (*MVOX:Josquin* — #329 review)
