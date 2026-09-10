// @vitest-environment happy-dom
//
// #311 RED — the Add Work picker: `pickableWorksVisible`, the exact prop
// sibling of #288's `pickableEditionsVisible` — with the DEFAULT INVERTED,
// per Gama's option-B ruling on the issue (comment 5613696176):
//
//   The component default is RENDER — `true`, NOT `pickableWorksList.length
//   > 0`. Hiding is an explicit OPT-IN: only a caller that can prove "the
//   load COMPLETED SUCCESSFULLY and there is genuinely nothing left to pick"
//   passes `false`. An un-migrated caller keeps today's behaviour exactly.
//
//   Why the deliberate asymmetry with `pickableEditionsVisible` (whose
//   default is the unsafe `length > 0`): a component default should be the
//   SAFE behaviour. `length === 0` has three causes — confirmed-empty,
//   not-loaded-yet, load-FAILED — and only the first should ever hide the
//   control. That knowledge lives in the caller, so the caller opts in.
//   The follow-up moves the SIBLING to this safe default too — it does NOT
//   pull this prop back to `length > 0` to match. GREEN must put a comment
//   saying exactly this at the default, or the next reader "fixes" the
//   asymmetry back.
//
//   The gate lands on the INNER select + button, NOT on the outer
//   `work-manage-add-work` wrapper — the same rule #272 part 4 pinned for
//   the programme control (and event/[id]/page.spec.ts asserts the works
//   wrapper's presence for an editor whose pickable list is genuinely
//   empty, so a wrapper-level gate flips that spec).
//
// The programme surface (`pickableEditions`/`pickableEditionsVisible`) is
// byte-untouched by #311 — pinned below.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RepertoireElement from './RepertoireElement.svelte';
import type { WorkRow } from '$lib/repertoire/types';
import type { Work } from '$lib/library/libraryData';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get: (_target, key) => () => `[${String(key)}]`
	})
}));

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
		externalLinks: [],
		canBorrow: false,
		notes: '',
		...overrides
	};
}

const PICKABLE: Work[] = [{ id: 'work-9', name: 'Nunc dimittis', composer: 'Arvo Pärt' }];

/** A season editor on the repertoire surface — the only state that renders
 *  the Add Work controls at all. */
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
		// The un-migrated-caller guarantee: a caller handing over an empty (or
		// still-loading, or failed-and-blanked) list keeps today's behaviour.
		// This is also why RepertoireElement.spec.ts's "rows.length === 0 with
		// manageRights 'editor'" spec (no pickableWorksList at all) keeps
		// passing untouched.
		const { container } = renderRepertoireEditor({ pickableWorksList: [] });
		expect(container.querySelector(SELECT)).not.toBeNull();
		expect(container.querySelector(BUTTON)).not.toBeNull();
	});

	it('pickableWorksVisible={false} with a NON-EMPTY list → select and button ABSENT; the wrapper itself stays (#272 part 4: the gate is on the dropdown, not the block)', () => {
		// The opt-in. The caller — not this component — proved "load completed
		// successfully, nothing left to pick"; content cannot override it
		// (a non-empty list under `false` means the caller's answer simply
		// hasn't caught up, and the caller is the one holding the truth).
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
		// A page mid-load (or after a FAILED load) passes true over a blanked
		// list: visible-but-empty, the loadManagePickers catch's own choice.
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
