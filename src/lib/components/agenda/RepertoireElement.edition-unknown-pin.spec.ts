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
		externalLinks: [],
		canBorrow: false,
		notes: '',
		...overrides
	};
}

/** Season editor on the repertoire surface, edition read TRUNCATED by default. */
function renderRow(
	r: WorkRow,
	opts: {
		options?: PickerOption[];
		resolved?: string[];
		manageRights?: 'editor' | 'not-editor';
		/** #331 — the MANAGE read's `truncated`, i.e. what an EDITOR's feed is
		 *  keyed on. Every #329 case here is a truncated read; the complete-read
		 *  suite at the bottom is the one that sets this false. */
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

// #331 (review finding 1) — the EDITOR under a COMPLETE read. This is the path
// the #329 suites above never touch (they all pin `pickableEditionsPartial:
// true`), and it is where item 4's relaxation was held out of the shared
// predicate: an editor's unknown state also removes the picker's '' (= unpin)
// entry, and under a complete read `unresolvedEditionWorkIds` issues no scoped
// read that could ever name the pin — the removal would be permanent, leaving
// her unable to clear a reference she cannot read. So her behaviour stays
// byte-identical to 25d72cd, as #331's own "Done when" requires, and the
// affordance question rides the split-out item 4 to a PO ruling.
describe('#331 — the EDITOR under a COMPLETE read keeps every affordance she had', () => {
	it('a pin nothing can name leaves the plain picker, with the unpin choice ENABLED', () => {
		const { container } = renderRow(row({ editionId: 'ed-9' }), {
			partial: false,
			options: [{ id: 'ed-1', label: '40-part original' }]
		});

		expect(container.querySelector('[data-testid="work-edition-unknown"]')).toBeNull();
		const select = picker(container)!;
		expect(select, 'work-edition-picker on the complete-read row').not.toBeNull();
		// The unpin entry is the point: it must not be the disabled unknown option.
		expect(optionShape(select)).toEqual([
			{ value: '', label: '[repertoire_pin_edition_label]', disabled: false },
			{ value: 'ed-1', label: '40-part original', disabled: false }
		]);
		// Still not displayed AS ed-1 — `pickerValue` keeps that honest on its own,
		// with no help from the unknown state.
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

// (*MVOX:Josquin* — #329 review)
// (*MVOX:Josquin* — #331 review, finding 1)
