// @vitest-environment happy-dom
import { render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);
vi.mock('$lib/paraglide/messages', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);

vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/mocks/library')).libraryReadsModule()
);
vi.mock('$lib/paraglide/runtime', async () =>
	(await import('$lib/testing/moduleStubs')).runtimeModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).activeMembersModule()
);

vi.mock('$lib/library/librarianStore', async () =>
	(await import('$lib/testing/mocks/library')).librarianOverRealModule({ libraryId: false })
);

vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('member')
);

import Page from './library/+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures';
import { findMyMemberIdMock } from '$lib/testing/moduleHandles';
import {
	listAllCopiesMock,
	listAllEditionsMock,
	listCopiesMock,
	listEditionsMock,
	listLendingsMock,
	listWorksMock,
	resolveBorrowerNamesMock,
	resolveCopyChainsMock,
	resolveCopyNamesMock
} from '$lib/testing/mocks/library';
import { listActiveMembersMock } from '$lib/testing/mocks/roster';
import { resolveLibrarianMock } from '$lib/testing/mocks/admin';
import {
	DB_A,
	DB_B,
	cleanupClearReset,
	setAuthedWithTwoCollectives,
	truncated
} from '$lib/testing/pages/library';

function complete<T>(items: T[]) {
	return { items, total: items.length, truncated: false };
}

function worksFor(db: string) {
	return db === DB_A
		? [{ id: 'work-a1', name: 'Spem in alium', composer: 'Thomas Tallis' }]
		: [{ id: 'work-b1', name: 'Os justi', composer: 'Anton Bruckner' }];
}

beforeEach(() => {
	setAuthedWithTwoCollectives();
	listWorksMock.mockImplementation((cfg: { db: string }) => Promise.resolve(complete(worksFor(cfg.db))));
	listLendingsMock.mockResolvedValue(complete([]));
	listEditionsMock.mockResolvedValue(complete([]));
	listCopiesMock.mockResolvedValue(complete([]));
	listAllEditionsMock.mockResolvedValue(complete([]));
	listAllCopiesMock.mockResolvedValue(complete([]));
	listActiveMembersMock.mockResolvedValue(toListRead([]));
	resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	findMyMemberIdMock.mockResolvedValue(null);
	resolveBorrowerNamesMock.mockResolvedValue(new Map());
	resolveCopyNamesMock.mockResolvedValue(new Map());
	resolveCopyChainsMock.mockResolvedValue(new Map());
});

afterEach(cleanupClearReset);

function notice(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[data-testid="library-partial-notice"]');
}

describe('#321 — /library states when its list is partial', () => {
	it('a truncated WORKS read renders a persistent, visible partial notice (role=status, i18n copy, never sr-only)', async () => {
		listWorksMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(truncated(worksFor(cfg.db), 612))
		);

		const { container } = render(Page);
		await waitFor(() => {
			expect(notice(container)).not.toBeNull();
		});
		const el = notice(container)!;
		expect(el.getAttribute('role')).toBe('status');
		expect(el.className).not.toMatch(/sr-only|hidden/);
		expect(el.getAttribute('aria-hidden')).not.toBe('true');
		expect(el.textContent).toContain('library_partial_notice');
		expect(container.textContent).toContain('Spem in alium');
		expect(container.querySelector('[data-testid="library-load-error"]')).toBeNull();
	});

	it('a truncated LENDINGS read (the collective-lifetime log) also raises the notice', async () => {
		listLendingsMock.mockResolvedValue(truncated([], 730));

		const { container } = render(Page);
		await waitFor(() => {
			expect(notice(container)).not.toBeNull();
		});
		expect(notice(container)!.getAttribute('role')).toBe('status');
	});

	it('with every read COMPLETE the notice is ABSENT from the DOM (not hidden — absent)', async () => {
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.textContent).toContain('Spem in alium');
		});
		expect(notice(container)).toBeNull();
	});

	it('the truncation fact does not leak across a collective switch: A truncated → switch to B (complete) → notice gone', async () => {
		listWorksMock.mockImplementation((cfg: { db: string }) =>
			cfg.db === DB_A
				? Promise.resolve(truncated(worksFor(DB_A), 612))
				: Promise.resolve(complete(worksFor(DB_B)))
		);

		const { container } = render(Page);
		await waitFor(() => {
			expect(notice(container)).not.toBeNull();
		});

		selectedCollectiveDbStore.set(DB_B);
		await waitFor(() => {
			expect(container.textContent).toContain('Os justi');
		});
		expect(notice(container)).toBeNull();
	});
});

// (*MVOX:Tallis* — RED spec, #321)
