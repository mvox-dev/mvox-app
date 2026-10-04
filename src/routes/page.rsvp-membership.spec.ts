// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/pages/agendaCopy')).agendaMessages({
		rsvp_non_member_hint: () => 'Only members can RSVP.'
	})
);

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).rightsModule(await importOriginal())
);
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).databaseEntityModule(await importOriginal())
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('records')
);
vi.mock('$lib/rsvp/rsvpOptimistic', async () =>
	(await import('$lib/testing/mocks/events')).rsvpOptimisticModule()
);

vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule({ lists: 'bare', byMember: 'records' })
);

vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);

import Page from './+page.svelte';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock,
	resolveManageRightsMock
} from '$lib/testing/moduleHandles';
import { applyRsvpChangeMock } from '$lib/testing/mocks/events';
import { EVENT } from '$lib/testing/pages/agenda';

function setAuthedWithOneCollective() {
	signIn();
	completionGateStore.set('complete');
}

async function waitForGoingButton(container: HTMLElement) {
	return waitFor(() => {
		const btn = container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
		expect(btn).not.toBeNull();
		return btn!;
	});
}

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	applyRsvpChangeMock.mockReset();
	resolveManageRightsMock.mockReset();
	resetAppState();
	resetGate();
});

describe('+page — membership is display, the Entu grant is the gate (#372)', () => {
	const AGENDA = () =>
		fullAgendaResult({ seasons: [], upcoming: [EVENT], recent: [], seasonId: null, seasonConductors: [], seasonOwners: [], seasonEditors: [] });

	it("membership 'loading' alone never disables OR enables: the grant says editor while the member lookup hangs -> ENABLED", async () => {
		loadFullAgendaMock.mockResolvedValue(AGENDA());
		findMyMemberIdMock.mockReturnValue(new Promise(() => {})); // never resolves
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		resolveManageRightsMock.mockResolvedValue('editor');
		setAuthedWithOneCollective();

		const { container } = render(Page);
		const btn = await waitForGoingButton(container);

		await waitFor(() => {
			expect(btn.disabled).toBe(false);
		});
		expect(container.textContent).not.toContain('Only members can RSVP.');

		expect(
			resolveManageRightsMock.mock.calls.some(
				(c) => (c[0] as { db?: string })?.db === 'sampledb' && c[1] === 'person-p' && c[2] === 'person-p'
			)
		).toBe(true);
	});

	it('a CONFIRMED non-member without the grant: the hint STAYS (display) and the control is NOT rendered — two separate facts', async () => {
		loadFullAgendaMock.mockResolvedValue(AGENDA());
		findMyMemberIdMock.mockResolvedValue(null);
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		resolveManageRightsMock.mockResolvedValue('not-editor');
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="rsvp-control"]')).toBeNull();
	});

	it('an ACTIVE member without the grant sees NO control and NO hint — the #369 trap', async () => {
		loadFullAgendaMock.mockResolvedValue(AGENDA());
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		resolveManageRightsMock.mockResolvedValue('not-editor');
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(
				resolveManageRightsMock.mock.calls.some((c) => c[1] === 'person-p' && c[2] === 'person-p')
			).toBe(true);
		});
		await waitFor(() => expect(findMyMemberIdMock).toHaveBeenCalled());
		await Promise.resolve();
		await Promise.resolve();

		expect(container.querySelector('[data-testid="rsvp-control"]')).toBeNull();
		expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).toBeNull();
	});

	it('a membership lookup FAILURE shows no false hint — and the grant alone still ENABLES', async () => {
		loadFullAgendaMock.mockResolvedValue(AGENDA());
		findMyMemberIdMock.mockRejectedValue(new Error('lookup boom'));
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		resolveManageRightsMock.mockResolvedValue('editor');
		setAuthedWithOneCollective();

		const { container } = render(Page);
		const btn = await waitForGoingButton(container);

		await waitFor(() => expect(findMyMemberIdMock).toHaveBeenCalled());
		await Promise.resolve();
		await Promise.resolve();

		await waitFor(() => {
			expect(btn.disabled).toBe(false);
		});
		expect(container.textContent).not.toContain('Only members can RSVP.');
	});
});

describe('+page — write-failure feedback (a rejected rsvp save)', () => {
	it('a rejected write surfaces a per-row save-failed error AND reverts the optimistic value', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [], upcoming: [EVENT], recent: [], seasonId: null, seasonConductors: [], seasonOwners: [], seasonEditors: [] }));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		resolveManageRightsMock.mockResolvedValue('editor'); // #372 — the grant enables the tap
		applyRsvpChangeMock.mockRejectedValue(new Error('save failed'));
		setAuthedWithOneCollective();

		const { container } = render(Page);
		const goingBtn = await waitForGoingButton(container);
		await waitFor(() => expect(goingBtn.disabled).toBe(false));

		await fireEvent.click(goingBtn);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="rsvp-save-failed"]')).not.toBeNull();
		});
		expect(container.textContent).toContain('Could not save your answer.');
		const goingAfter = container.querySelector('[data-testid="rsvp-btn-going"]');
		expect(goingAfter?.getAttribute('aria-pressed')).toBe('false');
	});
});

// (*MVOX:Tallis*)
