<script lang="ts">
	import { eventTypeLabel } from '$lib/events/eventTypeLabels';
	import { eventTypeBadgeClass } from '$lib/events/eventTypeStyles';

	interface Props {
		id: string;
		eventType: string;
		class: string;
	}

	const { id, eventType, class: layoutClass }: Props = $props();
</script>

<span
	data-testid="event-type-badge-{id}"
	class="{layoutClass} rounded-full border px-1.5 py-0.5 font-mono text-[9px] tracking-wide uppercase {eventTypeBadgeClass(
		eventType
	)}"
>
	{eventTypeLabel(eventType)}
</span>
