// The season attendance card's reads on /profile (#920): the agenda's season, gate and rates.
import { currentSeason, recentEvents } from '$lib/attendance/conductorLogic';
import {
	deriveAllMemberRates,
	deriveAttendanceRate,
	type MemberAttendanceRate
} from '$lib/attendance/attendanceSummary';
import { listAttendance, listMyAttendance, type MyAttendance } from '$lib/attendance/attendanceData';
import { reportProblem } from '$lib/problems/reportProblem';
import { manageRightsFrom, resolveManageRights } from '$lib/repertoire/repertoireActions';
import { loadActiveAndArchivedRosters } from '$lib/roster/memberLifecycle';
import { findMyMemberId } from '$lib/rsvp/rsvpData';
import { listEvents, listSeasonsOf } from '$lib/seasons/entuSeasons';
import type { EntuCfg } from '$lib/entu/cfg';
import type { AgendaItem } from '$lib/agenda/types';
import type { Season } from '$lib/seasons/types';

export interface SeasonAttendance {
	events: AgendaItem[];
	myRate: { attended: number; total: number };
	canExpand: boolean;
}

// A season whose grants the caller cannot see borrows the database entity's, as on the agenda.
async function canExpandFor(
	cfg: EntuCfg,
	season: Season,
	personId: string,
	dbEntityId: string
): Promise<boolean> {
	if (season.owners.length > 0 || season.editors.length > 0) {
		return manageRightsFrom(season.owners, season.editors, personId) === 'editor';
	}
	try {
		return (await resolveManageRights(cfg, dbEntityId, personId)) === 'editor';
	} catch (e) {
		reportProblem({ area: 'profile', action: 'resolving the database entity rights', error: e });
		return false;
	}
}

async function myAttendanceOrNone(cfg: EntuCfg, memberId: string): Promise<MyAttendance[]> {
	try {
		return (await listMyAttendance(cfg, memberId)).items;
	} catch (e) {
		reportProblem({ area: 'profile', action: 'loading your attendance', error: e });
		return [];
	}
}

/** null: no card, as on the agenda — not a member, or no past event in the current season.
 *  dbEntityId is the page's one resolution of the collective's database entity. */
export async function loadSeasonAttendance(
	cfg: EntuCfg,
	personId: string,
	dbEntityId: Promise<string | null>,
	now: Date = new Date()
): Promise<SeasonAttendance | null> {
	const [entityId, memberId] = await Promise.all([dbEntityId, findMyMemberId(cfg, personId)]);
	if (!memberId || !entityId) return null;
	const season = currentSeason(await listSeasonsOf(cfg, entityId), now);
	if (!season) return null;
	const events = recentEvents(await listEvents(cfg, season.id), now);
	if (events.length === 0) return null;
	const [mine, canExpand] = await Promise.all([
		myAttendanceOrNone(cfg, memberId),
		canExpandFor(cfg, season, personId, entityId)
	]);
	const ids = new Set(events.map((e) => e.id));
	const myRate = deriveAttendanceRate(
		mine.filter((a) => ids.has(a.eventId)),
		events.length
	);
	return { events, myRate, canExpand };
}

export async function loadSeasonMemberRates(
	cfg: EntuCfg,
	events: AgendaItem[]
): Promise<{ rates: MemberAttendanceRate[]; partial: boolean }> {
	const [rosters, perEvent] = await Promise.all([
		loadActiveAndArchivedRosters(cfg),
		Promise.all(events.map((event) => listAttendance(cfg, event.id)))
	]);
	return {
		rates: deriveAllMemberRates(
			perEvent.flat(),
			rosters.active.items,
			events.length,
			rosters.inactive.items
		),
		partial: rosters.active.truncated || rosters.inactive.truncated
	};
}

// (*MVOX:Josquin*)
