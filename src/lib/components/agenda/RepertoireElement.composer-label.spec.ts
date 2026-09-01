// @vitest-environment happy-dom
//
// #204 RED — work pickers show the composer alongside the work name.
//
// CONTRACT under test (defined HERE, implemented in GREEN):
//   The "Add work" picker's option label is `${name} - ${composer}` when the
//   work carries a composer, and EXACTLY `${name}` when composer is empty —
//   never a dangling trailing " - ". (Issue #204: "Silmavalgus - P. Uusberg".)
//
// This file covers the COMPONENT seam (RepertoireElement's add-work select).
// The page-route integrations live in page.repertoire-manage-wiring.spec.ts
// (agenda), event/[id]/page.spec.ts (event detail) and
// page.library-work-picker-composer.spec.ts (library bulk checkout).
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RepertoireElement from './RepertoireElement.svelte';
import type { WorkRow } from '$lib/repertoire/types';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get: (_target, key) => () => `[${String(key)}]`
	})
}));

afterEach(cleanup);

function row(overrides: Partial<WorkRow> = {}): WorkRow {
	return {
		id: 'ri-1',
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

async function renderAddWorkSelect(pickableWorksList: Array<{ id: string; name: string; composer: string }>) {
	// `props` wrapper: the component has a prop literally named `context`, which
	// collides with testing-library's mount option of the same name.
	const rendered = render(RepertoireElement, {
		props: { rows: [row()], manageRights: 'editor', context: 'repertoire', pickableWorksList }
	});
	await fireEvent.click(rendered.container.querySelector('[data-testid="works-line"]')!);
	const select = rendered.container.querySelector(
		'[data-testid="work-manage-add-work-select"]'
	) as HTMLSelectElement;
	expect(select).not.toBeNull();
	return select;
}

function optionLabels(select: HTMLSelectElement): string[] {
	return [...select.querySelectorAll('option')].map((o) => (o.textContent ?? '').trim());
}

describe('RepertoireElement — add-work picker shows composer (#204)', () => {
	it('option label reads "Name - Composer" when the work carries a composer', async () => {
		const select = await renderAddWorkSelect([
			{ id: 'w-1', name: 'Silmavalgus', composer: 'P. Uusberg' },
			{ id: 'w-2', name: 'Nunc dimittis', composer: 'Rachmaninoff' }
		]);
		expect(optionLabels(select)).toEqual([
			'[repertoire_add_work_label]',
			'Silmavalgus - P. Uusberg',
			'Nunc dimittis - Rachmaninoff'
		]);
	});

	it('a work with an EMPTY composer renders the name only — no dangling " - "', async () => {
		const select = await renderAddWorkSelect([
			{ id: 'w-1', name: 'Silmavalgus', composer: 'P. Uusberg' },
			{ id: 'w-2', name: 'Anonymous chant', composer: '' }
		]);
		const labels = optionLabels(select);
		expect(labels).toContain('Anonymous chant');
		// The exact-name option must be present AND nothing may end in a bare
		// separator (the `' - ' + ''` failure mode).
		expect(labels.some((l) => /\s-\s*$/.test(l))).toBe(false);
	});

	it('a WHITESPACE-ONLY composer renders the name only — blank is not a composer', async () => {
		const select = await renderAddWorkSelect([
			{ id: 'w-1', name: 'Silmavalgus', composer: '   ' },
			{ id: 'w-2', name: '  Nunc dimittis  ', composer: ' Rachmaninoff ' }
		]);
		expect(optionLabels(select)).toEqual([
			'[repertoire_add_work_label]',
			'Silmavalgus',
			'Nunc dimittis - Rachmaninoff'
		]);
	});
});

// (*MVOX:Tallis* — #204 RED)
// (*MVOX:Tallis* — #204 review fix-forward: whitespace-only composer)
