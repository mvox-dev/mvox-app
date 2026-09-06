// src/lib/schedule/scheduleSort.ts
//
// #262 — the schedule_item row shape + its ONE sort rule (datetime asc, name
// tie-break; deliberately NO ordinal, per the #246 adjudication), split out of
// scheduleData.ts into its OWN dependency-free module.
//
// WHY a separate file: scheduleData.ts's other exports (listScheduleItems,
// createScheduleItem, …) import `entuFetch`/`resolveTypeId`, which pull in
// `$lib/entu-config` -> `$env/dynamic/public` at MODULE LOAD time (an ES
// import is evaluated whole, even when only one named export is actually
// used) — fine for the event-detail page (real SvelteKit runtime) and for
// scheduleData.spec.ts (which mocks `$lib/entu-config`), but AgendaList.svelte
// is a plain component with a component-level test that mounts it with NO
// such mock. Importing `compareScheduleItems` from scheduleData.ts there would
// drag in that whole chain and crash at import time
// (`TypeError: Cannot read properties of undefined (reading 'env')`).
// scheduleData.ts re-exports both symbols, so every EXISTING caller (the data
// layer's own spec, the event-detail page) is unaffected.

export type ScheduleItem = { id: string; name: string; datetime: string };

/** datetime asc, name tie-break — the ONE sort rule (no ordinal, #246). */
export function compareScheduleItems(a: ScheduleItem, b: ScheduleItem): number {
	if (a.datetime !== b.datetime) return a.datetime < b.datetime ? -1 : 1;
	if (a.name === b.name) return 0;
	return a.name < b.name ? -1 : 1;
}

// (*MVOX:Josquin* — #262 GREEN: schedule_item sort, split for a dependency-free import)
