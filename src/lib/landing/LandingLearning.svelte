<!-- The season's works being learned, each with its sheet; two learning editions offer both. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { openPart } from '$lib/parts/openPart';
	import type { LearningSheet, LearningWork } from './landingReads';

	let { works, db }: { works: LearningWork[]; db: string } = $props();

	let choosing = $state<string | null>(null);

	function open(work: LearningWork, sheet: LearningSheet): void {
		openPart(db, sheet.fileId, {
			work: work.name,
			composer: work.composer,
			edition: sheet.edition,
			filename: sheet.filename
		});
	}

	function sheetTap(work: LearningWork): void {
		if (work.sheets.length === 1) open(work, work.sheets[0]);
		else choosing = choosing === work.workId ? null : work.workId;
	}
</script>

<section data-testid="landing-learning" class="flex flex-col gap-2" aria-labelledby="landing-learning-heading">
	<h2 id="landing-learning-heading" class="font-display text-lg text-ink-2">
		{m.landing_learning_heading()}
	</h2>
	<ul class="flex flex-col gap-2">
		{#each works as work (work.workId)}
			<li data-testid="landing-work-{work.workId}" class="flex flex-col gap-1">
				<div class="flex items-center justify-between gap-2">
					<span class="flex flex-col text-sm text-ink">
						<span>{work.name}</span>
						{#if work.composer}<span class="text-xs text-ink-2">{work.composer}</span>{/if}
					</span>
					{#if work.sheets.length > 0}
						<button
							type="button"
							data-testid="landing-sheet-{work.workId}"
							class="rounded-md border border-ink px-3 py-1 text-sm text-ink hover:bg-ink hover:text-paper"
							aria-expanded={work.sheets.length > 1 ? choosing === work.workId : undefined}
							onclick={() => sheetTap(work)}>{m.landing_sheet()}</button
						>
					{/if}
				</div>
				{#if choosing === work.workId}
					<div class="flex flex-wrap justify-end gap-1">
						{#each work.sheets as sheet (sheet.fileId)}
							<button
								type="button"
								data-testid="landing-sheet-choice-{sheet.fileId}"
								class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper"
								onclick={() => open(work, sheet)}>{sheet.edition || sheet.filename}</button
							>
						{/each}
					</div>
				{/if}
			</li>
		{/each}
	</ul>
	<a href="/library" data-testid="landing-all-library" class="text-sm text-ink underline">
		{m.landing_all_library()} <span aria-hidden="true">›</span>
	</a>
</section>
