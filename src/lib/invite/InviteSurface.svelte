<script lang="ts">
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getToken } from '$lib/auth/storage';
	import { cfgFor } from '$lib/entu/cfg';
	import { collectiveState } from '$lib/collectives/store';
	import RedactedText from '$lib/components/RedactedText.svelte';
	import FormError from '$lib/components/FormError.svelte';
	import { createInvite, sendInvite, type SendInviteResult } from './inviteData';
	import { loadPersonInviteData, loadPrerequisites, submitInvite } from './inviteSurfaceOps';
	import type { DbRight } from '$lib/nav/dbRights';
	import { writesAvailable } from '$lib/net/online';
	import type { JoinState } from '$lib/profile/linkedIdentities';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import type { RouteLoadStatus } from '$lib/loading/routeLoad';

	type InvitablePerson = { personId: string; name: string };

	let {
		presetDb = '',
		presetDbEntityId = '',
		presetDbName = '',
		heading = 'h1',
		layout = 'standalone',
		viewerPersonId = '',
		roster = [],
		rosterPartial = false
	}: {
		presetDb?: string;
		presetDbEntityId?: string;
		presetDbName?: string;
		heading?: 'h1' | 'h3';
		layout?: 'standalone' | 'embedded';
		viewerPersonId?: string;
		roster?: InvitablePerson[];
		rosterPartial?: boolean;
	} = $props();
	const rootClasses = $derived(
		layout === 'embedded' ? 'flex w-full flex-col gap-4' : 'mx-auto flex w-full max-w-md flex-col gap-4'
	);
	const initialPresetDb = untrack(() => presetDb);
	const initialPresetDbEntityId = untrack(() => presetDbEntityId);

	type Status = RouteLoadStatus | 'no-access' | 'creating' | 'create-error';

	const availableDbs = $derived(
		$collectiveState.status === 'ready' ? $collectiveState.collectives : []
	);

	const controlled = $derived(presetDb !== '' && presetDbEntityId !== '');
	const presetLabel = $derived(
		presetDbName || availableDbs.find((c) => c.db === presetDb)?.name || presetDb
	);

	let status = $state<Status>(initialPresetDb && initialPresetDbEntityId ? 'ready' : 'loading');
	let dbId = $state(initialPresetDb);
	let dbEntityId = $state(initialPresetDbEntityId);
	let resolvedForDb = $state(initialPresetDb && initialPresetDbEntityId ? initialPresetDb : '');

	let email = $state('');
	let emailMissing = $state(false);
	let outcome = $state<SendInviteResult | null>(null);
	let sendFailed = $state(false);
	// Created, but the send failed: listed so a retry sends to them instead of creating again.
	let createdPersons = $state<InvitablePerson[]>([]);

	let createError = $state<{ personId?: string } | null>(null);

	const canSubmit = $derived(dbId !== '' && dbEntityId !== '');
	const isOffline = $derived(!$writesAvailable);

	let dbRight = $state<DbRight | 'loading'>('loading');
	let joinStates = $state<Record<string, JoinState>>({});
	let personListError = $state(false);
	let selectedPersonId = $state('');

	const uninvitedPersons = $derived([
		...roster.filter((p) => joinStates[p.personId] === 'absent'),
		...createdPersons
	]);
	const selectedPerson = $derived(
		uninvitedPersons.find((p) => p.personId === selectedPersonId) ?? null
	);
	const showPersonSelect = $derived(controlled && dbRight === 'owner' && uninvitedPersons.length > 0);
	const ownerNoteVisible = $derived(controlled && (dbRight === 'editor' || dbRight === 'none'));

	const submitLabel = $derived(
		status === 'creating'
			? m.admin_invite_creating()
			: selectedPerson
				? m.admin_invite_submit_person({ name: selectedPerson.name })
				: m.admin_invite_submit()
	);

	let resolvedPersonDataKey = '';

	$effect(() => {
		if (!controlled || !presetDbEntityId || !viewerPersonId) return;
		const token = getToken();
		if (!token) return;
		const personIds = roster.map((p) => p.personId);
		const key = `${presetDb}|${presetDbEntityId}|${viewerPersonId}|${personIds.join(',')}`;
		if (key === resolvedPersonDataKey) return;
		resolvedPersonDataKey = key;
		personListError = false;
		void loadPersonInviteData(cfgFor(presetDb), presetDbEntityId, viewerPersonId, personIds).then(
			(loaded) => {
				dbRight = loaded.dbRight;
				joinStates = loaded.joinStates;
				personListError = loaded.personListError;
			}
		);
	});

	let hasShownForm = !!(initialPresetDb && initialPresetDbEntityId);

	async function loadDbPrerequisites(targetDb: string): Promise<void> {
		if (!hasShownForm) status = 'loading';
		dbEntityId = '';
		createdPersons = [];
		selectedPersonId = '';
		const result = await loadPrerequisites(targetDb);
		if (result.status === 'ready') {
			dbEntityId = result.dbEntityId;
			resolvedForDb = targetDb;
			status = 'ready';
			hasShownForm = true;
		} else {
			status = result.status;
		}
	}

	$effect(() => {
		if (controlled) {
			dbId = presetDb;
			dbEntityId = presetDbEntityId;
			resolvedForDb = presetDb;
			hasShownForm = true;
			status = 'ready';
		}
	});

	$effect(() => {
		if (controlled) return; // controlled mode — never self-resolves
		if (availableDbs.length === 0) {
			status = 'no-collective';
			dbId = '';
			dbEntityId = '';
			hasShownForm = false;
			resolvedForDb = '';
			return;
		}
		if (dbId === '' && availableDbs.length === 1) {
			dbId = availableDbs[0].db; // sole database preselected, select still rendered
		}
	});

	$effect(() => {
		if (controlled) return; // controlled mode — never self-resolves
		if (availableDbs.length === 0) return; // effect A already set no-collective
		if (dbId) {
			if (dbId === resolvedForDb) return; // already resolved — no redundant fetch
			void loadDbPrerequisites(dbId);
		} else {
			status = 'ready';
			hasShownForm = true;
		}
	});

	async function submit(): Promise<void> {
		if (isOffline) return;
		if (!dbId || !canSubmit || status === 'creating') return;
		const target = selectedPerson;
		emailMissing = !target && !/^[^\s@]+@[^\s@]+$/.test(email.trim());
		if (emailMissing) return;
		const cfg = cfgFor(dbId);
		createError = null;
		sendFailed = false;
		outcome = null;
		status = 'creating';
		const result = await submitInvite(
			cfg,
			{ dbEntityId, personId: target?.personId ?? '', email: email.trim() },
			{ createInvite: (c, input) => createInvite(c, input), sendInvite: (c, id) => sendInvite(c, id) }
		);
		if (result.kind === 'sent') {
			joinStates = { ...joinStates, ...result.refreshedJoinStates };
			createdPersons = createdPersons.filter((p) => p.personId !== target?.personId);
			outcome = result.outcome;
			selectedPersonId = '';
			email = '';
			status = 'ready';
		} else if (result.kind === 'session-expired') {
			status = 'session-expired';
		} else if (result.kind === 'send-error') {
			if (result.createdPersonId) {
				createdPersons = [...createdPersons, { personId: result.createdPersonId, name: email.trim() }];
				selectedPersonId = result.createdPersonId;
			}
			sendFailed = true;
			status = 'create-error';
		} else {
			createError = { personId: result.personId };
			status = 'create-error'; // form values stay — retry enabled
		}
	}
</script>

<div class={rootClasses}>
	<svelte:element
		this={heading}
		class={heading === 'h1' ? 'font-display text-2xl' : 'font-display text-lg'}
	>
		{m.admin_invite_title()}
	</svelte:element>

	{#if status === 'no-collective'}
		<p data-testid="invite-admin-no-collective" class="text-sm">
			{m.admin_invite_no_collective()}
		</p>
	{:else if status === 'loading'}
		<p class="text-sm" aria-busy="true">…</p>
	{:else if status === 'no-access'}
		<p data-testid="invite-admin-no-access" class="text-sm" role="alert">
			{m.admin_invite_no_access()}
		</p>
	{:else if status === 'session-expired'}
		<SessionExpiredNotice />
	{:else if status === 'load-error'}
		<div data-testid="invite-admin-load-error" class="flex flex-col gap-2" role="alert">
			<p class="text-sm text-danger">{m.admin_invite_load_error()}</p>
			<button
				type="button"
				data-testid="invite-admin-retry-load"
				class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
				onclick={() => dbId && loadDbPrerequisites(dbId)}
			>
				{m.admin_invite_retry_load()}
			</button>
		</div>
	{:else}
		{#if createError}
			<div data-testid="invite-admin-error" class="flex flex-col gap-1" role="alert">
				<p class="text-sm text-danger">
					{m.admin_invite_error()}
				</p>
				{#if createError.personId}
					<p data-testid="invite-partial-failure" class="text-sm text-danger">
						{m.admin_invite_partial_failure({ personId: createError.personId })}
					</p>
				{/if}
			</div>
		{/if}
		{#if sendFailed}
			<FormError data-testid="invite-send-error">{m.roster_member_invite_send_failed()}</FormError>
		{/if}
		<div class="flex flex-col gap-3">
			{#if controlled}
				<p data-testid="invite-db-fixed" class="flex flex-col gap-1 text-sm">
					<span>{m.admin_invite_db_label()}</span>
					<span class="font-medium">{presetLabel}</span>
				</p>
			{:else}
				<label class="flex flex-col gap-1 text-sm">
					{m.admin_invite_db_label()}
					<select
						data-testid="invite-db"
						value={dbId}
						onchange={(e) => (dbId = e.currentTarget.value)}
						class="rounded-md border border-ink px-3 py-2"
					>
						<option value="" disabled hidden>—</option>
						{#each availableDbs as c (c.db)}
							<option value={c.db}>{c.name}</option>
						{/each}
					</select>
				</label>
			{/if}
			{#if personListError}
				<p data-testid="invite-person-list-error" class="text-sm text-danger" role="alert">
					{m.admin_invite_person_list_error()}
				</p>
			{:else if showPersonSelect}
				<label class="flex flex-col gap-1 text-sm">
					{m.admin_invite_person_label()}
					<select
						data-testid="invite-person-select"
						value={selectedPersonId}
						onchange={(e) => {
							selectedPersonId = e.currentTarget.value;
							createError = null;
							sendFailed = false;
						}}
						class="rounded-md border border-ink px-3 py-2"
					>
						<option value="">{m.admin_invite_person_new()}</option>
						{#each uninvitedPersons as p (p.personId)}
							<option value={p.personId}>{p.name}</option>
						{/each}
					</select>
				</label>
			{:else if ownerNoteVisible}
				<p data-testid="invite-owner-note" class="text-xs text-ink-2">
					{m.roster_member_invite_owner_only()}
				</p>
			{/if}
			{#if !selectedPerson}
				<label class="flex flex-col gap-1 text-sm">
					{m.admin_invite_email_label()}
					<input
						type="email"
						data-testid="invite-email"
						required
						autocomplete="off"
						disabled={isOffline}
						bind:value={email}
						oninput={() => (emailMissing = false)}
						class="rounded-md border border-ink px-3 py-2"
					/>
				</label>
				{#if emailMissing}
					<FormError data-testid="invite-email-missing">{m.admin_invite_email_missing()}</FormError>
				{/if}
			{/if}
			{#if rosterPartial && !personListError}
				<p data-testid="invite-person-partial-notice" role="status" class="text-xs text-ink-2">
					{m.picker_partial_members_notice()}
				</p>
			{/if}
			{#if isOffline}
				<p data-testid="invite-write-unavailable" class="text-xs text-ink-2">
					{m.write_unavailable_no_signal()}
				</p>
			{/if}
			<button
				type="button"
				data-testid="invite-admin-submit"
				disabled={!canSubmit || status === 'creating' || isOffline}
				class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper disabled:opacity-50"
				onclick={submit}
			>
				<RedactedText>{submitLabel}</RedactedText>
			</button>
			<p
				data-testid="invite-send-status"
				role="status"
				aria-live="polite"
				class="min-h-[16px] text-xs leading-[16px] text-ink-2"
			>
				{#if outcome?.sent}{m.roster_member_invite_sent({ email: outcome.email })}
				{:else if outcome}{m.roster_member_invite_no_email()}{/if}
			</p>
		</div>
	{/if}
</div>

<!-- (*MVOX:Palestrina* — #140/S3 GREEN, extracted from admin/invite/+page.svelte -->
