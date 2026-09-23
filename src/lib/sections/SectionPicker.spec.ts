// @vitest-environment happy-dom
//
// #470 RED — SectionPicker.svelte REWRITTEN contract: NATIVE single-choice
// pickers, one per membership, plus a [+]. The custom listbox popup (trigger /
// menu / role="option" / toggle-onpick) is RETIRED — this file supersedes the
// TS.2/#96 popup pins wholesale. The component stays PRESENTATIONAL (no fetch,
// no cfg): the write dispatch + optimistic state live in the roster page
// (page.roster-picker.spec.ts), same split as before.
//
// Props (the contract this file pins; the shape CHANGES this slice, hence the
// deliberate render-time cast below):
//
//   memberId      string
//   memberName    string — names every control ("whose sections?"); the CALLER
//                 picks which name is in scope (the roster page passes the
//                 PROFILE name — see page.roster-real-names.spec.ts)
//   sections      SectionNode[] — the tree from listSections
//   selectedIds   string[] — the member's CURRENT section entity ids, ALL of
//                 them; the set every option list subtracts
//   renderIds     string[] — which of `selectedIds` THIS instance draws a
//                 select for (the roster's grouped view passes one card's
//                 single membership; the flat list passes the whole set).
//                 Review round 3: separate from `selectedIds`, because a
//                 scoped exclusion set makes her other held section look free
//                 — see page.roster-picker.spec.ts's option-list suite. These
//                 unit cases are the UNSCOPED shape, so `renderIds` defaults
//                 to `selectedIds` in `renderPicker` below
//   busy          boolean — freeze: every select AND the [+] disabled, root
//                 aria-busy (Mihkel: "the controls get freezed while entu
//                 syncs"); nothing visual beyond the native disabled state
//   onassign(sectionId)        blank picker chose a section
//   onunassign(sectionId)      a held section's picker chose Määramata ('')
//   onmove(fromId, toId)       a held section's picker chose another section
//
// Pinned markup contract (GREEN must implement):
//   - root: flex column, aria-busy={busy}
//   - one native <select data-testid="section-picker-select-<memberId>-<sectionId>">
//     PER HELD SECTION, value = that section id; options = Määramata (value '',
//     m.roster_unassigned()) + that section + every section NOT held by this
//     member, labels depth-indented (NBSP — the parentOptionLabel shape)
//   - Mihkel 1a/1b/1c: no section → just the [+]; the [+] opens ONE blank
//     <select data-testid="section-picker-select-<memberId>-blank"> valued '',
//     options = Määramata + the sections she is NOT in (nothing to gain by
//     choosing one twice — Gama); choosing one fires onassign(id)
//   - the [+] `section-picker-add-<memberId>`: native <button type="button">,
//     aria-label m.roster_section_add_label({ name }), matching title, inline
//     aria-hidden SVG; HIDDEN while a blank picker is open (Mihkel's rule)
//   - one-way `value=` + explicit `onchange`, NOT bind:value (InviteSurface's
//     controlled-select house shape)
//   - every select carries a visually-hidden <label> naming the member (and
//     the section) — native controls with real labels, the standing rule
//   - NO listbox, NO popup, NO create form, NO oncreate prop: creation left
//     the assignment flow entirely (`roster-new-section` in arrange mode is
//     the only entry — #124/#155, untouched)
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'svelte';

// Param-echoing message mock — labels must carry the member's NAME, so the
// mock renders "<key> <json-params>"; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy(
		{},
		{
			get:
				(_target, key) =>
				(params?: Record<string, unknown>) =>
					params && Object.keys(params).length > 0
						? `${String(key)} ${JSON.stringify(params)}`
						: String(key)
		}
	)
}));

import SectionPicker from './SectionPicker.svelte';
import type { SectionNode } from './sectionData';

afterEach(() => {
	cleanup();
});

// Soprano (order 1) ▸ Soprano 1; Alto (order 2) — same tree as the TS.1 specs.
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

interface PickerProps {
	memberId: string;
	memberName: string;
	sections: SectionNode[];
	selectedIds: string[];
	renderIds: string[];
	busy: boolean;
	onassign: (sectionId: string) => void;
	onunassign: (sectionId: string) => void;
	onmove: (fromId: string, toId: string) => void;
}

// The Props interface changes shape THIS slice (selectedIds+onpick+oncreate →
// per-membership handlers + busy) — the cast keeps `pnpm check` honest about
// everything else while these specs stay RED against the old component.
function renderPicker(overrides: Partial<PickerProps> = {}) {
	const selectedIds = overrides.selectedIds ?? [];
	const props: PickerProps = {
		memberId: 'm-1',
		memberName: 'Ada Lovelace',
		sections: fixtureTree(),
		selectedIds,
		// unscoped by default: these cases are the flat-list shape, one card
		// carrying every membership. A case that wants the grouped view's
		// per-card scope passes `renderIds` explicitly.
		renderIds: selectedIds,
		busy: false,
		onassign: vi.fn(),
		onunassign: vi.fn(),
		onmove: vi.fn(),
		...overrides
	};
	const { container } = render(SectionPicker, {
		props: props as unknown as ComponentProps<typeof SectionPicker>
	});
	return { container, props };
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function selectFor(container: HTMLElement, sectionId: string): HTMLSelectElement | null {
	return q(container, `section-picker-select-m-1-${sectionId}`) as HTMLSelectElement | null;
}

function blankSelect(container: HTMLElement): HTMLSelectElement | null {
	return q(container, 'section-picker-select-m-1-blank') as HTMLSelectElement | null;
}

function addButton(container: HTMLElement): HTMLButtonElement | null {
	return q(container, 'section-picker-add-m-1') as HTMLButtonElement | null;
}

function allSelects(container: HTMLElement): HTMLSelectElement[] {
	return Array.from(
		container.querySelectorAll<HTMLSelectElement>('[data-testid^="section-picker-select-"]')
	);
}

function optionValues(select: HTMLSelectElement): string[] {
	return Array.from(select.querySelectorAll('option')).map((o) => o.value);
}

function optionLabels(select: HTMLSelectElement): string[] {
	return Array.from(select.querySelectorAll('option')).map((o) => o.textContent ?? '');
}

/** The select's accessible name, resolved the way AT would: aria-label,
 *  aria-labelledby, a `label[for]`, or a wrapping <label>. */
function accessibleName(el: HTMLElement): string {
	const aria = el.getAttribute('aria-label');
	if (aria) return aria;
	const labelledby = el.getAttribute('aria-labelledby');
	if (labelledby) {
		return labelledby
			.split(/\s+/)
			.map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
			.join(' ')
			.trim();
	}
	const id = el.getAttribute('id');
	// Faithful to how a browser resolves `label[for]`: the label attaches to the
	// FIRST element carrying that id, so an element whose id is a duplicate has no
	// label at all — the failure mode #470's per-membership rows exposed.
	if (id && el.ownerDocument.getElementById(id) === el) {
		const label = el.ownerDocument.querySelector(`label[for="${id}"]`);
		if (label) return (label.textContent ?? '').trim();
	}
	return (el.closest('label')?.textContent ?? '').trim();
}

// ── 1a: no section — a [+] alone, expanding to one blank picker ─────────────────

describe('SectionPicker #470 — 1a: a member in NO section shows only the [+]', () => {
	it('renders the [+] and NO select at all', () => {
		const { container } = renderPicker({ selectedIds: [] });
		expect(addButton(container), 'the [+] control').not.toBeNull();
		expect(allSelects(container)).toEqual([]);
	});

	it('the [+] click opens ONE blank select valued "" whose options are Määramata + ALL sections (depth-indented labels, pre-order) — and the [+] itself is gone while it is open', async () => {
		const { container } = renderPicker({ selectedIds: [] });
		await fireEvent.click(addButton(container) as HTMLElement);

		const blank = blankSelect(container);
		expect(blank, 'the blank picker').not.toBeNull();
		expect(blank!.value).toBe('');
		expect(optionValues(blank!)).toEqual(['', 'sec-sop', 'sec-sop1', 'sec-alto']);
		// Depth is carried in the option LABELS (NBSP-indent — <option> can't be
		// styled portably; the parentOptionLabel shape carries over).
		expect(optionLabels(blank!)).toEqual([
			'roster_unassigned',
			'Soprano',
			'  Soprano 1',
			'Alto'
		]);
		// Mihkel: "[+] control is hidden, if there is an unassigned picker".
		expect(addButton(container)).toBeNull();
	});

	it("choosing a section in the blank picker fires onassign(thatId) ONCE — no unassign, no move — and the blank picker closes (the [+] returns)", async () => {
		const { container, props } = renderPicker({ selectedIds: [] });
		await fireEvent.click(addButton(container) as HTMLElement);
		await fireEvent.change(blankSelect(container) as HTMLElement, {
			target: { value: 'sec-sop' }
		});

		expect(props.onassign).toHaveBeenCalledTimes(1);
		expect(props.onassign).toHaveBeenCalledWith('sec-sop');
		expect(props.onunassign).not.toHaveBeenCalled();
		expect(props.onmove).not.toHaveBeenCalled();
		expect(blankSelect(container), 'the blank picker closes once it chose').toBeNull();
		expect(addButton(container), 'the [+] returns').not.toBeNull();
	});
});

// ── 1b: one section — its picker (with unassign) + the [+] ──────────────────────

describe('SectionPicker #470 — 1b: a member in ONE section shows that picker + the [+]', () => {
	it('renders one select valued with the held section: options Määramata + the held section + the non-held sections; plus the [+]', () => {
		const { container } = renderPicker({ selectedIds: ['sec-sop'] });
		const held = selectFor(container, 'sec-sop');
		expect(held, 'the held membership select').not.toBeNull();
		expect(held!.value).toBe('sec-sop');
		expect(optionValues(held!)).toEqual(['', 'sec-sop', 'sec-sop1', 'sec-alto']);
		expect(allSelects(container)).toHaveLength(1);
		expect(addButton(container)).not.toBeNull();
	});

	it("changing the held select to '' (Määramata) fires onunassign(thatSectionId) once", async () => {
		const { container, props } = renderPicker({ selectedIds: ['sec-sop'] });
		await fireEvent.change(selectFor(container, 'sec-sop') as HTMLElement, {
			target: { value: '' }
		});

		expect(props.onunassign).toHaveBeenCalledTimes(1);
		expect(props.onunassign).toHaveBeenCalledWith('sec-sop');
		expect(props.onassign).not.toHaveBeenCalled();
		expect(props.onmove).not.toHaveBeenCalled();
	});

	it('changing the held select to ANOTHER section fires onmove(fromId, toId) once — never a bare assign or unassign', async () => {
		const { container, props } = renderPicker({ selectedIds: ['sec-sop'] });
		await fireEvent.change(selectFor(container, 'sec-sop') as HTMLElement, {
			target: { value: 'sec-alto' }
		});

		expect(props.onmove).toHaveBeenCalledTimes(1);
		expect(props.onmove).toHaveBeenCalledWith('sec-sop', 'sec-alto');
		expect(props.onassign).not.toHaveBeenCalled();
		expect(props.onunassign).not.toHaveBeenCalled();
	});
});

// ── the DOM value never outruns `selectedIds` ──────────────────────────────────

describe('SectionPicker #470 — a select shows the membership it REPRESENTS, never the choice the parent refused', () => {
	it('after a move choice the held select is back on its own section: `selectedIds` alone decides what is displayed (F1 review fix — the parent may legitimately not patch)', async () => {
		// The parent owns the optimistic state; when its write fails it patches
		// nothing and re-renders with the SAME selectedIds. `value={sectionId}` is
		// one-way and `sectionId` never changes, so without the component putting
		// the value back the user's own DOM change would stand forever — showing a
		// section she is not in, and (the value already being the target) blocking
		// the very retry the page's error banner invites.
		const { container, props } = renderPicker({ selectedIds: ['sec-sop'] });
		const held = selectFor(container, 'sec-sop') as HTMLSelectElement;

		await fireEvent.change(held, { target: { value: 'sec-alto' } });

		expect(props.onmove).toHaveBeenCalledWith('sec-sop', 'sec-alto');
		expect(held.value, 'the select re-asserts its own membership').toBe('sec-sop');
		expect(held.selectedOptions[0]?.textContent?.trim()).toBe('Soprano');
	});

	it("after an unassign choice the held select is back on its own section too (the parent removes it only once the DELETE lands)", async () => {
		const { container, props } = renderPicker({ selectedIds: ['sec-sop'] });
		const held = selectFor(container, 'sec-sop') as HTMLSelectElement;

		await fireEvent.change(held, { target: { value: '' } });

		expect(props.onunassign).toHaveBeenCalledWith('sec-sop');
		expect(held.value).toBe('sec-sop');
	});

	it('a blank picker left at Määramata stays at Määramata, and one that chose is gone — either way nothing lingers on a value the parent did not land', async () => {
		const { container, props } = renderPicker({ selectedIds: [] });
		await fireEvent.click(addButton(container) as HTMLElement);
		const blank = blankSelect(container) as HTMLSelectElement;

		await fireEvent.change(blank, { target: { value: '' } });
		expect(props.onassign).not.toHaveBeenCalled();
		expect(blank.value).toBe('');
		expect(blankSelect(container), 'it stays open — nothing was chosen').not.toBeNull();
	});
});

// ── 1c: several sections — one picker each + the [+] ────────────────────────────

describe('SectionPicker #470 — 1c: a member in SEVERAL sections shows one picker per membership + the [+]', () => {
	it('renders one select per held section, each valued with its own section, plus the [+]', () => {
		const { container } = renderPicker({ selectedIds: ['sec-sop', 'sec-alto'] });
		const sop = selectFor(container, 'sec-sop');
		const alto = selectFor(container, 'sec-alto');
		expect(sop).not.toBeNull();
		expect(alto).not.toBeNull();
		expect(sop!.value).toBe('sec-sop');
		expect(alto!.value).toBe('sec-alto');
		expect(allSelects(container)).toHaveLength(2);
		expect(addButton(container)).not.toBeNull();
	});

	it('the blank picker EXCLUDES the held sections — full option list: Määramata + only the sections she is not in', async () => {
		const { container } = renderPicker({ selectedIds: ['sec-sop', 'sec-alto'] });
		await fireEvent.click(addButton(container) as HTMLElement);
		const blank = blankSelect(container);
		expect(blank).not.toBeNull();
		// Gama: "a blank picker lists only sections she is not in".
		expect(optionValues(blank!)).toEqual(['', 'sec-sop1']);
		expect(optionLabels(blank!)).toEqual(['roster_unassigned', '  Soprano 1']);
	});
});

// ── busy: the per-member freeze ─────────────────────────────────────────────────

describe('SectionPicker #470 — busy=true freezes THIS member’s controls', () => {
	it('every select and the [+] carry disabled, and the root carries aria-busy="true"', () => {
		const { container } = renderPicker({ selectedIds: ['sec-sop', 'sec-alto'], busy: true });
		for (const select of allSelects(container)) {
			expect(select.disabled, select.getAttribute('data-testid') ?? '').toBe(true);
		}
		expect(allSelects(container)).toHaveLength(2);
		const add = addButton(container);
		expect(add).not.toBeNull();
		expect(add!.disabled).toBe(true);
		const busyRoot = container.querySelector('[aria-busy="true"]');
		expect(busyRoot, 'root aria-busy while syncing').not.toBeNull();
		expect(busyRoot!.contains(allSelects(container)[0])).toBe(true);
	});

	it('busy=false: nothing is disabled and no aria-busy="true" root exists', () => {
		const { container } = renderPicker({ selectedIds: ['sec-sop'], busy: false });
		expect((selectFor(container, 'sec-sop') as HTMLSelectElement).disabled).toBe(false);
		expect((addButton(container) as HTMLButtonElement).disabled).toBe(false);
		expect(container.querySelector('[aria-busy="true"]')).toBeNull();
	});
});

// ── the [+] itself, labels, and what must NOT exist ─────────────────────────────

describe('SectionPicker #470 — native controls with real labels; creation is GONE', () => {
	it('the [+] is a native <button type="button"> with an aria-label naming the member (m.roster_section_add_label({name})), a matching title, and an aria-hidden glyph', () => {
		const { container } = renderPicker({ selectedIds: [] });
		const add = addButton(container);
		expect(add).not.toBeNull();
		expect(add!.tagName).toBe('BUTTON');
		expect(add!.type).toBe('button');
		const label = add!.getAttribute('aria-label') ?? '';
		expect(label).toContain('roster_section_add_label');
		expect(label).toContain('Ada Lovelace');
		expect(add!.getAttribute('title')).toBe(label);
		const glyph = add!.querySelector('svg');
		expect(glyph, 'inline SVG plus glyph').not.toBeNull();
		expect(glyph!.getAttribute('aria-hidden')).toBe('true');
	});

	it('EVERY select (held ones and the blank one) has an accessible name that names the member — carried on the element itself (aria-label), NOT via an id the roster can render twice', async () => {
		const { container } = renderPicker({ selectedIds: ['sec-sop'] });
		await fireEvent.click(addButton(container) as HTMLElement);
		const selects = allSelects(container);
		expect(selects.length).toBe(2); // held + blank
		for (const select of selects) {
			const name = accessibleName(select);
			expect(name, `${select.getAttribute('data-testid')} must be named`).not.toBe('');
			expect(name, `${select.getAttribute('data-testid')} names the member`).toContain(
				'Ada Lovelace'
			);
			// F2 review fix: the grouped roster mounts this component once per
			// MEMBERSHIP, so a document-unique `id` + `<label for>` pair cannot name
			// the later copies (label[for] resolves to the first match). The name has
			// to live on the control.
			expect(
				select.getAttribute('aria-label'),
				`${select.getAttribute('data-testid')} names itself, not through an id`
			).not.toBeNull();
		}
		expect(container.querySelector('label'), 'no <label for> pairing left').toBeNull();
	});

	it('no element with testid section-picker-new or section-create-form renders in ANY state — creating a section is not this control’s business anymore', async () => {
		const { container } = renderPicker({ selectedIds: ['sec-sop'] });
		expect(q(container, 'section-picker-new')).toBeNull();
		expect(q(container, 'section-create-form')).toBeNull();
		await fireEvent.click(addButton(container) as HTMLElement);
		expect(q(container, 'section-picker-new')).toBeNull();
		expect(q(container, 'section-create-form')).toBeNull();
	});
});

// (*MVOX:Tallis* — #470 RED: native per-membership pickers + [+]; supersedes the
//  TS.2/#96 popup-listbox contract)
