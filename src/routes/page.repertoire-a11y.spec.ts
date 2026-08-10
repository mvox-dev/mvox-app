// @vitest-environment happy-dom
//
// #93 TR.5 RED — i18n + a11y coverage for all Repertoire 1.0 surfaces:
//   - RepertoireElement (agenda Works element: collapse/expand, functional
//     links, status badge, management controls for both surfaces)
//   - the library browse tree's repertoire status badges (TR.4)
//
// Follows the #86/TA.5 precedent (page.attendance-a11y.spec.ts): source-scan
// tests for i18n hygiene + rendered-DOM tests for aria semantics. These are
// RED — they assert a11y the TR.2–TR.4 components do not yet carry:
//   - the collapsed Works toggle dangles its aria-controls IDREF (the expanded
//     region only renders when expanded — the exact defect the #86 pass ruled
//     against on SeasonSummary);
//   - per-row functional controls (PDF, Borrow) and management buttons
//     (remove, move, pin) have no aria-label naming their work — five rows of
//     "Remove" are indistinguishable to a screen reader;
//   - the management selects (status, pin edition, add work, add to
//     programme) have no accessible name at all (a placeholder <option> is
//     not a select's name);
//   - the two "Add" buttons share one accessible name;
//   - the library repertoire badge announces a bare "Active" with nothing
//     saying repertoire (adjacent to availability counts and lending copy).
// A set of guard tests pins down what already exists (aria-expanded,
// ol/li programme semantics, real <a> tags, the aria-hidden badge dot,
// locale key parity) so GREEN can't regress it.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Paraglide mock: real English strings for the keys that exist today, plus a
// Proxy fallback so aria-label keys ADDED by the GREEN pass resolve without
// this file needing to know their names — the fallback renders
// "<key> <param values...>", so assertions like "the label contains the work
// name" hold for any key shape as long as the name is passed as a param.
vi.mock('$lib/paraglide/messages.js', () => {
	const known: Record<string, (p?: Record<string, unknown>) => string> = {
		repertoire_no_edition: () => 'No pinned edition',
		repertoire_pdf_link: () => 'PDF',
		repertoire_borrow_link: () => 'Borrow',
		repertoire_status_learning: () => 'Learning',
		repertoire_status_active: () => 'Active',
		repertoire_status_retired: () => 'Retired',
		repertoire_status_dropped: () => 'Dropped',
		repertoire_pin_edition_label: () => 'Pin edition',
		repertoire_pin_edition_button: () => 'Pin',
		repertoire_remove: () => 'Remove',
		repertoire_move_up: () => 'Move up',
		repertoire_move_down: () => 'Move down',
		repertoire_add_work_label: () => 'Add a work',
		repertoire_add_work_button: () => 'Add',
		repertoire_add_programme_label: () => 'Add to programme',
		repertoire_add_programme_button: () => 'Add',
		repertoire_inactive_count: (p) => `+${p?.count} inactive`,
		// The badge screen-reader label GREEN is expected to add — named here so
		// the "contains Repertoire" assertions read against realistic copy.
		repertoire_badge_aria_label: (p?: Record<string, unknown>) => `Repertoire: ${p?.status}`
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
// Library page seams (for the TR.4 badge tests) — same mock set as
// page.library-repertoire-badges.spec.ts. Harmless for the RepertoireElement
// unit renders (it imports none of these modules).
// ───────────────────────────────────────────────────────────────────────────
const {
	listWorksMock,
	listEditionsMock,
	listCopiesMock,
	listAllEditionsMock,
	listAllCopiesMock,
	listLendingsMock,
	resolveBorrowerNamesMock,
	resolveCopyNamesMock
} = vi.hoisted(() => ({
	listWorksMock: vi.fn(),
	listEditionsMock: vi.fn(),
	listCopiesMock: vi.fn(),
	listAllEditionsMock: vi.fn(),
	listAllCopiesMock: vi.fn(),
	listLendingsMock: vi.fn(),
	resolveBorrowerNamesMock: vi.fn(),
	resolveCopyNamesMock: vi.fn()
}));
vi.mock('$lib/library/libraryData', async () => {
	const actual = await vi.importActual<typeof import('$lib/library/libraryData')>('$lib/library/libraryData');
	return {
		...actual,
		listWorks: listWorksMock,
		listEditions: listEditionsMock,
		listCopies: listCopiesMock,
		listAllEditions: listAllEditionsMock,
		listAllCopies: listAllCopiesMock,
		listLendings: listLendingsMock,
		resolveBorrowerNames: resolveBorrowerNamesMock,
		resolveCopyNames: resolveCopyNamesMock
	};
});
vi.mock('$lib/paraglide/runtime', () => ({ getLocale: () => 'en' }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));

const { listActiveMembersMock } = vi.hoisted(() => ({ listActiveMembersMock: vi.fn() }));
vi.mock('$lib/roster/rosterData', () => ({ listActiveMembers: listActiveMembersMock }));

const { resolveLibrarianMock } = vi.hoisted(() => ({ resolveLibrarianMock: vi.fn() }));
vi.mock('$lib/library/librarianStore', async () => {
	const actual = await vi.importActual<typeof import('$lib/library/librarianStore')>('$lib/library/librarianStore');
	return {
		...actual,
		resolveLibrarian: resolveLibrarianMock
	};
});

const { findMyMemberIdMock } = vi.hoisted(() => ({ findMyMemberIdMock: vi.fn() }));
vi.mock('$lib/rsvp/rsvpData', () => ({ findMyMemberId: findMyMemberIdMock }));

vi.mock('$lib/library/lendingActions', () => ({
	createLending: vi.fn(),
	returnLending: vi.fn(),
	bulkCheckout: vi.fn()
}));

const { listSeasonsMock } = vi.hoisted(() => ({ listSeasonsMock: vi.fn() }));
vi.mock('$lib/seasons/entuSeasons', async () => {
	const actual = await vi.importActual<typeof import('$lib/seasons/entuSeasons')>('$lib/seasons/entuSeasons');
	return {
		...actual,
		listSeasons: listSeasonsMock
	};
});
const { listRepertoireItemsMock } = vi.hoisted(() => ({ listRepertoireItemsMock: vi.fn() }));
vi.mock('$lib/repertoire/repertoireData', async () => {
	const actual = await vi.importActual<typeof import('$lib/repertoire/repertoireData')>('$lib/repertoire/repertoireData');
	return {
		...actual,
		listRepertoireItems: listRepertoireItemsMock
	};
});

import type { ComponentProps } from 'svelte';
import RepertoireElement from '$lib/components/agenda/RepertoireElement.svelte';
import type { WorkRow } from '$lib/repertoire/types';
import LibraryPage from './library/+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, selectedCollectiveDbStore, urlCollectiveDbStore } from '$lib/collectives/store';

afterEach(() => {
	cleanup();
	listWorksMock.mockReset();
	listEditionsMock.mockReset();
	listCopiesMock.mockReset();
	listAllEditionsMock.mockReset();
	listAllCopiesMock.mockReset();
	listLendingsMock.mockReset();
	resolveBorrowerNamesMock.mockReset();
	resolveCopyNamesMock.mockReset();
	resolveLibrarianMock.mockReset();
	findMyMemberIdMock.mockReset();
	listActiveMembersMock.mockReset();
	listSeasonsMock.mockReset();
	listRepertoireItemsMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function workRow(id: string, overrides: Partial<WorkRow> = {}): WorkRow {
	return {
		id,
		kind: 'repertoire',
		workId: `work-${id}`,
		editionId: '',
		workName: `Work ${id}`,
		composer: 'A Composer',
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

/** Two named repertoire rows with every functional link present — the
 *  distinctness assertions need two DIFFERENT works. */
const twoLinkedRows: WorkRow[] = [
	workRow('r1', {
		workName: 'Spem in alium',
		fileId: 'file-1',
		canBorrow: true,
		externalLinks: ['https://www.youtube.com/watch?v=abc']
	}),
	workRow('r2', {
		workName: 'Ave verum corpus',
		fileId: 'file-2',
		canBorrow: true,
		externalLinks: ['https://cpdl.org/wiki/AveVerum']
	})
];

/** A programmed concert: every row carries an ordinal (deliberately given out
 *  of order — render order must follow the ordinal, not the array). */
const programmeRows: WorkRow[] = [
	workRow('p2', { kind: 'program', workName: 'Second piece', status: null, ordinal: 1 }),
	workRow('p1', { kind: 'program', workName: 'Opening piece', status: null, ordinal: 0 }),
	workRow('p3', { kind: 'program', workName: 'Closing piece', status: null, ordinal: 2 })
];

async function renderElementExpanded(props: ComponentProps<typeof RepertoireElement>) {
	const { container } = render(RepertoireElement, { props });
	const line = container.querySelector('[data-testid="works-line"]') as HTMLElement;
	expect(line, 'works-line toggle must render for non-empty rows').not.toBeNull();
	await fireEvent.click(line);
	return container;
}

// ---------------------------------------------------------------------------
// Source-scan helpers (i18n hygiene) — same strategy as the #75/#86 passes:
// strip Svelte expressions + HTML comments from the template, then any
// remaining bare text node with letters in it is a hardcoded user-facing string.
// ---------------------------------------------------------------------------
function readSource(relPath: string): string {
	return readFileSync(resolve(process.cwd(), relPath), 'utf-8');
}

function bareTextNodes(source: string): string[] {
	// Strip ALL script blocks (RepertoireElement carries BOTH a <script module>
	// and an instance <script> — the #86 helper's "everything after the first
	// </script>" would scan the instance script as template).
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
		if (/^[▸▾·×♫\s\-–—|()]+$/.test(text)) continue;
		if (/^(&[a-zA-Z]+;|&#\d+;)+$/.test(text)) continue;
		if (!/[a-zA-Z]/.test(text)) continue;
		nodes.push(text);
	}
	return nodes;
}

// ---------------------------------------------------------------------------
// 1 — i18n: every repertoire surface renders via Paraglide keys only
// ---------------------------------------------------------------------------
describe('#93 — i18n: no hardcoded user-facing strings on repertoire surfaces', () => {
	it('RepertoireElement.svelte contains no bare text nodes outside m.* calls', () => {
		expect(bareTextNodes(readSource('src/lib/components/agenda/RepertoireElement.svelte'))).toEqual([]);
	});

	it('RepertoireElement.svelte has no hardcoded aria-label string literals (labels must come from m.*)', () => {
		const source = readSource('src/lib/components/agenda/RepertoireElement.svelte');
		const hardcoded = source.match(/aria-label="[^"]*[a-zA-Z][^"]*"/g) ?? [];
		expect(hardcoded).toEqual([]);
	});

	it('the library page has no hardcoded aria-label string literals on its repertoire badge', () => {
		const source = readSource('src/routes/library/+page.svelte');
		const hardcoded = source.match(/aria-label="[^"]*[a-zA-Z][^"]*"/g) ?? [];
		expect(hardcoded).toEqual([]);
	});

	it('every repertoire_* key in en.json exists in et, lv and uk', () => {
		const en = JSON.parse(readSource('messages/en.json')) as Record<string, string>;
		const repertoireKeys = Object.keys(en).filter((k) => k.startsWith('repertoire_'));
		expect(repertoireKeys.length).toBeGreaterThan(0);
		for (const locale of ['et', 'lv', 'uk']) {
			const messages = JSON.parse(readSource(`messages/${locale}.json`)) as Record<string, string>;
			const missing = repertoireKeys.filter((k) => !(k in messages));
			expect(missing, `${locale}.json is missing repertoire keys`).toEqual([]);
		}
	});

	// WCAG 2.5.3 Label in Name (Level A): where a control carries visible text,
	// its accessible name must CONTAIN that text as a contiguous string —
	// otherwise a speech-input user saying "click Move up" gets no match. This
	// is a translation-shape rule, not a markup one, so it is checked against
	// the message files in every locale: an aria-label key must be the visible
	// key's string plus context, never a reworded or reordered variant.
	it('every aria-label whose control has visible text CONTAINS that visible text verbatim, in all four locales (WCAG 2.5.3)', () => {
		// An aria-label key names its visible sibling by convention: strip
		// `_aria_label` and the base (or base + `_button`) is the visible key.
		// Keys with no such sibling (selects, the badge, the domain-texted
		// external links) label controls with no visible text of their own —
		// nothing to contain, so they're skipped here.
		const en = JSON.parse(readSource('messages/en.json')) as Record<string, string>;
		const pairs = Object.keys(en)
			.filter((k) => k.startsWith('repertoire_') && k.endsWith('_aria_label'))
			.map((ariaKey) => {
				const base = ariaKey.slice(0, -'_aria_label'.length);
				const visibleKey = [base, `${base}_button`].find((c) => c in en);
				return visibleKey ? { ariaKey, visibleKey } : null;
			})
			.filter((p): p is { ariaKey: string; visibleKey: string } => p !== null);
		expect(pairs.length, 'no visible-text/aria-label pairs found — the scan is vacuous').toBeGreaterThan(0);

		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const messages = JSON.parse(readSource(`messages/${locale}.json`)) as Record<string, string>;
			const violations = pairs
				.filter(({ ariaKey, visibleKey }) => !messages[ariaKey]?.includes(messages[visibleKey]))
				.map(
					({ ariaKey, visibleKey }) =>
						`${locale}: "${messages[ariaKey]}" (${ariaKey}) does not contain "${messages[visibleKey]}" (${visibleKey})`
				);
			expect(violations, `${locale}.json breaks Label in Name`).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// 2 — Works element collapse/expand: aria-expanded + non-dangling aria-controls
// ---------------------------------------------------------------------------
describe('#93 — a11y: Works element disclosure semantics', () => {
	it('guard: the collapsed toggle reports aria-expanded="false", the expanded one "true" with aria-controls resolving to the region', async () => {
		const { container } = render(RepertoireElement, { props: { rows: twoLinkedRows } });
		const line = container.querySelector('[data-testid="works-line"]') as HTMLElement;
		expect(line.tagName).toBe('BUTTON');
		expect(line.getAttribute('aria-expanded')).toBe('false');

		await fireEvent.click(line);
		expect(line.getAttribute('aria-expanded')).toBe('true');
		const controls = line.getAttribute('aria-controls');
		expect(controls, 'expanded toggle must reference its region via aria-controls').toBeTruthy();
		const region = line.ownerDocument.getElementById(controls!);
		expect(region).not.toBeNull();
		expect(region!.getAttribute('data-testid')).toBe('works-expanded');
	});

	it('the COLLAPSED toggle must not dangle its aria-controls IDREF — the expanded region only renders when expanded, so either drop the attribute while collapsed or keep the region in the DOM (the SeasonSummary ruling from #86)', () => {
		const { container } = render(RepertoireElement, { props: { rows: twoLinkedRows } });
		const line = container.querySelector('[data-testid="works-line"]') as HTMLElement;
		expect(line.getAttribute('aria-expanded')).toBe('false');
		const controls = line.getAttribute('aria-controls');
		if (controls !== null) {
			expect(
				line.ownerDocument.getElementById(controls),
				`aria-controls="${controls}" references an id that is not in the document while collapsed`
			).not.toBeNull();
		}
	});

	it('guard: the ♫ glyph on the collapsed line is aria-hidden (decorative)', () => {
		const { container } = render(RepertoireElement, { props: { rows: twoLinkedRows } });
		const line = container.querySelector('[data-testid="works-line"]') as HTMLElement;
		const glyph = Array.from(line.querySelectorAll('span')).find((s) => s.textContent?.includes('♫'));
		expect(glyph, 'the ♫ glyph span must exist').toBeTruthy();
		expect(glyph!.getAttribute('aria-hidden')).toBe('true');
	});
});

// ---------------------------------------------------------------------------
// 3 — functional links: real <a> tags, descriptive accessible names
// ---------------------------------------------------------------------------
describe('#93 — a11y: functional links are proper anchors with descriptive names', () => {
	it('guard: Borrow is a real <a href="/library"> with visible text; external links are <a href> with domain text and rel="noopener noreferrer"', async () => {
		const container = await renderElementExpanded({ rows: twoLinkedRows });

		const borrows = container.querySelectorAll('[data-testid="work-link-borrow"]');
		expect(borrows.length).toBe(2);
		borrows.forEach((borrow) => {
			expect(borrow.tagName).toBe('A');
			expect(borrow.getAttribute('href')).toBe('/library');
			expect((borrow.textContent ?? '').trim()).not.toBe('');
		});

		const externals = container.querySelectorAll('[data-testid="work-link-external"]');
		expect(externals.length).toBe(2);
		externals.forEach((link) => {
			expect(link.tagName).toBe('A');
			expect(link.getAttribute('href')).toMatch(/^https?:\/\//);
			expect((link.textContent ?? '').trim()).not.toBe('');
			expect(link.getAttribute('rel') ?? '').toContain('noopener');
		});
	});

	it('guard: the PDF control is a native <button type="button"> — the 60s signed url forces click-time resolution, and a button is the honest element for that', async () => {
		const container = await renderElementExpanded({ rows: twoLinkedRows });
		const pdfs = container.querySelectorAll('[data-testid="work-link-pdf"]');
		expect(pdfs.length).toBe(2);
		pdfs.forEach((pdf) => {
			expect(pdf.tagName).toBe('BUTTON');
			expect((pdf as HTMLButtonElement).type).toBe('button');
		});
	});

	it("every PDF button's aria-label names its work — two rows both announcing 'PDF' don't say WHOSE score opens", async () => {
		const container = await renderElementExpanded({ rows: twoLinkedRows });
		const labels = Array.from(container.querySelectorAll('[data-testid="work-link-pdf"]')).map((b) =>
			b.getAttribute('aria-label')
		);
		labels.forEach((label) => expect(label, 'PDF button is missing aria-label').toBeTruthy());
		expect(labels[0]).toContain('Spem in alium');
		expect(labels[1]).toContain('Ave verum corpus');
		expect(new Set(labels).size).toBe(2);
	});

	it("every Borrow link's aria-label names its work — 'Borrow' repeated per row fails WCAG 2.4.4 (link purpose)", async () => {
		const container = await renderElementExpanded({ rows: twoLinkedRows });
		const labels = Array.from(container.querySelectorAll('[data-testid="work-link-borrow"]')).map((a) =>
			a.getAttribute('aria-label')
		);
		labels.forEach((label) => expect(label, 'Borrow link is missing aria-label').toBeTruthy());
		expect(labels[0]).toContain('Spem in alium');
		expect(labels[1]).toContain('Ave verum corpus');
		expect(new Set(labels).size).toBe(2);
	});

	it("every external link's aria-label names its work as well as its domain — a link list of three identical 'youtube.com' entries doesn't say which piece each belongs to (WCAG 2.4.4)", async () => {
		const container = await renderElementExpanded({ rows: twoLinkedRows });
		const links = Array.from(container.querySelectorAll('[data-testid="work-link-external"]'));
		expect(links.length).toBe(2);
		const labels = links.map((a) => a.getAttribute('aria-label'));
		labels.forEach((label) => expect(label, 'external link is missing aria-label').toBeTruthy());
		// The visible text stays the bare domain, so the label must carry it too
		// (WCAG 2.5.3) on top of the work name that makes the row distinct.
		expect(labels[0]).toContain('youtube.com');
		expect(labels[0]).toContain('Spem in alium');
		expect(labels[1]).toContain('cpdl.org');
		expect(labels[1]).toContain('Ave verum corpus');
		expect(new Set(labels).size).toBe(2);
		links.forEach((link) => {
			const visible = (link.textContent ?? '').trim();
			expect(link.getAttribute('aria-label')).toContain(visible);
		});
	});
});

// ---------------------------------------------------------------------------
// 4 — status control: accessible name naming the work (the "or equivalent"
//     for a native <select>, whose selected option already announces state)
// ---------------------------------------------------------------------------
describe('#93 — a11y: the status control has an accessible name per work', () => {
	const editorProps = {
		rows: twoLinkedRows,
		manageRights: 'editor' as const,
		context: 'repertoire' as const
	};

	it('guard: the status select reflects the current status as its value', async () => {
		const container = await renderElementExpanded({
			...editorProps,
			rows: [workRow('r1', { workName: 'Spem in alium', status: 'learning' })]
		});
		const select = container.querySelector('[data-testid="work-manage-status-select"]') as HTMLSelectElement;
		expect(select).not.toBeNull();
		expect(select.value).toBe('learning');
	});

	it("every status select has an aria-label naming its work — a bare select with a list of statuses doesn't say WHICH work's status it sets", async () => {
		const container = await renderElementExpanded(editorProps);
		const labels = Array.from(
			container.querySelectorAll('[data-testid="work-manage-status-select"]')
		).map((s) => s.getAttribute('aria-label'));
		expect(labels.length).toBe(2);
		labels.forEach((label) => expect(label, 'status select is missing aria-label').toBeTruthy());
		expect(labels[0]).toContain('Spem in alium');
		expect(labels[1]).toContain('Ave verum corpus');
		expect(new Set(labels).size).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// 5 — concert programme: ol/li semantics in ordinal order
// ---------------------------------------------------------------------------
describe('#93 — a11y: concert programme is a numbered list', () => {
	it('guard: all-ordinal rows render as <ol> with one <li> per work, ordered by ordinal', async () => {
		const container = await renderElementExpanded({ rows: programmeRows });
		const region = container.querySelector('[data-testid="works-expanded"]') as HTMLElement;
		const ol = region.querySelector('ol');
		expect(ol, 'programmed rows must render inside an <ol>').not.toBeNull();
		const items = ol!.querySelectorAll('[data-testid="work-row"]');
		expect(items.length).toBe(3);
		items.forEach((item) => expect(item.tagName).toBe('LI'));
		const names = Array.from(items).map(
			(item) => item.querySelector('[data-testid="work-name"]')!.textContent
		);
		expect(names).toEqual(['Opening piece', 'Second piece', 'Closing piece']);
	});

	it('guard: no display utility on the <li> — `display: flex` would replace `display: list-item` and silently kill the 1./2./3. markers', async () => {
		const container = await renderElementExpanded({ rows: programmeRows });
		const items = container.querySelectorAll('ol [data-testid="work-row"]');
		expect(items.length).toBe(3);
		items.forEach((item) => {
			const classes = Array.from(item.classList);
			// `flex`/`grid`/`inline-*`/`block`/`table`/`contents`/`hidden` all compute to a
			// display other than list-item, which suppresses ::marker generation.
			const displayUtilities = classes.filter((c) =>
				/^(flex|inline-flex|grid|inline-grid|block|inline|inline-block|table|contents|hidden|flow-root)$/.test(
					c
				)
			);
			expect(
				displayUtilities,
				`<li> carries display utility ${displayUtilities.join(', ')} — list markers will not render`
			).toEqual([]);
		});
	});

	it('guard: season-repertoire fallback rows (no ordinals) render as an unordered list — a repertoire IS a list of works, it just has no concert position to number', async () => {
		const container = await renderElementExpanded({ rows: twoLinkedRows });
		const region = container.querySelector('[data-testid="works-expanded"]') as HTMLElement;
		expect(region.querySelector('ol'), 'unordered repertoire must not be numbered').toBeNull();
		expect(region.querySelector('ul'), 'repertoire rows need list semantics').not.toBeNull();
		const items = region.querySelectorAll('[data-testid="work-row"]');
		expect(items.length).toBe(2);
		items.forEach((item) => expect(item.tagName).toBe('LI'));
	});
});

// ---------------------------------------------------------------------------
// 6 — management buttons: descriptive aria-labels naming the work
// ---------------------------------------------------------------------------
describe('#93 — a11y: management controls identify their work', () => {
	it("every Remove button's aria-label names its work — a column of 'Remove' buttons is indistinguishable to a screen reader", async () => {
		const container = await renderElementExpanded({
			rows: twoLinkedRows,
			manageRights: 'editor',
			context: 'repertoire'
		});
		const labels = Array.from(
			container.querySelectorAll('[data-testid="work-manage-remove"]')
		).map((b) => b.getAttribute('aria-label'));
		expect(labels.length).toBe(2);
		labels.forEach((label) => expect(label, 'Remove button is missing aria-label').toBeTruthy());
		expect(labels[0]).toContain('Spem in alium');
		expect(labels[1]).toContain('Ave verum corpus');
		expect(new Set(labels).size).toBe(2);
	});

	it("move up/down buttons carry aria-labels naming the work AND the direction — 'Move up' x3 rows doesn't say which piece moves", async () => {
		const container = await renderElementExpanded({
			rows: programmeRows,
			manageRights: 'editor',
			context: 'programme'
		});
		const ups = Array.from(container.querySelectorAll('[data-testid="work-manage-move-up"]'));
		const downs = Array.from(container.querySelectorAll('[data-testid="work-manage-move-down"]'));
		expect(ups.length).toBe(3);
		expect(downs.length).toBe(3);
		const upLabels = ups.map((b) => b.getAttribute('aria-label'));
		const downLabels = downs.map((b) => b.getAttribute('aria-label'));
		[...upLabels, ...downLabels].forEach((label) =>
			expect(label, 'move button is missing aria-label').toBeTruthy()
		);
		// Names the work (render order is ordinal order: Opening, Second, Closing).
		expect(upLabels[0]).toContain('Opening piece');
		expect(downLabels[2]).toContain('Closing piece');
		// A row's up and down labels differ (direction is part of the name).
		expect(upLabels[0]).not.toBe(downLabels[0]);
		// Distinct per row — the label must key off the work, not be a shared constant.
		expect(new Set(upLabels).size).toBe(3);
	});

	it("the Pin button's aria-label names its work", async () => {
		const container = await renderElementExpanded({
			rows: twoLinkedRows,
			manageRights: 'editor',
			context: 'repertoire',
			editionOptionsByRowId: {
				r1: [{ id: 'ed-1', label: 'Urtext — Bärenreiter' }],
				r2: [{ id: 'ed-2', label: 'CPDL scan' }]
			}
		});
		const labels = Array.from(
			container.querySelectorAll('[data-testid="work-manage-pin-edition-button"]')
		).map((b) => b.getAttribute('aria-label'));
		expect(labels.length).toBe(2);
		labels.forEach((label) => expect(label, 'Pin button is missing aria-label').toBeTruthy());
		expect(labels[0]).toContain('Spem in alium');
		expect(labels[1]).toContain('Ave verum corpus');
	});

	it('every management select has an accessible name (aria-label) — a placeholder <option> is a value, not the name of the control', async () => {
		const container = await renderElementExpanded({
			rows: twoLinkedRows,
			seasonRights: 'editor',
			eventRights: 'editor',
			context: 'repertoire',
			pickableWorksList: [{ id: 'w-new', name: 'A new work', composer: '' }],
			pickableEditions: [{ id: 'ed-new', label: 'New work — Urtext' }],
			editionOptionsByRowId: { r1: [{ id: 'ed-1', label: 'Urtext' }] }
		});
		for (const testid of [
			'work-manage-status-select',
			'work-manage-pin-edition-select',
			'work-manage-add-work-select',
			'work-manage-add-programme-select'
		]) {
			const selects = container.querySelectorAll(`[data-testid="${testid}"]`);
			expect(selects.length, `${testid} must render`).toBeGreaterThan(0);
			selects.forEach((select) => {
				expect(select.getAttribute('aria-label'), `${testid} is missing aria-label`).toBeTruthy();
			});
		}
	});

	it("the two Add buttons have distinct accessible names — both surfaces can render together and two bare 'Add' buttons are indistinguishable", () => {
		// Empty rows + editor rights on BOTH surfaces: the works-manage-empty
		// branch renders both Add controls side by side.
		const { container } = render(RepertoireElement, {
			props: {
				rows: [],
				seasonRights: 'editor',
				eventRights: 'editor',
				context: 'repertoire',
				pickableWorksList: [{ id: 'w-new', name: 'A new work', composer: '' }],
				pickableEditions: [{ id: 'ed-new', label: 'New work — Urtext' }]
			}
		});
		const addWork = container.querySelector('[data-testid="work-manage-add-work-button"]') as HTMLElement;
		const addProgramme = container.querySelector(
			'[data-testid="work-manage-add-programme-button"]'
		) as HTMLElement;
		expect(addWork).not.toBeNull();
		expect(addProgramme).not.toBeNull();
		const nameOf = (el: HTMLElement) => el.getAttribute('aria-label') ?? (el.textContent ?? '').trim();
		expect(nameOf(addWork)).not.toBe(nameOf(addProgramme));
	});
});

// ---------------------------------------------------------------------------
// 7 — library browse tree badges: screen-reader text with repertoire context
// ---------------------------------------------------------------------------
describe('#93 — a11y: library repertoire badges are readable without color', () => {
	const SEASONS = [
		{
			id: 'season-current',
			name: '2025/26',
			startDate: '2025-09-01',
			endDate: '2026-08-31',
			conductors: [],
			owners: [],
			editors: []
		}
	];
	const WORKS = [
		{ id: 'work-active', name: 'Spem in alium', composer: 'Thomas Tallis' },
		{ id: 'work-learning', name: 'Mass in B minor', composer: 'J.S. Bach' }
	];
	const REPERTOIRE_ITEMS = [
		{ id: 'rep-1', workId: 'work-active', editionId: '', status: 'active', name: 'Spem in alium' },
		{ id: 'rep-2', workId: 'work-learning', editionId: '', status: 'learning', name: 'Mass in B minor' }
	];

	async function renderLibraryWithBadges() {
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
		resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
		findMyMemberIdMock.mockResolvedValue(null);
		resolveCopyNamesMock.mockResolvedValue(new Map());
		listAllEditionsMock.mockResolvedValue([]);
		listAllCopiesMock.mockResolvedValue([]);
		listActiveMembersMock.mockResolvedValue([]);
		listWorksMock.mockResolvedValue(WORKS);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		listSeasonsMock.mockResolvedValue(SEASONS);
		listRepertoireItemsMock.mockResolvedValue(REPERTOIRE_ITEMS);

		const { container } = render(LibraryPage);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="repertoire-badge-work-active"]')).not.toBeNull();
		});
		return container;
	}

	it('guard: the badge color dot is aria-hidden and a visible text label exists beside it', async () => {
		const container = await renderLibraryWithBadges();
		const badge = container.querySelector('[data-testid="repertoire-badge-work-active"]') as HTMLElement;
		const dot = badge.querySelector('[aria-hidden="true"]');
		expect(dot, 'badge dot must be aria-hidden').not.toBeNull();
		expect((badge.textContent ?? '').trim()).not.toBe('');
	});

	it("the badge's screen-reader text says REPERTOIRE, not a bare status — 'Active' alone, adjacent to availability counts and lending copy, doesn't say active in WHAT", async () => {
		const container = await renderLibraryWithBadges();

		const activeBadge = container.querySelector(
			'[data-testid="repertoire-badge-work-active"]'
		) as HTMLElement;
		const activeLabel = activeBadge.getAttribute('aria-label');
		expect(activeLabel, 'repertoire badge must have aria-label').toBeTruthy();
		expect(activeLabel).toMatch(/repertoire/i);
		expect(activeLabel).toContain('Active');

		const learningBadge = container.querySelector(
			'[data-testid="repertoire-badge-work-learning"]'
		) as HTMLElement;
		const learningLabel = learningBadge.getAttribute('aria-label');
		expect(learningLabel, 'repertoire badge must have aria-label').toBeTruthy();
		expect(learningLabel).toMatch(/repertoire/i);
		expect(learningLabel).toContain('Learning');
	});

	// Same rule as the RepertoireElement toggle above (the #86 SeasonSummary
	// ruling), enforced on the OTHER surface this slice touches: the badge
	// renders inside these very list items, so the browse tree's disclosure
	// toggles are in scope for #93 too.
	it('the library browse-tree toggles must not dangle their aria-controls IDREFs while collapsed — the regions they reference only render when expanded', async () => {
		const container = await renderLibraryWithBadges();
		listEditionsMock.mockResolvedValue([]);

		const toggles = Array.from(
			container.querySelectorAll('[data-testid^="library-work-toggle-"]')
		) as HTMLElement[];
		expect(toggles.length).toBe(WORKS.length);

		toggles.forEach((toggle) => {
			expect(toggle.getAttribute('aria-expanded')).toBe('false');
			const controls = toggle.getAttribute('aria-controls');
			if (controls !== null) {
				expect(
					toggle.ownerDocument.getElementById(controls),
					`aria-controls="${controls}" references an id that is not in the document while collapsed`
				).not.toBeNull();
			}
		});

		// …and once expanded the relationship must actually be there.
		await fireEvent.click(toggles[0]);
		await waitFor(() => {
			expect(toggles[0].getAttribute('aria-expanded')).toBe('true');
		});
		const expandedControls = toggles[0].getAttribute('aria-controls');
		expect(expandedControls, 'expanded toggle must reference its region via aria-controls').toBeTruthy();
		expect(toggles[0].ownerDocument.getElementById(expandedControls!)).not.toBeNull();
	});
});

// (*MVOX:Tallis*)
