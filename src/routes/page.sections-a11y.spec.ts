// @vitest-environment happy-dom
//
// #99 TS.5 RED — i18n + a11y coverage for all Sections 1.0 surfaces (TS.1–TS.4):
//   - the /roster page's section-grouped view (collapse toggles, drag handles,
//     move buttons, error banners)
//   - SectionPicker (trigger, option menu, inline create form)
//
// Follows the #93/TR.5 precedent (page.repertoire-a11y.spec.ts): source-scan
// tests for i18n hygiene + rendered-DOM tests for aria semantics — ALL DOM
// tests render the ACTUAL page route component (./roster/+page.svelte), never
// the picker in isolation, so GREEN cannot pass by patching a component the
// page doesn't mount ("partial assertions hide bugs").
//
// These are RED — they assert a11y the TS.1–TS.4 surfaces do not yet carry:
//   - the collapse toggles report aria-expanded but DANGLE no aria-controls at
//     all — a screen reader hears "collapsed/expanded" with no relationship to
//     WHAT gets disclosed (the #86 SeasonSummary ruling, third slice running);
//   - the picker menu is a bare <div> of buttons: no role="listbox", no
//     role="option", state via aria-pressed instead of aria-selected, and the
//     trigger doesn't announce that it pops anything up;
//     ⚠ SUPERSEDES the TS.2 aria-pressed pin in SectionPicker.spec.ts /
//     page.roster-picker.spec.ts — aria-pressed on role="option" is an invalid
//     ARIA mix, so GREEN must move those pins to aria-selected, not stack both;
//   - the drag handle is aria-hidden with NO aria-grabbed, and no element ever
//     exposes aria-dropeffect — a drag in progress is completely silent to AT;
//   - the open listbox has no keyboard navigation beyond Tab — ArrowDown/
//     ArrowUp must move focus through the options (the listbox pattern).
// A set of guard tests pins what already exists (aria-expanded, role="alert"
// on all three error surfaces, aria-invalid + aria-describedby on the create
// form, Escape dismissal, native buttons, locale key parity) so GREEN can't
// regress it.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	everyPatternContains,
	isMessageEmpty,
	type MessageFile
} from '$lib/testing/messageFile.js';

// Paraglide mock: real English strings for the keys that exist today, plus a
// Proxy fallback so keys ADDED by the GREEN pass resolve without this file
// needing to know their names — the fallback renders "<key> <param values...>",
// so "the label contains the section name" holds for any key shape as long as
// the name rides along as a param.
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
		roster_section_assign_failed: () =>
			"The section was created, but the member couldn't be added to it.",
		roster_section_drag_handle: (p) => `Drag to reorder ${p?.name}`
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

// ───────────────────────────────────────────────────────────────────────────
// Page seams — same mock set as page.roster-reorder.spec.ts: groupBySection
// runs REAL, only the fetch seams and the write seam are mocked.
// ───────────────────────────────────────────────────────────────────────────
const { loadRosterMock, listSectionsMock, assignMock, unassignMock, createMock, reorderMock } =
	vi.hoisted(() => ({
		loadRosterMock: vi.fn(),
		listSectionsMock: vi.fn(),
		assignMock: vi.fn(),
		unassignMock: vi.fn(),
		createMock: vi.fn(),
		reorderMock: vi.fn()
	}));
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
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));
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

// ── fixtures ────────────────────────────────────────────────────────────────
// Soprano (with one sub-section), Alto, Tenor — plus one UNASSIGNED member so
// the Unassigned pseudo-group and the picker's empty-selection state both
// render.

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

function fixtureRows(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'] },
		{ memberId: 'm-eva', personId: 'p-eva', name: 'Eva Green', email: 'eva@x.com', sectionIds: ['sec-sop1'] },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: '', sectionIds: ['sec-alto'] },
		{ memberId: 'm-uma', personId: 'p-uma', name: 'Uma Uus', email: 'uma@x.com', sectionIds: [] }
	];
}

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

beforeEach(() => {
	loadRosterMock.mockResolvedValue(fixtureRows());
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
	// TU.2/#110 finding #9 — sections default COLLAPSED now (member rows, and
	// this file's picker triggers, don't render until expanded); this file's
	// concern is a11y semantics on the ALREADY-OPEN surfaces, not the collapse
	// default itself (that's page.roster-sections-ux.spec.ts's job), so expand
	// everything up front via the same toggle-all control #9 shipped. Individual
	// tests that need a COLLAPSED starting point (the drag/reorder and
	// disclosure-contract tests) call `collapse()`/`expand()` explicitly, which
	// stay state-agnostic either way.
	const toggleAll = q(container, 'roster-view-chip-expanded') as HTMLElement | null;
	if (toggleAll) {
		await fireEvent.click(toggleAll);
		await waitFor(() => {
			expect(container.querySelector('[data-testid^="roster-row-"]')).not.toBeNull();
		});
	}
	return container;
}

// TU.2/#110 finding #9 — sections now default COLLAPSED, so this helper is
// STATE-AGNOSTIC (only clicks when currently expanded) rather than assuming an
// expanded start.
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

/** Open member `memberId`'s picker and return its menu element (the POPUP
 *  wrapper — it holds the listbox AND the "+ New section…" button beside it;
 *  see `listboxOf` for the role="listbox" element itself). */
async function openPicker(container: HTMLElement, memberId: string): Promise<HTMLElement> {
	const trigger = q(container, `section-picker-trigger-${memberId}`) as HTMLElement;
	expect(trigger, `picker trigger for ${memberId}`).not.toBeNull();
	await fireEvent.click(trigger);
	const menu = q(container, `section-picker-menu-${memberId}`) as HTMLElement;
	expect(menu, `picker menu for ${memberId}`).not.toBeNull();
	return menu;
}

/** The role="listbox" element inside member `memberId`'s open popup. */
function listboxOf(container: HTMLElement, memberId: string): HTMLElement {
	const listbox = q(container, `section-picker-listbox-${memberId}`) as HTMLElement;
	expect(listbox, `picker listbox for ${memberId}`).not.toBeNull();
	return listbox;
}

/** Minimal DataTransfer stand-in — happy-dom has no native one. */
function makeDataTransfer() {
	const data: Record<string, string> = {};
	return {
		setData: (k: string, v: string) => {
			data[k] = v;
		},
		getData: (k: string) => data[k] ?? '',
		effectAllowed: '',
		dropEffect: ''
	};
}

// #150 — the ▲/▼ buttons that used to trigger a reorder for these tests are
// gone; drag is now the only input, so the shared reorder-outcome tests below
// (error/status announcements) drive it the same way page.roster-reorder.spec.ts
// does.
async function dragAndDrop(container: HTMLElement, fromId: string, toId: string): Promise<void> {
	const dataTransfer = makeDataTransfer();
	const handle = q(container, `section-drag-handle-${fromId}`) as HTMLElement;
	expect(handle, `drag handle for ${fromId}`).not.toBeNull();
	const target = q(container, `section-header-${toId}`) as HTMLElement;
	expect(target, `drop target header for ${toId}`).not.toBeNull();
	await fireEvent.dragStart(handle, { dataTransfer });
	await fireEvent.dragOver(target, { dataTransfer });
	await fireEvent.drop(target, { dataTransfer });
}

// ---------------------------------------------------------------------------
// Source-scan helpers (i18n hygiene) — same strategy as the #86/#93 passes:
// strip script blocks, HTML comments and Svelte expressions from the template;
// any remaining bare text node with letters in it is a hardcoded user-facing
// string.
// ---------------------------------------------------------------------------
function readSource(relPath: string): string {
	return readFileSync(resolve(process.cwd(), relPath), 'utf-8');
}

function bareTextNodes(source: string): string[] {
	let template = source.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
	template = template.replace(/<!--[\s\S]*?-->/g, '');
	let prev = '';
	while (prev !== template) {
		prev = template;
		template = template.replace(/\{[^{}]*\}/g, '');
	}
	const nodes: string[] = [];
	const textNodePattern = />([^<]+)</g;
	let match: RegExpExecArray | null;
	while ((match = textNodePattern.exec(template)) !== null) {
		const text = match[1].trim();
		if (!text) continue;
		// Decorative glyph-only nodes (disclosure carets, drag handle, move
		// arrows, separators) are fine — they must be aria-hidden or labelled,
		// which the DOM tests below check; they are not TRANSLATABLE strings.
		if (/^[▸▾▲▼≡·×♫\s\-–—|(),]+$/.test(text)) continue;
		if (/^(&[a-zA-Z]+;|&#\d+;)+$/.test(text)) continue;
		if (!/[a-zA-Z]/.test(text)) continue;
		nodes.push(text);
	}
	return nodes;
}

// ---------------------------------------------------------------------------
// 1 — i18n: every sections surface renders via Paraglide keys only
// ---------------------------------------------------------------------------
describe('#99 — i18n: no hardcoded user-facing strings on sections surfaces', () => {
	it('roster/+page.svelte contains no bare text nodes outside m.* calls', () => {
		expect(bareTextNodes(readSource('src/routes/roster/+page.svelte'))).toEqual([]);
	});

	it('SectionPicker.svelte contains no bare text nodes outside m.* calls', () => {
		expect(bareTextNodes(readSource('src/lib/sections/SectionPicker.svelte'))).toEqual([]);
	});

	it('roster/+page.svelte has no hardcoded aria-label/title string literals (labels must come from m.*)', () => {
		const source = readSource('src/routes/roster/+page.svelte');
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

	it('guard: parameterised reorder labels carry {name} in ALL four locales — a label that drops the param collapses every section to the same announcement', () => {
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const messages = JSON.parse(readSource(`messages/${locale}.json`)) as MessageFile;
			for (const key of ['roster_section_drag_handle']) {
				expect(
					everyPatternContains(messages[key], '{name}'),
					`${locale}.json ${key} must carry {name} in every variant`
				).toBe(true);
			}
		}
	});
});

// ---------------------------------------------------------------------------
// 2 — collapse toggles: aria-expanded + non-dangling aria-controls
// ---------------------------------------------------------------------------
describe('#99 — a11y: section collapse toggles are proper disclosures', () => {
	it('guard: every section toggle is a <button> reporting aria-expanded="true" expanded, "false" collapsed', async () => {
		const container = await renderReady();
		const toggle = q(container, 'section-toggle-sec-sop') as HTMLElement;
		expect(toggle.tagName).toBe('BUTTON');
		// TU.2/#110 finding #9 — sections default COLLAPSED now; expand explicitly
		// before asserting the "expanded" half of the contract.
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
		// TU.2/#110 finding #9 — collapsed by default now.
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

// ---------------------------------------------------------------------------
// 3 — section picker: listbox semantics
// ---------------------------------------------------------------------------
describe("#99 — a11y: the section picker menu is a listbox (role='listbox', aria-selected)", () => {
	it("the open menu presents a role='listbox' — a bare <div> of buttons announces no selection widget at all", async () => {
		const container = await renderReady();
		const menu = await openPicker(container, 'm-ada');
		// #99 review (round 2) F4: the listbox is an element INSIDE the popup rather
		// than the popup itself, so it can own options ONLY — the "+ New section…"
		// action sits beside it instead of masquerading as an option. Still one
		// listbox, still inside the open menu.
		const listbox = listboxOf(container, 'm-ada');
		expect(listbox.getAttribute('role')).toBe('listbox');
		expect(menu.contains(listbox)).toBe(true);
	});

	it("the trigger announces its popup: aria-haspopup='listbox' alongside the existing aria-expanded", async () => {
		const container = await renderReady();
		const trigger = q(container, 'section-picker-trigger-m-ada') as HTMLElement;
		expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		await fireEvent.click(trigger);
		expect(trigger.getAttribute('aria-expanded')).toBe('true');
	});

	it("every section option carries role='option' with aria-selected reflecting the member's CURRENT sections — true on every assigned id, false on the rest", async () => {
		const container = await renderReady();
		await openPicker(container, 'm-ada'); // Ada is in sec-sop only
		for (const [sectionId, selected] of [
			['sec-sop', 'true'],
			['sec-sop1', 'false'],
			['sec-alto', 'false'],
			['sec-tenor', 'false']
		] as const) {
			const option = q(container, `section-picker-option-${sectionId}`) as HTMLElement;
			expect(option, `option ${sectionId}`).not.toBeNull();
			expect(option.getAttribute('role'), `option ${sectionId} role`).toBe('option');
			expect(option.getAttribute('aria-selected'), `option ${sectionId} aria-selected`).toBe(selected);
		}
	});

	it("the Unassigned option is role='option' too, aria-selected='true' exactly when the member has NO sections", async () => {
		const container = await renderReady();

		// Ada (assigned): Unassigned not selected.
		await openPicker(container, 'm-ada');
		let unassigned = q(container, 'section-picker-option-unassigned') as HTMLElement;
		expect(unassigned.getAttribute('role')).toBe('option');
		expect(unassigned.getAttribute('aria-selected')).toBe('false');
		await fireEvent.keyDown(document.body, { key: 'Escape' });

		// Uma (no sections): Unassigned selected.
		await openPicker(container, 'm-uma');
		unassigned = q(container, 'section-picker-option-unassigned') as HTMLElement;
		expect(unassigned.getAttribute('role')).toBe('option');
		expect(unassigned.getAttribute('aria-selected')).toBe('true');
	});

	it("options must NOT carry aria-pressed — pressed-state on role='option' is an invalid ARIA mix (supersedes the TS.2 aria-pressed pin; GREEN updates SectionPicker.spec.ts / page.roster-picker.spec.ts to aria-selected)", async () => {
		const container = await renderReady();
		await openPicker(container, 'm-ada');
		const withPressed = Array.from(
			container.querySelectorAll('[data-testid^="section-picker-option-"][aria-pressed]')
		).map((el) => el.getAttribute('data-testid'));
		expect(withPressed).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 4 — drag-reorder: aria-grabbed / aria-dropeffect + labelled keyboard fallback
// ---------------------------------------------------------------------------
describe('#99 — a11y: drag-reorder announces grab and drop state', () => {
	async function renderCollapsedAdmin(): Promise<HTMLElement> {
		const container = await renderReady('admin');
		for (const id of ['sec-sop', 'sec-alto', 'sec-tenor']) await collapse(container, id);
		return container;
	}

	it("an idle drag handle exposes aria-grabbed='false' and is NOT aria-hidden — a hidden handle can announce nothing, and this one carries the drag state", async () => {
		const container = await renderCollapsedAdmin();
		const handle = q(container, 'section-drag-handle-sec-sop') as HTMLElement;
		expect(handle, 'drag handle must render on a collapsed admin header').not.toBeNull();
		expect(handle.getAttribute('aria-hidden')).not.toBe('true');
		expect(handle.getAttribute('aria-grabbed')).toBe('false');
	});

	it("dragstart flips the dragged handle to aria-grabbed='true'; dragend returns it to 'false'", async () => {
		const container = await renderCollapsedAdmin();
		const handle = q(container, 'section-drag-handle-sec-sop') as HTMLElement;
		await fireEvent.dragStart(handle, { dataTransfer: makeDataTransfer() });
		expect(handle.getAttribute('aria-grabbed')).toBe('true');
		await fireEvent.dragEnd(handle);
		expect(handle.getAttribute('aria-grabbed')).toBe('false');
	});

	it("while a drag is live, every SIBLING drop target exposes aria-dropeffect='move' — with no dropeffect anywhere the drag is completely silent to AT", async () => {
		const container = await renderCollapsedAdmin();
		const handle = q(container, 'section-drag-handle-sec-sop') as HTMLElement;

		// Idle: no advertised drop targets.
		expect(container.querySelectorAll('[aria-dropeffect="move"]').length).toBe(0);

		await fireEvent.dragStart(handle, { dataTransfer: makeDataTransfer() });
		// Both remaining top-level siblings advertise the drop.
		for (const id of ['sec-alto', 'sec-tenor']) {
			const group = q(container, `section-group-${id}`) as HTMLElement;
			const dropTarget =
				group.getAttribute('aria-dropeffect') === 'move'
					? group
					: group.querySelector('[aria-dropeffect="move"]');
			expect(dropTarget, `section ${id} must expose aria-dropeffect="move" during a drag`).not.toBeNull();
		}
		// The Unassigned pseudo-group is NOT a drop target (not a section entity).
		const unassigned = q(container, 'section-group-unassigned') as HTMLElement;
		expect(unassigned.getAttribute('aria-dropeffect')).not.toBe('move');
		expect(unassigned.querySelector('[aria-dropeffect="move"]')).toBeNull();

		await fireEvent.dragEnd(handle);
		expect(container.querySelectorAll('[aria-dropeffect="move"]').length).toBe(0);
	});

	// #152 RED — SUPERSEDES the #150-era "NOT focusable" guard that lived here
	// (which said so itself: "expected to change shape when #152 lands"). The
	// handle now implements the keyboard grab protocol (see
	// page.roster-ux-a11y.spec.ts section 5 for the full contract), so it must
	// be focusable: every handle carries a tabindex, and at least one sits in
	// the Tab order (roving tabindex keeps one per composite; a flat
	// tabindex="0" everywhere also satisfies this).
	it('#152: the drag handle is FOCUSABLE — it implements the keyboard grab protocol now, so tabindex="-1" everywhere would leave the reorder keyboard-unreachable (WCAG 2.1.1)', async () => {
		const container = await renderCollapsedAdmin();
		const handles = ['sec-sop', 'sec-alto', 'sec-tenor'].map(
			(id) => q(container, `section-drag-handle-${id}`) as HTMLElement
		);
		for (const handle of handles) {
			expect(handle, 'handle must render').not.toBeNull();
			expect(handle.getAttribute('tabindex'), 'every handle must carry a tabindex').not.toBeNull();
		}
		expect(
			handles.some((handle) => handle.getAttribute('tabindex') === '0'),
			'at least one handle must be in the Tab order'
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 5 — form errors: role='alert' + field association
// ---------------------------------------------------------------------------
describe("#99 — a11y: every sections error surface is a live region (role='alert')", () => {
	it("guard: the create form's validation error has role='alert', and the name input carries aria-invalid + aria-describedby resolving to it", async () => {
		const container = await renderReady();
		await openPicker(container, 'm-ada');
		await fireEvent.click(q(container, 'section-picker-new') as HTMLElement);
		await fireEvent.click(q(container, 'section-create-submit') as HTMLElement); // empty name

		const error = q(container, 'section-create-error') as HTMLElement;
		expect(error, 'validation error must render').not.toBeNull();
		expect(error.getAttribute('role')).toBe('alert');
		expect(error.textContent).toContain('Section name is required.');

		const input = q(container, 'section-create-name') as HTMLElement;
		expect(input.getAttribute('aria-invalid')).toBe('true');
		const describedby = input.getAttribute('aria-describedby');
		expect(describedby, 'name input must reference its error').toBeTruthy();
		expect(input.ownerDocument.getElementById(describedby!)).toBe(error);
	});

	it("guard: a failed create write surfaces role='alert' inline in the member's row", async () => {
		createMock.mockRejectedValue(new Error('403'));
		const container = await renderReady();
		await openPicker(container, 'm-ada');
		await fireEvent.click(q(container, 'section-picker-new') as HTMLElement);
		const input = q(container, 'section-create-name') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'Bass' } });
		await fireEvent.click(q(container, 'section-create-submit') as HTMLElement);

		await waitFor(() => {
			const error = q(container, 'section-write-error-m-ada') as HTMLElement;
			expect(error).not.toBeNull();
			expect(error.getAttribute('role')).toBe('alert');
		});
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

// ---------------------------------------------------------------------------
// 6 — keyboard navigation on all interactive elements
// ---------------------------------------------------------------------------
describe('#99 — a11y: keyboard operability across the sections surfaces', () => {
	it('guard: trigger, every option, the new-section entry and both form actions are native <button type="button">s — keyboard-operable for free', async () => {
		const container = await renderReady();
		await openPicker(container, 'm-ada');
		const testids = [
			'section-picker-trigger-m-ada',
			'section-picker-option-sec-sop',
			'section-picker-option-unassigned',
			'section-picker-new'
		];
		for (const testid of testids) {
			const el = q(container, testid) as HTMLButtonElement;
			expect(el, testid).not.toBeNull();
			expect(el.tagName, testid).toBe('BUTTON');
			expect(el.type, testid).toBe('button');
		}
		await fireEvent.click(q(container, 'section-picker-new') as HTMLElement);
		for (const testid of ['section-create-submit', 'section-create-cancel']) {
			const el = q(container, testid) as HTMLButtonElement;
			expect(el.tagName, testid).toBe('BUTTON');
			expect(el.type, testid).toBe('button');
		}
	});

	it('guard: Escape closes the open picker without firing any write', async () => {
		const container = await renderReady();
		await openPicker(container, 'm-ada');
		await fireEvent.keyDown(document.body, { key: 'Escape' });
		expect(q(container, 'section-picker-menu-m-ada')).toBeNull();
		expect(assignMock).not.toHaveBeenCalled();
		expect(unassignMock).not.toHaveBeenCalled();
	});

	it('ArrowDown moves focus from the trigger/first option down the listbox; ArrowUp moves it back — the listbox pattern requires arrow navigation, Tab alone is not it', async () => {
		const container = await renderReady();
		const menu = await openPicker(container, 'm-ada');
		const first = q(container, 'section-picker-option-sec-sop') as HTMLElement;
		const second = q(container, 'section-picker-option-sec-sop1') as HTMLElement;

		first.focus();
		await fireEvent.keyDown(first, { key: 'ArrowDown' });
		expect(menu.ownerDocument.activeElement).toBe(second);

		await fireEvent.keyDown(second, { key: 'ArrowUp' });
		expect(menu.ownerDocument.activeElement).toBe(first);
	});

	it('ArrowDown on the LAST actionable entry does not wrap out of the widget — focus stays inside the listbox', async () => {
		const container = await renderReady();
		const menu = await openPicker(container, 'm-ada');
		const last = q(container, 'section-picker-new') as HTMLElement;
		last.focus();
		await fireEvent.keyDown(last, { key: 'ArrowDown' });
		const active = menu.ownerDocument.activeElement as HTMLElement | null;
		expect(active, 'focus must stay on an element').not.toBeNull();
		expect(menu.contains(active), 'focus escaped the listbox on ArrowDown at the end').toBe(true);
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

// ---------------------------------------------------------------------------
// 7 — #99 CODE-REVIEW FIXES (F1–F5). Each block pins a defect the first GREEN
//     pass shipped; all render the real page, same as everything above.
// ---------------------------------------------------------------------------
describe('#99 review F1 — dismissing the picker RESTORES focus to its trigger', () => {
	it('Escape with an option focused puts focus back on the trigger — an unmounted activeElement drops focus to <body> and the next Tab restarts at the top of the document', async () => {
		const container = await renderReady();
		await openPicker(container, 'm-ada');
		const trigger = q(container, 'section-picker-trigger-m-ada') as HTMLElement;
		const option = q(container, 'section-picker-option-sec-sop') as HTMLElement;

		option.focus();
		expect(option.ownerDocument.activeElement).toBe(option);
		await fireEvent.keyDown(option, { key: 'Escape' });

		expect(q(container, 'section-picker-menu-m-ada')).toBeNull();
		expect(trigger.ownerDocument.activeElement).toBe(trigger);
	});

	it('PICKING an option puts focus back on the trigger too — the write path drops focus exactly like Escape did', async () => {
		const container = await renderReady();
		await openPicker(container, 'm-ada');
		const trigger = q(container, 'section-picker-trigger-m-ada') as HTMLElement;
		const option = q(container, 'section-picker-option-sec-alto') as HTMLElement;

		option.focus();
		await fireEvent.click(option);

		await waitFor(() => {
			expect(q(container, 'section-picker-menu-m-ada')).toBeNull();
		});
		expect(trigger.ownerDocument.activeElement).toBe(trigger);
	});

	it('an OUTSIDE click does NOT yank focus back — opening another member’s picker must not pull focus onto the dismissed one’s trigger', async () => {
		const container = await renderReady();
		await openPicker(container, 'm-ada');
		const adaTrigger = q(container, 'section-picker-trigger-m-ada') as HTMLElement;
		(q(container, 'section-picker-option-sec-sop') as HTMLElement).focus();

		await fireEvent.click(q(container, 'section-picker-trigger-m-bea') as HTMLElement);

		expect(q(container, 'section-picker-menu-m-ada')).toBeNull();
		expect(q(container, 'section-picker-menu-m-bea')).not.toBeNull();
		expect(adaTrigger.ownerDocument.activeElement).not.toBe(adaTrigger);
	});
});

describe('#99 review F2 — arrow navigation is reachable FROM THE TRIGGER', () => {
	it('ArrowDown on the open trigger enters the list at the first option — focus stays on the trigger when the menu opens, so a menu-only keydown handler never fires at all', async () => {
		const container = await renderReady();
		await openPicker(container, 'm-ada');
		const trigger = q(container, 'section-picker-trigger-m-ada') as HTMLElement;

		trigger.focus();
		await fireEvent.keyDown(trigger, { key: 'ArrowDown' });

		expect(trigger.ownerDocument.activeElement).toBe(q(container, 'section-picker-option-sec-sop'));
	});

	it('ArrowUp on the open trigger enters the list at the LAST entry', async () => {
		const container = await renderReady();
		await openPicker(container, 'm-ada');
		const trigger = q(container, 'section-picker-trigger-m-ada') as HTMLElement;

		trigger.focus();
		await fireEvent.keyDown(trigger, { key: 'ArrowUp' });

		expect(trigger.ownerDocument.activeElement).toBe(q(container, 'section-picker-new'));
	});

	it('ArrowDown on a CLOSED trigger opens the listbox and lands on the first option (the canonical listbox behaviour)', async () => {
		const container = await renderReady();
		const trigger = q(container, 'section-picker-trigger-m-ada') as HTMLElement;
		trigger.focus();

		await fireEvent.keyDown(trigger, { key: 'ArrowDown' });

		await waitFor(() => {
			expect(q(container, 'section-picker-menu-m-ada')).not.toBeNull();
		});
		await waitFor(() => {
			expect(trigger.ownerDocument.activeElement).toBe(
				q(container, 'section-picker-option-sec-sop')
			);
		});
	});
});

describe('#99 review F3 — the listbox owns only options', () => {
	it("every DIRECT CHILD of role='listbox' carries role='option' — a listbox may only own option/group, and AT is entitled to drop any other child from the accessibility tree", async () => {
		const container = await renderReady();
		await openPicker(container, 'm-ada');
		const listbox = listboxOf(container, 'm-ada');
		expect(listbox.getAttribute('role')).toBe('listbox');

		const strays = Array.from(listbox.children)
			.filter((child) => child.getAttribute('role') !== 'option')
			.map((child) => child.getAttribute('data-testid'));
		expect(strays).toEqual([]);
	});
});

describe('#99 review F4 — only a SIBLING header advertises (and accepts) the drop', () => {
	it("a NON-SIBLING collapsed header exposes no aria-dropeffect and refuses the drop — dropOnto silently ignores cross-parent targets, so advertising 'move' there promises a move that never happens", async () => {
		const container = await renderReady('admin');
		// Soprano stays EXPANDED so its sub-section renders; the sub-section and
		// both foreign top-level sections collapse, so all three carry handles.
		for (const id of ['sec-sop1', 'sec-alto', 'sec-tenor']) await collapse(container, id);

		const handle = q(container, 'section-drag-handle-sec-alto') as HTMLElement;
		await fireEvent.dragStart(handle, { dataTransfer: makeDataTransfer() });

		// sec-tenor IS a top-level sibling of sec-alto → advertised.
		const sibling = q(container, 'section-group-sec-tenor') as HTMLElement;
		expect(sibling.querySelector('[aria-dropeffect="move"]')).not.toBeNull();

		// sec-sop1 is Soprano's CHILD → not a sibling of sec-alto, not a drop target.
		const foreign = q(container, 'section-group-sec-sop1') as HTMLElement;
		expect(foreign.getAttribute('aria-dropeffect')).not.toBe('move');
		expect(foreign.querySelector('[aria-dropeffect="move"]')).toBeNull();

		// …and the drop it refuses to advertise is a drop it also refuses to take.
		const target = q(container, 'section-header-sec-sop1') as HTMLElement;
		const dragover = new Event('dragover', { bubbles: true, cancelable: true });
		target.dispatchEvent(dragover);
		expect(dragover.defaultPrevented, 'a non-sibling header must not become a drop zone').toBe(
			false
		);
		await fireEvent.drop(target, { dataTransfer: makeDataTransfer() });
		expect(reorderMock).not.toHaveBeenCalled();
	});
});

// #152 RED — SUPERSEDES #99 review F5. F5 pinned role='img' EXPLICITLY
// conditioned on the handle being non-operable ("if the handle DOES become
// operable, this role='img' choice must be revisited" — the handle's own
// source comment). #152 makes it operable (Space/Enter grab, arrows move,
// Escape cancels — full contract in page.roster-ux-a11y.spec.ts section 5),
// so the promise flips: it IS a button now, and role='img' would hide an
// operable control from AT.
describe('#152 — the drag handle announces itself as a BUTTON (supersedes #99 F5)', () => {
	it("the handle is role='button' with an accessible name containing the section name — it is focusable and operable now, so 'img' would deny AT the control that exists", async () => {
		const container = await renderReady('admin');
		await collapse(container, 'sec-sop');
		const handle = q(container, 'section-drag-handle-sec-sop') as HTMLElement;

		expect(handle.getAttribute('role')).toBe('button');
		expect(handle.getAttribute('role')).not.toBe('img');
		expect(handle.getAttribute('aria-label')).toContain('Soprano');
		expect(handle.getAttribute('aria-hidden')).not.toBe('true');
	});
});

// ---------------------------------------------------------------------------
// 8 — #99 CODE-REVIEW FIXES, ROUND 2. Same discipline as section 7: every block
//     pins a defect the first round of review fixes shipped.
// ---------------------------------------------------------------------------
async function renderCollapsedAdmin(): Promise<HTMLElement> {
	const container = await renderReady('admin');
	for (const id of ['sec-sop', 'sec-alto', 'sec-tenor']) await collapse(container, id);
	return container;
}

describe('#99 review R2/F1 — the listbox is NAMED, and the trigger names what it controls', () => {
	it("the listbox carries an accessible name identifying the MEMBER — role='listbox' is Name From: author with a name REQUIRED, and a roster renders one picker per row", async () => {
		const container = await renderReady();
		await openPicker(container, 'm-ada');
		const listbox = listboxOf(container, 'm-ada');

		const label = listbox.getAttribute('aria-label');
		const labelledby = listbox.getAttribute('aria-labelledby');
		expect(label ?? labelledby, 'listbox must be named (aria-label or aria-labelledby)').toBeTruthy();
		if (label !== null) {
			expect(label, 'the name must say WHOSE sections this listbox edits').toContain('Ada Lovelace');
		} else {
			expect(listbox.ownerDocument.getElementById(labelledby!)).not.toBeNull();
		}
	});

	it("the trigger's aria-controls resolves to the listbox while open — and is ABSENT while closed, never a dangling IDREF (the #86 SeasonSummary ruling)", async () => {
		const container = await renderReady();
		const trigger = q(container, 'section-picker-trigger-m-ada') as HTMLElement;
		expect(trigger.getAttribute('aria-controls'), 'closed trigger must not dangle').toBeNull();

		await openPicker(container, 'm-ada');
		const controls = trigger.getAttribute('aria-controls');
		expect(controls, 'open trigger must name its popup').toBeTruthy();
		expect(trigger.ownerDocument.getElementById(controls!)).toBe(listboxOf(container, 'm-ada'));
	});

	it("with the create form showing, the trigger no longer advertises a listbox popup — the listbox is GONE, so aria-haspopup='listbox' described a widget that does not exist", async () => {
		const container = await renderReady();
		await openPicker(container, 'm-ada');
		const trigger = q(container, 'section-picker-trigger-m-ada') as HTMLElement;
		expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');

		await fireEvent.click(q(container, 'section-picker-new') as HTMLElement);
		expect(q(container, `section-picker-listbox-m-ada`), 'the listbox is replaced by the form').toBeNull();
		expect(trigger.getAttribute('aria-haspopup')).not.toBe('listbox');
		const controls = trigger.getAttribute('aria-controls');
		expect(controls, 'the trigger must point at the form it now pops up').toBeTruthy();
		expect(trigger.ownerDocument.getElementById(controls!)).toBe(q(container, 'section-create-form'));
	});
});

describe("#99 review R2/F4 — '+ New section…' is a BUTTON, not a fake option", () => {
	it("it carries no role='option'/aria-selected — inside a multi-selectable listbox that announced it as an unselected CHOICE, when activating it replaces the whole list with a form", async () => {
		const container = await renderReady();
		await openPicker(container, 'm-ada');
		const entry = q(container, 'section-picker-new') as HTMLElement;

		expect(entry.tagName).toBe('BUTTON');
		expect(entry.getAttribute('role')).toBeNull();
		expect(entry.getAttribute('aria-selected')).toBeNull();
		expect(listboxOf(container, 'm-ada').contains(entry), 'it must sit OUTSIDE the listbox').toBe(
			false
		);
	});
});

describe('#99 review R2/F2 — a failed reorder is SAID, not silently re-derived', () => {
	it("a rejected reorderSections surfaces role='alert' — the list snaps to the server's order, and without this nothing on screen says why", async () => {
		reorderMock.mockRejectedValue(new Error('403'));
		const container = await renderCollapsedAdmin();

		await dragAndDrop(container, 'sec-sop', 'sec-alto');

		await waitFor(() => {
			const error = q(container, 'section-reorder-error');
			expect(error, 'a failed reorder must render an error').not.toBeNull();
			expect(error!.getAttribute('role')).toBe('alert');
		});
	});

	it('a SUCCESSFUL reorder renders no error, and a retry clears a previous failure', async () => {
		reorderMock.mockRejectedValueOnce(new Error('403'));
		const container = await renderCollapsedAdmin();

		await dragAndDrop(container, 'sec-sop', 'sec-alto');
		await waitFor(() => {
			expect(q(container, 'section-reorder-error')).not.toBeNull();
		});

		await dragAndDrop(container, 'sec-sop', 'sec-alto');
		await waitFor(() => {
			expect(q(container, 'section-reorder-error'), 'a retry owns the error slot').toBeNull();
		});
	});
});

// #150 — the two focus-restoration tests that used to live here (button stays
// operable → refocus it; button lands on a boundary → fall back to the
// section toggle) tested `moveSection`'s own focus bookkeeping, which was
// deleted along with the ▲/▼ buttons. Drag/drop carries no equivalent focus
// hop (a mouse drag never had DOM focus to lose), so there is nothing left to
// pin here — the reorder-announcement coverage below still applies.
describe('#99 review R2/F3 — reorder outcomes are announced', () => {
	it('guard: the polite live region is present from FIRST render — a region mounted together with its own text is announced by nothing', async () => {
		const container = await renderReady();
		const status = q(container, 'roster-reorder-status') as HTMLElement;
		expect(status, 'the live region must exist before any reorder').not.toBeNull();
		expect(status.getAttribute('role')).toBe('status');
		expect(status.getAttribute('aria-live')).toBe('polite');
		expect(status.textContent?.trim()).toBe('');
	});

	it('a successful move announces the section BY NAME and its new position', async () => {
		const container = await renderCollapsedAdmin();

		await dragAndDrop(container, 'sec-sop', 'sec-alto');

		await waitFor(() => {
			const status = q(container, 'roster-reorder-status') as HTMLElement;
			expect(status.textContent).toContain('roster_section_moved');
			expect(status.textContent).toContain('Soprano');
			// Soprano moved from slot 1 to slot 2 of 3 top-level siblings.
			expect(status.textContent).toContain('2');
		});
	});
});

// ---------------------------------------------------------------------------
// 9 — #152 RED: keyboard reorder respects sibling boundaries. The full
//     grab/move/drop/cancel protocol is defined in page.roster-ux-a11y.spec.ts
//     section 5 (flat three-section fixture); THIS fixture has what that one
//     lacks — a sub-section (sec-sop1) and the Unassigned pseudo-group — so
//     the boundary rules live here: a keyboard move must stay inside its own
//     sibling group (same rule `dropOnto` enforces for pointer drops: a
//     cross-parent move is STRUCTURAL, not an order change) and must never
//     treat Unassigned as a landing slot (it is not a section entity).
// ---------------------------------------------------------------------------
describe('#152 — keyboard reorder respects sibling boundaries and the Unassigned pseudo-group', () => {
	/** Every section-group testid suffix in document order — nested groups
	 *  included, so a structural escape (a sub-section leaving its parent)
	 *  would show up as a changed sequence. */
	function groupOrder(container: HTMLElement): string[] {
		return Array.from(container.querySelectorAll('[data-testid^="section-group-"]')).map((el) =>
			el.getAttribute('data-testid')!.slice('section-group-'.length)
		);
	}

	/** Focus `id`'s handle and grab it with Space. */
	async function grab(container: HTMLElement, id: string): Promise<HTMLElement> {
		const handle = q(container, `section-drag-handle-${id}`) as HTMLElement;
		expect(handle, `drag handle for ${id}`).not.toBeNull();
		handle.focus();
		await fireEvent.keyDown(handle, { key: ' ' });
		expect(handle.getAttribute('aria-grabbed'), `Space must grab ${id}`).toBe('true');
		return handle;
	}

	it('ArrowDown on the grabbed LAST real section is a no-op — the Unassigned pseudo-group is not a landing slot, so there is nowhere further down', async () => {
		const container = await renderCollapsedAdmin();
		// All roots collapsed: Soprano, Alto, Tenor, then Unassigned.
		expect(groupOrder(container)).toEqual(['sec-sop', 'sec-alto', 'sec-tenor', 'unassigned']);

		const handle = await grab(container, 'sec-tenor');
		await fireEvent.keyDown(handle, { key: 'ArrowDown' });

		expect(groupOrder(container), 'Tenor must not move below/into Unassigned').toEqual([
			'sec-sop',
			'sec-alto',
			'sec-tenor',
			'unassigned'
		]);
		expect(handle.getAttribute('aria-grabbed'), 'the grab survives the clamped press').toBe('true');
		await fireEvent.keyDown(handle, { key: 'Escape' });
	});

	it('a grabbed SUB-SECTION with no siblings goes nowhere — ArrowUp/ArrowDown never escape its parent (a cross-parent move is structural, not an order change), and dropping in place writes nothing', async () => {
		const container = await renderReady('admin');
		// Soprano stays EXPANDED so Soprano 1 renders; Soprano 1 itself collapses
		// so it carries a handle (canReorder = admin AND collapsed).
		await collapse(container, 'sec-sop1');
		const before = groupOrder(container);
		expect(before).toContain('sec-sop1');

		const handle = await grab(container, 'sec-sop1');
		await fireEvent.keyDown(handle, { key: 'ArrowUp' });
		expect(groupOrder(container), 'ArrowUp on an only child must move nothing').toEqual(before);
		await fireEvent.keyDown(handle, { key: 'ArrowDown' });
		expect(groupOrder(container), 'ArrowDown on an only child must move nothing').toEqual(before);

		await fireEvent.keyDown(handle, { key: ' ' });
		expect(handle.getAttribute('aria-grabbed')).toBe('false');
		expect(reorderMock, 'a drop that moved nothing must not write').not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Palestrina* — section 7, #99 code-review fix regression cover)
// (*MVOX:Palestrina* — section 8, #99 code-review fix regression cover, round 2)
// (*MVOX:Tallis* — section 9, #152 keyboard-reorder sibling-boundary RED)
