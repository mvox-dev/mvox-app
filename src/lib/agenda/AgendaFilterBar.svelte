<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { agendaViewStore, setAgendaView } from '$lib/preferences/agendaView';
	import { rovingKeydown } from '$lib/a11y/roving';
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

	const views = [
		{ view: 'list', label: m.agenda_view_list },
		{ view: 'month', label: m.agenda_view_month }
	] as const;

	const CHIP_PRESSED_CLASS = 'font-semibold ring-1 ring-ink';
	function agendaTypeChipClass(type: AgendaFilterBucket): string {
		return filter === type
			? `${eventTypeBadgeClass(type)} ${CHIP_PRESSED_CLASS}`
			: 'border-ink-4 text-ink-2';
	}

	function handleAgendaViewKeydown(e: KeyboardEvent): void {
		rovingKeydown(e, {
			beforeFocus: (member) => {
				const view = member.dataset.agendaView as 'list' | 'month' | undefined;
				if (!view) return false;
				setAgendaView(view);
			}
		});
	}
</script>

<div class="flex flex-wrap items-center justify-between gap-2 pb-3">
	<div
		role="group"
		aria-label={m.agenda_filter_group_label()}
		class="flex flex-wrap gap-2"
	>
		<button
			type="button"
			data-testid="agenda-filter-all"
			aria-pressed={filter === 'all' ? 'true' : 'false'}
			class="rounded-full border px-2 py-0.5 font-mono text-[9px] tracking-wide uppercase {filter ===
			'all'
				? 'border-ink bg-ink text-paper'
				: 'border-ink-4 text-ink-2'}"
			onclick={() => onselect('all')}
		>
			{m.agenda_filter_all()}
		</button>
		{#each chips as type (type)}
			<button
				type="button"
				data-testid="agenda-filter-{type}"
				aria-pressed={filter === type ? 'true' : 'false'}
				class="rounded-full border px-2 py-0.5 font-mono text-[9px] tracking-wide uppercase {agendaTypeChipClass(
					type
				)}"
				onclick={() => onselect(type)}
			>
				{eventTypeLabel(type)}
			</button>
		{/each}
	</div>
	<div
		data-testid="agenda-view-toggle"
		role="radiogroup"
		tabindex="-1"
		aria-label={m.agenda_view_toggle_label()}
		class="inline-flex overflow-hidden rounded-md border border-ink-4"
		onkeydown={handleAgendaViewKeydown}
	>
		{#each views as { view, label } (view)}
			<button
				type="button"
				data-testid="agenda-view-{view}"
				data-agenda-view={view}
				role="radio"
				aria-checked={$agendaViewStore === view ? 'true' : 'false'}
				tabindex={$agendaViewStore === view ? 0 : -1}
				class="border-r border-ink-4 px-2 py-0.5 font-mono text-[9px] tracking-wide uppercase last:border-r-0 {$agendaViewStore ===
				view
					? 'bg-ink text-paper'
					: 'text-ink-2'}"
				onclick={() => setAgendaView(view)}
			>
				{label()}
			</button>
		{/each}
	</div>
</div>
