<!-- src/lib/components/attendance/AttendanceBadge.svelte -->
<!--
	#103 review F3 — the viewer's OWN attendance badge for one past event, in ONE
	place. Extracted from AgendaList (#85 TA.4), which had it inline, when the
	event detail page needed the same badge: two copies of the label map, the dot
	classes and the aria-label shape had already started to drift (the detail
	page's copy shipped without the dot and without `data-status`, and no test
	could see it).

	Owns the whole badge contract:
	  - the four states (#85 TA.4): 'not-recorded' is a genuine fourth state — a
	    past event nobody marked me for — never a blank and never defaulted onto
	    'absent';
	  - the translated text label (visible, not dot-only — page.attendance-a11y);
	  - the colour dot, which is aria-hidden: it duplicates the text label and
	    must not reach the accessibility tree;
	  - the `Attendance: …` aria-label, which a screen reader needs to tell this
	    apart from the RSVP control sitting next to it.

	Only `testid` varies between callers (the agenda keys its badges by event id,
	the detail page has exactly one), so it is a prop rather than a constant.
-->
<script module lang="ts">
	/** The four badge states a RECENT (past) row can carry. */
	export type BadgeStatus = 'present' | 'absent' | 'late' | 'not-recorded';
</script>

<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';

	interface Props {
		status: BadgeStatus;
		/** data-testid for this instance (agenda: `attendance-badge-{eventId}`;
		 *  event detail: `event-detail-attendance-badge`). */
		testid: string;
	}
	const { status, testid }: Props = $props();

	const DOT_CLASS: Record<BadgeStatus, string> = {
		present: 'bg-green',
		absent: 'bg-red',
		late: 'bg-amber',
		'not-recorded': 'bg-ink-4'
	};
	const LABEL: Record<BadgeStatus, () => string> = {
		present: m.attendance_status_present,
		absent: m.attendance_status_absent,
		late: m.attendance_status_late,
		'not-recorded': m.attendance_status_not_recorded
	};
</script>

<span
	data-testid={testid}
	data-status={status}
	role="img"
	aria-label={m.attendance_badge_aria_label({ status: LABEL[status]() })}
	class="inline-flex w-fit items-center gap-1 font-mono text-[9px] tracking-wide text-ink-2"
>
	<span class="h-1.5 w-1.5 rounded-full {DOT_CLASS[status]}" aria-hidden="true"></span>
	{LABEL[status]()}
</span>
