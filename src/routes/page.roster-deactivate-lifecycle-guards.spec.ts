// @vitest-environment happy-dom
// The roster: loud failures and in-flight loads across deactivate and reinstate.
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
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

import Page from './roster/+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { adminStore } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { signIn } from '$lib/testing/session';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import {
	deactivateMemberMock,
	listDeactivateBlockersMock,
	loadInactiveRosterMock,
	loadRosterMock,
	reinstateMemberMock
} from '$lib/testing/mocks/roster';
import { altoSection } from '$lib/testing/pages/rosterFixtures';
import { setAuthedWithOneCollective } from '$lib/testing/pages/roster';
import { openCard, renderRosterAs, useRosterDeactivatePage } from '$lib/testing/pages/rosterDeactivate';

useRosterDeactivatePage();

describe('(A/B) fail-LOUD — no lifecycle failure is allowed to be silent', () => {
	it('a rejected RIGHTS READ surfaces a role=alert on that row (not just a console line)', async () => {
		listDeactivateBlockersMock.mockRejectedValue(new Error('rights read failed'));
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		const alert = await waitFor(() => {
			const el = container.querySelector('[data-testid="member-deactivate-failed-m2"]');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect((alert.textContent ?? '').replace(/\s+/g, '')).toBe('[roster_member_deactivate_failed]m2');
		expect(alert.textContent).not.toContain('Berta Bass');
		const links = alert.querySelectorAll('a');
		expect(links).toHaveLength(1);
		expect(links[0].textContent?.trim()).toBe('m2');
		expect(links[0].getAttribute('href')).toBe('https://entu.app/sampledb/m2');
		expect(links[0].getAttribute('title')).toBe('m2');
		expect(deactivateMemberMock).not.toHaveBeenCalled();
		const confirmAfter = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-deactivate-confirm-m2"]'
		);
		expect(confirmAfter).not.toBeNull();
		expect(confirmAfter!.disabled).toBe(false);
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
	});

	it('a rejected STATUS WRITE surfaces the same alert, and the roster is NOT refetched as if it worked', async () => {
		deactivateMemberMock.mockRejectedValue(new Error('403'));
		const { container } = await renderRosterAs('admin');
		const rosterLoadsBefore = loadRosterMock.mock.calls.length;
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-failed-m2"]')).not.toBeNull()
		);
		expect(loadRosterMock.mock.calls.length).toBe(rosterLoadsBefore);
		const confirmAfter = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-deactivate-confirm-m2"]'
		);
		expect(confirmAfter).not.toBeNull();
		expect(confirmAfter!.disabled).toBe(false);
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
	});

	it('cancel-then-rearm after a failure: cancel disarms AND clears the alert; a fresh arm starts with no stale alert', async () => {
		deactivateMemberMock.mockRejectedValue(new Error('403'));
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-failed-m2"]')).not.toBeNull()
		);
		const cancel = container.querySelector('[data-testid="member-deactivate-cancel-m2"]');
		expect(cancel, 'the pair must still be armed beside the failure alert').not.toBeNull();
		await fireEvent.click(cancel!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-m2"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="member-deactivate-failed-m2"]')).toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).toBeNull();
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="member-deactivate-failed-m2"]')).toBeNull();
	});

	it('a rejected REINSTATE surfaces a role=alert next to that inactive row — otherwise the tap produces no visible change at all', async () => {
		listSectionsMock.mockResolvedValue([altoSection]);
		loadInactiveRosterMock.mockResolvedValue(toListRead([
			{
				memberId: 'm9',
				personId: 'pp-9',
				name: 'Gone Girl',
				email: 'gone@example.com',
				sectionIds: ['sec-alto'],
				dbEntityId: 'db-1'
			}
		]));
		reinstateMemberMock.mockRejectedValue(new Error('403'));
		const { container } = render(Page);
		setAuthedWithOneCollective();
		adminStore.set('admin');
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-toggle"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-reinstate-m9"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-reinstate-m9"]')!);
		const alert = await waitFor(() => {
			const el = container.querySelector('[data-testid="member-reinstate-failed-m9"]');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect((alert.textContent ?? '').replace(/\s+/g, '')).toBe('[roster_member_reinstate_failed]m9');
		expect(alert.textContent).not.toContain('Gone Girl');
		const links = alert.querySelectorAll('a');
		expect(links).toHaveLength(1);
		expect(links[0].textContent?.trim()).toBe('m9');
		expect(links[0].getAttribute('href')).toBe('https://entu.app/sampledb/m9');
		expect(links[0].getAttribute('title')).toBe('m9');
		expect(container.querySelector('[data-testid="inactive-member-row-m9"]')).not.toBeNull();
	});
});

describe('(B) #259 — in-flight inactive-panel loads must not outlive a collective switch', () => {
	type InactiveRow = {
		memberId: string;
		personId: string;
		name: string;
		email: string;
		sectionIds: string[];
		dbEntityId: string;
	};

	const goneGirl: InactiveRow = {
		memberId: 'm9',
		personId: 'pp-9',
		name: 'Gone Girl',
		email: 'gone@example.com',
		sectionIds: [],
		dbEntityId: 'db-1'
	};

	function setAuthedWithTwoCollectives() {
		signIn({
			collectives: [
				{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
				{ db: 'other-choir', name: 'Other Choir', personId: 'person-q' }
			]
		});
	}

	function holdInactiveLoads(): Array<(rows: InactiveRow[]) => void> {
		const settlers: Array<(rows: InactiveRow[]) => void> = [];
		loadInactiveRosterMock.mockImplementation(
			() =>
				new Promise<{ items: InactiveRow[]; total: number; truncated: boolean }>((resolve) => {
					settlers.push((rows: InactiveRow[]) => resolve(toListRead(rows)));
				})
		);
		return settlers;
	}

	async function renderTwoCollectiveRoster() {
		const utils = render(Page);
		setAuthedWithTwoCollectives();
		adminStore.set('admin');
		await waitFor(() =>
			expect(utils.container.querySelector('[data-testid="roster-inactive-toggle"]')).not.toBeNull()
		);
		return utils;
	}

	async function switchToOtherChoir(container: HTMLElement) {
		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => {
			const toggle = container.querySelector('[data-testid="roster-inactive-toggle"]');
			expect(toggle).not.toBeNull();
			expect(toggle!.getAttribute('aria-expanded')).toBe('false');
		});
	}

	const flush = () => new Promise((r) => setTimeout(r, 0));

	it("a PANEL-OPEN load that settles after a switch writes NOTHING — reopening on the new collective never renders the old one's rows", async () => {
		const settlers = holdInactiveLoads();
		const { container } = await renderTwoCollectiveRoster();

		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(1));

		await switchToOtherChoir(container);

		settlers[0]!([goneGirl]);
		await flush();

		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(2));
		expect(container.querySelector('[data-testid="inactive-member-row-m9"]')).toBeNull();

		settlers[1]!([]);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-empty"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="inactive-member-row-m9"]')).toBeNull();
	});

	it('a POST-REINSTATE panel reload that settles after a switch writes NOTHING', async () => {
		const settlers = holdInactiveLoads();
		const { container } = await renderTwoCollectiveRoster();

		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(1));
		settlers[0]!([goneGirl]);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-reinstate-m9"]')).not.toBeNull()
		);

		await fireEvent.click(container.querySelector('[data-testid="member-reinstate-m9"]')!);
		await waitFor(() => expect(reinstateMemberMock).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(2));

		await switchToOtherChoir(container);
		settlers[1]!([goneGirl]);
		await flush();

		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(3));
		expect(container.querySelector('[data-testid="inactive-member-row-m9"]')).toBeNull();

		settlers[2]!([]);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-empty"]')).not.toBeNull()
		);
	});

	it('NON-RACE: an ordinary reinstate with the panel open still refreshes it — she leaves the panel', async () => {
		loadInactiveRosterMock.mockResolvedValue(toListRead([goneGirl]));
		const { container } = render(Page);
		setAuthedWithOneCollective();
		adminStore.set('admin');
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-toggle"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-reinstate-m9"]')).not.toBeNull()
		);

		loadInactiveRosterMock.mockResolvedValue(toListRead([]));
		await fireEvent.click(container.querySelector('[data-testid="member-reinstate-m9"]')!);
		await waitFor(() => expect(reinstateMemberMock).toHaveBeenCalledTimes(1));

		await waitFor(() =>
			expect(container.querySelector('[data-testid="inactive-member-row-m9"]')).toBeNull()
		);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-empty"]')).not.toBeNull()
		);
		expect(
			container.querySelector('[data-testid="roster-inactive-toggle"]')?.getAttribute('aria-expanded')
		).toBe('true');
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
