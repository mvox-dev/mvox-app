// @vitest-environment happy-dom
// The roster: capture redaction on the inactive surface.
import { fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/roster/memberLifecycle', async () =>
	(await import('$lib/testing/mocks/roster')).memberLifecycleModule({ archived: true })
);
vi.mock('$lib/library/librarianStore', async (importOriginal) =>
	(await import('$lib/testing/mocks/library')).readyLibrarianModule(importOriginal)
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/roster/memberRecord', async (importOriginal) =>
	(await import('$lib/testing/mocks/roster')).memberRecordModule(importOriginal)
);

import { toListRead } from '$lib/testing/listReadFixtures';
import { REDACT_ATTR, REDACT_TOGGLE_ATTR } from '$lib/redact/redact';
import { loadInactiveRosterMock } from '$lib/testing/mocks/roster';
import { openCard, renderRosterAs, useRosterDeactivatePage } from '$lib/testing/pages/rosterDeactivate';

useRosterDeactivatePage();

describe('#388 — capture redaction: inactive row name marked; no unexplained real name or contact value with the toggle engaged', () => {
	const inactiveGone = [
		{
			memberId: 'm9',
			personId: 'pp-9',
			name: 'Gone Girl',
			email: 'gone@example.com',
			sectionIds: [],
			dbEntityId: 'db-1'
		}
	];
	const FIXTURE_VALUES = [
		'Alice Alto',
		'alice@example.com',
		'Berta Bass',
		'berta@example.com',
		'Gone Girl',
		'gone@example.com'
	];

	afterEach(() => {
		document.documentElement.removeAttribute(REDACT_TOGGLE_ATTR);
	});

	async function renderWithInactiveOpen() {
		loadInactiveRosterMock.mockResolvedValue(toListRead(inactiveGone));
		const utils = await renderRosterAs('admin');
		await waitFor(() =>
			expect(utils.container.querySelector('[data-testid="roster-inactive-toggle"]')).not.toBeNull()
		);
		await fireEvent.click(utils.container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() =>
			expect(utils.container.querySelector('[data-testid="inactive-member-row-m9"]')).not.toBeNull()
		);
		return utils;
	}

	function sweep(root: Element) {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		const unmarked: string[] = [];
		const found = new Set<string>();
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			const text = n.textContent ?? '';
			for (const value of FIXTURE_VALUES) {
				if (!text.includes(value)) continue;
				found.add(value);
				if (!n.parentElement?.closest(`[${REDACT_ATTR}]`)) {
					const owner = n.parentElement?.closest('[data-testid]')?.getAttribute('data-testid');
					unmarked.push(`${value} @ ${owner ?? n.parentElement?.tagName}`);
				}
			}
		}
		return { unmarked, found: [...found].sort() };
	}

	it('the inactive-members row name sits inside a tight marker', async () => {
		const { container } = await renderWithInactiveOpen();
		const row = container.querySelector('[data-testid="inactive-member-row-m9"]')!;
		const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
		const hits: Text[] = [];
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			if ((n.textContent ?? '').includes('Gone Girl')) hits.push(n as Text);
		}
		expect(hits.length, 'the inactive row renders her name').toBeGreaterThan(0);
		for (const hit of hits) {
			const marker = hit.parentElement?.closest(`[${REDACT_ATTR}]`) ?? null;
			expect(marker, `'Gone Girl' must sit inside a [${REDACT_ATTR}] element`).not.toBeNull();
			expect(row.contains(marker), 'the marker is inside the row, not around the panel').toBe(true);
			expect(marker!.textContent?.trim()).toBe('Gone Girl');
		}
	});

	it.each([
		['collapsed rows + inactive panel', false],
		['with m2\'s record editor open', true]
	] as const)('AC3 (%s): with data-redacting on <html>, every fixture name/email in a text node is inside a marked element', async (_label, openEditor) => {
		document.documentElement.setAttribute(REDACT_TOGGLE_ATTR, '');
		const { container } = await renderWithInactiveOpen();
		if (openEditor) await openCard(container, 'm2');
		expect(document.documentElement.hasAttribute(REDACT_TOGGLE_ATTR)).toBe(true);
		const { unmarked, found } = sweep(document.body);
		expect(unmarked).toEqual([]);
		expect(found).toEqual(
			['Alice Alto', 'Berta Bass', 'Gone Girl', 'alice@example.com', 'berta@example.com'].sort()
		);
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
