// @vitest-environment happy-dom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RepertoireElement, { ADD_WORK_KEY } from './RepertoireElement.svelte';
import type { WorkRow } from '$lib/repertoire/types';

// #90 TR.2 RED — the collapsed/expanded "Works" element on an agenda event row.
// Prop-driven and fetch-free (same unit-level seam as AgendaList/RsvpControl:
// the page resolves data, the component renders it). The row shape is the
// page-resolved view model — ONE definition, imported from
// $lib/repertoire/types (it is shared with AgendaList and its producer
// workRows.ts; a local copy here would let the contract drift silently).
//
// The PDF is NOT an href: Entu's signed S3 url is valid for 60 seconds
// (entu-www src/api/files/index.md), so it cannot be resolved at agenda load
// and parked in an anchor. The row carries the file PROPERTY id and the
// component calls `onpdfclick(fileId)` so the page can sign it at click time.
//
// Pinned testids: works-line (collapsed, tappable), works-expanded,
// work-row, work-status-badge, work-edition, work-no-edition, work-notes,
// work-link-pdf, work-link-borrow, work-link-external.

vi.mock('$lib/paraglide/messages.js', () => ({
	// Proxy mock: any message key resolves to a `[key]` stub, so GREEN may pick
	// whatever i18n keys it needs without editing this spec. Assertions below
	// pin structure (testids, hrefs, domains), never translated copy.
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get: (_target, key) => () => `[${String(key)}]`
	})
}));

afterEach(cleanup);

let rowSeq = 0;
function row(overrides: Partial<WorkRow> = {}): WorkRow {
	return {
		id: `ri-${++rowSeq}`,
		// #91 — provenance defaults to the season repertoire (the read-only specs
		// above all describe repertoire rows); programme fixtures override it.
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

const twoRows: WorkRow[] = [
	row(),
	row({ workName: 'Mass in B minor', composer: 'J. S. Bach', status: 'learning', editionName: 'Bärenreiter BA 5103' })
];

function text(el: Element | null): string {
	return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

// ── Collapsed line (#90 AC-1) ───────────────────────────────────────────────

describe('RepertoireElement — collapsed Works line', () => {
	it("shows work names joined by ' · ', preceded by ♫", () => {
		const { container } = render(RepertoireElement, { rows: twoRows });
		const line = container.querySelector('[data-testid="works-line"]');
		expect(line).not.toBeNull();
		expect(text(line)).toContain('♫');
		expect(text(line)).toContain('Spem in alium · Mass in B minor');
	});

	// #91 review F6 — a season editor reads the repertoire unfiltered so the
	// status toggle stays two-way, but the at-a-glance line must still name the
	// music actually being sung. Inactive rows are counted, not listed.
	it('names only ACTIVE works, counting the inactive ones instead', () => {
		const { container } = render(RepertoireElement, {
			rows: [
				row({ workName: 'Spem in alium', status: 'active' }),
				row({ workName: 'Dropped motet', status: 'dropped' }),
				row({ workName: 'Retired anthem', status: 'retired' })
			]
		});
		const line = text(container.querySelector('[data-testid="works-line"]'));
		expect(line).toContain('Spem in alium');
		expect(line).not.toContain('Dropped motet');
		expect(line).not.toContain('Retired anthem');
		expect(line).toContain('[repertoire_inactive_count]');
	});

	it('no inactive rows → no count suffix at all', () => {
		const { container } = render(RepertoireElement, { rows: twoRows });
		expect(text(container.querySelector('[data-testid="works-line"]'))).not.toContain(
			'[repertoire_inactive_count]'
		);
	});

	it('is ABSENT when there are no works — no empty "Works" placeholder', () => {
		const { container } = render(RepertoireElement, { rows: [] });
		expect(container.querySelector('[data-testid="works-line"]')).toBeNull();
		expect(container.querySelector('[data-testid="works-expanded"]')).toBeNull();
	});

	it('starts collapsed: the expanded view is not rendered before a tap', () => {
		const { container } = render(RepertoireElement, { rows: twoRows });
		expect(container.querySelector('[data-testid="works-expanded"]')).toBeNull();
	});

	it('tapping the line expands the view; tapping again collapses it', async () => {
		const { container } = render(RepertoireElement, { rows: twoRows });
		const line = container.querySelector('[data-testid="works-line"]');
		await fireEvent.click(line!);
		expect(container.querySelector('[data-testid="works-expanded"]')).not.toBeNull();
		await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);
		expect(container.querySelector('[data-testid="works-expanded"]')).toBeNull();
	});
});

// ── Expanded view (#90 AC-1, badge + edition) ───────────────────────────────

async function renderExpanded(rows: WorkRow[], extra: Record<string, unknown> = {}) {
	// Wrapped under `props` explicitly: one management prop is named `context`,
	// which COLLIDES with @testing-library/svelte's own mount-option name — an
	// unwrapped options object containing a `context` key is (mis)parsed as a
	// mount option, not a component prop (see UnknownSvelteOptionsError).
	const rendered = render(RepertoireElement, { props: { rows, ...extra } });
	await fireEvent.click(rendered.container.querySelector('[data-testid="works-line"]')!);
	return rendered;
}

describe('RepertoireElement — expanded view', () => {
	it('renders one work row per entry with work name and composer', async () => {
		const { container } = await renderExpanded(twoRows);
		const rows = container.querySelectorAll('[data-testid="work-row"]');
		expect(rows.length).toBe(2);
		expect(text(rows[0])).toContain('Spem in alium');
		expect(text(rows[0])).toContain('Thomas Tallis');
		expect(text(rows[1])).toContain('Mass in B minor');
		expect(text(rows[1])).toContain('J. S. Bach');
	});

	// #91 review F6 — the badge is TRANSLATED, through the same message lookup the
	// management select uses. It used to print `row.status` verbatim, which put
	// raw 'retired'/'dropped' on screen in all four locales.
	it("shows the status badge with the TRANSLATED repertoire status ('active' / 'learning')", async () => {
		const { container } = await renderExpanded(twoRows);
		const badges = container.querySelectorAll('[data-testid="work-status-badge"]');
		expect(badges.length).toBe(2);
		expect(text(badges[0])).toBe('[repertoire_status_active]');
		expect(text(badges[1])).toBe('[repertoire_status_learning]');
	});

	it('translates retired/dropped too — never the raw schema string', async () => {
		const { container } = await renderExpanded([row({ status: 'retired' }), row({ status: 'dropped' })]);
		const badges = container.querySelectorAll('[data-testid="work-status-badge"]');
		expect(text(badges[0])).toBe('[repertoire_status_retired]');
		expect(text(badges[1])).toBe('[repertoire_status_dropped]');
	});

	it('de-emphasises inactive rows so a dropped work cannot read as live repertoire', async () => {
		const { container } = await renderExpanded([row({ status: 'active' }), row({ status: 'dropped' })]);
		const workRows = container.querySelectorAll('[data-testid="work-row"]');
		expect(workRows[0].getAttribute('data-inactive')).toBeNull();
		expect(workRows[1].getAttribute('data-inactive')).toBe('true');
	});

	it('hides the status badge for program items (status null — a concert programme has no status)', async () => {
		const { container } = await renderExpanded([row({ status: null })]);
		expect(container.querySelector('[data-testid="work-status-badge"]')).toBeNull();
	});

	it('shows the pinned edition name', async () => {
		const { container } = await renderExpanded([row()]);
		const edition = container.querySelector('[data-testid="work-edition"]');
		expect(text(edition)).toContain('40-part original');
	});

	it('marks a work with no pinned edition via work-no-edition instead of an empty edition line', async () => {
		const { container } = await renderExpanded([row({ editionName: '' })]);
		expect(container.querySelector('[data-testid="work-no-edition"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="work-edition"]')).toBeNull();
	});
});

// ── Functional links (#90 AC-3/AC-4/AC-5) ───────────────────────────────────

describe('RepertoireElement — functional links', () => {
	it('renders a PDF control when the row carries a fileId — and NEVER a pre-signed href (the url lives 60s)', async () => {
		const { container } = await renderExpanded([row({ fileId: 'file-1' })]);
		const pdf = container.querySelector('[data-testid="work-link-pdf"]');
		expect(pdf).not.toBeNull();
		expect(pdf?.getAttribute('href')).toBeNull();
	});

	it('clicking PDF calls onpdfclick with the file id, so the page signs the url AT CLICK TIME', async () => {
		const onpdfclick = vi.fn();
		const rendered = render(RepertoireElement, { rows: [row({ fileId: 'file-1' })], onpdfclick });
		await fireEvent.click(rendered.container.querySelector('[data-testid="works-line"]')!);
		await fireEvent.click(rendered.container.querySelector('[data-testid="work-link-pdf"]')!);
		expect(onpdfclick).toHaveBeenCalledTimes(1);
		expect(onpdfclick).toHaveBeenCalledWith('file-1');
	});

	it('renders NO PDF control when the edition has no file', async () => {
		const { container } = await renderExpanded([row({ fileId: '' })]);
		expect(container.querySelector('[data-testid="work-link-pdf"]')).toBeNull();
	});

	it('renders a Borrow link to /library when copies exist for the edition', async () => {
		const { container } = await renderExpanded([row({ canBorrow: true })]);
		const borrow = container.querySelector('[data-testid="work-link-borrow"]');
		expect(borrow).not.toBeNull();
		expect(borrow?.getAttribute('href')).toBe('/library');
	});

	it('renders NO Borrow link when no copies exist', async () => {
		const { container } = await renderExpanded([row({ canBorrow: false })]);
		expect(container.querySelector('[data-testid="work-link-borrow"]')).toBeNull();
	});

	it('renders one external link per external_link value, href intact, link text naming the domain', async () => {
		const { container } = await renderExpanded([
			row({
				externalLinks: [
					'https://imslp.org/wiki/Spem_in_alium',
					'https://www.youtube.com/watch?v=abc'
				]
			})
		]);
		const links = container.querySelectorAll('[data-testid="work-link-external"]');
		expect(links.length).toBe(2);
		expect(links[0].getAttribute('href')).toBe('https://imslp.org/wiki/Spem_in_alium');
		expect(text(links[0])).toContain('imslp.org');
		expect(links[1].getAttribute('href')).toBe('https://www.youtube.com/watch?v=abc');
		expect(text(links[1])).toContain('youtube.com');
	});
});

// ── Concert ordering (#90 AC-6) ─────────────────────────────────────────────

describe('RepertoireElement — concert ordering', () => {
	it('renders a NUMBERED programme (ol > li, ordinal order) when ordinals are present', async () => {
		const { container } = await renderExpanded([
			// deliberately out of ordinal order in props — display follows ordinal
			row({ workName: 'Mass in B minor', composer: 'J. S. Bach', status: null, ordinal: 2 }),
			row({ workName: 'Spem in alium', status: null, ordinal: 1 })
		]);
		const expanded = container.querySelector('[data-testid="works-expanded"]');
		const ol = expanded?.querySelector('ol');
		expect(ol).not.toBeNull();
		const lis = ol!.querySelectorAll('li');
		expect(lis.length).toBe(2);
		expect(text(lis[0])).toContain('Spem in alium');
		expect(text(lis[1])).toContain('Mass in B minor');
	});

	it('renders names-only (no ol) when ordinals are absent — season repertoire is unordered', async () => {
		const { container } = await renderExpanded(twoRows); // both ordinal: null
		const expanded = container.querySelector('[data-testid="works-expanded"]');
		expect(expanded?.querySelector('ol')).toBeNull();
		expect(text(expanded)).toContain('Spem in alium');
		expect(text(expanded)).toContain('Mass in B minor');
	});
});

// ── Programme notes (#90 — soloists / dedications on a program_item) ────────

describe('RepertoireElement — programme notes', () => {
	it('renders program notes on the expanded row when present', async () => {
		const { container } = await renderExpanded([row({ status: null, ordinal: 1, notes: 'soloist: N. N.' })]);
		const notes = container.querySelector('[data-testid="work-notes"]');
		expect(text(notes)).toContain('soloist: N. N.');
	});

	it('renders NO notes element when the row carries none', async () => {
		const { container } = await renderExpanded([row({ notes: '' })]);
		expect(container.querySelector('[data-testid="work-notes"]')).toBeNull();
	});
});

// ── Disclosure a11y (repo convention: every disclosure sets aria-expanded) ──

describe('RepertoireElement — disclosure a11y', () => {
	it('the collapsed line exposes aria-expanded, flipping on tap', async () => {
		const { container } = render(RepertoireElement, { rows: twoRows });
		const line = container.querySelector('[data-testid="works-line"]');
		expect(line?.getAttribute('aria-expanded')).toBe('false');
		await fireEvent.click(line!);
		expect(
			container.querySelector('[data-testid="works-line"]')?.getAttribute('aria-expanded')
		).toBe('true');
	});

	it('aria-controls points at the id of the expanded region', async () => {
		const { container } = await renderExpanded(twoRows);
		const controls = container
			.querySelector('[data-testid="works-line"]')
			?.getAttribute('aria-controls');
		expect(controls).toBeTruthy();
		expect(container.querySelector('[data-testid="works-expanded"]')?.getAttribute('id')).toBe(
			controls
		);
	});
});

// ── Duplicate ordinals must not crash the render (Entu mandatory is soft) ───
// `mandatory: true` is a UI hint in Entu, not enforcement — two program_items
// with no ordinal both default to 0. Keying the numbered branch on the ordinal
// threw `each_key_duplicate`, which takes down the whole agenda page.

describe('RepertoireElement — duplicate ordinals', () => {
	it('renders both rows (no each_key_duplicate) when two program items share an ordinal', async () => {
		const { container } = await renderExpanded([
			row({ id: 'pi-a', workName: 'First', status: null, ordinal: 0 }),
			row({ id: 'pi-b', workName: 'Second', status: null, ordinal: 0 })
		]);
		const rendered = container.querySelectorAll('[data-testid="work-row"]');
		expect(rendered.length).toBe(2);
		// Equal ordinals keep source order (stable sort).
		expect(text(rendered[0])).toContain('First');
		expect(text(rendered[1])).toContain('Second');
	});
});

// ── Duplicate external links must not crash the render either ──────────────
// Same failure mode, one list down: `external_link` is an implicitly
// multi-valued Entu string prop and POST appends rather than replaces, so an
// edition can legitimately hold the SAME url twice. Keying that {#each} on the
// url string threw `each_key_duplicate` on expand.

describe('RepertoireElement — duplicate external links', () => {
	it('renders both anchors (no each_key_duplicate) when an edition holds the same url twice', async () => {
		const dup = 'https://imslp.org/wiki/Spem_in_alium';
		const { container } = await renderExpanded([row({ externalLinks: [dup, dup] })]);
		const links = container.querySelectorAll('[data-testid="work-link-external"]');
		expect(links.length).toBe(2);
		expect(links[0].getAttribute('href')).toBe(dup);
		expect(links[1].getAttribute('href')).toBe(dup);
	});
});

// ── #91 TR.3 — management controls (rights-gated writes) ────────────────────
// Still prop-driven and fetch-free: this component only renders controls and
// forwards taps via callback props. Rights, picker candidates and pending
// state are all caller-supplied.

describe('RepertoireElement — management: rights gating', () => {
	it("manageRights omitted (defaults 'not-editor') → no management controls, even with rows", async () => {
		const { container } = await renderExpanded(twoRows);
		expect(container.querySelector('[data-testid="work-manage-row"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-manage-add-work"]')).toBeNull();
	});

	it("manageRights 'error' → no management controls (never treated as editor)", async () => {
		const { container } = await renderExpanded(twoRows, { manageRights: 'error' });
		expect(container.querySelector('[data-testid="work-manage-row"]')).toBeNull();
	});

	it("manageRights 'editor' with rows → per-row management controls render", async () => {
		const { container } = await renderExpanded(twoRows, { manageRights: 'editor' });
		expect(container.querySelectorAll('[data-testid="work-manage-row"]').length).toBe(2);
	});

	it("rows.length === 0 with manageRights 'editor' → renders the 'Add' control directly, no disclosure at all", () => {
		const { container } = render(RepertoireElement, { rows: [], manageRights: 'editor' });
		expect(container.querySelector('[data-testid="works-line"]')).toBeNull();
		expect(container.querySelector('[data-testid="works-manage-empty"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="work-manage-add-work"]')).not.toBeNull();
	});

	it("rows.length === 0 with manageRights 'not-editor' → nothing renders at all (unchanged read-only behaviour)", () => {
		const { container } = render(RepertoireElement, { rows: [] });
		expect(container.querySelector('[data-testid="works-manage-empty"]')).toBeNull();
	});
});

async function renderExpandedManaged(rows: WorkRow[], extra: Record<string, unknown> = {}) {
	return renderExpanded(rows, { manageRights: 'editor', ...extra });
}

describe('RepertoireElement — management: repertoire status + remove', () => {
	it('status select is seeded with the row status and calls onstatuschange on change', async () => {
		const onstatuschange = vi.fn();
		const { container } = await renderExpandedManaged([row({ id: 'ri-1', status: 'active' })], {
			onstatuschange
		});
		const select = container.querySelector('[data-testid="work-manage-status-select"]') as HTMLSelectElement;
		expect(select.value).toBe('active');
		await fireEvent.change(select, { target: { value: 'retired' } });
		expect(onstatuschange).toHaveBeenCalledWith('ri-1', 'retired');
	});

	it('status select disables while its row id is pending', async () => {
		const { container } = await renderExpandedManaged([row({ id: 'ri-1' })], {
			pendingKeys: new Set(['ri-1'])
		});
		const select = container.querySelector('[data-testid="work-manage-status-select"]') as HTMLSelectElement;
		expect(select.disabled).toBe(true);
	});

	it('Remove button calls onremoveitem with the row id, and is disabled while pending', async () => {
		const onremoveitem = vi.fn();
		const { container } = await renderExpandedManaged([row({ id: 'ri-1' })], { onremoveitem });
		const btn = container.querySelector('[data-testid="work-manage-remove"]') as HTMLButtonElement;
		expect(btn.disabled).toBe(false);
		await fireEvent.click(btn);
		expect(onremoveitem).toHaveBeenCalledWith('ri-1');
	});

	it('pin-edition picker is absent when editionOptionsByRowId has no options for the row', async () => {
		const { container } = await renderExpandedManaged([row({ id: 'ri-1' })]);
		expect(container.querySelector('[data-testid="work-manage-pin-edition-select"]')).toBeNull();
	});

	it('picking an edition and tapping Pin calls onpinedition with the row id + chosen edition id', async () => {
		const onpinedition = vi.fn();
		const { container } = await renderExpandedManaged([row({ id: 'ri-1' })], {
			onpinedition,
			editionOptionsByRowId: { 'ri-1': [{ id: 'ed-1', label: 'Bärenreiter' }] }
		});
		const select = container.querySelector('[data-testid="work-manage-pin-edition-select"]') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'ed-1' } });
		const btn = container.querySelector('[data-testid="work-manage-pin-edition-button"]') as HTMLButtonElement;
		expect(btn.disabled).toBe(false);
		await fireEvent.click(btn);
		expect(onpinedition).toHaveBeenCalledWith('ri-1', 'ed-1');
	});

	it('Pin button stays disabled until an edition is picked', async () => {
		const { container } = await renderExpandedManaged([row({ id: 'ri-1' })], {
			editionOptionsByRowId: { 'ri-1': [{ id: 'ed-1', label: 'Bärenreiter' }] }
		});
		const btn = container.querySelector('[data-testid="work-manage-pin-edition-button"]') as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
	});
});

describe('RepertoireElement — management: add work (repertoire context)', () => {
	it('Add button disabled with no selection; picking a work then tapping Add calls onaddwork', async () => {
		const onaddwork = vi.fn();
		const { container } = await renderExpandedManaged([row()], {
			onaddwork,
			pickableWorksList: [{ id: 'work-x', name: 'Nunc dimittis', composer: 'Rachmaninoff' }]
		});
		const addBtn = container.querySelector('[data-testid="work-manage-add-work-button"]') as HTMLButtonElement;
		expect(addBtn.disabled).toBe(true);
		const select = container.querySelector('[data-testid="work-manage-add-work-select"]') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'work-x' } });
		expect(addBtn.disabled).toBe(false);
		await fireEvent.click(addBtn);
		expect(onaddwork).toHaveBeenCalledWith('work-x');
	});

	it('Add-work controls disable while ADD_WORK_KEY is pending', async () => {
		const { container } = await renderExpandedManaged([row()], {
			pendingKeys: new Set([ADD_WORK_KEY]),
			pickableWorksList: [{ id: 'work-x', name: 'Nunc dimittis', composer: 'Rachmaninoff' }]
		});
		const select = container.querySelector('[data-testid="work-manage-add-work-select"]') as HTMLSelectElement;
		expect(select.disabled).toBe(true);
	});
});

describe('RepertoireElement — management: programme reorder + remove + add', () => {
	const programmeRows: WorkRow[] = [
		row({ id: 'pi-a', kind: 'program', workName: 'First', status: null, ordinal: 0 }),
		row({ id: 'pi-b', kind: 'program', workName: 'Second', status: null, ordinal: 1 }),
		row({ id: 'pi-c', kind: 'program', workName: 'Third', status: null, ordinal: 2 })
	];

	it('move up/down call onmoveitem with direction; boundary rows disable the boundary button', async () => {
		const onmoveitem = vi.fn();
		const { container } = await renderExpandedManaged(programmeRows, {
			context: 'programme',
			onmoveitem
		});
		const ups = container.querySelectorAll('[data-testid="work-manage-move-up"]');
		const downs = container.querySelectorAll('[data-testid="work-manage-move-down"]');
		expect((ups[0] as HTMLButtonElement).disabled).toBe(true); // first row can't move up
		expect((downs[2] as HTMLButtonElement).disabled).toBe(true); // last row can't move down
		expect((ups[1] as HTMLButtonElement).disabled).toBe(false);
		await fireEvent.click(downs[1]);
		expect(onmoveitem).toHaveBeenCalledWith('pi-b', 'down');
	});

	it('Remove in programme context calls onremoveitem with the program_item id', async () => {
		const onremoveitem = vi.fn();
		const { container } = await renderExpandedManaged(programmeRows, {
			context: 'programme',
			onremoveitem
		});
		const removeButtons = container.querySelectorAll('[data-testid="work-manage-remove"]');
		await fireEvent.click(removeButtons[0]);
		expect(onremoveitem).toHaveBeenCalledWith('pi-a');
	});

	it('add-to-programme picks the NEXT ordinal (max existing + 1) and forwards it to onaddprogramitem', async () => {
		const onaddprogramitem = vi.fn();
		const { container } = await renderExpandedManaged(programmeRows, {
			context: 'programme',
			onaddprogramitem,
			pickableEditions: [{ id: 'ed-9', label: 'Work — Edition' }]
		});
		const select = container.querySelector('[data-testid="work-manage-add-programme-select"]') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'ed-9' } });
		const btn = container.querySelector('[data-testid="work-manage-add-programme-button"]') as HTMLButtonElement;
		await fireEvent.click(btn);
		expect(onaddprogramitem).toHaveBeenCalledWith('ed-9', 3);
	});

	it('add-to-programme on an EMPTY row set defaults the ordinal to 0', async () => {
		const onaddprogramitem = vi.fn();
		const { container } = render(RepertoireElement, {
			props: {
				rows: [],
				manageRights: 'editor',
				context: 'programme',
				onaddprogramitem,
				pickableEditions: [{ id: 'ed-9', label: 'Work — Edition' }]
			}
		});
		const select = container.querySelector('[data-testid="work-manage-add-programme-select"]') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'ed-9' } });
		await fireEvent.click(container.querySelector('[data-testid="work-manage-add-programme-button"]')!);
		expect(onaddprogramitem).toHaveBeenCalledWith('ed-9', 0);
	});

	it('repertoire-context rows never render move up/down (wrong context for reordering)', async () => {
		const { container } = await renderExpandedManaged(twoRows);
		expect(container.querySelector('[data-testid="work-manage-move-up"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-manage-move-down"]')).toBeNull();
	});
});

// ── #91 review — provenance gating, status round-trip, programme entry point ─
// The three ways the management surface could hand the page the wrong id, or
// strand a work, all live in this component's gating.

describe('RepertoireElement — management: row provenance (kind) gates the controls', () => {
	// An event with NO program_items renders the SEASON repertoire as fallback
	// (TR.2's hierarchy), so a programme surface can be showing repertoire_item
	// ids. "Remove from tonight" on one of those deletes the whole collective's
	// season entry.
	const fallbackRows: WorkRow[] = [
		row({ id: 'ri-fallback', kind: 'repertoire', status: 'active', ordinal: null })
	];

	it('programme context + season-fallback rows → NO Remove button (its id is a repertoire_item id)', async () => {
		const { container } = await renderExpandedManaged(fallbackRows, { context: 'programme' });
		expect(container.querySelector('[data-testid="work-manage-remove"]')).toBeNull();
	});

	it('programme context + season-fallback rows → no row controls at all, not even an empty control strip', async () => {
		const { container } = await renderExpandedManaged(fallbackRows, { context: 'programme' });
		expect(container.querySelector('[data-testid="work-manage-row"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-manage-move-up"]')).toBeNull();
	});

	it('repertoire context + PROGRAM rows → no row controls either (the ids are program_item ids)', async () => {
		const programRows: WorkRow[] = [
			row({ id: 'pi-1', kind: 'program', status: null, ordinal: 0 })
		];
		const { container } = await renderExpandedManaged(programRows, { context: 'repertoire' });
		expect(container.querySelector('[data-testid="work-manage-row"]')).toBeNull();
	});

	it('programme context + program rows → Remove is present and forwards the program_item id', async () => {
		const onremoveitem = vi.fn();
		const { container } = await renderExpandedManaged(
			[row({ id: 'pi-1', kind: 'program', status: null, ordinal: 0 })],
			{ context: 'programme', onremoveitem }
		);
		await fireEvent.click(container.querySelector('[data-testid="work-manage-remove"]')!);
		expect(onremoveitem).toHaveBeenCalledWith('pi-1');
	});
});

describe('RepertoireElement — management: the status toggle round-trips', () => {
	it('a RETIRED row still renders the status select, seeded with retired — the toggle is two-way', async () => {
		const { container } = await renderExpandedManaged([
			row({ id: 'ri-1', kind: 'repertoire', status: 'retired' })
		]);
		const select = container.querySelector(
			'[data-testid="work-manage-status-select"]'
		) as HTMLSelectElement;
		expect(select).not.toBeNull();
		expect(select.value).toBe('retired');
	});

	it('a retired row can be set back to active', async () => {
		const onstatuschange = vi.fn();
		const { container } = await renderExpandedManaged(
			[row({ id: 'ri-1', kind: 'repertoire', status: 'dropped' })],
			{ onstatuschange }
		);
		const select = container.querySelector(
			'[data-testid="work-manage-status-select"]'
		) as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'active' } });
		expect(onstatuschange).toHaveBeenCalledWith('ri-1', 'active');
	});

	it('a row whose status did not narrow (bad data) still gets the control, seeded to the schema default', async () => {
		const { container } = await renderExpandedManaged([
			row({ id: 'ri-1', kind: 'repertoire', status: null })
		]);
		const select = container.querySelector(
			'[data-testid="work-manage-status-select"]'
		) as HTMLSelectElement;
		expect(select).not.toBeNull();
		expect(select.value).toBe('active');
	});
});

describe('RepertoireElement — management: per-surface rights', () => {
	it('an EVENT editor sees "Add to programme" on a repertoire-context row — the only way to create the FIRST program_item', async () => {
		const onaddprogramitem = vi.fn();
		const { container } = await renderExpanded(
			[row({ kind: 'repertoire', status: 'active' })],
			{
				seasonRights: 'not-editor',
				eventRights: 'editor',
				context: 'repertoire',
				onaddprogramitem,
				pickableEditions: [{ id: 'ed-9', label: 'Work — Edition' }]
			}
		);
		const select = container.querySelector(
			'[data-testid="work-manage-add-programme-select"]'
		) as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'ed-9' } });
		await fireEvent.click(
			container.querySelector('[data-testid="work-manage-add-programme-button"]')!
		);
		// No ordinals on a fallback row set → the new programme opens at 0.
		expect(onaddprogramitem).toHaveBeenCalledWith('ed-9', 0);
	});

	it('an EVENT-only editor gets NO repertoire row controls (season repertoire is not theirs to edit)', async () => {
		const { container } = await renderExpanded([row({ kind: 'repertoire', status: 'active' })], {
			seasonRights: 'not-editor',
			eventRights: 'editor',
			context: 'repertoire'
		});
		expect(container.querySelector('[data-testid="work-manage-status-select"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-manage-add-work"]')).toBeNull();
	});

	it('a SEASON-only editor gets repertoire controls but no programme add', async () => {
		const { container } = await renderExpanded([row({ kind: 'repertoire', status: 'active' })], {
			seasonRights: 'editor',
			eventRights: 'not-editor',
			context: 'repertoire'
		});
		expect(container.querySelector('[data-testid="work-manage-status-select"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="work-manage-add-programme"]')).toBeNull();
	});

	it("neither right → nothing at all, even with rows (the reader's view is untouched)", async () => {
		const { container } = await renderExpanded([row({ kind: 'repertoire' })], {
			seasonRights: 'error',
			eventRights: 'not-editor'
		});
		expect(container.querySelector('[data-testid="work-manage-row"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-manage-add-work"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-manage-add-programme"]')).toBeNull();
	});
});

// (*MVOX:Tallis* — RED spec)
// (*MVOX:Josquin* — review fix-forward: shared WorkRow, click-time PDF signing,
// duplicate-ordinal keying, disclosure a11y, programme notes, unkeyed external
// links)
// (*MVOX:Josquin* — #91 TR.3 GREEN: management-controls coverage, mirroring
// the repertoireActions.ts RED contract)
// (*MVOX:Josquin* — #91 review fix-forward: row-provenance gating, status
// round-trip, per-surface rights)
