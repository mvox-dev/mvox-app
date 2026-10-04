// @vitest-environment happy-dom
// The agenda's RSVP control asks Entu whether the singer may write.
import { render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred, json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
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
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';
import { E1, RIGHTS_URL, SELF_EDITOR, agendaWith, cleanupResetRsvpMocks, row, setAuthed, stubWire, waitForRow } from '$lib/testing/pages/agendaRsvp';

const RIGHTS_URL_OTHER =
	'https://api.entu-test.invalid/other-choir/entity/person-p?props=_owner,_editor';

const SELF_OWNER_ONLY = { _id: 'person-p', _owner: [{ reference: 'person-p' }] };
const NO_GRANT = { _id: 'person-p' };
const GRANTS_EXCLUDE_SELF = {
	_id: 'person-p',
	_owner: [{ reference: 'org-admin' }],
	_editor: [{ reference: 'someone-else' }, { reference: 'another-person' }]
};

function rsvpButtons(container: HTMLElement): HTMLButtonElement[] {
	return Array.from(container.querySelectorAll('button[data-testid^="rsvp-btn-"]'));
}

function rightsCalls(fetchStub: ReturnType<typeof vi.fn>, url: string) {
	return fetchStub.mock.calls.filter((c) => String(c[0]) === url);
}

afterEach(cleanupResetRsvpMocks);

describe('+page — RSVP enablement is the Entu grant on the singer’s own person (#372)', () => {
	it('WIRE: enablement is GET entity/{personId}?props=_owner,_editor — full shape — and does NOT wait on findMyMemberId', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockReturnValue(new Promise(() => {}));
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		const fetchStub = stubWire({ [RIGHTS_URL]: { body: SELF_EDITOR } });
		setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);

		const { container } = render(Page);

		await waitFor(() => {
			expect(rightsCalls(fetchStub, RIGHTS_URL).length).toBeGreaterThan(0);
		});
		const [, init] = rightsCalls(fetchStub, RIGHTS_URL)[0] as [unknown, RequestInit | undefined];
		expect(init?.method ?? 'GET').toBe('GET');
		expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer jwt-abc');

		await waitFor(() => {
			const btn = row(container, 'e1')?.querySelector(
				'[data-testid="rsvp-btn-going"]'
			) as HTMLButtonElement | null;
			expect(btn).not.toBeNull();
			expect(btn!.disabled).toBe(false);
		});
	});

	it('self-_editor on her person -> all four buttons enabled, no hint', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		const fetchStub = stubWire({ [RIGHTS_URL]: { body: SELF_EDITOR } });
		setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);

		const { container } = render(Page);
		await waitForRow(container, 'e1');
		await waitFor(() => {
			expect(rightsCalls(fetchStub, RIGHTS_URL).length).toBeGreaterThan(0);
		});

		await waitFor(() => {
			for (const status of ['going', 'not_going', 'maybe', 'late']) {
				const btn = row(container, 'e1')?.querySelector(
					`[data-testid="rsvp-btn-${status}"]`
				) as HTMLButtonElement | null;
				expect(btn, `rsvp-btn-${status}`).not.toBeNull();
				expect(btn!.disabled, `rsvp-btn-${status}`).toBe(false);
			}
		});
		expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).toBeNull();
	});

	it('self-_owner only -> enabled (ownership subsumes editing)', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		const fetchStub = stubWire({ [RIGHTS_URL]: { body: SELF_OWNER_ONLY } });
		setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);

		const { container } = render(Page);

		await waitFor(() => {
			expect(rightsCalls(fetchStub, RIGHTS_URL).length).toBeGreaterThan(0);
		});
		await waitFor(() => {
			const btn = row(container, 'e1')?.querySelector(
				'[data-testid="rsvp-btn-going"]'
			) as HTMLButtonElement | null;
			expect(btn).not.toBeNull();
			expect(btn!.disabled).toBe(false);
		});
	});

	it('no grant (rights props ABSENT — the private-bucket read of a no-grant caller) -> the control is NOT rendered, even for an active member', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1'); // an ACTIVE member — #369's trap
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		const fetchStub = stubWire({ [RIGHTS_URL]: { body: NO_GRANT } });
		setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);

		const { container } = render(Page);
		const r = await waitForRow(container, 'e1');

		await waitFor(() => {
			expect(rightsCalls(fetchStub, RIGHTS_URL).length).toBeGreaterThan(0);
		});
		await waitFor(() => expect(findMyMemberIdMock).toHaveBeenCalled());
		await Promise.resolve();
		await Promise.resolve();

		expect(r.querySelector('[data-testid="rsvp-control"]')).toBeNull();
		expect(container.querySelectorAll('[data-testid="rsvp-control"]').length).toBe(0);
		expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).toBeNull();
	});

	it('rights UNRESOLVED (read still in flight) -> disabled, no hint, no invitation', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		stubWire({ [RIGHTS_URL]: { hold: true } });
		setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);

		const { container } = render(Page);
		await waitForRow(container, 'e1');
		await waitFor(() => expect(findMyMemberIdMock).toHaveBeenCalled());
		await Promise.resolve();
		await Promise.resolve();

		const buttons = rsvpButtons(container);
		expect(buttons.every((b) => b.disabled)).toBe(true);
		expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).toBeNull();
	});

	it('a collective switch mid-flight DISCARDS the stale rights answer (sameCollectiveIdentity guard)', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		const stale = deferred<Response>();
		const fetchStub = stubWire({
			[RIGHTS_URL]: { deferredResponse: stale.promise }, // sampledb: held, resolves LATE
			[RIGHTS_URL_OTHER]: { hold: true } // other-choir: unresolved
		});
		setAuthed([
			{ db: 'sampledb', name: 'Sampledb' },
			{ db: 'other-choir', name: 'Other Choir' }
		]);

		const { container } = render(Page);
		await waitFor(() => {
			expect(rightsCalls(fetchStub, RIGHTS_URL).length).toBeGreaterThan(0);
		});

		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => {
			expect(rightsCalls(fetchStub, RIGHTS_URL_OTHER).length).toBeGreaterThan(0);
		});

		stale.resolve(json({ entity: SELF_EDITOR }));
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		const buttons = rsvpButtons(container);
		expect(buttons.every((b) => b.disabled)).toBe(true);
	});

	it('#369 regression: rights props present but self in NEITHER (the 19-of-24 shape) -> never an enabled button, no control', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1'); // active member, like all 19
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		const fetchStub = stubWire({ [RIGHTS_URL]: { body: GRANTS_EXCLUDE_SELF } });
		setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);

		const { container } = render(Page);
		const r = await waitForRow(container, 'e1');
		await waitFor(() => {
			expect(rightsCalls(fetchStub, RIGHTS_URL).length).toBeGreaterThan(0);
		});
		await Promise.resolve();
		await Promise.resolve();

		expect(rsvpButtons(container).filter((b) => !b.disabled).length).toBe(0);
		expect(r.querySelector('[data-testid="rsvp-control"]')).toBeNull();
	});

	it('F1: a CONFIRMED non-member who still holds self-_editor gets the hint, NOT an enabled control', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue(null); // archived / not yet accepted
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		const fetchStub = stubWire({ [RIGHTS_URL]: { body: SELF_EDITOR } });
		setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);

		const { container } = render(Page);
		const r = await waitForRow(container, 'e1');
		await waitFor(() => {
			expect(rightsCalls(fetchStub, RIGHTS_URL).length).toBeGreaterThan(0);
		});
		await waitFor(() => {
			expect(r.querySelector('[data-testid="rsvp-non-member-hint"]')).not.toBeNull();
		});
		expect(r.querySelector('[data-testid="rsvp-control"]')).toBeNull();
		expect(rsvpButtons(container)).toEqual([]);
	});
});

// (*MVOX:Tallis*)
