// @vitest-environment happy-dom
// #99 i18n + a11y cover for the sections surfaces: source scans for i18n hygiene, and DOM
// tests that always render the real /roster page, never a component alone.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bareTextNodes } from '$lib/testing/bareText';
import {
	everyPatternContains,
	isMessageEmpty,
	type MessageFile
} from '$lib/testing/messageFile.js';

// Paraglide mock: real English for the known keys; a Proxy fallback renders "<key> <params>",
// so a label naming the section holds for any key shape.
vi.mock('$lib/paraglide/messages.js', () => {
	const known: Record<string, (p?: Record<string, unknown>) => string> = {
		roster_title: () => 'Roster',
		roster_no_collective: () => 'Select a collective to view the roster.',
		roster_load_error: () => 'Something went wrong loading the roster.',
		roster_retry: () => 'Retry',
		roster_empty: () => 'No members to show yet.',
		roster_unassigned: () => 'Unassigned',
		roster_column_name: () => 'Name',
		roster_sort_alphabetical: () => 'Sort A–Z',
		roster_sort_grouped: () => 'Group by section',
		roster_sections_load_error: () =>
			"Section grouping couldn't be loaded — showing the flat list instead.",
		roster_new_section: () => '+ New section…',
		roster_new_section_top_level: () => '(top level)',
		roster_create_assign: () => 'Create + assign',
		roster_cancel: () => 'Cancel',
		roster_section_name_required: () => 'Section name is required.',
		roster_section_duplicate: () => 'A section with this name already exists.',
		roster_section_name_label: () => 'Section name',
		roster_section_parent_label: () => 'Parent section',
		roster_section_create_failed: () => "The section couldn't be created — nothing was saved.",
		roster_section_write_failed: () => "The section change couldn't be saved."
	};
	const m = new Proxy(known, {
		get(target, prop) {
			const key = String(prop);
			if (key in target) return target[key];
			return (params?: Record<string, unknown>) =>
				[key, ...(params ? Object.values(params).map(String) : [])].join(' ');
		}
	});
	return { m };
});

// Page seams: groupBySection runs real; only the fetch and write seams are mocked.
const { loadRosterMock, listSectionsMock, assignMock, unassignMock, createMock, reorderMock } =
	vi.hoisted(() => ({
		loadRosterMock: vi.fn(),
		listSectionsMock: vi.fn(),
		assignMock: vi.fn(),
		unassignMock: vi.fn(),
		createMock: vi.fn(),
		reorderMock: vi.fn()
	}));
// /roster reads the opt-in real-names producer; `loadRoster` stays profile-names-only.
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
vi.mock('$lib/sections/sectionActions', () => ({
	assignMemberSection: assignMock,
	unassignMemberSection: unassignMock,
	createSection: createMock,
	reorderSections: reorderMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import type { SectionNode } from '$lib/sections/sectionData';
import type { RosterRow } from '$lib/roster/rosterData';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin, type AdminState } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures';
import { ROSTER_SURFACES } from '$lib/roster/rosterSurfaces';

// Fixtures: Soprano (one sub-section), Alto, Tenor, and one unassigned member.

function fixtureTree(): SectionNode[] {
	return [
		{
			id: 'sec-sop',
			name: 'Soprano',
			displayOrder: 1,
			parentId: null,
			depth: 0,
			children: [
				{ id: 'sec-sop1', name: 'Soprano 1', displayOrder: 1, parentId: 'sec-sop', depth: 1, children: [] }
			]
		},
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, depth: 0, children: [] },
		{ id: 'sec-tenor', name: 'Tenor', displayOrder: 3, parentId: null, depth: 0, children: [] }
	];
}

// Every row lists the reader ('person-p') in `ownerIds`, so the picker gate stays open
// for this file's picker cover.
function fixtureRows(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'], ownerIds: ['person-p'] },
		{ memberId: 'm-eva', personId: 'p-eva', name: 'Eva Green', email: 'eva@x.com', sectionIds: ['sec-sop1'], ownerIds: ['person-p'] },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: '', sectionIds: ['sec-alto'], ownerIds: ['person-p'] },
		{ memberId: 'm-uma', personId: 'p-uma', name: 'Uma Uus', email: 'uma@x.com', sectionIds: [], ownerIds: ['person-p'] }
	];
}

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
}

beforeEach(() => {
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue(fixtureTree());
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createMock.mockResolvedValue('sec-created');
	reorderMock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	assignMock.mockReset();
	unassignMock.mockReset();
	createMock.mockReset();
	reorderMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderReady(admin: AdminState = 'admin'): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	adminStore.set(admin);
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'roster-groups')).not.toBeNull();
	});
	// Sections start collapsed, so expand all up front. Tests that need a collapsed start
	// call `collapse()`/`expand()`, which work from either state.
	const toggleAll = q(container, 'roster-view-chip-expanded') as HTMLElement | null;
	if (toggleAll) {
		await fireEvent.click(toggleAll);
		await waitFor(() => {
			expect(container.querySelector('[data-testid^="roster-row-"]')).not.toBeNull();
		});
	}
	return container;
}

// State-agnostic: clicks only when the section is expanded.
async function collapse(container: HTMLElement, id: string): Promise<void> {
	const toggle = q(container, `section-toggle-${id}`) as HTMLElement;
	if (toggle.getAttribute('aria-expanded') === 'true') await fireEvent.click(toggle);
	await waitFor(() => {
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
	});
}

/** Companion to `collapse` — expand `id` regardless of the current default. */
async function expand(container: HTMLElement, id: string): Promise<void> {
	const toggle = q(container, `section-toggle-${id}`) as HTMLElement;
	if (toggle.getAttribute('aria-expanded') === 'false') await fireEvent.click(toggle);
	await waitFor(() => {
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
	});
}

/** #470 — open member `memberId`'s BLANK picker via the [+]. */
async function openBlankPicker(container: HTMLElement, memberId: string): Promise<HTMLSelectElement> {
	const add = q(container, `section-picker-add-${memberId}`) as HTMLElement;
	expect(add, `the [+] for ${memberId}`).not.toBeNull();
	await fireEvent.click(add);
	await waitFor(() => {
		expect(q(container, `section-picker-select-${memberId}-blank`)).not.toBeNull();
	});
	return q(container, `section-picker-select-${memberId}-blank`) as HTMLSelectElement;
}

/** An element's accessible name, resolved the way AT would: aria-label,
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

// The page-level create form lives in Arrange mode.
async function renderArrangeReady(): Promise<HTMLElement> {
	const container = await renderReady();
	await fireEvent.click(q(container, 'roster-view-chip-arrange') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-arrange-list')).not.toBeNull();
	});
	return container;
}

function readSource(relPath: string): string {
	return readFileSync(resolve(process.cwd(), relPath), 'utf-8');
}

// 1 — i18n: every sections surface renders via Paraglide keys only
describe('#99 — i18n: no hardcoded user-facing strings on sections surfaces', () => {
	it.each(ROSTER_SURFACES)('%s contains no bare text nodes outside m.* calls', (file) => {
		expect(bareTextNodes(readSource(file))).toEqual([]);
	});

	it('SectionPicker.svelte contains no bare text nodes outside m.* calls', () => {
		expect(bareTextNodes(readSource('src/lib/sections/SectionPicker.svelte'))).toEqual([]);
	});

	it.each(ROSTER_SURFACES)('%s has no hardcoded aria-label/title string literals (labels must come from m.*)', (file) => {
		const source = readSource(file);
		const hardcoded = source.match(/(?:aria-label|title)="[^"]*[a-zA-Z][^"]*"/g) ?? [];
		expect(hardcoded).toEqual([]);
	});

	it('SectionPicker.svelte has no hardcoded aria-label/placeholder string literals', () => {
		const source = readSource('src/lib/sections/SectionPicker.svelte');
		const hardcoded = source.match(/(?:aria-label|placeholder)="[^"]*[a-zA-Z][^"]*"/g) ?? [];
		expect(hardcoded).toEqual([]);
	});

	it('guard: every roster_* key in en.json exists in et, lv and uk, and none is empty', () => {
		const en = JSON.parse(readSource('messages/en.json')) as MessageFile;
		const rosterKeys = Object.keys(en).filter((k) => k.startsWith('roster_'));
		expect(rosterKeys.length).toBeGreaterThan(0);
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const messages = JSON.parse(readSource(`messages/${locale}.json`)) as MessageFile;
			const missing = rosterKeys.filter((k) => !(k in messages));
			expect(missing, `${locale}.json is missing roster keys`).toEqual([]);
			const empty = rosterKeys.filter((k) => k in messages && isMessageEmpty(messages[k]));
			expect(empty, `${locale}.json has empty roster values`).toEqual([]);
		}
	});

	it('guard: parameterised reorder/rename announcement labels carry {name} in ALL four locales — a label that drops the param collapses every section to the same announcement', () => {
		// The drag-handle label key went with its element; the live-region announcements
		// (reorder, rename) still carry `{name}`.
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const messages = JSON.parse(readSource(`messages/${locale}.json`)) as MessageFile;
			for (const key of [
				'roster_section_moved',
				'roster_section_grabbed',
				'roster_section_dropped',
				'roster_section_move_cancelled',
				'roster_section_indented',
				'roster_section_unindented',
				'roster_section_unindented_top',
				'roster_section_removed',
				'roster_section_renamed',
				'roster_section_rename_failed'
			]) {
				expect(
					everyPatternContains(messages[key], '{name}'),
					`${locale}.json ${key} must carry {name} in every variant`
				).toBe(true);
			}
		}
	});
});

// 2 — collapse toggles: aria-expanded + non-dangling aria-controls
describe('#99 — a11y: section collapse toggles are proper disclosures', () => {
	it('guard: every section toggle is a <button> reporting aria-expanded="true" expanded, "false" collapsed', async () => {
		const container = await renderReady();
		const toggle = q(container, 'section-toggle-sec-sop') as HTMLElement;
		expect(toggle.tagName).toBe('BUTTON');
		// Sections start collapsed; expand before asserting the expanded half.
		await expand(container, 'sec-sop');
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		await collapse(container, 'sec-sop');
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
	});

	it('the EXPANDED toggle references its disclosed region via aria-controls resolving to an element in the document — aria-expanded with no relationship does not say WHAT is disclosed', async () => {
		const container = await renderReady();
		for (const id of ['sec-sop', 'sec-alto', 'sec-tenor']) {
			await expand(container, id); // TU.2/#110 finding #9 — collapsed by default now
			const toggle = q(container, `section-toggle-${id}`) as HTMLElement;
			expect(toggle.getAttribute('aria-expanded')).toBe('true');
			const controls = toggle.getAttribute('aria-controls');
			expect(controls, `expanded toggle ${id} must carry aria-controls`).toBeTruthy();
			expect(
				toggle.ownerDocument.getElementById(controls!),
				`aria-controls="${controls}" on ${id} references an id that is not in the document`
			).not.toBeNull();
		}
	});

	it('the COLLAPSED toggle must not dangle its aria-controls IDREF — the region only renders while expanded, so either drop the attribute while collapsed or keep the region in the DOM (the #86 SeasonSummary ruling)', async () => {
		const container = await renderReady();
		await collapse(container, 'sec-sop');
		const toggle = q(container, 'section-toggle-sec-sop') as HTMLElement;
		const controls = toggle.getAttribute('aria-controls');
		if (controls !== null) {
			expect(
				toggle.ownerDocument.getElementById(controls),
				`aria-controls="${controls}" references an id that is not in the document while collapsed`
			).not.toBeNull();
		}
	});

	it('the Unassigned pseudo-group toggle follows the same disclosure contract (aria-expanded + resolving aria-controls while expanded)', async () => {
		const container = await renderReady();
		const toggle = q(container, 'section-toggle-unassigned') as HTMLElement;
		expect(toggle, 'unassigned toggle must render (fixture has an unassigned member)').not.toBeNull();
		// Collapsed by default.
		await expand(container, 'unassigned');
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		const controls = toggle.getAttribute('aria-controls');
		expect(controls, 'expanded unassigned toggle must carry aria-controls').toBeTruthy();
		expect(toggle.ownerDocument.getElementById(controls!)).not.toBeNull();
	});

	it('guard: the disclosure caret glyph is aria-hidden (decorative)', async () => {
		const container = await renderReady();
		const toggle = q(container, 'section-toggle-sec-sop') as HTMLElement;
		const glyph = Array.from(toggle.querySelectorAll('span')).find((s) =>
			/[▸▾]/.test(s.textContent ?? '')
		);
		expect(glyph, 'the caret glyph span must exist').toBeTruthy();
		expect(glyph!.getAttribute('aria-hidden')).toBe('true');
	});
});

// 3 — #470: the section controls are native, labelled form controls. The browser owns a
// native <select>'s semantics; what we pin is that the controls are native and named.
describe('#470 — a11y: native per-membership selects + a labelled [+], no custom widget left', () => {
	it("a member's held section renders a NATIVE <select> with an accessible name that names her", async () => {
		const container = await renderReady();
		const select = q(container, 'section-picker-select-m-ada-sec-sop') as HTMLSelectElement;
		expect(select, "Ada's Soprano select").not.toBeNull();
		expect(select.tagName).toBe('SELECT');
		const name = accessibleName(select);
		expect(name, 'the select must be named').not.toBe('');
		expect(name).toContain('Ada Lovelace');
	});

	it('the [+] is a native, labelled <button type="button"> naming the member; the blank picker it opens is a named native <select> too', async () => {
		const container = await renderReady();
		const add = q(container, 'section-picker-add-m-uma') as HTMLButtonElement;
		expect(add, "Uma's [+]").not.toBeNull();
		expect(add.tagName).toBe('BUTTON');
		expect(add.type).toBe('button');
		expect(add.getAttribute('aria-label') ?? '').toContain('Uma Uus');

		const blank = await openBlankPicker(container, 'm-uma');
		expect(blank.tagName).toBe('SELECT');
		const name = accessibleName(blank);
		expect(name, 'the blank picker must be named').not.toBe('');
		expect(name).toContain('Uma Uus');
	});

	it('a member in TWO sections renders one row per membership — and EVERY select in the document is named, not just the first (F2 review fix)', async () => {
		// The grouped view mounts a member's picker once per membership, so an id + <label for>
		// pairing would duplicate ids and leave the later rows' controls unnamed.
		loadRosterMock.mockResolvedValue(
			toListRead([
				...fixtureRows(),
				{
					memberId: 'm-multi',
					personId: 'p-multi',
					name: 'Mia Multi',
					email: 'mia@x.com',
					sectionIds: ['sec-sop', 'sec-alto'],
					ownerIds: ['person-p']
				}
			])
		);
		const container = await renderReady();

		expect(
			container.querySelectorAll('[data-testid="roster-row-m-multi"]').length,
			'one row per membership'
		).toBe(2);
		// Each card shows its own membership, so the select testids are unique; the [+] is not
		// section-scoped and repeats per card, so the names may not rest on ids.
		expect(
			container.querySelectorAll('[data-testid="section-picker-select-m-multi-sec-sop"]').length,
			'her Soprano select renders once, on her Soprano card'
		).toBe(1);
		expect(
			container.querySelectorAll('[data-testid="section-picker-select-m-multi-sec-alto"]').length,
			'her Alto select renders once, on her Alto card'
		).toBe(1);
		expect(
			container.querySelectorAll('[data-testid="section-picker-add-m-multi"]').length,
			'the [+] rides on both of her cards'
		).toBe(2);

		const selects = Array.from(
			container.querySelectorAll<HTMLSelectElement>('[data-testid^="section-picker-select-"]')
		);
		for (const select of selects) {
			expect(
				accessibleName(select),
				`${select.getAttribute('data-testid')} must be named wherever it renders`
			).not.toBe('');
		}
		// The names must not rest on document-unique ids either.
		const ids = selects
			.map((el) => el.getAttribute('id'))
			.filter((id): id is string => id !== null);
		expect(
			ids.filter((id, i) => ids.indexOf(id) !== i),
			'no duplicated id is used to name a control'
		).toEqual([]);
	});

	it('nothing of the custom widget survives: no role="listbox", no role="option", no aria-haspopup trigger, no picker menu testid', async () => {
		const container = await renderReady();
		expect(container.querySelector('[role="listbox"]')).toBeNull();
		expect(container.querySelector('[role="option"]')).toBeNull();
		expect(container.querySelector('[data-testid^="section-picker-trigger-"]')).toBeNull();
		expect(container.querySelector('[data-testid^="section-picker-menu-"]')).toBeNull();
		expect(container.querySelector('[data-testid^="section-picker-listbox-"]')).toBeNull();
	});
});

// 5 — form errors: role='alert' + field association
describe("#99 — a11y: every sections error surface is a live region (role='alert')", () => {
	it("guard (#470: re-driven through the page-level roster-new-section form): the validation error has role='alert', and the name input carries aria-invalid + aria-describedby resolving to it", async () => {
		const container = await renderArrangeReady();
		await fireEvent.click(q(container, 'roster-new-section') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'roster-new-section-form')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'roster-new-section-submit') as HTMLElement); // empty name

		const error = q(container, 'roster-new-section-error') as HTMLElement;
		expect(error, 'validation error must render').not.toBeNull();
		expect(error.getAttribute('role')).toBe('alert');
		expect(error.textContent).toContain('Section name is required.');

		const input = q(container, 'roster-new-section-name') as HTMLElement;
		expect(input.getAttribute('aria-invalid')).toBe('true');
		const describedby = input.getAttribute('aria-describedby');
		expect(describedby, 'name input must reference its error').toBeTruthy();
		expect(input.ownerDocument.getElementById(describedby!)).toBe(error);
	});

	it("guard (#470: the banner's producer is the ASSIGN path now): a failed assign through the blank picker surfaces role='alert' inline in the member's row", async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		assignMock.mockRejectedValue(new Error('403'));
		const container = await renderReady();

		const blank = await openBlankPicker(container, 'm-uma');
		await fireEvent.change(blank, { target: { value: 'sec-alto' } });

		await waitFor(() => {
			const error = q(container, 'section-write-error-m-uma') as HTMLElement;
			expect(error).not.toBeNull();
			expect(error.getAttribute('role')).toBe('alert');
		});
		consoleSpy.mockRestore();
	});

	it("guard: the section-tree load failure banner has role='alert'", async () => {
		listSectionsMock.mockRejectedValue(new Error('boom'));
		setAuthedWithOneCollective();
		adminStore.set('admin');
		const { container } = render(Page);
		await waitFor(() => {
			const banner = q(container, 'roster-sections-load-error');
			expect(banner).not.toBeNull();
			expect(banner!.getAttribute('role')).toBe('alert');
		});
	});

	it("guard: the roster load failure has role='alert' with a keyboard-operable Retry button", async () => {
		loadRosterMock.mockRejectedValue(new Error('boom'));
		setAuthedWithOneCollective();
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'roster-load-error')).not.toBeNull();
		});
		const banner = q(container, 'roster-load-error') as HTMLElement;
		expect(banner.getAttribute('role')).toBe('alert');
		const retry = q(container, 'roster-retry-load') as HTMLElement;
		expect(retry.tagName).toBe('BUTTON');
	});
});

// 6 — keyboard navigation on all interactive elements
describe('#99 — a11y: keyboard operability across the sections surfaces', () => {
	it('guard (#470): the section controls are NATIVE elements — the [+] a <button type="button">, every picker a <select> — keyboard-operable for free, no arrow-key plumbing of ours left to break', async () => {
		const container = await renderReady();
		const add = q(container, 'section-picker-add-m-ada') as HTMLButtonElement;
		expect(add, "Ada's [+]").not.toBeNull();
		expect(add.tagName).toBe('BUTTON');
		expect(add.type).toBe('button');
		const selects = Array.from(
			container.querySelectorAll<HTMLElement>('[data-testid^="section-picker-select-"]')
		);
		expect(selects.length, 'one select per membership renders').toBeGreaterThan(0);
		for (const select of selects) {
			expect(select.tagName, select.getAttribute('data-testid') ?? '').toBe('SELECT');
		}
		// Merely rendering (and opening nothing) writes nothing.
		expect(assignMock).not.toHaveBeenCalled();
		expect(unassignMock).not.toHaveBeenCalled();
	});

	it('guard: the sort toggle and section collapse toggles are native <button>s (keyboard-operable), and the sort toggle reports its state via aria-pressed', async () => {
		const container = await renderReady();
		// Collapse toggles first — clicking the sort toggle below switches to the
		// FLAT view, where section groups (and their toggles) no longer render.
		const toggle = q(container, 'section-toggle-sec-alto') as HTMLElement;
		expect(toggle.tagName).toBe('BUTTON');
		const sort = q(container, 'roster-sort-toggle') as HTMLButtonElement;
		expect(sort.tagName).toBe('BUTTON');
		expect(sort.getAttribute('aria-pressed')).toBe('false');
		await fireEvent.click(sort);
		expect(sort.getAttribute('aria-pressed')).toBe('true');
	});
});

describe('#99 review R2/F3 — the reorder live region is present from first render', () => {
	it('guard: role="status"/aria-live="polite", mounted before any reorder — a region mounted together with its own text is announced by nothing', async () => {
		const container = await renderReady();
		const status = q(container, 'roster-reorder-status') as HTMLElement;
		expect(status, 'the live region must exist before any reorder').not.toBeNull();
		expect(status.getAttribute('role')).toBe('status');
		expect(status.getAttribute('aria-live')).toBe('polite');
		expect(status.textContent?.trim()).toBe('');
	});
});

// (*MVOX:Tallis*) (*MVOX:Palestrina*)
