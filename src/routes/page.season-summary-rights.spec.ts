// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const {
	loadRosterMock,
	loadActiveAndArchivedRostersMock,
	listAttendanceMock,
	listMyAttendanceMock,
	listAllRsvpsForEventMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	loadActiveAndArchivedRostersMock: vi.fn(),
	listAttendanceMock: vi.fn(),
	listMyAttendanceMock: vi.fn(),
	listAllRsvpsForEventMock: vi.fn()
}));
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
	(await import('$lib/testing/moduleStubs')).repertoireActionsModule(await importOriginal())
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('records')
);
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/roster/memberLifecycle', () => ({
	deactivateMember: vi.fn(),
	reinstateMember: vi.fn(),
	loadInactiveRoster: vi.fn(),
	loadActiveAndArchivedRosters: loadActiveAndArchivedRostersMock,
	listInactiveMembers: vi.fn(),
	listDeactivateBlockers: vi.fn()
}));
vi.mock('$lib/attendance/attendanceData', async (importActual) => ({
	...(await importActual<typeof import('$lib/attendance/attendanceData')>()),
	listAttendance: listAttendanceMock,
	listMyAttendance: listMyAttendanceMock,
	listAllRsvpsForEvent: listAllRsvpsForEventMock,
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn()
}));
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';

function agendaItem(id: string, startDatetime: string) {
	return {
		id,
		name: `Rehearsal ${id}`,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: []
	};
}

function agendaFixture(overrides: {
	seasonOwners?: string[];
	seasonEditors?: string[];
	seasonConductors?: string[];
}) {
	return fullAgendaResult({
		seasons: [],
		upcoming: [],
		recent: [
			agendaItem('past-1', '2026-06-10T16:00:00.000Z'),
			agendaItem('past-2', '2026-06-03T16:00:00.000Z')
		],
		seasonId: 's1',
		seasonConductors: overrides.seasonConductors ?? [],
		seasonOwners: overrides.seasonOwners ?? [],
		seasonEditors: overrides.seasonEditors ?? []
	});
}

function setAuthedWithOneCollective(personId = 'person-p') {
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId }] });
	completionGateStore.set('complete');
}

beforeEach(() => {
	findMyMemberIdMock.mockResolvedValue('m1');
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listMyAttendanceMock.mockResolvedValue(
		toListRead([{ attendanceId: 'a1', eventId: 'past-1', status: 'present' }])
	);
	listAllRsvpsForEventMock.mockResolvedValue([]);
	loadRosterMock.mockResolvedValue(
		toListRead([{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' }])
	);
	loadActiveAndArchivedRostersMock.mockResolvedValue({
		active: toListRead([
			{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' }
		]),
		inactive: toListRead([])
	});
	listAttendanceMock.mockResolvedValue([{ attendanceId: 'x1', memberId: 'm1', status: 'present' }]);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	resetAppState();
	resetGate();
});

async function renderWithSummary() {
	const utils = render(Page);
	setAuthedWithOneCollective();
	await waitFor(() =>
		expect(utils.container.querySelector('[data-testid="season-summary"]')).not.toBeNull()
	);
	return utils;
}

const EXPAND = '[data-testid="season-summary-expand"]';

describe('#365 — the season-summary comparison opens on season rights', () => {
	it('a season OWNER gets the expand affordance, and the comparison opens on click', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaFixture({ seasonOwners: ['person-p'] }));
		const { container } = await renderWithSummary();
		await waitFor(() => expect(container.querySelector(EXPAND)).not.toBeNull());
		await fireEvent.click(container.querySelector(EXPAND)!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-rate-m1"]')).not.toBeNull()
		);
	});

	it('a season EDITOR gets the expand affordance', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaFixture({ seasonEditors: ['person-p'] }));
		const { container } = await renderWithSummary();
		await waitFor(() => expect(container.querySelector(EXPAND)).not.toBeNull());
	});

	it('a member with NEITHER grant gets no affordance — the roster comparison is unreachable', async () => {
		loadFullAgendaMock.mockResolvedValue(
			agendaFixture({ seasonOwners: ['someone-else'], seasonEditors: ['other-person'] })
		);
		const { container } = await renderWithSummary();
		expect(container.querySelector(EXPAND)).toBeNull();
		expect(container.querySelector('[data-testid="member-rate-m1"]')).toBeNull();
	});

	it('the conductor SEAT does not count: on the conductor list but holding no grant → NO expand', async () => {
		loadFullAgendaMock.mockResolvedValue(
			agendaFixture({ seasonConductors: ['person-p'], seasonOwners: [], seasonEditors: [] })
		);
		const { container } = await renderWithSummary();
		expect(container.querySelector(EXPAND)).toBeNull();
	});

	it('no affordance while the agenda (and with it the rights answer) is still loading', async () => {
		loadFullAgendaMock.mockReturnValue(new Promise(() => {}));
		const { container } = render(Page);
		setAuthedWithOneCollective();
		await waitFor(() => expect(loadFullAgendaMock).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 0));
		expect(container.querySelector(EXPAND)).toBeNull();
	});
});

const SRC_ROOT = resolve(__dirname, '..');

function sourceFiles(): string[] {
	return readdirSync(SRC_ROOT, { recursive: true, withFileTypes: true })
		.filter(
			(d) =>
				d.isFile() &&
				(d.name.endsWith('.svelte') || d.name.endsWith('.ts')) &&
				!d.name.endsWith('.spec.ts')
		)
		.map((d) => join(d.parentPath, d.name))
		.filter((f) => !relative(SRC_ROOT, f).startsWith(join('lib', 'paraglide')));
}

describe('#365 — conductorStore is dead (done-when 2)', () => {
	it('src/lib/attendance/conductorStore.ts no longer exists', () => {
		expect(
			existsSync(join(SRC_ROOT, 'lib', 'attendance', 'conductorStore.ts')),
			'conductorStore.ts must be deleted — the expand gate was its last consumer (#365)'
		).toBe(false);
	});

	it('no non-spec source references attendance/conductorStore', () => {
		const needle = 'attendance/conductorStore';
		const offenders: string[] = [];
		for (const file of sourceFiles()) {
			const source = readFileSync(file, 'utf-8');
			let idx = source.indexOf(needle);
			while (idx !== -1) {
				const line = source.slice(0, idx).split('\n').length;
				offenders.push(`${relative(SRC_ROOT, file)}:${line}`);
				idx = source.indexOf(needle, idx + 1);
			}
		}
		expect(
			offenders,
			`live references to the deleted conductorStore:\n${offenders.join('\n')}`
		).toEqual([]);
	});
});

// (*MVOX:Tallis*)
