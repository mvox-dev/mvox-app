// The roster route and every component it is split into, for the source scans.
export const ROSTER_SURFACES = [
	'src/routes/roster/+page.svelte',
	'src/lib/roster/MemberRow.svelte',
	'src/lib/roster/MemberRecordEditor.svelte',
	'src/lib/roster/MemberInvite.svelte',
	'src/lib/roster/MemberDeactivate.svelte',
	'src/lib/roster/InactiveList.svelte',
	'src/lib/sections/SectionArrange.svelte',
	'src/lib/sections/SectionArrangeRow.svelte'
] as const;
