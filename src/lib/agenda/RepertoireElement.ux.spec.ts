// @vitest-environment happy-dom
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
		fileName: '',
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

const DIVIDE_Y = /(^|\s)divide-y(-\d+)?(\s|$)/;
const OWN_ROW_BORDER = /(^|\s)(sm:|max-sm:)?border-[tby]\b/;

function listOf(container: HTMLElement): HTMLElement {
	const list = container.querySelector('[data-testid="works-expanded"] ol, [data-testid="works-expanded"] ul');
	expect(list).not.toBeNull();
	return list as HTMLElement;
}

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
		expect(listOf(container).className).toMatch(DIVIDE_Y);
		const workRows = container.querySelectorAll('[data-testid="work-row"]');
		expect(workRows.length).toBe(3);
		for (const li of workRows) {
			expect(li.className).not.toMatch(OWN_ROW_BORDER);
		}
	});
});

describe('RepertoireElement — unified status/actions row (#111 finding 3)', () => {
	function renderAsSeasonEditor(rows = threeRows()) {
		return render(RepertoireElement, {
			props: { rows, expanded: true, manageRights: 'editor', context: 'repertoire' }
		});
	}

	it('renders NO separate status chip in the panel header when the status buttons row is present', () => {
		const { container } = renderAsSeasonEditor();
		expect(container.querySelector('[data-testid="work-status-active"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="work-status-badge"]')).toBeNull();
	});

	it('the status buttons live in a single row that is the LAST element of the work panel', () => {
		const { container } = renderAsSeasonEditor();
		const workRows = container.querySelectorAll('[data-testid="work-row"]');
		expect(workRows.length).toBe(3);
		for (const li of workRows) {
			const manageRow = li.querySelector('[data-testid="work-manage-row"]');
			expect(manageRow).not.toBeNull();
			expect(manageRow!.parentElement!.lastElementChild).toBe(manageRow);
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

	it('every work row carries its status on a rendered attribute the tests can assert on', () => {
		const { container } = renderAsSeasonEditor();
		const statuses = [...container.querySelectorAll('[data-testid="work-row"]')].map((li) =>
			li.getAttribute('data-status')
		);
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

	it('a plain member (no manage rights) still sees the status chip', () => {
		const { container } = render(RepertoireElement, { props: { rows: [row()], expanded: true } });
		expect(container.querySelector('[data-testid="work-manage-row"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-status-badge"]')).not.toBeNull();
	});
});

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
		expect(select.tagName).toBe('SELECT');
		expect(select.className).toMatch(/(^|\s)w-full(\s|$)/);
	});

	it('at desktop width the existing inline dropdown is preserved (sm:w-auto, same native select, options intact)', () => {
		const { container } = renderAsEventEditor();
		const select = addProgrammeSelect(container);
		expect(select.className).toMatch(/(^|\s)sm:w-auto(\s|$)/);
		expect(select.tagName).toBe('SELECT');
		const labels = [...select.querySelectorAll('option')].map((o) => o.textContent?.trim());
		expect(labels).toEqual([
			'[repertoire_add_programme_label]',
			pickableEditions[0].label,
			pickableEditions[1].label
		]);
	});
});

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
			`${pickableWorksList[0].name} - ${pickableWorksList[0].composer}`,
			`${pickableWorksList[1].name} - ${pickableWorksList[1].composer}`
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
