import { cfgFor } from '$lib/entu/cfg';
import { loadFullAgenda } from '$lib/agenda/agendaData';
import { sameCollectiveIdentity } from '$lib/collectives/store';
import { isAuthExpiredError } from '$lib/entu/request';
import { resetServedFromCache } from '$lib/entu/readCache';
import type { ManageRightsState } from '$lib/repertoire/types';
import { loadMembership } from '$lib/rsvp/membershipLoad';
import type { createAgendaWorksLoad } from '$lib/agenda/agendaWorksLoad';
import type { AgendaLoadDeps, AgendaLoadState, LoadCounters } from '$lib/agenda/agendaLoad';

type SelectedLoadParts = Pick<
	ReturnType<typeof createAgendaWorksLoad>,
	| 'resetManagement'
	| 'deriveSeasonCreateRights'
	| 'loadDatabaseEntityRights'
	| 'upgradeRepertoireManagement'
	| 'loadWorksAndManagement'
	| 'loadScheduleItems'
> & { closeAttendancePanel: () => void };

export function createSelectedLoad(
	ag: AgendaLoadState,
	seq: LoadCounters,
	deps: AgendaLoadDeps,
	parts: SelectedLoadParts
) {
	const {
		resetSeasonManage,
		closeSeasonCreateForm,
		restoreSeriesCreateRun,
		refreshPresence,
		findMyMemberId,
		listMyRsvps,
		rsvpsByEventId,
		listMyAttendance,
		canMarkAttendance,
		manageRightsFrom,
		manageRightsOrNone,
		resolveManageRights
	} = deps;
	const {
		resetManagement,
		deriveSeasonCreateRights,
		loadDatabaseEntityRights,
		upgradeRepertoireManagement,
		loadWorksAndManagement,
		loadScheduleItems,
		closeAttendancePanel
	} = parts;

	function resetMembership() {
		ag.memberId = null;
		ag.membership = 'loading';
		ag.rsvpRights = 'loading';
		ag.failedEventIds = new Set();
		ag.savedEventIds = new Set();
	}

	function resetWorks() {
		ag.worksByEventId = {};
		ag.scheduleByEventId = {};
		ag.heldFileIds = null;
		resetManagement();
	}

	function resetWorksIdle() {
		resetWorks();
		ag.libraryPickersLoading = false;
		ag.worksRowsLoading = false;
	}

	function resetRosterCaches() {
		ag.rosterCache = null;
		ag.rosterRows = [];
		ag.rosterPartial = false;
		ag.sectionsCache = null;
		ag.rosterSections = [];
		ag.rosterReadFailed = false;
		ag.sectionsReadFailed = false;
	}

	function resetSeasonRates() {
		ag.attendanceFailedByEvent = new Map();
		ag.myAttendance = [];
		ag.attendancePartial = false;
		ag.seasonSummaryExpanded = false;
		ag.seasonMemberRates = [];
		ag.seasonRatesLoaded = false;
		ag.seasonRatesLoading = false;
		ag.seasonRatesError = false;
		ag.seasonRatesPartial = false;
		ag.seasons = [];
		closeSeasonCreateForm();
		deps.closeEventCreateForm();
	}

	return function loadForSelected(opts: { keepSeasonManage?: boolean } = {}) {
		const keepSeasonManage = opts.keepSeasonManage === true;
		const heldSeasonId = keepSeasonManage && deps.seasonManageOpen() ? ag.manageableSeasonId : null;
		const current = deps.selected();
		if (!current) {
			ag.agendaItems = [];
			ag.agendaLoading = false;
			ag.agendaError = false;
			resetMembership();
			ag.rsvpByEventId = {};
			ag.rsvpPartial = false;
			ag.recentItems = [];
			ag.attendanceEventIds = new Set();
			ag.agendaTypeFilter = 'all';
			resetWorksIdle();
			closeAttendancePanel();
			resetRosterCaches();
			resetSeasonManage();
			resetSeasonRates();
			deps.closeSeriesCreateForm();
			return;
		}
		const thisRequest = ++seq.requestId;
		closeAttendancePanel();
		ag.agendaLoading = true;
		ag.agendaError = false;
		ag.sessionExpired = false;
		resetServedFromCache();
		resetMembership();
		resetWorks();
		if (!keepSeasonManage) {
			ag.agendaTypeFilter = 'all';
			resetRosterCaches();
			resetSeasonManage();
			deps.closeSeriesCreateForm();
		}
		ag.rsvpPartial = false;
		resetSeasonRates();

		const personId = current.personId;

		loadFullAgenda()
			.then(
				({
					upcoming,
					recent,
					seasonId,
					seasonConductors,
					seasonOwners,
					seasonEditors,
					seasons: fullSeasons,
					manageableSeasonId: mSeasonId,
					manageableSeasonOwners: mOwners,
					manageableSeasonEditors: mEditors
				}) => {
					if (thisRequest !== seq.requestId) return;
					ag.agendaItems = upcoming;
					ag.agendaLoading = false;
					ag.recentItems = recent;
					ag.seasons = fullSeasons;

					const worksCfg = cfgFor(current.db);
					const events = [...upcoming, ...recent];
					const eventIds = events.map((item) => item.id);
					ag.currentSeasonId = seasonId;
					ag.seasonManageRights = manageRightsOrNone(
						seasonId,
						seasonOwners,
						seasonEditors,
						personId
					);
					const nowDateOnly = new Date().toISOString().slice(0, 10);
					const candidateSeasons = fullSeasons.filter(
						(s) => s.id === mSeasonId || s.endDate === '' || s.endDate >= nowDateOnly
					);
					const nextManageableRightsById: Record<string, ManageRightsState> = {};
					for (const s of candidateSeasons) {
						nextManageableRightsById[s.id] = manageRightsFrom(s.owners, s.editors, personId);
					}
					ag.manageableSeasonRightsById = nextManageableRightsById;
					const keptSeasonId =
						heldSeasonId !== null && candidateSeasons.some((s) => s.id === heldSeasonId)
							? heldSeasonId
							: null;
					if (keptSeasonId !== null) {
						ag.manageableSeasonId = keptSeasonId;
						ag.manageableSeasonRights = nextManageableRightsById[keptSeasonId] ?? 'not-editor';
					} else {
						if (heldSeasonId !== null) {
							resetSeasonManage();
							deps.closeSeriesCreateForm();
						}
						ag.manageableSeasonId = mSeasonId;
						ag.manageableSeasonRights = manageRightsOrNone(mSeasonId, mOwners, mEditors, personId);
					}
					restoreSeriesCreateRun();
					ag.seasonCreateRights = deriveSeasonCreateRights(
						seasonId,
						seasonOwners,
						seasonEditors,
						fullSeasons,
						personId
					);
					ag.eventManageRights = Object.fromEntries(
						events.map((item) => [item.id, manageRightsFrom(item.owners, item.editors, personId)])
					);
					loadWorksAndManagement(worksCfg, eventIds, seasonId, thisRequest);
					refreshPresence(worksCfg.db, personId, () => thisRequest === seq.requestId);
					loadScheduleItems(worksCfg, eventIds, thisRequest);
					const currentRightsInvisible =
						seasonId !== null && seasonOwners.length === 0 && seasonEditors.length === 0;
					const noSeasonToBorrowFrom = seasonId === null && fullSeasons.length === 0;
					const invisibleCandidateSeasons = candidateSeasons.filter(
						(s) => s.owners.length === 0 && s.editors.length === 0
					);
					if (
						invisibleCandidateSeasons.length > 0 ||
						currentRightsInvisible ||
						noSeasonToBorrowFrom
					) {
						loadDatabaseEntityRights(worksCfg, personId).then((state) => {
							if (thisRequest !== seq.requestId) return;
							if (state !== 'editor') return;
							if (invisibleCandidateSeasons.length > 0) {
								ag.manageableSeasonRightsById = {
									...ag.manageableSeasonRightsById,
									...Object.fromEntries(
										invisibleCandidateSeasons.map(
											(s) => [s.id, 'editor'] as [string, ManageRightsState]
										)
									)
								};
							}
							if (
								ag.manageableSeasonId !== null &&
								ag.manageableSeasonRightsById[ag.manageableSeasonId] === 'editor'
							) {
								ag.manageableSeasonRights = 'editor';
							}
							ag.seasonCreateRights = 'editor';
							if (currentRightsInvisible && ag.seasonManageRights !== 'editor') {
								ag.seasonManageRights = 'editor';
								upgradeRepertoireManagement(worksCfg, eventIds, seasonId, thisRequest);
							}
						});
					}
					ag.attendanceEventIds = new Set(
						recent.filter((item) => canMarkAttendance(item, personId)).map((item) => item.id)
					);
				}
			)
			.catch((err) => {
				if (thisRequest !== seq.requestId) return;
				ag.agendaLoading = false;
				if (isAuthExpiredError(err)) {
					ag.sessionExpired = true;
				} else {
					ag.agendaError = true;
				}
				ag.recentItems = [];
				ag.attendanceEventIds = new Set();
				resetWorksIdle();
				resetSeasonManage();
				ag.seasons = [];
			});

		{
			const rightsCfg = cfgFor(current.db);
			const rightsIdentity = { db: current.db, personId };
			resolveManageRights(rightsCfg, personId, personId).then((state) => {
				if (!sameCollectiveIdentity(deps.collectiveIdentity(), rightsIdentity)) return;
				ag.rsvpRights = state === 'editor' ? 'editor' : 'not-editor';
			});
		}

		loadMembership(
			findMyMemberId(cfgFor(current.db), personId),
			() => thisRequest === seq.requestId,
			ag,
			(id) => {
				if (id) {
					listMyAttendance(cfgFor(current.db), id)
						.then((result) => {
							if (thisRequest !== seq.requestId) return;
							ag.myAttendance = result.items;
							ag.attendancePartial = result.truncated;
						})
						.catch(() => {
							if (thisRequest !== seq.requestId) return;
							ag.myAttendance = [];
							ag.attendancePartial = false;
						});
				} else {
					ag.myAttendance = [];
					ag.attendancePartial = false;
				}
			}
		);

		listMyRsvps(cfgFor(current.db), personId)
			.then((result) => {
				if (thisRequest !== seq.requestId) return;
				ag.rsvpByEventId = rsvpsByEventId(result.items);
				ag.rsvpPartial = result.truncated;
			})
			.catch(() => {
				if (thisRequest !== seq.requestId) return;
				ag.rsvpByEventId = {};
				ag.rsvpPartial = false;
			});
	}
}
