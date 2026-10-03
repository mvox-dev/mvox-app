// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const {
	loadRosterMock,
	listSectionsMock,
	deactivateMemberMock,
	reinstateMemberMock,
	loadInactiveRosterMock,
	listInactiveMembersMock,
	listDeactivateBlockersMock,
	createInviteMock,
	mintSelfLinkInviteMock,
	withdrawInviteMock,
	listJoinStatesMock,
	listJoinStateDetailsMock,
	resolveOwnerTierMock,
	loadMemberRecordMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	deactivateMemberMock: vi.fn(),
	reinstateMemberMock: vi.fn(),
	loadInactiveRosterMock: vi.fn(),
	listInactiveMembersMock: vi.fn(),
	listDeactivateBlockersMock: vi.fn(),
	createInviteMock: vi.fn(),
	mintSelfLinkInviteMock: vi.fn(),
	withdrawInviteMock: vi.fn(),
	listJoinStatesMock: vi.fn(),
	listJoinStateDetailsMock: vi.fn(),
	resolveOwnerTierMock: vi.fn(),
	loadMemberRecordMock: vi.fn()
}));

vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/roster/memberLifecycle', () => ({
	deactivateMember: deactivateMemberMock,
	reinstateMember: reinstateMemberMock,
	loadInactiveRoster: loadInactiveRosterMock,
	listInactiveMembers: listInactiveMembersMock,
	listDeactivateBlockers: listDeactivateBlockersMock
}));
vi.mock('$lib/invite/inviteData', async (importActual) => ({
	...(await importActual<typeof import('$lib/invite/inviteData')>()),
	createInvite: createInviteMock,
	mintSelfLinkInvite: mintSelfLinkInviteMock,
	withdrawInvite: withdrawInviteMock
}));
vi.mock('$lib/profile/linkedIdentities', async (importActual) => ({
	...(await importActual<typeof import('$lib/profile/linkedIdentities')>()),
	listJoinStates: listJoinStatesMock,
	listJoinStateDetails: listJoinStateDetailsMock
}));
vi.mock('$lib/nav/adminStore', async (importActual) => ({
	...(await importActual<typeof import('$lib/nav/adminStore')>()),
	resolveOwnerTier: resolveOwnerTierMock
}));
vi.mock('$lib/roster/memberRecord', async (importActual) => ({
	...(await importActual<typeof import('$lib/roster/memberRecord')>()),
	loadMemberRecord: loadMemberRecordMock
}));
vi.mock('$lib/library/librarianStore', async (importActual) => ({
	...(await importActual<typeof import('$lib/library/librarianStore')>()),
	resolveMyLibraryId: vi.fn().mockResolvedValue('lib-1'),
	resolveLibrarian: vi.fn().mockResolvedValue({ state: 'ready', libraryId: 'lib-1' })
}));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

import Page from './roster/+page.svelte';
import type { RosterRow } from '$lib/roster/rosterData';
import type { SectionNode } from '$lib/sections/sectionData';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures';
import { isoDateFormatter } from '$lib/preferences/timeFormat';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

const CREATED_AT: Record<string, string> = {
	m1: '2026-05-02T12:00:00.000Z',
	m2: '2026-05-03T12:00:00.000Z',
	m3: '2026-05-04T12:00:00.000Z',
	m4: '2026-08-15T12:00:00.000Z',
	'm-bob': '2026-07-01T12:00:00.000Z'
};

function rowsA(): RosterRow[] {
	return [
		{ memberId: 'm1', personId: 'person-p', name: 'Alice Alto', email: 'alice@example.com', sectionIds: [], dbEntityId: ORG_A, createdAt: CREATED_AT.m1 } as RosterRow,
		{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com', sectionIds: [], dbEntityId: ORG_A, createdAt: CREATED_AT.m2 } as RosterRow,
		{ memberId: 'm3', personId: 'pp-3', name: 'Carl Cantor', email: 'carl@example.com', sectionIds: [], dbEntityId: ORG_A, createdAt: CREATED_AT.m3 } as RosterRow,
		{ memberId: 'm4', personId: 'pp-4', name: 'Dora Descant', email: 'dora@example.com', sectionIds: [], dbEntityId: ORG_A, createdAt: CREATED_AT.m4 } as RosterRow
	];
}

function rowsB(): RosterRow[] {
	return [
		{ memberId: 'm-bob', personId: 'p-bob', name: 'Bob Bass', email: 'bob@x.com', sectionIds: [], dbEntityId: ORG_B, createdAt: CREATED_AT['m-bob'] } as RosterRow
	];
}

function treeA(): SectionNode[] {
	return [
		{ id: 'sec-alto', name: 'Alto', displayOrder: 1, parentId: null, dbEntityId: ORG_A, depth: 0, children: [] }
	];
}

function treeB(): SectionNode[] {
	return [
		{ id: 'sec-b1', name: 'Bass I', displayOrder: 1, parentId: null, dbEntityId: ORG_B, depth: 0, children: [] }
	];
}

type JoinState = 'absent' | 'invited' | 'joined';
type JoinStateDetail = { state: JoinState; at?: string };

let joinStatesByDb: Record<string, Record<string, JoinState>>;
let joinDatesByDb: Record<string, Record<string, string>>;

function detailsFor(db: string, personIds: string[]): Record<string, JoinStateDetail> {
	return Object.fromEntries(
		personIds.map((id) => {
			const state = joinStatesByDb[db]?.[id] ?? 'absent';
			const at = state === 'absent' ? undefined : joinDatesByDb[db]?.[id];
			return [id, at === undefined ? { state } : { state, at }];
		})
	);
}

function setAuthedWithTwoCollectives() {
	signIn({
		collectives: [
			{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
			{ db: 'other-choir', name: 'Other Choir', personId: 'person-q' }
		]
	});
}

beforeEach(() => {
	joinStatesByDb = {
		sampledb: { 'person-p': 'joined', 'pp-2': 'joined', 'pp-3': 'invited', 'pp-4': 'absent' },
		'other-choir': { 'p-bob': 'absent' }
	};
	joinDatesByDb = {
		sampledb: {
			'person-p': '2026-05-06T12:00:00.000Z',
			'pp-2': '2026-09-10T12:00:00.000Z',
			'pp-3': new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 h ago — invited, NOT expired
			'pp-4': new Date(Date.now() - 60 * 60 * 1000).toISOString()
		},
		'other-choir': { 'p-bob': new Date(Date.now() - 60 * 60 * 1000).toISOString() }
	};
	loadRosterMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(toListRead(cfg.db === 'sampledb' ? rowsA() : rowsB()))
	);
	listSectionsMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(cfg.db === 'sampledb' ? treeA() : treeB())
	);
	listJoinStatesMock.mockImplementation((cfg: { db: string }, personIds: string[]) =>
		Promise.resolve(
			Object.fromEntries(
				personIds.map((id) => [id, joinStatesByDb[cfg.db]?.[id] ?? 'absent'])
			)
		)
	);
	listJoinStateDetailsMock.mockImplementation((cfg: { db: string }, personIds: string[]) =>
		Promise.resolve(detailsFor(cfg.db, personIds))
	);
	resolveOwnerTierMock.mockResolvedValue('owner');
	mintSelfLinkInviteMock.mockResolvedValue({ inviteToken: 'tok-fresh-1' });
	withdrawInviteMock.mockResolvedValue(undefined);
	deactivateMemberMock.mockResolvedValue(undefined);
	reinstateMemberMock.mockResolvedValue(undefined);
	loadInactiveRosterMock.mockResolvedValue(toListRead([]));
	listInactiveMembersMock.mockResolvedValue(toListRead([]));
	listDeactivateBlockersMock.mockResolvedValue([]);
	loadMemberRecordMock.mockResolvedValue({ state: 'none' });
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	if (originalClipboardDesc) {
		Object.defineProperty(navigator, 'clipboard', originalClipboardDesc);
	} else {
		Reflect.deleteProperty(navigator, 'clipboard');
	}
	resetAppState();
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

const originalClipboardDesc = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function setClipboard(value: unknown): void {
	Object.defineProperty(navigator, 'clipboard', {
		value,
		configurable: true,
		writable: true
	});
}

function allControls(container: HTMLElement): Element[] {
	return [
		...container.querySelectorAll(
			'[data-testid^="roster-member-invite-"], [data-testid^="roster-member-reinvite-"], [data-testid^="roster-member-withdraw-"]'
		)
	];
}

async function renderRoster(
	opts: { admin?: 'admin' | 'not-admin'; tier?: 'owner' | 'editor' | 'none' | 'error' } = {}
) {
	resolveOwnerTierMock.mockResolvedValue(opts.tier ?? 'owner');
	const utils = render(Page);
	setAuthedWithTwoCollectives();
	adminStore.set(opts.admin ?? 'admin');
	await waitFor(() =>
		expect(
			utils.container.querySelector('[data-testid="section-toggle-unassigned"]')
		).not.toBeNull()
	);
	await fireEvent.click(
		utils.container.querySelector('[data-testid="section-toggle-unassigned"]')!
	);
	await waitFor(() =>
		expect(utils.container.querySelector('[data-testid="roster-row-m2"]')).not.toBeNull()
	);
	return utils;
}

async function switchToOtherChoir(container: HTMLElement) {
	selectedCollectiveDbStore.set('other-choir');
	await waitFor(() => expect(q(container, 'section-toggle-sec-b1')).not.toBeNull());
	await fireEvent.click(q(container, 'section-toggle-unassigned')!);
	await waitFor(() => expect(q(container, 'roster-row-m-bob')).not.toBeNull());
}

async function openCard(container: HTMLElement, memberId: string) {
	const li = q(container, `roster-row-${memberId}`);
	expect(li, `roster-row-${memberId} must render`).not.toBeNull();
	if (li!.querySelector('[data-testid="roster-record-name"]')) return; // already open
	const card = q(container, `roster-row-card-${memberId}`);
	expect(card, `#302: collapsed-card activator roster-row-card-${memberId} must render`).not.toBeNull();
	await fireEvent.click(card!);
	await waitFor(() =>
		expect(
			q(container, `roster-row-${memberId}`)!.querySelector('[data-testid="roster-record-name"]')
		).not.toBeNull()
	);
}

describe('(A) dated status lines — #467: one line per row, four display states, the read still the gate', () => {

	const fmtDate = isoDateFormatter();

	function lineLabel(display: 'absent' | 'invited' | 'expired' | 'joined', at: string): string {
		return `[roster_member_join_state_${display} ${JSON.stringify({ date: fmtDate.format(new Date(at)) })}]`;
	}

	function chipSet(container: HTMLElement): Record<string, { state: string | null; label: string }> {
		return Object.fromEntries(
			[...container.querySelectorAll('[data-testid^="roster-row-join-state-"]')].map((el) => [
				el.getAttribute('data-testid')!,
				{ state: el.getAttribute('data-join-state'), label: (el.textContent ?? '').trim() }
			])
		);
	}

	function expectedLinesSampledb(): Record<string, { state: string; label: string }> {
		return {
			'roster-row-join-state-m1': {
				state: 'joined',
				label: lineLabel('joined', joinDatesByDb.sampledb['person-p'])
			},
			'roster-row-join-state-m2': {
				state: 'joined',
				label: lineLabel('joined', joinDatesByDb.sampledb['pp-2'])
			},
			'roster-row-join-state-m3': {
				state: 'invited',
				label: lineLabel('invited', joinDatesByDb.sampledb['pp-3'])
			},
			'roster-row-join-state-m4': {
				state: 'absent',
				label: lineLabel('absent', CREATED_AT.m4)
			}
		};
	}

	it('an owner-admin sees ONE dated line on EVERY readable row — all four states, exact text with the yyyy-mm-dd date; a 1 h-old invite reads INVITED, and joined now RENDERS (member since)', async () => {
		const { container } = await renderRoster();
		await waitFor(() => expect(q(container, 'roster-row-join-state-m3')).not.toBeNull());
		expect(chipSet(container)).toEqual(expectedLinesSampledb());
	});

	it('the presence-check trap, still pinned: an invited-but-never-joined member renders INVITED (dated), never member-since', async () => {
		const { container } = await renderRoster();
		await waitFor(() => expect(q(container, 'roster-row-join-state-m3')).not.toBeNull());
		expect(q(container, 'roster-row-join-state-m3')!.getAttribute('data-join-state')).toBe('invited');
		expect(q(container, 'roster-row-join-state-m3')!.getAttribute('data-join-state')).not.toBe('joined');
	});

	it("EXPIRED is display-only: a placeholder minted 25 h ago renders data-join-state='expired' with the expired copy — while the OWNER CONTROLS still route it exactly as invited (saada uuesti + tühista kutse, no kutsu)", async () => {
		const at25hAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
		joinDatesByDb.sampledb['pp-3'] = at25hAgo;
		const { container } = await renderRoster();
		await waitFor(() => expect(q(container, 'roster-row-join-state-m3')).not.toBeNull());
		expect(q(container, 'roster-row-join-state-m3')!.getAttribute('data-join-state')).toBe('expired');
		expect(q(container, 'roster-row-join-state-m3')!.textContent?.trim()).toBe(
			lineLabel('expired', at25hAgo)
		);
		await openCard(container, 'm3');
		await waitFor(() => expect(q(container, 'roster-member-reinvite-m3')).not.toBeNull());
		expect(q(container, 'roster-member-withdraw-m3')).not.toBeNull();
		expect(q(container, 'roster-member-invite-m3')).toBeNull();
	});

	it('#454: a NON-admin reader whose read returned states sees EXACTLY the lines an admin sees — the read is the gate, not the role (joined included)', async () => {
		const admin = await renderRoster();
		await waitFor(() => expect(q(admin.container, 'roster-row-join-state-m3')).not.toBeNull());
		const adminLines = chipSet(admin.container);
		expect(adminLines).toEqual(expectedLinesSampledb());
		cleanup();

		const { container } = await renderRoster({ admin: 'not-admin' });
		await waitFor(() => expect(q(container, 'roster-row-join-state-m3')).not.toBeNull());
		expect(chipSet(container)).toEqual(adminLines);
	});

	it('#454 PAGE guard: a personId the detail record OMITS (withheld bucket) renders NO line, while the keys present render theirs — never a guessed one', async () => {
		listJoinStateDetailsMock.mockImplementation((cfg: { db: string }, personIds: string[]) =>
			Promise.resolve(detailsFor(cfg.db, personIds.filter((id) => id !== 'pp-4')))
		);
		const { container } = await renderRoster({ admin: 'not-admin' });
		await waitFor(() => expect(q(container, 'roster-row-join-state-m3')).not.toBeNull());
		const expected = expectedLinesSampledb();
		delete (expected as Record<string, unknown>)['roster-row-join-state-m4'];
		expect(chipSet(container)).toEqual(expected);
	});

	it('#467 done-when 3, absent shape: a row with NO readable member _created (createdAt undefined) renders NOTHING — no bare label, no guessed date; the other rows keep their lines', async () => {
		loadRosterMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(
				toListRead(
					cfg.db === 'sampledb'
						? rowsA().map((r) =>
								r.memberId === 'm4'
									? ({ ...r, createdAt: undefined } as RosterRow)
									: r
							)
						: rowsB()
				)
			)
		);
		const { container } = await renderRoster();
		await waitFor(() => expect(q(container, 'roster-row-join-state-m3')).not.toBeNull());
		expect(q(container, 'roster-row-m4'), 'the row itself still renders').not.toBeNull();
		const expected = expectedLinesSampledb();
		delete (expected as Record<string, unknown>)['roster-row-join-state-m4'];
		expect(chipSet(container)).toEqual(expected);
	});

	it('#467 done-when 3, invited shape: an invited row whose property stamp could not be read (detail.at undefined) renders NOTHING — the state alone is not a line', async () => {
		delete joinDatesByDb.sampledb['pp-3'];
		const { container } = await renderRoster();
		await waitFor(() => expect(q(container, 'roster-row-join-state-m4')).not.toBeNull());
		expect(q(container, 'roster-row-m3'), 'the row itself still renders').not.toBeNull();
		expect(chipSet(container)).toEqual({
			'roster-row-join-state-m1': {
				state: 'joined',
				label: lineLabel('joined', joinDatesByDb.sampledb['person-p'])
			},
			'roster-row-join-state-m2': {
				state: 'joined',
				label: lineLabel('joined', joinDatesByDb.sampledb['pp-2'])
			},
			'roster-row-join-state-m4': {
				state: 'absent',
				label: lineLabel('absent', CREATED_AT.m4)
			}
		});
	});

	for (const [shape, bad] of [
		['a JSON null', null],
		['a garbage string', 'not-a-date']
	] as const) {
		it(`#467 done-when 3, absent shape: ${shape} member _created renders NOTHING — no 1970-01-01, no RangeError, the row and every other line intact`, async () => {
			loadRosterMock.mockImplementation((cfg: { db: string }) =>
				Promise.resolve(
					toListRead(
						cfg.db === 'sampledb'
							? rowsA().map((r) =>
									r.memberId === 'm4' ? ({ ...r, createdAt: bad } as unknown as RosterRow) : r
								)
							: rowsB()
					)
				)
			);
			const { container } = await renderRoster();
			await waitFor(() => expect(q(container, 'roster-row-join-state-m3')).not.toBeNull());
			expect(q(container, 'roster-row-m4'), 'the row itself still renders').not.toBeNull();
			const expected = expectedLinesSampledb();
			delete (expected as Record<string, unknown>)['roster-row-join-state-m4'];
			expect(chipSet(container)).toEqual(expected);
		});

		it(`#467 done-when 3, invited shape: ${shape} property stamp renders NOTHING — no 1970-01-01, no RangeError, the other rows keep their lines`, async () => {
			joinDatesByDb.sampledb['pp-3'] = bad as unknown as string;
			const { container } = await renderRoster();
			await waitFor(() => expect(q(container, 'roster-row-join-state-m4')).not.toBeNull());
			expect(q(container, 'roster-row-m3'), 'the row itself still renders').not.toBeNull();
			expect(chipSet(container)).toEqual({
				'roster-row-join-state-m1': {
					state: 'joined',
					label: lineLabel('joined', joinDatesByDb.sampledb['person-p'])
				},
				'roster-row-join-state-m2': {
					state: 'joined',
					label: lineLabel('joined', joinDatesByDb.sampledb['pp-2'])
				},
				'roster-row-join-state-m4': {
					state: 'absent',
					label: lineLabel('absent', CREATED_AT.m4)
				}
			});
		});
	}

	it('#454 WIRE refusal, the REACHABLE shape: HTTP 200 with the private bucket withheld — driven through the REAL dated producer — leaves every row line-less while the rows render', async () => {
		const actual =
			await vi.importActual<typeof import('$lib/profile/linkedIdentities')>(
				'$lib/profile/linkedIdentities'
			);
		const withheldFetch = vi.fn().mockImplementation((url: string) => {
			const id = String(url).split('/entity/')[1]?.split('?')[0] ?? '';
			return Promise.resolve(
				new Response(JSON.stringify({ entity: { _id: id } }), { status: 200 })
			);
		}) as unknown as typeof fetch;
		listJoinStatesMock.mockImplementation((cfg: { db: string; token: string }, ids: string[]) =>
			actual.listJoinStates(cfg, ids, withheldFetch)
		);
		listJoinStateDetailsMock.mockImplementation((cfg: { db: string; token: string }, ids: string[]) =>
			(
				actual as unknown as {
					listJoinStateDetails: (
						cfg: { db: string; token: string },
						ids: string[],
						fetchImpl?: typeof fetch
					) => Promise<Record<string, JoinStateDetail>>;
				}
			).listJoinStateDetails(cfg, ids, withheldFetch)
		);

		const { container } = await renderRoster({ admin: 'not-admin' });
		expect(q(container, 'roster-row-m3'), 'the roster rows must be on screen').not.toBeNull();
		expect(withheldFetch, 'the real producer must have issued the reads').toHaveBeenCalled();
		expect(chipSet(container)).toEqual({});
	});

	it('#454 WIRE refusal, the LOUD shape: an HTTP failure rejects the whole fan-out and the page carries NO line on any row', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		listJoinStatesMock.mockRejectedValue(
			new Error('listLinkedIdentities: identity read failed: HTTP 403')
		);
		listJoinStateDetailsMock.mockRejectedValue(
			new Error('listLinkedIdentities: identity read failed: HTTP 403')
		);
		const { container } = await renderRoster({ admin: 'not-admin' });
		expect(q(container, 'roster-row-m3'), 'the roster rows must be on screen').not.toBeNull();
		expect(chipSet(container)).toEqual({});
		expect(errSpy).toHaveBeenCalled();
		errSpy.mockRestore();
	});

	it("INTEGRATION: the route reads through listJoinStateDetails — called with the selected collective's cfg and the rendered rows' personIds — and derives BOTH records from that ONE result (listJoinStates is never called by the page)", async () => {
		await renderRoster();
		await waitFor(() => expect(listJoinStateDetailsMock).toHaveBeenCalled());
		const matching = listJoinStateDetailsMock.mock.calls.some((call) => {
			const [cfg, ids] = call as [{ db: string }, string[]];
			return cfg.db === 'sampledb' && ['pp-2', 'pp-3', 'pp-4'].every((id) => ids.includes(id));
		});
		expect(matching).toBe(true);
		expect(listJoinStatesMock).not.toHaveBeenCalled();
	});

	it('INTEGRATION: the post-mint refresh re-reads through listJoinStateDetails for THAT person (the one-result derivation covers the refresh path too)', async () => {
		const { container } = await renderRoster();
		await openCard(container, 'm4');
		await waitFor(() => expect(q(container, 'roster-member-invite-m4')).not.toBeNull());
		listJoinStateDetailsMock.mockClear();
		await fireEvent.click(q(container, 'roster-member-invite-m4')!);
		await waitFor(() => expect(mintSelfLinkInviteMock).toHaveBeenCalledTimes(1));
		await waitFor(() =>
			expect(
				listJoinStateDetailsMock.mock.calls.some((call) => {
					const [cfg, ids] = call as [{ db: string }, string[]];
					return cfg.db === 'sampledb' && ids.length === 1 && ids[0] === 'pp-4';
				})
			).toBe(true)
		);
		expect(listJoinStatesMock).not.toHaveBeenCalled();
	});
});

describe('(B) controls route by state — owner-admin', () => {
	it('never-invited row (m4): kutsu, and ONLY kutsu', async () => {
		const { container } = await renderRoster();
		await openCard(container, 'm4'); // #302 drive-path edit
		await waitFor(() => expect(q(container, 'roster-member-invite-m4')).not.toBeNull());
		expect(q(container, 'roster-member-reinvite-m4')).toBeNull();
		expect(q(container, 'roster-member-withdraw-m4')).toBeNull();
	});

	it('invited row (m3): saada uuesti AND tühista kutse — and kutsu is UNREACHABLE (a kutsu on a live-link row is a state-routing bug)', async () => {
		const { container } = await renderRoster();
		await openCard(container, 'm3'); // #302 drive-path edit
		await waitFor(() => expect(q(container, 'roster-member-reinvite-m3')).not.toBeNull());
		expect(q(container, 'roster-member-withdraw-m3')).not.toBeNull();
		expect(q(container, 'roster-member-invite-m3')).toBeNull();
	});

	it('joined rows (m1, m2): no controls at all — even with their own editors OPEN (#302: the absence must be meaningful, not just the closed-editor default)', async () => {
		const { container } = await renderRoster();
		await waitFor(() => expect(q(container, 'roster-row-join-state-m3')).not.toBeNull());
		for (const memberId of ['m1', 'm2']) {
			await openCard(container, memberId); // #302 drive-path edit (one at a time)
			expect(q(container, `roster-member-invite-${memberId}`)).toBeNull();
			expect(q(container, `roster-member-reinvite-${memberId}`)).toBeNull();
			expect(q(container, `roster-member-withdraw-${memberId}`)).toBeNull();
		}
	});
});

describe('(C) the controls gate on _owner ONLY — PO ruling 2026-09-09, probe-observed boundary', () => {
	it('an editor-admin gets ZERO control elements — not three disabled buttons, not three failing buttons — and ONE LINE saying invites require owner rights, not silence', async () => {
		const { container } = await renderRoster({ tier: 'editor' });
		await waitFor(() =>
			expect(q(container, 'roster-row-join-state-m3')).not.toBeNull()
		);
		await openCard(container, 'm3');
		expect(allControls(container)).toHaveLength(0);
		const notes = container.querySelectorAll('[data-testid="roster-invite-owner-note"]');
		expect(notes.length).toBeGreaterThanOrEqual(1);
		expect((notes[0].textContent ?? '').trim()).not.toBe('');
	});

	it('an owner-admin gets the controls and NO owner-rights note', async () => {
		const { container } = await renderRoster({ tier: 'owner' });
		await openCard(container, 'm4'); // #302 drive-path edit
		await waitFor(() => expect(q(container, 'roster-member-invite-m4')).not.toBeNull());
		expect(q(container, 'roster-invite-owner-note')).toBeNull();
	});

	it('a NON-admin gets neither controls nor the note', async () => {
		const { container } = await renderRoster({ admin: 'not-admin' });
		expect(allControls(container)).toHaveLength(0);
		expect(q(container, 'roster-invite-owner-note')).toBeNull();
	});

	it("a tier-resolution 'error' fails CLOSED: no controls", async () => {
		const { container } = await renderRoster({ tier: 'error' });
		await waitFor(() =>
			expect(q(container, 'roster-row-join-state-m3')).not.toBeNull()
		);
		await openCard(container, 'm3'); // #302 drive-path edit
		expect(allControls(container)).toHaveLength(0);
	});

	it("INTEGRATION: the route resolves the owner tier for the selected collective's viewer", async () => {
		await renderRoster();
		await waitFor(() => expect(resolveOwnerTierMock).toHaveBeenCalled());
		const matching = resolveOwnerTierMock.mock.calls.some((call) => {
			const [cfg, personId] = call as [{ db: string }, string];
			return cfg.db === 'sampledb' && personId === 'person-p';
		});
		expect(matching).toBe(true);
	});
});

describe('(D) kutsu — first invite, minted onto the EXISTING person', () => {
	it('calls mintSelfLinkInvite (sweep-then-mint) for THAT person, NEVER createInvite, and surfaces the fresh link — the token is the deliverable', async () => {
		const { container } = await renderRoster();
		await openCard(container, 'm4'); // #302 drive-path edit
		await waitFor(() => expect(q(container, 'roster-member-invite-m4')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-invite-m4')!);
		await waitFor(() => expect(mintSelfLinkInviteMock).toHaveBeenCalledTimes(1));
		expect(mintSelfLinkInviteMock.mock.calls[0][0].db).toBe('sampledb');
		expect(mintSelfLinkInviteMock.mock.calls[0][1]).toBe('pp-4');
		expect(createInviteMock).not.toHaveBeenCalled();
		const copyButton = await waitFor(() => {
			const el = q(container, 'roster-invite-copy-m4');
			expect(el).not.toBeNull();
			return el!;
		});
		const writeText = vi.fn().mockResolvedValue(undefined);
		setClipboard({ writeText });
		await fireEvent.click(copyButton);
		await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
		const payload = writeText.mock.calls[0][0] as string;
		expect(payload).toContain('tok-fresh-1');
		expect(payload).toContain('/invite/');
		expect(payload.startsWith(window.location.origin)).toBe(true);
		expect(container.textContent).not.toContain('tok-fresh-1');
	});

	it('after the mint the state is RE-READ and the row follows the contents: kutsu gone, saada uuesti + tühista kutse on', async () => {
		mintSelfLinkInviteMock.mockImplementation(async (_cfg: unknown, personId: string) => {
			joinStatesByDb.sampledb[personId] = 'invited';
			return { inviteToken: 'tok-fresh-1' };
		});
		const { container } = await renderRoster();
		await openCard(container, 'm4'); // #302 drive-path edit
		await waitFor(() => expect(q(container, 'roster-member-invite-m4')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-invite-m4')!);
		await waitFor(() => expect(q(container, 'roster-member-reinvite-m4')).not.toBeNull());
		expect(q(container, 'roster-member-withdraw-m4')).not.toBeNull();
		expect(q(container, 'roster-member-invite-m4')).toBeNull();
		expect(q(container, 'roster-row-join-state-m4')!.getAttribute('data-join-state')).toBe('invited');
	});

	it('a mint failure surfaces as an inline role="alert" on the row — no link panel, and kutsu stays for a retry', async () => {
		mintSelfLinkInviteMock.mockRejectedValue(
			new Error('self-link mint refused: HTTP 403 — the person lacks self-_editor')
		);
		const { container } = await renderRoster();
		await openCard(container, 'm4'); // #302 drive-path edit
		await waitFor(() => expect(q(container, 'roster-member-invite-m4')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-invite-m4')!);
		const alertEl = await waitFor(() => {
			const el = q(container, 'roster-invite-error-m4');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alertEl.getAttribute('role')).toBe('alert');
		expect(q(container, 'roster-invite-copy-m4')).toBeNull();
		expect(q(container, 'roster-member-invite-m4')).not.toBeNull();
	});
});

describe('(E) saada uuesti — atomic replace via the sweep-then-mint producer', () => {
	it('calls mintSelfLinkInvite for the invited person (the invariant — old link dies in the same action — is pinned at the wire in inviteData.withdraw.spec.ts), never createInvite, and surfaces the fresh link', async () => {
		const { container } = await renderRoster();
		await openCard(container, 'm3'); // #302 drive-path edit
		await waitFor(() => expect(q(container, 'roster-member-reinvite-m3')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-reinvite-m3')!);
		await waitFor(() => expect(mintSelfLinkInviteMock).toHaveBeenCalledTimes(1));
		expect(mintSelfLinkInviteMock.mock.calls[0][1]).toBe('pp-3');
		expect(createInviteMock).not.toHaveBeenCalled();
		const copyButton = await waitFor(() => {
			const el = q(container, 'roster-invite-copy-m3');
			expect(el).not.toBeNull();
			return el!;
		});
		const writeText = vi.fn().mockResolvedValue(undefined);
		setClipboard({ writeText });
		await fireEvent.click(copyButton);
		await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
		const payload = writeText.mock.calls[0][0] as string;
		expect(payload).toContain('tok-fresh-1');
		expect(payload).toContain('/invite/');
		expect(payload.startsWith(window.location.origin)).toBe(true);
		expect(container.textContent).not.toContain('tok-fresh-1');
	});
});

describe('(F) tühista kutse — a revocation; withdrawn collapses to never-invited', () => {
	it('calls withdrawInvite for THAT person, mints NOTHING, and on success the row REAPPEARS in the needs-inviting population: badge absent, kutsu on (Mihkel ruling — same state, no marker)', async () => {
		withdrawInviteMock.mockImplementation(async (_cfg: unknown, personId: string) => {
			joinStatesByDb.sampledb[personId] = 'absent';
		});
		const { container } = await renderRoster();
		await openCard(container, 'm3'); // #302 drive-path edit
		await waitFor(() => expect(q(container, 'roster-member-withdraw-m3')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-withdraw-m3')!);
		await waitFor(() => expect(withdrawInviteMock).toHaveBeenCalledTimes(1));
		expect(withdrawInviteMock.mock.calls[0][0].db).toBe('sampledb');
		expect(withdrawInviteMock.mock.calls[0][1]).toBe('pp-3');
		expect(mintSelfLinkInviteMock).not.toHaveBeenCalled();
		await waitFor(() => expect(q(container, 'roster-member-invite-m3')).not.toBeNull());
		expect(q(container, 'roster-member-reinvite-m3')).toBeNull();
		expect(q(container, 'roster-member-withdraw-m3')).toBeNull();
		expect(q(container, 'roster-row-join-state-m3')!.getAttribute('data-join-state')).toBe('absent');
	});

	it('a withdraw failure is FAILURE: inline role="alert", and the row is NOT rendered as withdrawn — the live-credential controls stay (never a partial success rendered as done)', async () => {
		withdrawInviteMock.mockRejectedValue(
			new Error('withdraw failed: HTTP 500 on property eu-old-2 — a placeholder survives')
		);
		const { container } = await renderRoster();
		await openCard(container, 'm3'); // #302 drive-path edit
		await waitFor(() => expect(q(container, 'roster-member-withdraw-m3')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-withdraw-m3')!);
		const alertEl = await waitFor(() => {
			const el = q(container, 'roster-withdraw-error-m3');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alertEl.getAttribute('role')).toBe('alert');
		expect(q(container, 'roster-member-reinvite-m3')).not.toBeNull();
		expect(q(container, 'roster-member-withdraw-m3')).not.toBeNull();
		expect(q(container, 'roster-member-invite-m3')).toBeNull();
		expect(q(container, 'roster-row-join-state-m3')!.getAttribute('data-join-state')).toBe('invited');
	});
});

describe('(G) collective switch — the #287 bug class, kept out of the new feature', () => {
	it("a minted link from collective A does not survive the switch, and B's join states are read fresh with B's cfg", async () => {
		const { container } = await renderRoster();
		await openCard(container, 'm4'); // #302 drive-path edit
		await waitFor(() => expect(q(container, 'roster-member-invite-m4')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-invite-m4')!);
		await waitFor(() => expect(q(container, 'roster-invite-copy-m4')).not.toBeNull());

		const writeText = vi.fn().mockResolvedValue(undefined);
		setClipboard({ writeText });
		await fireEvent.click(q(container, 'roster-invite-copy-m4')!);
		await waitFor(() =>
			expect(q(container, 'roster-invite-copy-status-m4')?.textContent?.trim()).toBe(
				'[admin_invite_copied]'
			)
		);

		await switchToOtherChoir(container);
		expect(q(container, 'roster-invite-copy-m4')).toBeNull();
		expect(
			container.querySelectorAll('[data-testid^="roster-invite-copy-status-"]')
		).toHaveLength(0);
		await waitFor(() =>
			expect(
				[...listJoinStatesMock.mock.calls, ...listJoinStateDetailsMock.mock.calls].some(
					(call) => {
						const [cfg, ids] = call as [{ db: string }, string[]];
						return cfg.db === 'other-choir' && ids.includes('p-bob');
					}
				)
			).toBe(true)
		);

		await openCard(container, 'm-bob');
		await waitFor(() => expect(q(container, 'roster-member-invite-m-bob')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-invite-m-bob')!);
		await waitFor(() => expect(q(container, 'roster-invite-copy-m-bob')).not.toBeNull());
		const freshStatus = q(container, 'roster-invite-copy-status-m-bob');
		expect(freshStatus).not.toBeNull();
		expect(freshStatus!.textContent?.trim()).toBe('');
	});

	it("#346 — a copy FAILURE's alert from collective A does not survive the switch either (copyFailed state joins the same resets)", async () => {
		const { container } = await renderRoster();
		await openCard(container, 'm4'); // #302 drive-path edit
		await waitFor(() => expect(q(container, 'roster-member-invite-m4')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-invite-m4')!);
		await waitFor(() => expect(q(container, 'roster-invite-copy-m4')).not.toBeNull());

		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		setClipboard(undefined); // absent API → the visible per-row failure
		await fireEvent.click(q(container, 'roster-invite-copy-m4')!);
		await waitFor(() => expect(q(container, 'roster-invite-copy-error-m4')).not.toBeNull());
		consoleSpy.mockRestore();

		await switchToOtherChoir(container);
		expect(
			container.querySelectorAll('[data-testid^="roster-invite-copy-error-"]')
		).toHaveLength(0);

		await openCard(container, 'm-bob');
		await waitFor(() => expect(q(container, 'roster-member-invite-m-bob')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-invite-m-bob')!);
		await waitFor(() => expect(q(container, 'roster-invite-copy-m-bob')).not.toBeNull());
		expect(q(container, 'roster-invite-copy-error-m-bob')).toBeNull();
	});
});

describe('(H) a superseded load\'s join-state tail writes NOTHING', () => {
	async function renderWithHeldFanOut(
		aTail: (
			resolve: (v: Record<string, JoinState>) => void,
			reject: (e: unknown) => void
		) => () => void
	) {
		let settleA: () => void = () => {};
		listJoinStatesMock.mockImplementation((cfg: { db: string }, personIds: string[]) => {
			if (cfg.db === 'sampledb') {
				return new Promise<Record<string, JoinState>>((resolve, reject) => {
					settleA = aTail(resolve, reject);
				});
			}
			return Promise.resolve(
				Object.fromEntries(personIds.map((id) => [id, joinStatesByDb[cfg.db]?.[id] ?? 'absent']))
			);
		});
		listJoinStateDetailsMock.mockImplementation((cfg: { db: string }, personIds: string[]) => {
			if (cfg.db === 'sampledb') {
				return new Promise<Record<string, JoinStateDetail>>((resolve, reject) => {
					settleA = aTail(
						(states) => resolve(detailsFor(cfg.db, Object.keys(states))),
						reject
					);
				});
			}
			return Promise.resolve(detailsFor(cfg.db, personIds));
		});
		const utils = render(Page);
		setAuthedWithTwoCollectives();
		adminStore.set('admin');
		await waitFor(() =>
			expect(
				[...listJoinStatesMock.mock.calls, ...listJoinStateDetailsMock.mock.calls].some(
					(c) => (c[0] as { db: string }).db === 'sampledb'
				)
			).toBe(true)
		);
		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => expect(q(utils.container, 'section-toggle-unassigned')).not.toBeNull());
		await fireEvent.click(q(utils.container, 'section-toggle-unassigned')!);
		await waitFor(() => expect(q(utils.container, 'roster-row-join-state-m-bob')).not.toBeNull());
		await openCard(utils.container, 'm-bob'); // #302 drive-path edit
		expect(q(utils.container, 'roster-member-invite-m-bob')).not.toBeNull();
		return { ...utils, settleA };
	}

	async function flush() {
		await new Promise((r) => setTimeout(r, 0));
		await tick();
	}

	it("A's fan-out RESOLVING after the switch does not overwrite B's join states — B keeps every badge and control", async () => {
		const { container, settleA } = await renderWithHeldFanOut((resolve) => () =>
			resolve({ 'person-p': 'joined', 'pp-2': 'joined', 'pp-3': 'invited', 'pp-4': 'absent' })
		);
		settleA();
		await flush();
		expect(q(container, 'roster-row-join-state-m-bob')).not.toBeNull();
		expect(q(container, 'roster-row-join-state-m-bob')!.getAttribute('data-join-state')).toBe(
			'absent'
		);
		expect(q(container, 'roster-member-invite-m-bob')).not.toBeNull();
	});

	it("A's fan-out REJECTING after the switch does not blank B's join states either", async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { container, settleA } = await renderWithHeldFanOut((_resolve, reject) => () =>
			reject(new Error('join-state fan-out failed for the collective we already left'))
		);
		settleA();
		await flush();
		expect(q(container, 'roster-row-join-state-m-bob')).not.toBeNull();
		expect(q(container, 'roster-row-join-state-m-bob')!.getAttribute('data-join-state')).toBe(
			'absent'
		);
		expect(q(container, 'roster-member-invite-m-bob')).not.toBeNull();
		expect(
			errSpy.mock.calls.some((c) => String(c[0]).includes('join-state load failed'))
		).toBe(false);
		errSpy.mockRestore();
	});
});

describe('(I) a generation bump during an in-flight invite write re-enables the controls (#287 discipline)', () => {
	function heldMint() {
		let release: () => void = () => {};
		mintSelfLinkInviteMock.mockImplementation(
			() =>
				new Promise<{ inviteToken: string }>((resolve) => {
					release = () => resolve({ inviteToken: 'tok-fresh-1' });
				})
		);
		return () => release();
	}

	it('a COLLECTIVE SWITCH mid-mint leaves the new roster\'s controls enabled, not permanently disabled', async () => {
		const release = heldMint();
		const { container } = await renderRoster();
		await openCard(container, 'm4'); // #302 drive-path edit
		await waitFor(() => expect(q(container, 'roster-member-invite-m4')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-invite-m4')!);
		await waitFor(() => expect(mintSelfLinkInviteMock).toHaveBeenCalledTimes(1));

		await switchToOtherChoir(container);
		await openCard(container, 'm-bob'); // #302 drive-path edit (switch closed any editor)
		release();
		await new Promise((r) => setTimeout(r, 0));
		await tick();

		const control = q(container, 'roster-member-invite-m-bob');
		expect(control).not.toBeNull();
		expect((control as HTMLButtonElement).disabled).toBe(false);
	});

	it('a SAME-COLLECTIVE refresh mid-mint (a deactivate reload) leaves the controls enabled too', async () => {
		const release = heldMint();
		const { container } = await renderRoster();
		await openCard(container, 'm4'); // #302 drive-path edit
		await waitFor(() => expect(q(container, 'roster-member-invite-m4')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-invite-m4')!);
		await waitFor(() => expect(mintSelfLinkInviteMock).toHaveBeenCalledTimes(1));

		await openCard(container, 'm2');
		await fireEvent.click(q(container, 'member-deactivate-m2')!);
		await waitFor(() => expect(q(container, 'member-deactivate-confirm-m2')).not.toBeNull());
		await fireEvent.click(q(container, 'member-deactivate-confirm-m2')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(loadRosterMock).toHaveBeenCalledTimes(2));
		release();
		await new Promise((r) => setTimeout(r, 0));
		await tick();
		if (!q(container, 'roster-row-m4')) {
			await fireEvent.click(q(container, 'section-toggle-unassigned')!);
		}
		await waitFor(() => expect(q(container, 'roster-row-m4')).not.toBeNull());

		await openCard(container, 'm4');
		const control = q(container, 'roster-member-invite-m4');
		expect(control).not.toBeNull();
		expect((control as HTMLButtonElement).disabled).toBe(false);
	});
});

// (*MVOX:Tallis*) (*MVOX:Byrd*) (*MVOX:Josquin*)
