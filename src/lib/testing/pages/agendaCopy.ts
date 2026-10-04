// English copy for the root page agenda specs; a spec passes only the keys it words differently.
import { copyWith, englishMessages, type Copy } from '../messageMocks';

export const AGENDA_COPY = {
	agenda_empty_no_events: () => 'No upcoming events.',
	agenda_duration_min: (p: { minutes: number }) => `${p.minutes} min`,
	agenda_today: () => 'Today',
	agenda_tomorrow: () => 'Tomorrow',
	agenda_gap_weeks: (p: { weeks: number }) => `${p.weeks} weeks later`,
	agenda_load_error: () => "Couldn't load the agenda.",
	agenda_retry: () => 'Retry',
	agenda_filter_all: () => 'All',
	agenda_filter_group_label: () => 'Filter by event type',
	agenda_view_toggle_label: () => 'Agenda view',
	agenda_view_list: () => 'List',
	agenda_view_month: () => 'Month',
	agenda_filter_empty: () => 'No events match this filter.',
	agenda_switch_collective: () => 'Switch collective',
	agenda_row_link_label: (p: { event: string }) => `View details for ${p.event}`,
	rsvp_status_going: () => 'Going',
	rsvp_status_not_going: () => 'Not going',
	rsvp_status_maybe: () => 'Maybe',
	rsvp_status_late: () => 'Running late',
	rsvp_group_label: () => 'RSVP',
	rsvp_non_member_hint: () => 'You are not an active member.',
	rsvp_save_failed: () => 'Could not save your answer.',
	agenda_recent: () => 'Recent',
	agenda_take_attendance: () => 'Take attendance',
	agenda_take_attendance_label: (p: { event: string }) => `Take attendance for ${p.event}`,
	attendance_group_label: (p: { name: string }) => `Attendance for ${p.name}`,
	attendance_status_present: () => 'Present',
	attendance_status_absent: () => 'Absent',
	attendance_status_late: () => 'Late',
	attendance_toggle_aria_label: (p: { name: string; status: string }) =>
		`Mark ${p.name} as ${p.status}`,
	attendance_rsvp_none: () => 'No answer',
	attendance_rsvp_aria_label: (p: { name: string; rsvp: string }) =>
		`RSVP for ${p.name}: ${p.rsvp}`,
	attendance_load_error: () => "Couldn't load attendance.",
	attendance_loading: () => 'Loading attendance…',
	attendance_ready: (p: { count: number }) => `Attendance loaded, ${p.count} members`,
	attendance_save_failed: () => 'Could not save attendance.',
	attendance_tally: (p: { present: number; absent: number; late: number }) =>
		`${p.present} present · ${p.absent} absent · ${p.late} late`,
	attendance_close: () => 'Close',
	attendance_status_not_recorded: () => 'Not recorded',
	attendance_season_summary: () => 'This season',
	attendance_season_rate: (p: { attended: number; total: number }) =>
		`Attended ${p.attended} of ${p.total} events`,
	attendance_member_rate: (p: { attended: number; total: number }) =>
		`${p.attended} of ${p.total}`,
	attendance_all_members: () => 'All members',
	agenda_recent_show_more: () => 'Show earlier',
	attendance_saved: () => 'Saved.',
	attendance_tally_unconfirmed: () => 'Counts include unconfirmed changes.',
	picker_partial_members_notice: () => 'Not every member is listed here',
	session_expired_message: () => 'Your session has expired. Please sign in again.',
	session_expired_signin: () => 'Sign in'
} satisfies Copy;

export function agendaMessages(overrides: Partial<typeof AGENDA_COPY> = {}) {
	return englishMessages(copyWith(AGENDA_COPY, overrides));
}

// (*MVOX:Josquin*)
