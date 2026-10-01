<script lang="ts">
	import AsOfLine from '$lib/components/offline/AsOfLine.svelte';
	// `servedFromCache` is the OLDEST readAt among entries served since
	// `resetServedFromCache()` (reset at the top of every load) so an online
	// load never shows a stale line.
	import { servedFromCache } from '$lib/entu/readCache';
	import { m } from '$lib/paraglide/messages.js';

	let {
		rsvpPartial,
		attendancePartial,
		showOnboarding
	}: {
		rsvpPartial: boolean;
		attendancePartial: boolean;
		showOnboarding: boolean;
	} = $props();
</script>

{#if $servedFromCache}
	<AsOfLine readAt={$servedFromCache} testid="agenda-as-of" class="mb-3" />
	<a
		href="/downloads"
		class="mb-3 block text-sm text-ink underline"
		data-testid="agenda-downloads-link-cached"
	>
		{m.agenda_downloads_link()}
	</a>
{/if}
{#if rsvpPartial}
	<p
		data-testid="rsvp-partial-notice"
		role="status"
		class="mb-3 rounded-md border border-dashed border-ink-4 p-2 text-sm text-ink-2"
	>
		{m.rsvp_partial_notice()}
	</p>
{/if}
{#if attendancePartial}
	<p
		data-testid="attendance-partial-notice"
		role="status"
		class="mb-3 rounded-md border border-dashed border-ink-4 p-2 text-sm text-ink-2"
	>
		{m.attendance_partial_notice()}
	</p>
{/if}
{#if showOnboarding}
	<div
		data-testid="agenda-onboarding"
		class="mb-3 flex flex-col gap-2 rounded-md border border-dashed border-ink-4 p-3"
	>
		<ol class="flex flex-col gap-1 text-sm text-ink-2">
			<li>{m.agenda_onboarding_step_season()}</li>
			<li>{m.agenda_onboarding_step_series()}</li>
			<li>{m.agenda_onboarding_step_events()}</li>
		</ol>
	</div>
{/if}
