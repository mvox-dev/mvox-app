<!-- The admin page's collective-name field: a pencil that opens an inline editor. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { cfgFor } from '$lib/entu/cfg';
	import { renameCollectiveInStore } from '$lib/collectives/store';
	import type * as CollectiveName from '$lib/collectives/collectiveName';
	import type { CollectiveNameMarker } from '$lib/collectives/collectiveName';
	import { focusAfterRender, focusOnMount } from '$lib/a11y/focusable';
	import EditActivator from '$lib/components/EditActivator.svelte';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';

	interface Props {
		nameMarker: CollectiveNameMarker | null;
		nameHeldOffline: boolean;
		cfg: EntuCfg | null;
		isOffline: boolean;
		loadSeq: () => number;
		updateCollectiveName: typeof CollectiveName.updateCollectiveName;
	}

	let {
		nameMarker = $bindable(),
		nameHeldOffline = $bindable(),
		cfg,
		isOffline,
		loadSeq,
		updateCollectiveName
	}: Props = $props();

	let editingName = $state(false);
	let nameDraft = $state('');
	let nameWritePending = $state(false);
	let nameError = $state(false);
	let namePencilRef = $state<HTMLButtonElement | undefined>(undefined);

	export function reset(): void {
		editingName = false;
		nameDraft = '';
		nameError = false;
		nameWritePending = false;
	}

	function beginNameEdit(): void {
		// Backstop for a tap that beat the offline re-render.
		if (isOffline) return;
		if (!nameMarker || nameWritePending) return;
		nameError = false;
		nameDraft = nameMarker.name;
		editingName = true;
	}

	/** Escape and blur dismiss without writing. Only a keyboard dismissal returns focus to
	 *  the pencil; after a blur the viewer already chose where focus went. */
	function cancelNameEdit(restoreFocus: boolean): void {
		editingName = false;
		nameDraft = '';
		nameHeldOffline = false;
		if (restoreFocus) void focusAfterRender(() => namePencilRef);
	}

	/** Enter writes at once. The draft is trimmed first because the read side trims, so an
	 *  untrimmed write would round-trip padding. Focus returns in the finally, once the pencil
	 *  is enabled again: focus on a disabled element does nothing. */
	async function confirmNameEdit(restoreFocus: boolean): Promise<void> {
		if (!editingName || !cfg || !nameMarker) return;
		// Offline: no write, and the editor stays on the typed draft; closing would lose the
		// retyping. nameHeldOffline says why nothing saved.
		if (isOffline) {
			nameError = false;
			nameHeldOffline = true;
			return;
		}
		const draft = nameDraft.trim();
		const before = nameMarker;
		if (draft === '' || draft === before.name) {
			// No writable change — dismiss without touching the wire.
			cancelNameEdit(restoreFocus);
			return;
		}
		editingName = false;
		nameDraft = '';
		const thisLoad = loadSeq();
		const writeCfg = cfgFor(cfg.db);
		nameWritePending = true;
		try {
			await updateCollectiveName(writeCfg, before.markerId, draft);
			if (thisLoad !== loadSeq()) return; // superseded by a newer selection
			nameMarker = { ...before, name: draft };
			renameCollectiveInStore(writeCfg.db, draft);
			nameError = false;
		} catch (e) {
			if (thisLoad !== loadSeq()) return;
			console.error('admin collective name: write failed', e);
			nameError = true;
		} finally {
			if (thisLoad === loadSeq()) {
				nameWritePending = false;
				// A re-opened editor owns focus now; a late restore would pull it out of the input.
				if (restoreFocus && !editingName) {
					await focusAfterRender(() => namePencilRef);
				}
			}
		}
	}

	function handleNameKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			cancelNameEdit(true);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			void confirmNameEdit(true);
		}
	}
</script>

<!-- A missing marker hides the name surface; a failed read is a load-error. -->
{#if nameMarker}
	<div class="flex flex-col gap-1.5">
		{#if editingName}
			<input
				type="text"
				data-testid="admin-collective-name-input"
				aria-label={m.admin_collective_name_edit_aria_label()}
				class="border-b border-ink bg-transparent font-display text-2xl"
				value={nameDraft}
				use:focusOnMount
				oninput={(e) => (nameDraft = (e.currentTarget as HTMLInputElement).value)}
				onblur={() => cancelNameEdit(false)}
				onkeydown={handleNameKeydown}
			/>
		{:else}
			<!-- The whole field is the button, for a 44px target. A div, not h2: this is page
			     context, and an empty name must not read as a blank heading. -->
			<div
				data-testid="admin-collective-name"
				aria-labelledby="admin-collective-name-value"
				class="font-display text-2xl"
			>
				<EditActivator
					label={m.admin_collective_name_edit_aria_label()}
					data-testid="admin-collective-name-edit"
					disabled={nameWritePending || isOffline}
					bind:element={namePencilRef}
					class="w-full items-center gap-2 font-display text-2xl"
					onclick={beginNameEdit}
				>
					{#if nameMarker.name}
						<span id="admin-collective-name-value">{nameMarker.name}</span>
					{:else}
						<span id="admin-collective-name-value" class="text-ink-3 italic">
							{m.admin_collective_name_unnamed()}
						</span>
					{/if}
				</EditActivator>
			</div>
		{/if}
		{#if nameError}
			<p data-testid="admin-collective-name-error" role="alert" class="text-sm text-red-700">
				{m.admin_collective_name_save_error()}
			</p>
		{/if}
	</div>
{/if}
