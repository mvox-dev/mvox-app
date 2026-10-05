// @vitest-environment happy-dom
// The roster record editor: capture markers on the row and edit label.
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { REDACT_ATTR } from '$lib/redact/redact';
import { renderRosterAs } from '$lib/testing/pages/rosterRender';
import { q, useRecordEditorPage } from '$lib/testing/pages/rosterRecordEditor';

useRecordEditorPage();

function textNodesContaining(root: Element, needle: string): Text[] {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const hits: Text[] = [];
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		if ((n.textContent ?? '').includes(needle)) hits.push(n as Text);
	}
	return hits;
}

function expectTightlyMarked(root: Element, needle: string, where: string) {
	const hits = textNodesContaining(root, needle);
	expect(hits.length, `${where}: '${needle}' must render here`).toBeGreaterThan(0);
	for (const hit of hits) {
		const marker = hit.parentElement?.closest(`[${REDACT_ATTR}]`) ?? null;
		expect(marker, `${where}: '${needle}' must sit inside a [${REDACT_ATTR}] element`).not.toBeNull();
		expect(root.contains(marker), `${where}: the marker must be INSIDE the surface, not around it`).toBe(true);
		expect(marker!.textContent?.trim(), `${where}: the marker holds exactly the value`).toBe(needle);
	}
}

describe('#388 — the collapsed row\'s name and email and the sr-only edit label\'s name carry the capture marker', () => {
	it.each(['admin', 'not-admin'] as const)('%s: roster-row-name and roster-row-email each render their value inside a tight marker', async (role) => {
		const { container } = await renderRosterAs(role);
		for (const [memberId, name, email] of [
			['m1', 'Alice Alto', 'alice@example.com'],
			['m2', 'Berta Bass', 'berta@example.com']
		] as const) {
			const li = q(container, `roster-row-${memberId}`)!;
			const nameEl = li.querySelector('[data-testid="roster-row-name"]');
			const emailEl = li.querySelector('[data-testid="roster-row-email"]');
			expect(nameEl, `${memberId} roster-row-name`).not.toBeNull();
			expect(emailEl, `${memberId} roster-row-email`).not.toBeNull();
			expectTightlyMarked(nameEl!, name, `${memberId} roster-row-name`);
			expectTightlyMarked(emailEl!, email, `${memberId} roster-row-email`);
		}
	});

	it('admin: the card activator\'s sr-only label keeps its static copy OUTSIDE the marker and the member\'s name INSIDE it', async () => {
		const { container } = await renderRosterAs('admin');
		const card = q(container, 'roster-row-card-m2')!;
		expect(card).not.toBeNull();
		const label = card.querySelector('.sr-only');
		expect(label, 'the sr-only edit label renders inside the card').not.toBeNull();
		expect(label!.textContent).toContain('[roster_record_edit_label]');
		expectTightlyMarked(label!, 'Berta Bass', 'sr-only edit label');
		const copy = textNodesContaining(label!, '[roster_record_edit_label]');
		expect(copy).toHaveLength(1);
		expect(copy[0].parentElement?.closest(`[${REDACT_ATTR}]`) ?? null).toBeNull();
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
