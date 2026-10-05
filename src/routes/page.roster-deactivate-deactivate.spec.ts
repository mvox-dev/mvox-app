// @vitest-environment happy-dom
// The roster: deactivating a member, its confirm and refusal.
import { fireEvent, waitFor } from '@testing-library/svelte';
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

import { LibraryLookupError, resolveMyLibraryId } from '$lib/library/librarianStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { deferred } from '$lib/testing/entuFetchKit';
import {
	deactivateMemberMock,
	listDeactivateBlockersMock,
	loadRosterMock
} from '$lib/testing/mocks/roster';
import {
	openCard,
	renderRosterAs,
	rosterTwo,
	useRosterDeactivatePage
} from '$lib/testing/pages/rosterDeactivate';

useRosterDeactivatePage();

describe('(A) deactivate — admin-only, never self (done-when 7)', () => {
	it('a collective admin sees the deactivate control on ANOTHER member\'s row', async () => {
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit: control lives in the opened editor
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).not.toBeNull();
	});

	it("the viewer's OWN row never carries a deactivate control — self-deactivation is impossible at the UI", async () => {
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm1');
		expect(container.querySelector('[data-testid="member-deactivate-m1"]')).toBeNull();
	});

	it('a NON-admin member sees no deactivate control anywhere', async () => {
		const { container } = await renderRosterAs('not-admin');
		expect(container.querySelector('[data-testid="member-deactivate-m1"]')).toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
	});
});

describe('(A) two-step confirm — the page\'s existing destructive idiom, reused', () => {
	it('arming swaps in confirm + cancel and writes NOTHING', async () => {
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(deactivateMemberMock).not.toHaveBeenCalled();
	});

	it('cancel disarms — the arm control returns, still nothing written', async () => {
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-m2"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).toBeNull();
		expect(deactivateMemberMock).not.toHaveBeenCalled();
	});

	it('confirm calls deactivateMember for THAT member and refetches the roster (she drops out of the active reads)', async () => {
		const { container } = await renderRosterAs('admin');
		const loadsBefore = loadRosterMock.mock.calls.length;
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));
		expect(deactivateMemberMock.mock.calls[0][1]).toBe('m2');
		await waitFor(() =>
			expect(loadRosterMock.mock.calls.length).toBeGreaterThan(loadsBefore)
		);
	});
});

describe('(A) refusal while a manageable grant is held — names the remedy (Gama binding)', () => {
	it('an admin-grant blocker REFUSES: no write, and the message carries the collective so it can say where to remove the role — never a bare "cannot deactivate"', async () => {
		listDeactivateBlockersMock.mockResolvedValue([{ role: 'admin' }]);
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		const refused = await waitFor(() => {
			const el = container.querySelector('[data-testid="member-deactivate-refused-m2"]');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(refused.textContent).toContain('Sampledb');
		expect(deactivateMemberMock).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
	});

	it('FAIL-CLOSED: when the rights read itself rejects, deactivate does NOT proceed', async () => {
		listDeactivateBlockersMock.mockRejectedValue(new Error('rights read failed'));
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(listDeactivateBlockersMock).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 0));
		expect(deactivateMemberMock).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
	});

	it('FAIL-CLOSED: a roster with no resolvable database entity id NEVER deactivates', async () => {
		loadRosterMock.mockResolvedValue(toListRead([
			{ memberId: 'm1', personId: 'person-p', name: 'Alice Alto', email: 'alice@example.com', sectionIds: [] },
			{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com', sectionIds: [] }
		]));
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
		expect(resolveMyLibraryId).not.toHaveBeenCalled();
		expect(listDeactivateBlockersMock).not.toHaveBeenCalled();
		expect(deactivateMemberMock).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
	});

	it('FAIL-CLOSED: when the LIBRARY lookup rejects, deactivate does NOT proceed and the row alerts', async () => {
		vi.mocked(resolveMyLibraryId).mockRejectedValue(
			new LibraryLookupError('library lookup failed: HTTP 500', 500)
		);
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
		expect(listDeactivateBlockersMock).not.toHaveBeenCalled();
		expect(deactivateMemberMock).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
	});

	it('a genuine null library id still proceeds — no library is a FACT, not a failure', async () => {
		vi.mocked(resolveMyLibraryId).mockResolvedValue(null);
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));
		expect(listDeactivateBlockersMock.mock.calls[0][3]).toBeNull();
	});
});

describe('(A) #286 — the armed pair through the in-flight deactivate: mounted, disabled, aria-busy; cancel inert; one write; one arm slot', () => {
	it('while the BLOCKER READ is in flight the pair stays mounted — both halves disabled, confirm aria-busy, labels unchanged', async () => {
		const gate = deferred<{ role: string }[]>();
		listDeactivateBlockersMock.mockImplementation(() => gate.promise);
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(listDeactivateBlockersMock).toHaveBeenCalledTimes(1));

		const confirm = await waitFor(() => {
			const el = container.querySelector<HTMLButtonElement>(
				'[data-testid="member-deactivate-confirm-m2"]'
			);
			expect(el, 'confirm must stay mounted through the chain').not.toBeNull();
			expect(el!.disabled).toBe(true);
			return el!;
		});
		expect(confirm.getAttribute('aria-busy')).toBe('true');
		const cancel = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-deactivate-cancel-m2"]'
		);
		expect(cancel, 'cancel must stay mounted through the chain').not.toBeNull();
		expect(cancel!.disabled).toBe(true);
		expect(confirm.textContent).toContain('roster_member_deactivate_confirm');
		expect(cancel!.textContent).toContain('roster_member_deactivate_cancel');
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();

		gate.resolve([]);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));
	});

	it('while the WRITE is in flight the pair is disabled + confirm aria-busy — a double-tap cannot fire two writes; release → she leaves the roster and the pair disarms', async () => {
		const gate = deferred();
		deactivateMemberMock.mockImplementation(() => gate.promise);
		const { container } = await renderRosterAs('admin');
		const loadsBefore = loadRosterMock.mock.calls.length;
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));

		const confirm = await waitFor(() => {
			const el = container.querySelector<HTMLButtonElement>(
				'[data-testid="member-deactivate-confirm-m2"]'
			);
			expect(el, 'confirm must stay mounted through the write').not.toBeNull();
			expect(el!.disabled).toBe(true);
			return el!;
		});
		expect(confirm.getAttribute('aria-busy')).toBe('true');
		expect(
			container.querySelector<HTMLButtonElement>('[data-testid="member-deactivate-cancel-m2"]')!
				.disabled
		).toBe(true);

		await fireEvent.click(confirm);
		confirm.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(deactivateMemberMock).toHaveBeenCalledTimes(1);

		loadRosterMock.mockResolvedValue(toListRead([rosterTwo[0]]));
		gate.resolve();
		await waitFor(() =>
			expect(loadRosterMock.mock.calls.length).toBeGreaterThan(loadsBefore)
		);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).toBeNull()
		);
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).toBeNull();
		expect(deactivateMemberMock).toHaveBeenCalledTimes(1);
	});

	it('CANCEL during the held BLOCKER READ is INERT — no disarm, the pair stays mounted; release → the outcome lands honestly', async () => {
		const gate = deferred<{ role: string }[]>();
		listDeactivateBlockersMock.mockImplementation(() => gate.promise);
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(listDeactivateBlockersMock).toHaveBeenCalledTimes(1));

		const cancel = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-deactivate-cancel-m2"]'
		)!;
		await fireEvent.click(cancel);
		cancel.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(
			container.querySelector('[data-testid="member-deactivate-confirm-m2"]'),
			'the pair must not disarm while the chain is in flight'
		).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(
			container.querySelector('[data-testid="member-deactivate-m2"]'),
			'the rest-state trigger must never render while the chain is running'
		).toBeNull();

		gate.resolve([]);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));
	});

	it('CANCEL during the held WRITE is INERT — release → the deactivation LANDS: refetch, row gone, never "stopped"', async () => {
		const gate = deferred();
		deactivateMemberMock.mockImplementation(() => gate.promise);
		const { container } = await renderRosterAs('admin');
		const loadsBefore = loadRosterMock.mock.calls.length;
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));

		const cancel = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-deactivate-cancel-m2"]'
		)!;
		await fireEvent.click(cancel);
		cancel.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(
			container.querySelector('[data-testid="member-deactivate-confirm-m2"]'),
			'cancel mid-write must not imply the deactivation was stopped'
		).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();

		loadRosterMock.mockResolvedValue(toListRead([rosterTwo[0]]));
		gate.resolve();
		await waitFor(() =>
			expect(loadRosterMock.mock.calls.length).toBeGreaterThan(loadsBefore)
		);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-row-m2"]')).toBeNull()
		);
		expect(deactivateMemberMock).toHaveBeenCalledTimes(1);
	});

	it('a SECOND row cannot be armed mid-flight — the single arm slot is never stolen from the in-flight row', async () => {
		loadRosterMock.mockResolvedValue(toListRead([
			...rosterTwo,
			{ memberId: 'm3', personId: 'pp-3', name: 'Carla Cantus', email: 'carla@example.com', sectionIds: [], dbEntityId: 'db-1' }
		]));
		const gate = deferred();
		deactivateMemberMock.mockImplementation(() => gate.promise);
		const { container } = await renderRosterAs('admin');
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-row-card-m3"]')).not.toBeNull()
		);
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));

		await openCard(container, 'm3');
		const trigger3 = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-deactivate-m3"]'
		)!;
		await fireEvent.click(trigger3);
		trigger3.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(
			container.querySelector('[data-testid="member-deactivate-confirm-m3"]'),
			'no second row may arm while a deactivation is in flight'
		).toBeNull();
		expect(
			container.querySelector('[data-testid="member-deactivate-confirm-m2"]'),
			"the in-flight row's pair must survive the attempted steal"
		).not.toBeNull();

		gate.resolve();
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).toBeNull()
		);
	});

	it('REFUSAL (held read): the pair stays ARMED and re-enabled beside the refusal — explicit cancel disarms AND clears it (done-when 4)', async () => {
		const gate = deferred<{ role: string }[]>();
		listDeactivateBlockersMock.mockImplementation(() => gate.promise);
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(listDeactivateBlockersMock).toHaveBeenCalledTimes(1));

		gate.resolve([{ role: 'admin' }]);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-refused-m2"]')).not.toBeNull()
		);
		const confirm = await waitFor(() => {
			const el = container.querySelector<HTMLButtonElement>(
				'[data-testid="member-deactivate-confirm-m2"]'
			);
			expect(el).not.toBeNull();
			expect(el!.disabled).toBe(false);
			return el!;
		});
		expect(confirm.getAttribute('aria-busy')).not.toBe('true');
		const cancel = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-deactivate-cancel-m2"]'
		)!;
		expect(cancel.disabled).toBe(false);
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
		expect(deactivateMemberMock).not.toHaveBeenCalled();

		await fireEvent.click(cancel);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-m2"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="member-deactivate-refused-m2"]')).toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).toBeNull();
	});

	it('FAILURE (held write): the pair stays ARMED and re-enabled beside the error — direct retry through the SAME confirm succeeds', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const gate = deferred();
		deactivateMemberMock.mockImplementation(() => gate.promise);
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));

		gate.reject(new Error('500'));
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-failed-m2"]')).not.toBeNull()
		);
		const confirm = await waitFor(() => {
			const el = container.querySelector<HTMLButtonElement>(
				'[data-testid="member-deactivate-confirm-m2"]'
			);
			expect(el).not.toBeNull();
			expect(el!.disabled).toBe(false);
			return el!;
		});
		expect(confirm.getAttribute('aria-busy')).not.toBe('true');
		expect(
			container.querySelector<HTMLButtonElement>('[data-testid="member-deactivate-cancel-m2"]')!
				.disabled
		).toBe(false);
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();

		deactivateMemberMock.mockResolvedValue(undefined);
		loadRosterMock.mockResolvedValue(toListRead([rosterTwo[0]]));
		await fireEvent.click(confirm);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(2));
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).toBeNull()
		);
		expect(container.querySelector('[data-testid="member-deactivate-failed-m2"]')).toBeNull();
		consoleSpy.mockRestore();
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
