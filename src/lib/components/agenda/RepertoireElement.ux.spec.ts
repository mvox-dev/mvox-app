// @vitest-environment happy-dom
//
// #111 TU.3 RED — Repertoire UX corrections from Mihkel's 2026-08-11 live gate
// walk (#108 findings 2–4):
//
//   Finding #2 — the expanded works view needs a visual separator between
//   work rows. Encoded as Tailwind's `divide-y` on the list element: happy-dom
//   applies no real CSS, so the class list IS the testable surface (same
//   convention as page.repertoire-a11y.spec.ts's display-utility guard), and
//   `divide-y`'s semantics are exactly the requirement — a border between
//   consecutive children, none above the first or below the last. The <li>s
//   themselves must stay border-free: a per-row `border-b` would draw a rule
//   under the LAST row too, and a `border-t` one above the first.
//
//   Finding #3 — status chip (ACTIVE) + status picker unified into ONE row as
//   the last element of the work panel, [Remove] on the same row. The picker
//   row (work-manage-row) already sits at the bottom with Remove in it; the
//   defect is the SEPARATE chip still rendered up in the header area next to
//   the composer. Contract: when the management row renders, the chip does
//   not — the picker (which displays the current status as its value) is the
//   single status surface. A plain member has no picker, so the chip stays
//   her only status display (guarded below).
//
//   Finding #4 — "Add to programme" breaks layout on mobile: the native
//   <select>'s intrinsic width follows its widest "Work — Edition" option and
//   overflows the agenda row on a phone. Contract: the control STAYS a native
//   <select> (the OS picker is the fix, not a custom listbox), stretched
//   `w-full` on mobile so it can never exceed its container, with `sm:w-auto`
//   restoring the existing inline dropdown at the app's desktop breakpoint
//   (640px — NavShell's State C boundary).
//
//   Finding #4, second pass (#111 review) — the overflow is a property of ANY
//   native <select> whose widest option is a user-authored string, not of the
//   programme picker specifically. Two siblings render on the same phone
//   surface from the same kind of data — work-manage-add-work-select (work
//   names) and work-manage-pin-edition-select (the same "Work — Edition"
//   labels that motivated the fix) — and on the repertoire context, which is
//   what a season editor sees on every agenda row, "Add work" is the picker
//   actually on screen. All three therefore carry the same treatment.
//   work-manage-status-select deliberately does NOT: its options are the four
//   fixed STATUS_OPTIONS labels, which cannot outgrow the row, and stretching
//   it would push [Remove] off the shared actions row for no gain.
//
// GREEN note: removing the editor-surface chip will break existing chip
// assertions made under editor rights — page.repertoire-manage-wiring.spec.ts
// reads work-status-badge textContent in the optimistic-status specs (~lines
// 311/459/484). Those assertions migrate to `data-status` on the work row, NOT
// to the status <select>'s value: fireEvent.change sets a <select>'s value
// itself, which would make the optimistic assertions tautological (#111
// review). The
// member-surface chip specs in RepertoireElement.spec.ts render WITHOUT manage
// rights and must keep passing untouched.
//
// #125 GREEN note — work-manage-status-select and work-manage-pin-edition-select
// no longer exist (see RepertoireElement.status-edition.spec.ts): status is four
// inline buttons (work-status-learning|active|retired|dropped) and edition is
// ONE unified work-edition-picker select. The specs below assert on those
// surfaces; the mobile-width treatment moved with the pin-edition select onto
// work-edition-picker.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RepertoireElement from './RepertoireElement.svelte';
import type { WorkRow } from '$lib/repertoire/types';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get: (_target, key) => () => `[${String(key)}]`
	})
}));

afterEach(cleanup);

let rowSeq = 0;
function row(overrides: Partial<WorkRow> = {}): WorkRow {
	return {
		id: `ri-${++rowSeq}`,
		kind: 'repertoire',
		workId: 'work-1',
		editionId: 'ed-1',
		workName: 'Spem in alium',
		composer: 'Thomas Tallis',
		status: 'active',
		editionName: '40-part original',
		ordinal: null,
		fileId: '',
		externalLinks: [],
		canBorrow: false,
		notes: '',
		...overrides
	};
}

function threeRows(): WorkRow[] {
	return [
		row(),
		row({ workName: 'Mass in B minor', composer: 'J. S. Bach', status: 'learning' }),
		row({ workName: 'Nunc dimittis', composer: 'Arvo Pärt', status: 'active' })
	];
}

function threeProgrammeRows(): WorkRow[] {
	return threeRows().map((r, i) => ({ ...r, kind: 'program' as const, status: null, ordinal: i }));
}

/** Tailwind class-list matchers — the testable encoding of visual dividers
 *  under happy-dom (no real CSS is applied; see header). */
const DIVIDE_Y = /(^|\s)divide-y(-\d+)?(\s|$)/;
const OWN_ROW_BORDER = /(^|\s)(sm:|max-sm:)?border-[tby]\b/;

function listOf(container: HTMLElement): HTMLElement {
	const list = container.querySelector('[data-testid="works-expanded"] ol, [data-testid="works-expanded"] ul');
	expect(list).not.toBeNull();
	return list as HTMLElement;
}

// ── Finding #2 — work row separators ────────────────────────────────────────

describe('RepertoireElement — work row separators (#111 finding 2)', () => {
	it('separates consecutive work rows with a divider (divide-y on the season-repertoire ul)', () => {
		const { container } = render(RepertoireElement, { props: { rows: threeRows(), expanded: true } });
		const list = listOf(container);
		expect(list.tagName).toBe('UL'); // ordinal-free season repertoire → ul branch
		expect(list.className).toMatch(DIVIDE_Y);
	});

	it('separates programmed (ol) rows the same way', () => {
		const { container } = render(RepertoireElement, {
			props: { rows: threeProgrammeRows(), expanded: true }
		});
		const list = listOf(container);
		expect(list.tagName).toBe('OL'); // every row carries an ordinal → numbered branch
		expect(list.className).toMatch(DIVIDE_Y);
	});

	it('draws no divider above the first row or below the last (between-children only, no per-row borders)', () => {
		const { container } = render(RepertoireElement, { props: { rows: threeRows(), expanded: true } });
		// The divider mechanism must be the list's divide-y (between children
		// ONLY, by definition) …
		expect(listOf(container).className).toMatch(DIVIDE_Y);
		// … and never a border utility on the rows themselves, which would rule
		// above the first or below the last row.
		const workRows = container.querySelectorAll('[data-testid="work-row"]');
		expect(workRows.length).toBe(3);
		for (const li of workRows) {
			expect(li.className).not.toMatch(OWN_ROW_BORDER);
		}
	});
});

// ── Finding #3 — status + actions unified into one bottom row ──────────────

describe('RepertoireElement — unified status/actions row (#111 finding 3)', () => {
	function renderAsSeasonEditor(rows = threeRows()) {
		return render(RepertoireElement, {
			props: { rows, expanded: true, manageRights: 'editor', context: 'repertoire' }
		});
	}

	it('renders NO separate status chip in the panel header when the status buttons row is present', () => {
		const { container } = renderAsSeasonEditor();
		// The buttons row is on screen …
		expect(container.querySelector('[data-testid="work-status-active"]')).not.toBeNull();
		// … so the chip must NOT be: the buttons are the single status surface.
		expect(container.querySelector('[data-testid="work-status-badge"]')).toBeNull();
	});

	it('the status buttons live in a single row that is the LAST element of the work panel', () => {
		const { container } = renderAsSeasonEditor();
		const workRows = container.querySelectorAll('[data-testid="work-row"]');
		expect(workRows.length).toBe(3);
		for (const li of workRows) {
			const manageRow = li.querySelector('[data-testid="work-manage-row"]');
			expect(manageRow).not.toBeNull();
			// Last element of the panel: nothing renders below the actions row.
			expect(manageRow!.parentElement!.lastElementChild).toBe(manageRow);
			// All four statuses (learn / active / retire / drop) get a button.
			for (const status of ['learning', 'active', 'retired', 'dropped']) {
				expect(manageRow!.querySelector(`[data-testid="work-status-${status}"]`)).not.toBeNull();
			}
		}
	});

	it('Remove sits on the SAME row as the status buttons', () => {
		const { container } = renderAsSeasonEditor();
		for (const li of container.querySelectorAll('[data-testid="work-row"]')) {
			const statusButton = li.querySelector('[data-testid="work-status-active"]');
			const remove = li.querySelector('[data-testid="work-manage-remove"]');
			expect(statusButton).not.toBeNull();
			expect(remove).not.toBeNull();
			expect(remove!.closest('[data-testid="work-manage-row"]')).toBe(
				statusButton!.closest('[data-testid="work-manage-row"]')
			);
		}
	});

	// Guard — dropping the editor-surface chip leaves the <select> as the only
	// status display there, and a <select>'s value is NOT a testable surface:
	// fireEvent.change writes it itself, so an optimistic-update assertion made
	// on it passes even when nothing updated. The row therefore mirrors its
	// status onto `data-status`, which only the render can write. Keep this
	// attribute: page.repertoire-manage-wiring.spec.ts's two optimistic-status
	// regression guards (#91 review F5, the #15 clobber class) assert on it.
	it('every work row carries its status on a rendered attribute the tests can assert on', () => {
		const { container } = renderAsSeasonEditor();
		const statuses = [...container.querySelectorAll('[data-testid="work-row"]')].map((li) =>
			li.getAttribute('data-status')
		);
		// threeRows() → active / learning / active, in order.
		expect(statuses).toEqual(['active', 'learning', 'active']);
	});

	it('a row with no status at all carries no data-status (absent, not a fabricated "active")', () => {
		const { container } = render(RepertoireElement, {
			props: {
				rows: [row({ status: null })],
				expanded: true,
				manageRights: 'editor',
				context: 'repertoire'
			}
		});
		expect(container.querySelector('[data-testid="work-row"]')!.hasAttribute('data-status')).toBe(
			false
		);
	});

	// Guard — a plain member has NO picker row, so the chip stays her only
	// status display. Finding 3 unifies chip+picker where both exist; it must
	// not strip status information from the read-only surface.
	it('a plain member (no manage rights) still sees the status chip', () => {
		const { container } = render(RepertoireElement, { props: { rows: [row()], expanded: true } });
		expect(container.querySelector('[data-testid="work-manage-row"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-status-badge"]')).not.toBeNull();
	});
});

// ── Finding #4 — native mobile picker for "Add to programme" ────────────────

describe('RepertoireElement — native mobile programme picker (#111 finding 4)', () => {
	const pickableEditions = [
		{ id: 'ed-1', label: 'Spem in alium — 40-part original (Tallis Scholars edition)' },
		{ id: 'ed-2', label: 'Mass in B minor — Bärenreiter BA 5103 urtext full score' }
	];

	function renderAsEventEditor() {
		return render(RepertoireElement, {
			props: {
				rows: threeRows(),
				expanded: true,
				context: 'programme',
				eventRights: 'editor',
				pickableEditions
			}
		});
	}

	function addProgrammeSelect(container: HTMLElement): HTMLSelectElement {
		const select = container.querySelector('[data-testid="work-manage-add-programme-select"]');
		expect(select).not.toBeNull();
		return select as HTMLSelectElement;
	}

	it('below the responsive breakpoint the picker is a native <select> stretched to container width', () => {
		const { container } = renderAsEventEditor();
		const select = addProgrammeSelect(container);
		// Native OS picker — a real <select>, not a custom listbox.
		expect(select.tagName).toBe('SELECT');
		// Mobile-first full width: intrinsic option width can never overflow the
		// row on a phone. (Class-list encoding — see header.)
		expect(select.className).toMatch(/(^|\s)w-full(\s|$)/);
	});

	it('at desktop width the existing inline dropdown is preserved (sm:w-auto, same native select, options intact)', () => {
		const { container } = renderAsEventEditor();
		const select = addProgrammeSelect(container);
		// The sm: override restores today's auto-width inline control at ≥640px.
		expect(select.className).toMatch(/(^|\s)sm:w-auto(\s|$)/);
		// Same control on both viewports: still the native select with the
		// placeholder + one option per pickable edition.
		expect(select.tagName).toBe('SELECT');
		const labels = [...select.querySelectorAll('option')].map((o) => o.textContent?.trim());
		expect(labels).toEqual([
			'[repertoire_add_programme_label]',
			pickableEditions[0].label,
			pickableEditions[1].label
		]);
	});
});

// ── Finding #4, second pass — the sibling repertoire pickers ────────────────
//
// Same root cause, same treatment (see header). No happy-dom test can confirm
// the VISUAL fix — no CSS is applied here, so the class list is the only
// testable surface and a phone-width live walk remains the real gate for all
// three selects. What these guards buy is that the treatment cannot silently
// come off one picker while staying on the others.

describe('RepertoireElement — native mobile pickers, repertoire surface (#111 finding 4)', () => {
	const pickableWorksList = [
		{ id: 'work-9', name: 'Litany to the Holy Spirit (SATB divisi, a cappella)', composer: 'Hurford' },
		{ id: 'work-10', name: 'Bogoroditse Devo from the All-Night Vigil op. 37', composer: 'Rachmaninoff' }
	];
	const editionOptions = [
		{ id: 'ed-7', label: 'Spem in alium — 40-part original (Tallis Scholars edition)' },
		{ id: 'ed-8', label: 'Spem in alium — Bärenreiter BA 5103 urtext full score' }
	];

	function renderAsSeasonEditor() {
		const rows = threeRows();
		const { container } = render(RepertoireElement, {
			props: {
				rows,
				expanded: true,
				manageRights: 'editor',
				context: 'repertoire',
				pickableWorksList,
				editionOptionsByRowId: Object.fromEntries(rows.map((r) => [r.id, editionOptions]))
			}
		});
		return container;
	}

	function select(container: HTMLElement, testid: string): HTMLSelectElement {
		const el = container.querySelector(`[data-testid="${testid}"]`);
		expect(el).not.toBeNull();
		return el as HTMLSelectElement;
	}

	it('"Add work" is a native <select>, full width on mobile, inline at ≥640px, options intact', () => {
		const el = select(renderAsSeasonEditor(), 'work-manage-add-work-select');
		expect(el.tagName).toBe('SELECT');
		expect(el.className).toMatch(/(^|\s)w-full(\s|$)/);
		expect(el.className).toMatch(/(^|\s)sm:w-auto(\s|$)/);
		const labels = [...el.querySelectorAll('option')].map((o) => o.textContent?.trim());
		expect(labels).toEqual([
			'[repertoire_add_work_label]',
			pickableWorksList[0].name,
			pickableWorksList[1].name
		]);
	});

	it('the unified edition picker is a native <select>, full width on mobile, inline at ≥640px, options intact', () => {
		const el = select(renderAsSeasonEditor(), 'work-edition-picker');
		expect(el.tagName).toBe('SELECT');
		expect(el.className).toMatch(/(^|\s)w-full(\s|$)/);
		expect(el.className).toMatch(/(^|\s)sm:w-auto(\s|$)/);
		const labels = [...el.querySelectorAll('option')].map((o) => o.textContent?.trim());
		expect(labels).toEqual([
			'[repertoire_pin_edition_label]',
			editionOptions[0].label,
			editionOptions[1].label
		]);
	});

	it('every edition picker on the surface carries the treatment, not just the first row', () => {
		const container = renderAsSeasonEditor();
		const pickers = [...container.querySelectorAll('[data-testid="work-edition-picker"]')];
		expect(pickers.length).toBe(3); // one per work row
		for (const el of pickers) {
			expect(el.className).toMatch(/(^|\s)w-full(\s|$)/);
			expect(el.className).toMatch(/(^|\s)sm:w-auto(\s|$)/);
		}
	});
});
