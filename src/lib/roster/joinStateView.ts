import { m } from '$lib/paraglide/messages.js';
import { INVITE_LIFETIME_MS } from '$lib/invite/inviteData';
import type { JoinState, JoinStateDetail } from '$lib/profile/linkedIdentities';
import type { RosterRow } from '$lib/roster/rosterData';
import { isoDateFormatter } from '$lib/preferences/timeFormat';

export type JoinDisplayState = 'absent' | 'invited' | 'expired' | 'joined';

export const JOIN_STATE_LABEL: Record<JoinDisplayState, (params: { date: string }) => string> = {
	absent: m.roster_member_join_state_absent,
	invited: m.roster_member_join_state_invited,
	expired: m.roster_member_join_state_expired,
	joined: m.roster_member_join_state_joined
};

export const JOIN_STATE_BADGE_CLASS: Record<JoinDisplayState, string> = {
	joined: 'border-emerald-700 text-emerald-700',
	invited: 'border-amber-700 text-amber-700',
	expired: 'border-red-700 text-red-700',
	absent: 'border-ink-4 text-ink-2'
};

let dateFmt: Intl.DateTimeFormat | null = null;

export function formatJoinStateDate(at: string): string {
	dateFmt ??= isoDateFormatter();
	return dateFmt.format(new Date(at));
}

export function joinStateLine(
	row: RosterRow,
	details: Record<string, JoinStateDetail>
): { display: JoinDisplayState; at: string } | undefined {
	const detail = details[row.personId];
	if (detail === undefined) return undefined;
	const at = detail.state === 'absent' ? row.createdAt : detail.at;
	if (at === undefined || Number.isNaN(Date.parse(at))) return undefined;
	if (detail.state === 'absent') return { display: 'absent', at };
	if (detail.state === 'invited') {
		const expired = Date.parse(at) + INVITE_LIFETIME_MS < Date.now();
		return { display: expired ? 'expired' : 'invited', at };
	}
	return { display: 'joined', at };
}

export function bareJoinStates(details: Record<string, JoinStateDetail>): Record<string, JoinState> {
	return Object.fromEntries(Object.entries(details).map(([id, d]) => [id, d.state]));
}

// (*MVOX:Josquin*)
