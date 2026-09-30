// The event route and every component it is split into, for the source scans.
export const EVENT_SURFACES = [
	'src/routes/event/[id]/+page.svelte',
	'src/lib/events/EventConvertForm.svelte',
	'src/lib/events/EventFieldEdit.svelte',
	'src/lib/events/EventScheduleSection.svelte',
	'src/lib/events/EventRsvpSection.svelte',
	'src/lib/events/EventWorksSection.svelte',
	'src/lib/events/EventAttendanceSection.svelte',
	'src/lib/events/EventDangerZone.svelte'
] as const;
