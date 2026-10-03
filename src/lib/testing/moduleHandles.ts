// Shared handles for page-import mocks: spec and vi.mock factory import here, one vi.fn each.
import { vi } from 'vitest';

export const loadFullAgendaMock = vi.fn();
export const listSectionsMock = vi.fn();
export const resolveDatabaseEntityIdMock = vi.fn();
export const findMyMemberIdMock = vi.fn();
export const listMyRsvpsMock = vi.fn();
export const resolveManageRightsMock = vi.fn();
export const loadWorksByEventIdMock = vi.fn();
export const deleteRepertoireItemMock = vi.fn();
export const updateRepertoireStatusMock = vi.fn();

export function agendaDataModule() {
	return {
		loadFullAgenda: loadFullAgendaMock
	};
}

export function sectionDataModule(actual: unknown) {
	return { ...(actual as object), listSections: listSectionsMock };
}

// Without the real module, a full replacement: only resolveDatabaseEntityId exists.
export function entityIdModule(actual: unknown = {}) {
	return { ...(actual as object), resolveDatabaseEntityId: resolveDatabaseEntityIdMock };
}

type RsvpRow = { rsvpId: string; eventId: string; status: string };

function rsvpsByEventId(rsvps: RsvpRow[]) {
	const map: Record<string, { rsvpId: string; status: string }> = {};
	for (const r of rsvps) map[r.eventId] = { rsvpId: r.rsvpId, status: r.status };
	return map;
}

// 'member': only findMyMemberId; 'list': listMyRsvps only, member-1 fixed;
// 'empty'/'records': the whole module, byEventId empty or keyed.
export function rsvpHandlesModule(shape: 'member' | 'list' | 'empty' | 'records') {
	if (shape === 'member') return { findMyMemberId: findMyMemberIdMock };
	if (shape === 'list')
		return {
			findMyMemberId: vi.fn().mockResolvedValue('member-1'),
			findMyRsvpForEvent: vi.fn().mockResolvedValue(null),
			listMyRsvps: listMyRsvpsMock,
			rsvpsByEventId: () => ({}),
			createRsvp: vi.fn(),
			updateRsvpStatus: vi.fn(),
			deleteRsvp: vi.fn()
		};
	return {
		findMyMemberId: findMyMemberIdMock,
		listMyRsvps: listMyRsvpsMock,
		rsvpsByEventId: shape === 'records' ? rsvpsByEventId : () => ({}),
		createRsvp: vi.fn(),
		updateRsvpStatus: vi.fn(),
		deleteRsvp: vi.fn()
	};
}

export function worksModule(actual: unknown) {
	return { ...(actual as object), loadWorksByEventId: loadWorksByEventIdMock };
}

// writes: delete and status update are shared handles too, not the real module's.
export function rightsModule(actual: unknown, opts: { writes?: boolean } = {}) {
	const writes = opts.writes
		? {
				deleteRepertoireItem: deleteRepertoireItemMock,
				updateRepertoireStatus: updateRepertoireStatusMock
			}
		: {};
	return { ...(actual as object), resolveManageRights: resolveManageRightsMock, ...writes };
}

// (*MVOX:Josquin*)
