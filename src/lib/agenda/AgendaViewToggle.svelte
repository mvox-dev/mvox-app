<!-- Detailne / Kompaktne: the agenda's day list or month overview, kept on this device. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { agendaViewStore, setAgendaView } from '$lib/preferences/agendaView';
	import SegmentedPill from '$lib/components/SegmentedPill.svelte';

	const views = [
		{ view: 'list', label: m.agenda_view_list },
		{ view: 'month', label: m.agenda_view_month }
	] as const;
</script>

<SegmentedPill
	testid="agenda-view-toggle"
	label={m.agenda_view_toggle_label()}
	options={views.map(({ view, label }) => ({
		value: view,
		label: label(),
		testid: `agenda-view-${view}`
	}))}
	selected={$agendaViewStore}
	emptyAllowed={false}
	defaultValue="list"
	kind="ui"
	buttonClass="px-2 py-0.5 font-mono text-[9px] tracking-wide uppercase"
	onselect={(view) => view && setAgendaView(view)}
/>
