<!-- The landing: what a member needs most days, with one door into the rest of the app. -->
<script lang="ts">
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/auth/session';
	import { collectiveState, selectedCollectiveStore } from '$lib/collectives/store';
	import { writesAvailable } from '$lib/net/online';
	import AgendaCollectivesStatus from '$lib/agenda/AgendaCollectivesStatus.svelte';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import { createLanding } from '$lib/landing/landingState.svelte';
	import LandingHeading from '$lib/landing/LandingHeading.svelte';
	import LandingNextEvent from '$lib/landing/LandingNextEvent.svelte';
	import LandingUnanswered from '$lib/landing/LandingUnanswered.svelte';
	import LandingLearning from '$lib/landing/LandingLearning.svelte';
	import LandingLinks from '$lib/landing/LandingLinks.svelte';

	const auth = $derived($authStore);
	const collectives = $derived($collectiveState);
	const selected = $derived($selectedCollectiveStore);
	const isOffline = $derived(!$writesAvailable);

	const landing = createLanding();
	const s = landing.state;

	const nonMember = $derived(s.membership === 'non-member' || s.canAnswer === false);
	const answerLocked = $derived(isOffline || s.membership === 'loading' || s.canAnswer === null);
	const next = $derived(landing.nextEvent);

	$effect(() => {
		const current = selected;
		untrack(() => landing.load(current));
	});
</script>

{#if auth.status === 'authenticated'}
	{#if collectives.status === 'ready' && selected}
		<main class="min-h-screen bg-paper px-6 py-10 text-ink">
			<div class="mx-auto flex w-full max-w-md flex-col gap-6">
				<LandingHeading {selected} initials={s.initials} />
				{#if s.sessionExpired}
					<SessionExpiredNotice centered />
				{:else if s.agendaError}
					<div data-testid="landing-agenda-error" class="flex flex-col items-start gap-2">
						<p class="text-sm text-ink-2">{m.agenda_load_error()}</p>
						<button
							type="button"
							data-testid="landing-retry"
							class="rounded-md border border-ink px-4 py-2 text-sm text-ink hover:bg-ink hover:text-paper"
							onclick={() => landing.load(selected)}>{m.agenda_retry()}</button
						>
					</div>
				{:else}
					{#if isOffline && next && !nonMember}
						<p data-testid="landing-write-unavailable" class="text-xs text-ink-2">
							{m.write_unavailable_no_signal()}
						</p>
					{/if}
					{#if next}
						<LandingNextEvent
							event={next}
							answer={s.answers?.[next.id]}
							answersKnown={s.answers !== null}
							{nonMember}
							canWrite={s.canAnswer !== false}
							pending={answerLocked || s.pending.has(next.id)}
							failed={s.failed.has(next.id)}
							tally={s.tally}
							tallyError={s.tallyError}
							onanswer={(status) => landing.answer(next.id, status)}
						/>
					{/if}
					{#if s.answersError}
						<p data-testid="landing-answers-error" class="text-sm text-danger">
							{m.landing_answers_error()}
						</p>
					{:else if !nonMember && landing.unanswered.length > 0}
						{#if s.answersPartial}
							<p data-testid="rsvp-partial-notice" class="text-xs text-ink-2">{m.rsvp_partial_notice()}</p>
						{/if}
						<LandingUnanswered
							events={landing.unanswered}
							pending={s.pending}
							failed={s.failed}
							disabled={answerLocked}
							onanswer={(id, status) => landing.answer(id, status)}
						/>
					{/if}
				{/if}
				{#if !s.sessionExpired}
					{#if s.learningError}
						<p data-testid="landing-learning-error" class="text-sm text-danger">{m.library_load_error()}</p>
					{:else if s.learning.length > 0}
						<LandingLearning works={s.learning} db={selected.db} />
					{/if}
					{#if s.linksError}
						<p data-testid="landing-links-error" class="text-sm text-danger">{m.links_load_error()}</p>
					{:else if s.links.length > 0}
						<LandingLinks links={s.links} />
					{/if}
				{/if}
				<a
					href="/agenda"
					data-testid="landing-everything-else"
					class="block w-full rounded-md border border-ink px-4 py-3 text-center text-sm text-ink hover:bg-ink hover:text-paper"
				>
					{m.landing_everything_else()} <span aria-hidden="true">›</span>
				</a>
			</div>
		</main>
	{:else}
		<AgendaCollectivesStatus {collectives} />
	{/if}
{/if}
