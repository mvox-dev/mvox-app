<!-- The agenda's event-type filter; tapping the chosen type goes back to Kõik. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import SegmentedPill from '$lib/components/SegmentedPill.svelte';
	import { eventTypeLabel } from '$lib/events/eventTypeLabels';
	import { eventTypeBadgeClass } from '$lib/events/eventTypeStyles';
	import type { AgendaFilterBucket, AgendaTypeFilter } from '$lib/agenda/agendaFilter';

	let {
		chips,
		filter,
		onselect
	}: {
		chips: AgendaFilterBucket[];
		filter: AgendaTypeFilter;
		onselect: (value: AgendaTypeFilter) => void;
	} = $props();

	const typeOptions = $derived([
		{ value: 'all' as AgendaTypeFilter, label: m.agenda_filter_all(), testid: 'agenda-filter-all' },
		...chips.map((type) => ({
			value: type as AgendaTypeFilter,
			label: eventTypeLabel(type),
			testid: `agenda-filter-${type}`,
			pressedClass: `${eventTypeBadgeClass(type)} font-semibold ring-1 ring-ink`
		}))
	]);
</script>

<SegmentedPill
	testid="agenda-type-filter"
	label={m.agenda_filter_group_label()}
	options={typeOptions}
	selected={filter}
	emptyAllowed={true}
	defaultValue="all"
	kind="ui"
	buttonClass="px-2 py-0.5 font-mono text-[9px] tracking-wide uppercase"
	onselect={(value) => value && onselect(value)}
/>
