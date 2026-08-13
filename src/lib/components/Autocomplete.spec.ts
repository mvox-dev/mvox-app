// @vitest-environment happy-dom
//
// #132/T2 RED — the reusable Autocomplete (combobox) component: the app's FIRST
// input-anchored autocomplete. First consumer is the season-creation form's
// conductor field (page.season-create.spec.ts); T4 (event creation) and T3
// (season management) reuse it unchanged, so NOTHING season-specific may leak in.
//
// CONTRACT (GREEN must implement — SectionPicker.svelte is the a11y pattern
// source, ADAPTED to an input-anchored combobox, not copied):
//
//   PROPS ($props(), Svelte 5 runes only)
//     items         Array<{ id: string; label: string }> — the searchable list
//     onSelect      (selection: { id: string | null; label: string }) => void —
//                   ONE call per commit; a list pick carries the item's id+label,
//                   a free-text commit carries id: null + the typed text
//     placeholder   visible input hint
//     label         accessible name for the input AND the listbox (i18n string —
//                   the CALLER localizes; this component renders no copy of its own)
//     allowFreeText optional, default false
//
//   TESTIDS (static — the form under T2 holds exactly one instance)
//     autocomplete-input          the text input. role="combobox",
//                                 aria-haspopup="listbox", aria-expanded,
//                                 aria-controls -> the OPEN listbox's id,
//                                 aria-label = `label`, placeholder = `placeholder`
//     autocomplete-listbox        the dropdown. role="listbox", aria-label =
//                                 `label`. NOT in the DOM while closed (same
//                                 render-nothing-when-closed shape as
//                                 SectionPicker's menu — fail-closed, no
//                                 display:none stowaway a test could false-pass on)
//     autocomplete-option-<id>    one per FILTERED item, role="option", DOM order
//                                 = `items` order, text = the item's label
//
//   BEHAVIOR
//     - closed until the user types; typing (input event) opens the dropdown and
//       filters `items` by case-insensitive SUBSTRING match on `label`,
//       client-side (the component never fetches — reusability checklist #11)
//     - focus STAYS in the input throughout (typing must keep working), so the
//       highlight moves via aria-activedescendant, never by moving DOM focus:
//       ArrowDown/ArrowUp set the highlighted option's own DOM id as the input's
//       `aria-activedescendant` and mark that option aria-selected="true";
//       exactly one option is ever highlighted; clamped at BOTH ends
//       (SectionPicker's clamp, not wrap-around)
//     - typing does NOT auto-highlight — before any ArrowDown there is NO
//       highlighted option and no aria-activedescendant (this is what makes the
//       Enter rules below unambiguous)
//     - Enter WITH a highlighted option → onSelect({ id, label }) once, dropdown
//       closes, input CLEARS (the first consumer is a MULTI-ADD conductors field:
//       the caller renders what was picked, the input readies for the next entry)
//     - Enter with NO highlight: allowFreeText=true and non-blank text →
//       onSelect({ id: null, label: <typed text> }) + close + clear;
//       allowFreeText=false (or absent — the default) → NOTHING: no onSelect,
//       and blank/whitespace-only text is never committed even with
//       allowFreeText=true
//     - Escape closes the dropdown, no onSelect, input keeps its text and focus
//     - a click OUTSIDE the component closes the dropdown, no onSelect
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Autocomplete from './Autocomplete.svelte';

afterEach(() => {
	cleanup();
});

const ITEMS = [
	{ id: 'p-ada', label: 'Ada Lovelace' },
	{ id: 'p-alan', label: 'Alan Turing' },
	{ id: 'p-grace', label: 'Grace Hopper' }
];

function renderAutocomplete(overrides: Record<string, unknown> = {}) {
	const onSelect = vi.fn();
	const { container } = render(Autocomplete, {
		props: {
			items: ITEMS,
			onSelect,
			placeholder: 'Search people…',
			label: 'Conductors',
			...overrides
		}
	});
	return { container, onSelect };
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function input(container: HTMLElement): HTMLInputElement {
	return q(container, 'autocomplete-input') as HTMLInputElement;
}

async function type(container: HTMLElement, value: string): Promise<void> {
	await fireEvent.input(input(container), { target: { value } });
}

async function key(container: HTMLElement, keyName: string): Promise<void> {
	await fireEvent.keyDown(input(container), { key: keyName });
}

/** The currently highlighted option (aria-selected="true"), or null. */
function highlighted(container: HTMLElement): HTMLElement | null {
	return (
		q(container, 'autocomplete-listbox')?.querySelector<HTMLElement>('[aria-selected="true"]') ??
		null
	);
}

// ── rendering + closed-state a11y ───────────────────────────────────────────────

describe('Autocomplete — renders an input with the given placeholder (closed by default)', () => {
	it('autocomplete-input carries the placeholder, the label as its accessible name, and the combobox ARIA trio; the listbox is NOT in the DOM while closed', () => {
		const { container, onSelect } = renderAutocomplete();

		const inputEl = input(container);
		expect(inputEl).not.toBeNull();
		expect(inputEl.placeholder).toBe('Search people…');
		expect(inputEl.getAttribute('aria-label')).toBe('Conductors');
		expect(inputEl.getAttribute('role')).toBe('combobox');
		expect(inputEl.getAttribute('aria-haspopup')).toBe('listbox');
		expect(inputEl.getAttribute('aria-expanded')).toBe('false');

		// Fail-closed: no dropdown node at all while closed — a hidden-but-present
		// listbox is exactly the stowaway a display:none check would false-pass on.
		expect(q(container, 'autocomplete-listbox')).toBeNull();
		expect(onSelect).not.toHaveBeenCalled();
	});
});

// ── typing filters ──────────────────────────────────────────────────────────────

describe('Autocomplete — typing opens the dropdown and filters the items', () => {
	it("typing 'turing' shows ONLY Alan Turing (case-insensitive substring on label), as role=option entries inside the listbox", async () => {
		const { container } = renderAutocomplete();

		await type(container, 'turing');

		await waitFor(() => {
			expect(q(container, 'autocomplete-listbox')).not.toBeNull();
		});
		const listbox = q(container, 'autocomplete-listbox') as HTMLElement;
		const options = Array.from(listbox.querySelectorAll('[role="option"]'));
		expect(options).toHaveLength(1);
		expect(q(container, 'autocomplete-option-p-alan')?.textContent).toContain('Alan Turing');
		expect(q(container, 'autocomplete-option-p-ada')).toBeNull();
		expect(q(container, 'autocomplete-option-p-grace')).toBeNull();
		expect(input(container).getAttribute('aria-expanded')).toBe('true');
	});

	it("typing 'a' matches all three (substring, not prefix), in items order", async () => {
		const { container } = renderAutocomplete();

		await type(container, 'a');

		await waitFor(() => {
			expect(q(container, 'autocomplete-listbox')).not.toBeNull();
		});
		const listbox = q(container, 'autocomplete-listbox') as HTMLElement;
		const labels = Array.from(listbox.querySelectorAll('[role="option"]')).map((o) =>
			o.textContent?.trim()
		);
		expect(labels).toEqual(['Ada Lovelace', 'Alan Turing', 'Grace Hopper']);
	});

	it('typing does NOT auto-highlight: no aria-selected option, no aria-activedescendant, until an ArrowDown', async () => {
		const { container } = renderAutocomplete();

		await type(container, 'a');
		await waitFor(() => {
			expect(q(container, 'autocomplete-listbox')).not.toBeNull();
		});

		expect(highlighted(container)).toBeNull();
		expect(input(container).getAttribute('aria-activedescendant') ?? '').toBe('');
	});
});

// ── arrow-key navigation ────────────────────────────────────────────────────────

describe('Autocomplete — ArrowDown/ArrowUp move the highlight through the FILTERED list', () => {
	it('ArrowDown highlights the first option (aria-selected + aria-activedescendant pointing at its DOM id); a second ArrowDown moves to the second; ArrowUp moves back', async () => {
		const { container } = renderAutocomplete();

		await type(container, 'a'); // all three match
		await key(container, 'ArrowDown');

		await waitFor(() => {
			expect(highlighted(container)?.textContent).toContain('Ada Lovelace');
		});
		// Focus stayed in the input — activedescendant IS the highlight mechanism.
		const first = highlighted(container) as HTMLElement;
		expect(first.id).not.toBe('');
		expect(input(container).getAttribute('aria-activedescendant')).toBe(first.id);

		await key(container, 'ArrowDown');
		await waitFor(() => {
			expect(highlighted(container)?.textContent).toContain('Alan Turing');
		});
		expect(input(container).getAttribute('aria-activedescendant')).toBe(
			(highlighted(container) as HTMLElement).id
		);
		// Exactly ONE option highlighted at a time.
		expect(
			(q(container, 'autocomplete-listbox') as HTMLElement).querySelectorAll(
				'[aria-selected="true"]'
			)
		).toHaveLength(1);

		await key(container, 'ArrowUp');
		await waitFor(() => {
			expect(highlighted(container)?.textContent).toContain('Ada Lovelace');
		});
	});

	it('clamped at BOTH ends: ArrowUp on the first stays put, ArrowDown past the last stays on the last (no wrap-around)', async () => {
		const { container } = renderAutocomplete();

		await type(container, 'a');
		await key(container, 'ArrowDown'); // -> Ada (first)
		await key(container, 'ArrowUp'); // clamp at top
		await waitFor(() => {
			expect(highlighted(container)?.textContent).toContain('Ada Lovelace');
		});

		await key(container, 'ArrowDown');
		await key(container, 'ArrowDown');
		await key(container, 'ArrowDown'); // past the end
		await key(container, 'ArrowDown'); // still past the end
		await waitFor(() => {
			expect(highlighted(container)?.textContent).toContain('Grace Hopper');
		});
	});

	it('navigation walks the FILTERED list, not the full items array', async () => {
		const { container } = renderAutocomplete();

		await type(container, 'grace'); // only Grace matches
		await key(container, 'ArrowDown');

		await waitFor(() => {
			expect(highlighted(container)?.textContent).toContain('Grace Hopper');
		});
	});
});

// ── Enter commits ───────────────────────────────────────────────────────────────

describe('Autocomplete — Enter selects the highlighted item', () => {
	it('Enter on a highlighted option calls onSelect ONCE with { id, label }, closes the dropdown, and CLEARS the input (multi-add readiness)', async () => {
		const { container, onSelect } = renderAutocomplete();

		await type(container, 'a');
		await key(container, 'ArrowDown');
		await key(container, 'ArrowDown'); // -> Alan Turing
		await key(container, 'Enter');

		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(onSelect).toHaveBeenCalledWith({ id: 'p-alan', label: 'Alan Turing' });
		await waitFor(() => {
			expect(q(container, 'autocomplete-listbox')).toBeNull();
		});
		expect(input(container).getAttribute('aria-expanded')).toBe('false');
		expect(input(container).value).toBe('');
	});
});

// ── free-text commits ───────────────────────────────────────────────────────────

describe('Autocomplete — allowFreeText governs Enter on NON-matching text (no highlight)', () => {
	it('allowFreeText=true: Enter on text matching nothing calls onSelect ONCE with { id: null, label: <typed text> } and closes + clears', async () => {
		const { container, onSelect } = renderAutocomplete({ allowFreeText: true });

		await type(container, 'Arvo Pärt'); // matches no item
		await key(container, 'Enter');

		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(onSelect).toHaveBeenCalledWith({ id: null, label: 'Arvo Pärt' });
		await waitFor(() => {
			expect(q(container, 'autocomplete-listbox')).toBeNull();
		});
		expect(input(container).value).toBe('');
	});

	it('allowFreeText=true: a whitespace-only Enter commits NOTHING (blank free text is never a value)', async () => {
		const { container, onSelect } = renderAutocomplete({ allowFreeText: true });

		await type(container, '   ');
		await key(container, 'Enter');

		expect(onSelect).not.toHaveBeenCalled();
	});

	it('allowFreeText=false: Enter on non-matching text does NOTHING — no onSelect call', async () => {
		const { container, onSelect } = renderAutocomplete({ allowFreeText: false });

		await type(container, 'Arvo Pärt');
		await key(container, 'Enter');

		expect(onSelect).not.toHaveBeenCalled();
	});

	it('allowFreeText DEFAULTS to false: with the prop omitted, Enter on non-matching text commits nothing', async () => {
		const { container, onSelect } = renderAutocomplete(); // no allowFreeText

		await type(container, 'Arvo Pärt');
		await key(container, 'Enter');

		expect(onSelect).not.toHaveBeenCalled();
	});
});

// ── dismissal ───────────────────────────────────────────────────────────────────

describe('Autocomplete — Escape and outside click dismiss without committing', () => {
	it('Escape closes the dropdown, keeps the typed text AND focus in the input, and never calls onSelect', async () => {
		const { container, onSelect } = renderAutocomplete();

		input(container).focus();
		await type(container, 'ada');
		await waitFor(() => {
			expect(q(container, 'autocomplete-listbox')).not.toBeNull();
		});

		await key(container, 'Escape');

		await waitFor(() => {
			expect(q(container, 'autocomplete-listbox')).toBeNull();
		});
		expect(input(container).getAttribute('aria-expanded')).toBe('false');
		expect(input(container).value).toBe('ada');
		expect(document.activeElement).toBe(input(container));
		expect(onSelect).not.toHaveBeenCalled();
	});

	it('a click OUTSIDE the component closes the dropdown without committing', async () => {
		const { container, onSelect } = renderAutocomplete();

		await type(container, 'ada');
		await waitFor(() => {
			expect(q(container, 'autocomplete-listbox')).not.toBeNull();
		});

		await fireEvent.click(document.body);

		await waitFor(() => {
			expect(q(container, 'autocomplete-listbox')).toBeNull();
		});
		expect(onSelect).not.toHaveBeenCalled();
	});
});

// ── #132/T2 review F2 — Escape is LAYERED, not a single blunt dismissal ─────────

describe('Autocomplete — Escape belongs to the popup FIRST (WAI-APG layering)', () => {
	it('with the dropdown OPEN, Escape does not reach an enclosing surface: the event stops here', async () => {
		const onOuterEscape = vi.fn();
		document.addEventListener('keydown', onOuterEscape);
		try {
			const { container } = renderAutocomplete();

			await type(container, 'ada');
			await waitFor(() => {
				expect(q(container, 'autocomplete-listbox')).not.toBeNull();
			});

			await key(container, 'Escape');

			// The popup closed…
			await waitFor(() => {
				expect(q(container, 'autocomplete-listbox')).toBeNull();
			});
			// …and the form/dialog around it never saw the keystroke. Without this,
			// one Escape both closed the dropdown and discarded the whole form.
			expect(onOuterEscape).not.toHaveBeenCalled();
		} finally {
			document.removeEventListener('keydown', onOuterEscape);
		}
	});

	it('with the dropdown already CLOSED, Escape bubbles on so the enclosing surface can dismiss', async () => {
		const onOuterEscape = vi.fn();
		document.addEventListener('keydown', onOuterEscape);
		try {
			const { container } = renderAutocomplete();

			await type(container, 'ada');
			await key(container, 'Escape'); // consumed by the popup
			onOuterEscape.mockClear();

			await key(container, 'Escape'); // second one is not ours

			expect(onOuterEscape).toHaveBeenCalledTimes(1);
		} finally {
			document.removeEventListener('keydown', onOuterEscape);
		}
	});
});

// ── #132/T2 review F5 — keyboard-only reach: open + jump + empty status ─────────

describe('Autocomplete — the listbox is reachable from the keyboard alone', () => {
	it('ArrowDown on the focused-but-empty input OPENS the dropdown with the full list and NO highlight; the next ArrowDown starts walking it', async () => {
		const { container } = renderAutocomplete();

		await key(container, 'ArrowDown');

		await waitFor(() => {
			expect(q(container, 'autocomplete-listbox')).not.toBeNull();
		});
		const options = Array.from(
			(q(container, 'autocomplete-listbox') as HTMLElement).querySelectorAll('[role="option"]')
		);
		expect(options).toHaveLength(3);
		// Opening never auto-highlights (same contract as typing).
		expect(highlighted(container)).toBeNull();

		await key(container, 'ArrowDown');
		await waitFor(() => {
			expect(highlighted(container)?.textContent).toContain('Ada Lovelace');
		});
	});

	it('ArrowUp on a closed dropdown opens it too (same no-highlight open)', async () => {
		const { container } = renderAutocomplete();

		await key(container, 'ArrowUp');

		await waitFor(() => {
			expect(q(container, 'autocomplete-listbox')).not.toBeNull();
		});
		expect(highlighted(container)).toBeNull();
	});

	it('Home/End jump to the first/last option of the FILTERED list', async () => {
		const { container } = renderAutocomplete();

		await type(container, 'a'); // all three match
		await key(container, 'End');
		await waitFor(() => {
			expect(highlighted(container)?.textContent).toContain('Grace Hopper');
		});

		await key(container, 'Home');
		await waitFor(() => {
			expect(highlighted(container)?.textContent).toContain('Ada Lovelace');
		});
	});

	it('a filter matching NOTHING announces the caller’s emptyLabel as role="status" instead of an open-but-silent listbox', async () => {
		const { container } = renderAutocomplete({ emptyLabel: 'No matching people.' });

		await type(container, 'zzz');

		await waitFor(() => {
			expect(q(container, 'autocomplete-empty')).not.toBeNull();
		});
		const status = q(container, 'autocomplete-empty') as HTMLElement;
		expect(status.getAttribute('role')).toBe('status');
		expect(status.textContent).toContain('No matching people.');
		expect(
			(q(container, 'autocomplete-listbox') as HTMLElement).querySelectorAll('[role="option"]')
		).toHaveLength(0);
	});

	it('without an emptyLabel the component stays copy-free: no status line is invented', async () => {
		const { container } = renderAutocomplete();

		await type(container, 'zzz');

		await waitFor(() => {
			expect(q(container, 'autocomplete-listbox')).not.toBeNull();
		});
		expect(q(container, 'autocomplete-empty')).toBeNull();
	});

	// #132/T2 review F4 — two defects the "it exists with role=status" assertion
	// above could not see: the region lived INSIDE the listbox (a listbox may own
	// only option/group children — AT enumerating children by role skips anything
	// else), and it was created already-populated (a live region inserted with its
	// text in place is generally not announced; only later mutations are).
	it('the empty-state region is NOT a child of the listbox and is mounted (blank) from first render, so its text ARRIVES in an existing live region', async () => {
		const { container } = renderAutocomplete({ emptyLabel: 'No matching people.' });

		// Present before there is anything to say — the whole point.
		const status = q(container, 'autocomplete-empty') as HTMLElement;
		expect(status).not.toBeNull();
		expect(status.getAttribute('role')).toBe('status');
		expect(status.textContent?.trim()).toBe('');

		await type(container, 'zzz');

		await waitFor(() => {
			expect(q(container, 'autocomplete-empty')?.textContent).toContain('No matching people.');
		});
		// SAME element — the text changed inside a region that was already there.
		expect(q(container, 'autocomplete-empty')).toBe(status);
		const listbox = q(container, 'autocomplete-listbox') as HTMLElement;
		expect(listbox).not.toBeNull();
		expect(listbox.contains(status)).toBe(false);
		// The listbox owns options and nothing else.
		for (const child of Array.from(listbox.children)) {
			expect(child.getAttribute('role')).toBe('option');
		}
	});
});

// ── focus leaving the combobox ──────────────────────────────────────────────────

describe('Autocomplete — the popup does not outlive focus (review F3)', () => {
	it('focus moving to a control OUTSIDE the component closes the dropdown and drops aria-expanded to false', async () => {
		const { container } = renderAutocomplete();
		const outside = document.createElement('button');
		outside.setAttribute('data-testid', 'outside-control');
		document.body.appendChild(outside);

		await type(container, 'a');
		await waitFor(() => {
			expect(q(container, 'autocomplete-listbox')).not.toBeNull();
		});

		// Tab skips the tabindex="-1" options — the next stop is outside the widget.
		await fireEvent.focusOut(input(container), { relatedTarget: outside });

		await waitFor(() => {
			expect(q(container, 'autocomplete-listbox')).toBeNull();
		});
		expect(input(container).getAttribute('aria-expanded')).toBe('false');
		outside.remove();
	});

	it('focus leaving to nothing at all (relatedTarget null — e.g. a tap on the page background) also closes it', async () => {
		const { container } = renderAutocomplete();

		await type(container, 'a');
		await waitFor(() => {
			expect(q(container, 'autocomplete-listbox')).not.toBeNull();
		});

		await fireEvent.focusOut(input(container), { relatedTarget: null });

		await waitFor(() => {
			expect(q(container, 'autocomplete-listbox')).toBeNull();
		});
	});

	it('focus moving INSIDE the component (onto an option) keeps the dropdown open — the click that follows must still land', async () => {
		const { container, onSelect } = renderAutocomplete();

		await type(container, 'ada');
		await waitFor(() => {
			expect(q(container, 'autocomplete-option-p-ada')).not.toBeNull();
		});
		const option = q(container, 'autocomplete-option-p-ada') as HTMLElement;

		await fireEvent.focusOut(input(container), { relatedTarget: option });

		expect(q(container, 'autocomplete-listbox')).not.toBeNull();
		await fireEvent.click(option);
		expect(onSelect).toHaveBeenCalledWith({ id: 'p-ada', label: 'Ada Lovelace' });
	});
});

// ── open-state a11y wiring ──────────────────────────────────────────────────────

describe('Autocomplete — ARIA combobox wiring while open', () => {
	it('open: input aria-expanded="true" with aria-controls resolving to the listbox; listbox role="listbox" named by the label prop; entries are role="option"', async () => {
		const { container } = renderAutocomplete();

		await type(container, 'a');
		await waitFor(() => {
			expect(q(container, 'autocomplete-listbox')).not.toBeNull();
		});

		const inputEl = input(container);
		const listbox = q(container, 'autocomplete-listbox') as HTMLElement;
		expect(inputEl.getAttribute('aria-expanded')).toBe('true');
		expect(listbox.getAttribute('role')).toBe('listbox');
		expect(listbox.getAttribute('aria-label')).toBe('Conductors');
		// aria-controls must point at the ACTUAL listbox element.
		expect(listbox.id).not.toBe('');
		expect(inputEl.getAttribute('aria-controls')).toBe(listbox.id);
		for (const option of Array.from(listbox.children)) {
			expect(option.getAttribute('role')).toBe('option');
		}
	});
});

// (*MVOX:Tallis* — #132/T2 RED: Autocomplete combobox contract)
