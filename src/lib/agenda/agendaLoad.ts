// Agenda data load: the page owns the state object and every write; reads from modules that
// also write reach this file through `deps`, so the write-gate fence still sees them in the page.
import type { MemberAttendanceRate } from '$lib/attendance/attendanceSummary';
import type { CollectiveIdentity } from '$lib/collectives/store';
import type { RosterRow } from '$lib/roster/rosterData';
import type { SectionNode } from '$lib/sections/sectionData';
import type { AgendaItem } from '$lib/agenda/types';
import type { AttendanceStatus, MyAttendance } from '$lib/attendance/attendanceData';
import type { ManageRightsState, PickerOption, WorkRow } from '$lib/repertoire/types';
import type { RepertoireItem } from '$lib/repertoire/repertoireData';
import type { RsvpByEventId } from '$lib/rsvp/rsvpData';
import type { ScheduleItem } from '$lib/schedule/scheduleData';
import type { Season } from '$lib/seasons/types';
import type { Copy, Edition, Work } from '$lib/library/libraryData';
import type { CANONICAL_EVENT_TYPES } from '$lib/events/eventTypeLabels';
import type * as AttendanceData from '$lib/attendance/attendanceData';
import type * as LibraryData from '$lib/library/libraryData';
import type * as MemberLifecycle from '$lib/roster/memberLifecycle';
import type * as RepertoireActions from '$lib/repertoire/repertoireActions';
import type * as RepertoireData from '$lib/repertoire/repertoireData';
import type * as RsvpData from '$lib/rsvp/rsvpData';
import type * as ScheduleData from '$lib/schedule/scheduleData';
import type { CollectiveState } from '$lib/collectives/types';
import { createAgendaPanels } from '$lib/agenda/agendaPanels';
import { createAgendaRosterCache } from '$lib/agenda/agendaRosterCache';
import { createAgendaRowStore } from '$lib/agenda/agendaRowStore';
import { createSelectedLoad } from '$lib/agenda/agendaSelectedLoad';
import { createAgendaWorksLoad } from '$lib/agenda/agendaWorksLoad';

type AgendaTypeFilter = 'all' | (typeof CANONICAL_EVENT_TYPES)[number];

export function createAgendaLoadState() {
	return {
		agendaItems: [] as AgendaItem[],
		agendaLoading: true,
		agendaError: false,
		sessionExpired: false,
		memberId: null as string | null,
		membership: 'loading' as 'loading' | 'member' | 'non-member',
		rsvpRights: 'loading' as 'loading' | 'editor' | 'not-editor',
		rsvpByEventId: {} as RsvpByEventId,
		rsvpPartial: false,
		failedEventIds: new Set() as Set<string>,
		savedEventIds: new Set() as Set<string>,
		myAttendance: [] as MyAttendance[],
		attendancePartial: false,
		recentItems: [] as AgendaItem[],
		attendanceEventIds: new Set() as Set<string>,
		agendaTypeFilter: 'all' as AgendaTypeFilter,
		worksByEventId: {} as Record<string, WorkRow[]>,
		scheduleByEventId: {} as Record<string, ScheduleItem[]>,
		pdfError: false,
		heldFileIds: null as Set<string> | null,
		currentSeasonId: null as string | null,
		seasonManageRights: 'not-editor' as ManageRightsState,
		manageableSeasonId: null as string | null,
		manageableSeasonRights: 'not-editor' as ManageRightsState,
		manageableSeasonRightsById: {} as Record<string, ManageRightsState>,
		seasonCreateRights: 'not-editor' as ManageRightsState,
		eventManageRights: {} as Record<string, ManageRightsState>,
		seasons: [] as Season[],
		seasonRepertoire: [] as RepertoireItem[],
		libraryWorks: [] as Work[],
		libraryEditions: [] as Edition[],
		libraryWorksPartial: false,
		libraryEditionsPartial: false,
		scopedEditionsByWorkId: {} as Record<string, PickerOption[]>,
		libraryPickersLoading: false,
		libraryPickersLoadSucceeded: false,
		worksRowsLoading: false,
		managePendingKeys: new Set() as Set<string>,
		manageError: false,
		panelRepertoire: [] as RepertoireItem[],
		panelWorks: [] as Work[],
		panelEditions: [] as Edition[],
		panelWorksPartial: false,
		panelCopies: [] as Copy[],
		panelRepertoireError: false,
		panelRepertoireLoading: false,
		panelRepertoireItemsOk: false,
		panelWorksSourcesOk: false,
		seasonSummaryExpanded: false,
		seasonMemberRates: [] as MemberAttendanceRate[],
		seasonRatesLoaded: false,
		seasonRatesLoading: false,
		seasonRatesError: false,
		seasonRatesPartial: false,
		attendanceItem: null as AgendaItem | null,
		attendanceLoading: false,
		attendanceError: false,
		attendanceRoster: [] as RosterRow[],
		attendanceMap: {} as Record<string, { attendanceId: string; status: AttendanceStatus }>,
		attendanceRsvpMap: {} as Record<string, { rsvpId: string; status: string }>,
		attendancePendingMemberIds: new Set() as Set<string>,
		attendanceFailedMemberIds: new Set() as Set<string>,
		attendanceSavedMemberIds: new Set() as Set<string>,
		attendanceFailedByEvent: new Map() as Map<string, Set<string>>,
		rosterCache: null as { db: string; roster: RosterRow[]; truncated: boolean; fetchedAt: number; } | null,
		rosterRows: [] as RosterRow[],
		rosterReadsInFlight: 0,
		rosterReadFailed: false,
		rosterPartial: false,
		sectionsReadFailed: false,
		sectionsCache: null as { db: string; sections: SectionNode[]; fetchedAt: number } | null,
		rosterSections: [] as SectionNode[],
	};
}

export type AgendaLoadState = ReturnType<typeof createAgendaLoadState>;

export function createLoadCounters() {
	return {
		scopedEditionWorkIdsRequested: new Set<string>(),
		panelRepertoireSeasonId: null as string | null,
		attendanceRequestId: 0,
		requestId: 0,
		pressureSweepRanAtOpen: false,
		worksLoadId: 0,
		scheduleLoadId: 0,
	};
}

export type LoadCounters = ReturnType<typeof createLoadCounters>;

export interface AgendaLoadDeps {
	selected: () => { db: string; personId: string } | null;
	seasonManageOpen: () => boolean;
	seasonManageSwitchGeneration: () => number;
	collectiveIdentity: () => CollectiveIdentity | null;
	collectivesState: () => CollectiveState;
	isRepertoirePending: (key: string) => boolean;
	pendingMembersForEvent: (eventId: string) => Set<string>;
	resetSeasonManage: () => void;
	closeSeasonCreateForm: () => void;
	closeEventCreateForm: () => void;
	closeSeriesCreateForm: () => void;
	restoreSeriesCreateRun: () => void;
	refreshPresence: (db: string, personId: string, isCurrent: () => boolean) => void;
	findMyMemberId: typeof RsvpData.findMyMemberId;
	listMyRsvps: typeof RsvpData.listMyRsvps;
	rsvpsByEventId: typeof RsvpData.rsvpsByEventId;
	listMyAttendance: typeof AttendanceData.listMyAttendance;
	listAttendance: typeof AttendanceData.listAttendance;
	listAllRsvpsForEvent: typeof AttendanceData.listAllRsvpsForEvent;
	attendanceByMemberId: typeof AttendanceData.attendanceByMemberId;
	listWorks: typeof LibraryData.listWorks;
	listAllEditions: typeof LibraryData.listAllEditions;
	listAllCopies: typeof LibraryData.listAllCopies;
	listRepertoireItems: typeof RepertoireData.listRepertoireItems;
	listScheduleItemsByEventId: typeof ScheduleData.listScheduleItemsByEventId;
	loadActiveAndArchivedRosters: typeof MemberLifecycle.loadActiveAndArchivedRosters;
	canMarkAttendance: typeof RepertoireActions.canMarkAttendance;
	manageRightsFrom: typeof RepertoireActions.manageRightsFrom;
	resolveManageRights: typeof RepertoireActions.resolveManageRights;
}

export function createAgendaLoader(ag: AgendaLoadState, seq: LoadCounters, deps: AgendaLoadDeps) {
	const roster = createAgendaRosterCache(ag);
	const works = createAgendaWorksLoad(ag, seq, deps);
	const panels = createAgendaPanels(ag, seq, deps, roster.getRoster);
	const loadForSelected = createSelectedLoad(ag, seq, deps, {
		...works,
		closeAttendancePanel: panels.closeAttendancePanel
	});
	return {
		...roster,
		loadForSelected,
		...works,
		rowStore: createAgendaRowStore(ag),
		...panels
	};
}
