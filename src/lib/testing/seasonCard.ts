// #261 — the ONE shared way test suites open (and close) the season-manage
// panel after the season-card rework. Before #261 nine spec files each clicked
// the [⚙] `season-manage-gear` to reach the panel; the gear is REMOVED by the
// rework (Mihkel ruling 2026-09-06: "gear not needed") and the whole COLLAPSED
// card is the expand control now. Retargeting happens HERE, once — never
// hand-edited divergently across nine files again.
//
//   season-card-expand     the collapsed card's whole-card click target: a real
//                          native <button> (full-width, min-h-11) whose visible
//                          text is the season's NAME. Clicking it expands the
//                          card (opens season-manage-panel).
//   season-card-collapse   the OPENED card's title-row click target: likewise a
//                          real <button> carrying the season name; clicking it
//                          collapses the card back. Carries the
//                          closeSeasonManagePanel refusal (disabled while
//                          seriesRunUnfinished || eventConvertRunUnfinished).
//
// The full behavior contract lives in src/routes/page.season-card.spec.ts.
import { fireEvent, waitFor } from '@testing-library/svelte';
import { expect } from 'vitest';

export const SEASON_CARD_EXPAND = 'season-card-expand';
export const SEASON_CARD_COLLAPSE = 'season-card-collapse';

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

/** Expand the season card (the whole collapsed card is the click target),
 *  wait for the panel. Returns the panel element. No-op if already open. */
export async function openSeasonCardPanel(container: HTMLElement): Promise<HTMLElement> {
	if (!q(container, 'season-manage-panel')) {
		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});
		await fireEvent.click(q(container, SEASON_CARD_EXPAND) as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).not.toBeNull();
		});
	}
	return q(container, 'season-manage-panel') as HTMLElement;
}

/** Collapse the opened season card by its title row, wait for the panel to go. */
export async function collapseSeasonCard(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(q(container, SEASON_CARD_COLLAPSE)).not.toBeNull();
	});
	await fireEvent.click(q(container, SEASON_CARD_COLLAPSE) as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-manage-panel')).toBeNull();
	});
}

// (*MVOX:Tallis* — #261 RED: the shared open-the-panel helper, retargeted from
// the retired gear to the card's own expand/collapse controls)
