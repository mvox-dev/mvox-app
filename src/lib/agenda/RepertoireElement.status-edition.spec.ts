// @vitest-environment happy-dom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RepertoireElement from './RepertoireElement.svelte';
import type { WorkRow } from '$lib/repertoire/types';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket')
);

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

const STATUSES = ['learning', 'active', 'retired', 'dropped'] as const;

const EDITION_OPTIONS = [
	{ id: 'ed-1', label: '40-part original' },
	{ id: 'ed-2', label: 'Bärenreiter urtext' }
];

const HEAVY_LEFT_PADDING = /(^|\s)pl-(?:[3-9]|[1-9]\d)(?:\.\d+)?(\s|$)/;

interface EditorProps {
	rows?: WorkRow[];
	editionOptionsByRowId?: Record<string, { id: string; label: string }[]>;
	onstatuschange?: (itemId: string, status: string) => void;
	onpinedition?: (itemId: string, editionId: string) => void;
	pendingKeys?: ReadonlySet<string>;
}

function renderAsSeasonEditor(props: EditorProps = {}) {
	const rows = props.rows ?? [row()];
	return {
		rows,
		...render(RepertoireElement, {
			props: {
				rows,
				expanded: true,
				manageRights: 'editor',
				context: 'repertoire',
				editionOptionsByRowId:
					props.editionOptionsByRowId ??
					Object.fromEntries(rows.map((r) => [r.id, EDITION_OPTIONS])),
				onstatuschange: props.onstatuschange,
				onpinedition: props.onpinedition,
				pendingKeys: props.pendingKeys ?? new Set<string>()
			}
		})
	};
}

function firstWorkRow(container: HTMLElement): HTMLElement {
	const li = container.querySelector('[data-testid="work-row"]');
	expect(li).not.toBeNull();
	return li as HTMLElement;
}

describe('RepertoireElement — works-expanded unindent (#125 F4)', () => {
	it('layout guard (happy-dom cannot measure indent): the expanded wrapper has no pl-3+ padding', () => {
		const { container } = renderAsSeasonEditor();
		const wrapper = container.querySelector('[data-testid="works-expanded"]');
		expect(wrapper).not.toBeNull();
		expect((wrapper as HTMLElement).className).not.toMatch(HEAVY_LEFT_PADDING);
	});
});

describe('RepertoireElement — inline status buttons (#125 F5a)', () => {
	it('renders NO status <select> on the editor surface', () => {
		const { container } = renderAsSeasonEditor();
		expect(container.querySelector('[data-testid="work-manage-status-select"]')).toBeNull();
	});

	it('renders one button per status, all four inside the work-manage-row', () => {
		const { container } = renderAsSeasonEditor();
		const manageRow = firstWorkRow(container).querySelector('[data-testid="work-manage-row"]');
		expect(manageRow).not.toBeNull();
		for (const status of STATUSES) {
			const btn = manageRow!.querySelector(`[data-testid="work-status-${status}"]`);
			expect(btn, `work-status-${status}`).not.toBeNull();
			expect((btn as HTMLElement).tagName).toBe('BUTTON');
			expect((btn as HTMLButtonElement).type).toBe('button');
		}
	});

	it('status button labels route through the i18n lookup, not raw status strings', () => {
		const { container } = renderAsSeasonEditor();
		for (const status of STATUSES) {
			const btn = container.querySelector(`[data-testid="work-status-${status}"]`);
			expect(btn!.textContent).toContain(`[repertoire_status_${status}]`);
		}
	});

	it('the CURRENT status button is distinguished with aria-pressed="true", the others "false"', () => {
		const { container } = renderAsSeasonEditor({ rows: [row({ status: 'learning' })] });
		for (const status of STATUSES) {
			const btn = container.querySelector(`[data-testid="work-status-${status}"]`);
			expect(btn!.getAttribute('aria-pressed'), `work-status-${status}`).toBe(
				status === 'learning' ? 'true' : 'false'
			);
		}
	});

	it('clicking a different status button calls onstatuschange with (itemId, status)', async () => {
		const onstatuschange = vi.fn();
		const { container, rows } = renderAsSeasonEditor({ onstatuschange });
		await fireEvent.click(container.querySelector('[data-testid="work-status-retired"]')!);
		expect(onstatuschange).toHaveBeenCalledTimes(1);
		expect(onstatuschange).toHaveBeenCalledWith(rows[0].id, 'retired');
	});

	it('the status buttons share the SAME row as [Remove]', () => {
		const { container } = renderAsSeasonEditor();
		const remove = firstWorkRow(container).querySelector('[data-testid="work-manage-remove"]');
		expect(remove).not.toBeNull();
		const manageRow = remove!.closest('[data-testid="work-manage-row"]');
		for (const status of STATUSES) {
			const btn = container.querySelector(`[data-testid="work-status-${status}"]`);
			expect(btn!.closest('[data-testid="work-manage-row"]')).toBe(manageRow);
		}
	});

	it('all four status buttons disable while the row has a pending write (double-tap guard)', () => {
		const { container, rows } = (() => {
			const r = row();
			return renderAsSeasonEditor({ rows: [r], pendingKeys: new Set([r.id]) });
		})();
		expect(rows.length).toBe(1);
		for (const status of STATUSES) {
			const btn = container.querySelector(`[data-testid="work-status-${status}"]`);
			expect((btn as HTMLButtonElement).disabled, `work-status-${status}`).toBe(true);
		}
	});

	it('a plain member (no manage rights) gets no status buttons, keeps the status chip', () => {
		const { container } = render(RepertoireElement, {
			props: { rows: [row()], expanded: true }
		});
		for (const status of STATUSES) {
			expect(container.querySelector(`[data-testid="work-status-${status}"]`)).toBeNull();
		}
		expect(container.querySelector('[data-testid="work-status-badge"]')).not.toBeNull();
	});
});

describe('RepertoireElement — unified edition picker (#125 F5b)', () => {
	it('renders NO [Pin] button and NO old pin-edition select', () => {
		const { container } = renderAsSeasonEditor();
		expect(container.querySelector('[data-testid="work-manage-pin-edition-button"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-manage-pin-edition-select"]')).toBeNull();
	});

	it('renders a native unified picker showing the CURRENT edition as its value', () => {
		const { container } = renderAsSeasonEditor();
		const picker = container.querySelector('[data-testid="work-edition-picker"]');
		expect(picker).not.toBeNull();
		expect((picker as HTMLElement).tagName).toBe('SELECT');
		expect((picker as HTMLSelectElement).value).toBe('ed-1');
		const optionValues = [...picker!.querySelectorAll('option')].map((o) =>
			o.getAttribute('value')
		);
		expect(optionValues).toContain('ed-1');
		expect(optionValues).toContain('ed-2');
	});

	it('selecting another edition fires onpinedition immediately — no confirm step', async () => {
		const onpinedition = vi.fn();
		const { container, rows } = renderAsSeasonEditor({ onpinedition });
		const picker = container.querySelector('[data-testid="work-edition-picker"]')!;
		await fireEvent.change(picker, { target: { value: 'ed-2' } });
		expect(onpinedition).toHaveBeenCalledTimes(1);
		expect(onpinedition).toHaveBeenCalledWith(rows[0].id, 'ed-2');
	});

	it('the picker IS the edition surface: no separate read-only edition line beside it', () => {
		const { container } = renderAsSeasonEditor();
		const li = firstWorkRow(container);
		expect(li.querySelector('[data-testid="work-edition-picker"]')).not.toBeNull();
		expect(li.querySelector('[data-testid="work-edition"]')).toBeNull();
		expect(li.querySelector('[data-testid="work-no-edition"]')).toBeNull();
	});

	it('a work with ONE edition still renders the picker with that edition selected', () => {
		const r = row();
		const { container } = renderAsSeasonEditor({
			rows: [r],
			editionOptionsByRowId: { [r.id]: [EDITION_OPTIONS[0]] }
		});
		const picker = container.querySelector('[data-testid="work-edition-picker"]');
		expect(picker).not.toBeNull();
		expect((picker as HTMLSelectElement).value).toBe('ed-1');
	});

	it('a row with NO pinned edition renders the picker unselected and pins on change', async () => {
		const onpinedition = vi.fn();
		const r = row({ editionId: '', editionName: '' });
		const { container } = renderAsSeasonEditor({ rows: [r], onpinedition });
		const picker = container.querySelector('[data-testid="work-edition-picker"]')!;
		expect((picker as HTMLSelectElement).value).toBe('');
		await fireEvent.change(picker, { target: { value: 'ed-2' } });
		expect(onpinedition).toHaveBeenCalledWith(r.id, 'ed-2');
	});

	it('a work with ZERO editions hides the picker; the read-only edition line stays', () => {
		const r = row();
		const { container } = renderAsSeasonEditor({ rows: [r], editionOptionsByRowId: {} });
		expect(container.querySelector('[data-testid="work-edition-picker"]')).toBeNull();
		expect(
			firstWorkRow(container).querySelector('[data-testid="work-edition"]')
		).not.toBeNull();
	});

	it('the picker disables while the row has a pending write', () => {
		const r = row();
		const { container } = renderAsSeasonEditor({ rows: [r], pendingKeys: new Set([r.id]) });
		const picker = container.querySelector('[data-testid="work-edition-picker"]');
		expect(picker).not.toBeNull();
		expect((picker as HTMLSelectElement).disabled).toBe(true);
	});

	it('a plain member keeps the read-only edition line, never the picker', () => {
		const { container } = render(RepertoireElement, {
			props: { rows: [row()], expanded: true }
		});
		expect(container.querySelector('[data-testid="work-edition-picker"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-edition"]')).not.toBeNull();
	});
});
