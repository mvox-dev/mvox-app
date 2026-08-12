// @vitest-environment happy-dom
//
// TU.1/#109 RED — finding #10 root cause B, reproduced on the LIVE-SHAPED tree.
//
// This is the tree the live /roster picker actually holds (verbatim from
// polyphony, 2026-08-12 probe: 16 `section` entities across FOUR test orgs, all
// org-parented → ALL FLAT ROOTS; ids are the real entity ids). Every standard
// voice-section name is already taken by SOME org's section, so the TS.3-era
// GLOBAL duplicate check refuses every name an admin would actually type.
// Mihkel's live gate walk (2026-08-11): typing "Soprano II" with parent
// "Soprano" — the exact section finding #8 wants nested — was refused as a
// duplicate of Kammernaiskoor Sireen's flat "Soprano II". Net effect: "new
// section creation doesn't work in live environment".
//
// Contract (GREEN): the duplicate check is scoped to the chosen parent's DIRECT
// CHILDREN (top-level sections for "(top level)") — see
// SectionPicker.create.spec.ts for the base sibling-scope pins.
//
// TU.1/#109 REVIEW — and at TOP LEVEL, "sibling" also means SAME ORG. All 16
// live sections are org-parented roots belonging to FOUR different orgs, so
// parent-scoping alone still treated them as one sibling set: an EFK admin
// creating a top-level "Soprano II" was refused because Kammernaiskoor Sireen
// has one. (The very same fixture carries three "Bass", two "Baritone" and two
// "I Tenor" roots — live proof those roots are not one sibling set.) The picker
// now takes the member's own `orgId` and compares top-level candidates only
// against roots of THAT org; sub-section scope is unchanged.
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

import SectionPicker from './SectionPicker.svelte';
import type { SectionNode } from './sectionData';

afterEach(() => {
	cleanup();
});

/** Real live entity ids (2026-08-12 probe of polyphony). */
const ORG_EFK = '69c7f8718489bfcb0e81b065'; // "Eesti Filharmoonia Kammerkoor"
const ORG_SIREEN = '69c7f8788489bfcb0e81b1a9'; // "Kammernaiskoor Sireen"
/**
 * The two remaining test orgs' ids were not captured in the probe output this
 * fix had to hand — placeholders stand in. Nothing below asserts against them:
 * every assertion turns on EFK's own roots vs Sireen's "Soprano II", both of
 * which ARE live-verified (see page.roster-sections-live-wire.spec.ts, which
 * pins Soprano II's `_parent` → Kammernaiskoor Sireen from the same probe).
 * [speculative] which of the two owns which male-voice block — grouped here by
 * the probe's id/creation order (each org's four voice sections follow it).
 */
const ORG_TEST_3 = 'org-test-3-unprobed';
const ORG_TEST_4 = 'org-test-4-unprobed';

const EFK_SOPRANO = '69c7f8728489bfcb0e81b07b';
const EFK_ALTO = '69c7f8748489bfcb0e81b0cd';
const SIREEN_SOPRANO_II = '69c7f8798489bfcb0e81b207';

/** The live tree, verbatim: 16 sections, four orgs' worth, all flat roots. */
function liveTree(): SectionNode[] {
	const flat: Array<[string, string, number, string]> = [
		[EFK_SOPRANO, 'Soprano', 1, ORG_EFK],
		['69c7f8788489bfcb0e81b1bf', 'Soprano I', 2, ORG_SIREEN],
		[SIREEN_SOPRANO_II, 'Soprano II', 3, ORG_SIREEN],
		[EFK_ALTO, 'Alto', 4, ORG_EFK],
		['69c7f87b8489bfcb0e81b257', 'Alto I', 5, ORG_SIREEN],
		['69c7f87c8489bfcb0e81b2a7', 'Alto II', 6, ORG_SIREEN],
		['69c7f8758489bfcb0e81b113', 'Tenor', 7, ORG_EFK],
		['69c7f87e8489bfcb0e81b2fa', 'I Tenor', 8, ORG_TEST_3],
		['69c7f8808489bfcb0e81b374', 'II Tenor', 9, ORG_TEST_3],
		['69c7f8878489bfcb0e81b506', 'I Tenor', 10, ORG_TEST_4],
		['69c7f8828489bfcb0e81b3ec', 'Baritone', 11, ORG_TEST_3],
		['69c7f8848489bfcb0e81b46e', 'Bass', 12, ORG_TEST_3],
		['69c7f8898489bfcb0e81b580', 'Baritone', 13, ORG_TEST_4],
		['69c7f8888489bfcb0e81b544', 'II Tenor', 14, ORG_TEST_4],
		['69c7f8768489bfcb0e81b163', 'Bass', 15, ORG_EFK],
		['69c7f88a8489bfcb0e81b5bc', 'Bass', 16, ORG_TEST_4]
	];
	return flat.map(([id, name, displayOrder, orgId]) => ({
		id,
		name,
		displayOrder,
		parentId: null,
		orgId,
		depth: 0,
		children: []
	}));
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function openFormAndType(
	container: HTMLElement,
	name: string,
	parentValue?: string
): Promise<void> {
	await fireEvent.click(q(container, 'section-picker-trigger-m-1') as HTMLElement);
	await fireEvent.click(q(container, 'section-picker-new') as HTMLElement);
	await fireEvent.input(q(container, 'section-create-name') as HTMLElement, {
		target: { value: name }
	});
	if (parentValue !== undefined) {
		await fireEvent.change(q(container, 'section-create-parent') as HTMLElement, {
			target: { value: parentValue }
		});
	}
	await fireEvent.click(q(container, 'section-create-submit') as HTMLElement);
}

/** The picker as the roster renders it for an EFK member (row.orgId = EFK). */
function renderLivePicker(orgId: string | null = ORG_EFK) {
	const oncreate = vi.fn();
	const { container } = render(SectionPicker, {
		props: {
			memberId: 'm-1',
			memberName: 'Ada Lovelace',
			sections: liveTree(),
			selectedIds: [],
			orgId,
			onpick: vi.fn(),
			oncreate
		}
	});
	return { container, oncreate };
}

describe('SectionPicker on the LIVE polyphony tree — finding #10 reproduced', () => {
	it("Mihkel's exact live gesture: 'Soprano II' with parent = Soprano (which has NO child of that name) MUST fire oncreate — the flat 'Soprano II' of another test org is not a sibling", async () => {
		const { container, oncreate } = renderLivePicker();
		await openFormAndType(container, 'Soprano II', EFK_SOPRANO);

		expect(q(container, 'section-create-error')).toBeNull();
		expect(oncreate).toHaveBeenCalledTimes(1);
		expect(oncreate).toHaveBeenCalledWith({ name: 'Soprano II', parentId: EFK_SOPRANO });
		// Close-after-action, same as every valid submit.
		expect(q(container, 'section-picker-menu-m-1')).toBeNull();
	});

	it("'Alto II' under Alto: same shape, same requirement — every voice name being taken SOMEWHERE in the flat test tree must not block sub-section creation", async () => {
		const { container, oncreate } = renderLivePicker();
		await openFormAndType(container, 'Alto II', EFK_ALTO);

		expect(q(container, 'section-create-error')).toBeNull();
		expect(oncreate).toHaveBeenCalledWith({ name: 'Alto II', parentId: EFK_ALTO });
	});

	it("TU.1/#109 review: a TOP-LEVEL 'Soprano II' for an EFK member FIRES — the only live 'Soprano II' root belongs to Kammernaiskoor Sireen, and another org's root is not a sibling", async () => {
		const { container, oncreate } = renderLivePicker();
		await openFormAndType(container, 'Soprano II');

		expect(q(container, 'section-create-error')).toBeNull();
		expect(oncreate).toHaveBeenCalledTimes(1);
		expect(oncreate).toHaveBeenCalledWith({ name: 'Soprano II', parentId: null });
	});

	it("a TOP-LEVEL duplicate of EFK's OWN root ('soprano' vs its 'Soprano') stays refused — org scoping does not blunt genuine sibling collision", async () => {
		const { container, oncreate } = renderLivePicker();
		await openFormAndType(container, '  soprano ');

		const error = q(container, 'section-create-error');
		expect(error).not.toBeNull();
		expect(error?.textContent).toContain('roster_section_duplicate');
		expect(oncreate).not.toHaveBeenCalled();
	});

	it("org UNKNOWN (no orgId prop) stays conservative — every root is a possible sibling, so a top-level 'Soprano II' is still refused rather than risking a real duplicate", async () => {
		const { container, oncreate } = renderLivePicker(null);
		await openFormAndType(container, 'Soprano II');

		expect(q(container, 'section-create-error')?.textContent).toContain(
			'roster_section_duplicate'
		);
		expect(oncreate).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis* — TU.1/#109 RED, finding #10 root cause B on the live-shaped tree)
