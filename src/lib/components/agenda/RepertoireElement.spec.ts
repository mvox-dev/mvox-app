// @vitest-environment happy-dom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RepertoireElement from './RepertoireElement.svelte';
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

async function renderExpanded(rows: WorkRow[]) {
	const rendered = render(RepertoireElement, { rows });
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

	it("shows the status badge with the repertoire status ('active' / 'learning')", async () => {
		const { container } = await renderExpanded(twoRows);
		const badges = container.querySelectorAll('[data-testid="work-status-badge"]');
		expect(badges.length).toBe(2);
		expect(text(badges[0])).toContain('active');
		expect(text(badges[1])).toContain('learning');
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

// (*MVOX:Tallis* — RED spec)
// (*MVOX:Josquin* — review fix-forward: shared WorkRow, click-time PDF signing,
// duplicate-ordinal keying, disclosure a11y, programme notes, unkeyed external
// links)
