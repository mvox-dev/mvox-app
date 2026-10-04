// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor } from '@testing-library/svelte';
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
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock,
	resolveManageRightsMock
} from '$lib/testing/moduleHandles';
import { setAuthedWithOneCollective } from '$lib/testing/pages/roster';

const EVENT = {
	id: 'e1',
	name: 'Rehearsal e1',
	startDatetime: '2026-06-15T09:00:00.000Z',
	durationMinutes: 90,
	location: '',
	conductors: [],
	owners: [],
	editors: []
};

function goingButton(container: HTMLElement) {
	return container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
}
async function waitForGoingButton(container: HTMLElement) {
	return waitFor(() => {
		const btn = goingButton(container);
		expect(btn).not.toBeNull();
		return btn!;
	});
}

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	resolveManageRightsMock.mockReset();
	resetAppState();
	resetGate();
});

describe('+page — completion gate suppresses S1 (the member RSVP affordance)', () => {
	it('an INCOMPLETE member (real grant, gate incomplete) is NOT shown as a member: control disabled AND no non-member hint (never mislabeled)', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [], upcoming: [EVENT], recent: [], seasonId: null, seasonConductors: [], seasonOwners: [], seasonEditors: [] }));
		findMyMemberIdMock.mockResolvedValue('member-1'); // she IS an active member
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		resolveManageRightsMock.mockResolvedValue('editor'); // #372 — she HAS the grant
		completionGateStore.set('incomplete'); // ...but her domain name is missing
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await waitForGoingButton(container);
		await vi.waitFor(() => expect(findMyMemberIdMock).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 0));

		const btn = goingButton(container)!;
		expect(btn.disabled).toBe(true); // S1 must NOT light for an incomplete member
		expect(container.textContent).not.toContain('Only members can RSVP.'); // she is a member, not a non-member
	});

	it('a COMPLETE member (gate complete) IS shown as a member: control enabled (the release path)', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [], upcoming: [EVENT], recent: [], seasonId: null, seasonConductors: [], seasonOwners: [], seasonEditors: [] }));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		resolveManageRightsMock.mockResolvedValue('editor');
		completionGateStore.set('complete');
		setAuthedWithOneCollective();

		const { container } = render(Page);
		const btn = await waitForGoingButton(container);
		await waitFor(() => expect(btn.disabled).toBe(false));
		expect(container.textContent).not.toContain('Only members can RSVP.');
	});

	it('a member with the gate still LOADING is disabled with NO hint (no flash of the member affordance)', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [], upcoming: [EVENT], recent: [], seasonId: null, seasonConductors: [], seasonOwners: [], seasonEditors: [] }));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		resolveManageRightsMock.mockResolvedValue('editor');
		completionGateStore.set('loading');
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await waitForGoingButton(container);
		await vi.waitFor(() => expect(findMyMemberIdMock).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 0));

		const btn = goingButton(container)!;
		expect(btn.disabled).toBe(true);
		expect(container.textContent).not.toContain('Only members can RSVP.');
	});

	it('a GENUINE non-member with no grant is unaffected by the (complete) gate: the hint shows, NO control renders (no over-reach)', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [], upcoming: [EVENT], recent: [], seasonId: null, seasonConductors: [], seasonOwners: [], seasonEditors: [] }));
		findMyMemberIdMock.mockResolvedValue(null); // confirmed non-member
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		resolveManageRightsMock.mockResolvedValue('not-editor');
		completionGateStore.set('complete');
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await waitFor(() => expect(container.textContent).toContain('Only members can RSVP.'));
		expect(container.querySelector('[data-testid="rsvp-control"]')).toBeNull();
	});

	for (const gate of ['incomplete', 'loading'] as const) {
		it(`F2: gate='${gate}' must not resurrect a control for a CONFIRMED no-grant member — nothing renders`, async () => {
			loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [], upcoming: [EVENT], recent: [], seasonId: null, seasonConductors: [], seasonOwners: [], seasonEditors: [] }));
			findMyMemberIdMock.mockResolvedValue('member-1'); // active member, no grant
			listMyRsvpsMock.mockResolvedValue(toListRead([]));
			resolveManageRightsMock.mockResolvedValue('not-editor');
			completionGateStore.set(gate);
			setAuthedWithOneCollective();

			const { container } = render(Page);
			await vi.waitFor(() => expect(resolveManageRightsMock).toHaveBeenCalled());
			await new Promise((r) => setTimeout(r, 0));

			expect(container.querySelector('[data-testid="rsvp-control"]')).toBeNull();
			expect(goingButton(container)).toBeNull();
			expect(container.textContent).not.toContain('Only members can RSVP.');
		});
	}
});

// (*MVOX:Tallis*)
