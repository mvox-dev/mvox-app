// @vitest-environment happy-dom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RepertoireElement from './RepertoireElement.svelte';
import type { WorkRow } from '$lib/repertoire/types';
import type { Work } from '$lib/library/libraryData';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket')
);

afterEach(cleanup);

let rowSeq = 0;
function repertoireRow(overrides: Partial<WorkRow> = {}): WorkRow {
	return {
		id: `ri-${++rowSeq}`,
		kind: 'repertoire',
		workId: 'work-1',
		editionId: '',
		workName: 'Spem in alium',
		composer: 'Thomas Tallis',
		status: 'active',
		editionName: '',
		ordinal: null,
		fileId: '',
		fileName: '',
		externalLinks: [],
		canBorrow: false,
		notes: '',
		...overrides
	};
}

const PICKABLE: Work[] = [{ id: 'work-9', name: 'Nunc dimittis', composer: 'Arvo Pärt' }];

function renderRepertoireEditor(extra: Record<string, unknown> = {}) {
	return render(RepertoireElement, {
		props: {
			rows: [repertoireRow()],
			expanded: true,
			context: 'repertoire',
			manageRights: 'editor',
			...extra
		} as never
	});
}

const WRAPPER = '[data-testid="work-manage-add-work"]';
const SELECT = '[data-testid="work-manage-add-work-select"]';
const BUTTON = '[data-testid="work-manage-add-work-button"]';

describe('#311 — pickableWorksVisible: default RENDERS (option B: hiding is opt-in, never inferred from length)', () => {
	it('prop OMITTED with an EMPTY pickableWorksList → the select still renders — the default is TRUE, not `length > 0`', () => {
		const { container } = renderRepertoireEditor({ pickableWorksList: [] });
		expect(container.querySelector(SELECT)).not.toBeNull();
		expect(container.querySelector(BUTTON)).not.toBeNull();
	});

	it('pickableWorksVisible={false} with a NON-EMPTY list → select and button ABSENT; the wrapper itself stays (#272 part 4: the gate is on the dropdown, not the block)', () => {
		const { container } = renderRepertoireEditor({
			pickableWorksList: PICKABLE,
			pickableWorksVisible: false
		});
		expect(container.querySelector(SELECT), 'select must be gone under an explicit false').toBeNull();
		expect(container.querySelector(BUTTON), 'button must be gone under an explicit false').toBeNull();
		expect(
			container.querySelector(WRAPPER),
			'the wrapper stays — the gate lands on the inner controls (mirrors #272 part 4)'
		).not.toBeNull();
	});

	it('pickableWorksVisible={true} with an EMPTY list → select renders — the explicit override outranks emptiness in BOTH directions', () => {
		const { container } = renderRepertoireEditor({
			pickableWorksList: [],
			pickableWorksVisible: true
		});
		expect(container.querySelector(SELECT)).not.toBeNull();
	});

	it('the programme surface is untouched: pickableWorksVisible={false} does not reach the editions control', () => {
		const { container } = render(RepertoireElement, {
			props: {
				rows: [repertoireRow({ kind: 'program', editionId: 'ed-1', ordinal: 0 })],
				expanded: true,
				context: 'programme',
				eventRights: 'editor',
				pickableEditions: [{ id: 'ed-9', label: 'Spem in alium — 40-part original' }],
				pickableWorksVisible: false
			} as never
		});
		expect(
			container.querySelector('[data-testid="work-manage-add-programme-select"]'),
			'pickableEditions/pickableEditionsVisible keep their #288 behaviour byte-exactly'
		).not.toBeNull();
	});
});

// (*MVOX:Tallis* — #311 RED: the Add Work picker renders only when there is something to add)
