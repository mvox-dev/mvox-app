import type {
	deleteEvent,
	getSeriesDefaults,
	SeriesDefaults,
	SeriesOption
} from '$lib/seasons/seasonManage';
import type { reassignEventSeries, unassignEventSeries } from '$lib/events/eventSeriesActions';
import type { convertEventToSeries } from '$lib/events/eventConvert';
import type { createEvent } from '$lib/entity/entityCreate';
import type { findMyMemberId, findMyRsvpForEvent } from '$lib/rsvp/rsvpData';
import type { createRsvpChangeQueue } from '$lib/rsvp/rsvpChangeQueue';
import type {
	AttendanceStatus,
	attendanceByMemberId,
	listAllRsvpsForEvent,
	listAttendance
} from '$lib/attendance/attendanceData';
import type { createAttendanceChangeQueue } from '$lib/attendance/attendanceChangeQueue';
import type { loadRosterIncludingArchived } from '$lib/roster/memberLifecycle';
import type { listRepertoireItems, RepertoireItem } from '$lib/repertoire/repertoireData';
import type {
	createProgramItem,
	createRepertoireItem,
	createRepertoireWriteQueue,
	deleteProgramItem,
	deleteRepertoireItem,
	pickableWorks,
	pinEdition,
	planProgramMove,
	reorderProgramItems,
	resolveManageRights,
	updateRepertoireStatus
} from '$lib/repertoire/repertoireActions';
import type { Edition, listEditions, Work } from '$lib/library/libraryData';
import type {
	createScheduleItem,
	listScheduleItems,
	removeScheduleItem,
	ScheduleItem,
	updateScheduleItemField
} from '$lib/schedule/scheduleData';
import type { EditableEventField, updateEventField } from '$lib/events/eventFieldEdit';
import type { ManageRightsState, WorkRow } from '$lib/repertoire/types';

// Children get every read or write of a module that writes through here, so the page
// stays the one writer behind the offline gate.
export interface EventActions {
	deleteEvent: typeof deleteEvent;
	convertEventToSeries: typeof convertEventToSeries;
	createEvent: typeof createEvent;
	findMyMemberId: typeof findMyMemberId;
	findMyRsvpForEvent: typeof findMyRsvpForEvent;
	createRsvpChangeQueue: typeof createRsvpChangeQueue;
	listAllRsvpsForEvent: typeof listAllRsvpsForEvent;
	listAttendance: typeof listAttendance;
	attendanceByMemberId: typeof attendanceByMemberId;
	createAttendanceChangeQueue: typeof createAttendanceChangeQueue;
	loadRosterIncludingArchived: typeof loadRosterIncludingArchived;
	listRepertoireItems: typeof listRepertoireItems;
	resolveManageRights: typeof resolveManageRights;
	createRepertoireWriteQueue: typeof createRepertoireWriteQueue;
	createProgramItem: typeof createProgramItem;
	createRepertoireItem: typeof createRepertoireItem;
	deleteProgramItem: typeof deleteProgramItem;
	deleteRepertoireItem: typeof deleteRepertoireItem;
	pickableWorks: typeof pickableWorks;
	pinEdition: typeof pinEdition;
	planProgramMove: typeof planProgramMove;
	reorderProgramItems: typeof reorderProgramItems;
	updateRepertoireStatus: typeof updateRepertoireStatus;
	listEditions: typeof listEditions;
	listScheduleItems: typeof listScheduleItems;
	createScheduleItem: typeof createScheduleItem;
	updateScheduleItemField: typeof updateScheduleItemField;
	removeScheduleItem: typeof removeScheduleItem;
	updateEventField: typeof updateEventField;
	getSeriesDefaults: typeof getSeriesDefaults;
	reassignEventSeries: typeof reassignEventSeries;
	unassignEventSeries: typeof unassignEventSeries;
}

/** What the page loads and more than one section reads; reset on every load. */
export interface EventPageState {
	memberId: string | null;
	membership: 'loading' | 'member' | 'non-member';
	seasonId: string | null;
	seasonManageRights: ManageRightsState;
	workRows: WorkRow[];
	heldFileIds: Set<string> | null;
	libraryWorks: Work[];
	libraryEditions: Edition[];
	libraryWorksPartial: boolean;
	libraryEditionsPartial: boolean;
	seasonRepertoire: RepertoireItem[];
	libraryPickersLoading: boolean;
	libraryPickersLoadSucceeded: boolean;
	// Never reset: the works picker keeps its last answer across a reload.
	pickableWorksVisible: boolean | undefined;
	scheduleRows: ScheduleItem[];
	scheduleLoaded: boolean;
	attendanceMap: Record<string, { attendanceId: string; status: AttendanceStatus }>;
}

export function createEventPageState(): EventPageState {
	return {
		memberId: null,
		membership: 'loading',
		seasonId: null,
		seasonManageRights: 'not-editor',
		workRows: [],
		heldFileIds: null,
		libraryWorks: [],
		libraryEditions: [],
		libraryWorksPartial: false,
		libraryEditionsPartial: false,
		seasonRepertoire: [],
		libraryPickersLoading: true,
		libraryPickersLoadSucceeded: false,
		pickableWorksVisible: undefined,
		scheduleRows: [],
		scheduleLoaded: false,
		attendanceMap: {}
	};
}

// Writes only, never reads ev: the page calls this inside its load effect.
export function resetEventPageState(ev: EventPageState): void {
	const { pickableWorksVisible: _keep, ...fresh } = createEventPageState();
	Object.assign(ev, fresh);
}

/** The series picker's state; reset when no collective or event is selected. */
export interface EventSeriesState {
	options: SeriesOption[];
	optionsLoaded: boolean;
	armedTarget: { id: string } | null;
	previewDefaults: SeriesDefaults | null;
	pending: boolean;
	error: string | null;
	status: string;
}

export function createEventSeriesState(): EventSeriesState {
	return {
		options: [],
		optionsLoaded: false,
		armedTarget: null,
		previewDefaults: null,
		pending: false,
		error: null,
		status: ''
	};
}

export function resetEventSeriesState(series: EventSeriesState): void {
	Object.assign(series, createEventSeriesState());
}

type FieldFlags = Partial<Record<EditableEventField, boolean>>;

/** The inline field editor's state. It outlives a reload, as it always has. */
export interface EventEditState {
	editingField: EditableEventField | null;
	draft: string;
	draftDate: string;
	draftTime: string;
	errors: FieldFlags;
	rangeErrors: FieldFlags;
	heldOffline: boolean;
	writePending: FieldFlags;
	locationSuggestions: string[];
	locationCorpusRequested: boolean;
	pendingFocusRestore: FieldFlags;
	pencilRefs: Partial<Record<EditableEventField, HTMLButtonElement>>;
}

export function createEventEditState(): EventEditState {
	return {
		editingField: null,
		draft: '',
		draftDate: '',
		draftTime: '',
		errors: {},
		rangeErrors: {},
		heldOffline: false,
		writePending: {},
		locationSuggestions: [],
		locationCorpusRequested: false,
		pendingFocusRestore: {},
		pencilRefs: {}
	};
}

// (*MVOX:Josquin*)
