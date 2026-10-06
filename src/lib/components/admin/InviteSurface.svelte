<script lang="ts">
	import { reportProblem } from '$lib/problems/reportProblem';
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getToken } from '$lib/auth/storage';
	import { cfgFor } from '$lib/entu/cfg';
	import { collectiveState } from '$lib/collectives/store';
	import RedactedText from '$lib/components/RedactedText.svelte';
	import {
		createInvite,
		InviteCreateError,
		resolveInviteParentId,
		mintSelfLinkInvite,
		SelfLinkMintError
	} from '$lib/invite/inviteData';
	import { buildInviteUrl } from '$lib/invite/invite-links';
	import { parseInviteToken } from '$lib/invite/parse-invite-token';
	import { createInviteLinkCopier } from '$lib/invite/copy-invite-link';
	import { resolveOwnerTier, type OwnerTier } from '$lib/nav/adminStore';
	import { writesAvailable } from '$lib/net/online';
	import { listJoinStates, type JoinState } from '$lib/profile/linkedIdentities';
	import { isAuthExpiredError } from '$lib/entu/request';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import { isoDateFormatter } from '$lib/preferences/timeFormat';
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
		heading?: 'h1' | 'h2';
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

	type Status = RouteLoadStatus | 'no-access' | 'creating' | 'done' | 'create-error';

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

	const inviteExpiryDateFmt = isoDateFormatter();

	let inviteLink = $state('');
	let inviteExpiryDate = $state('');
	let copied = $state(false);
	let copyFailed = $state(false);
	const copier = createInviteLinkCopier(() => inviteLink);

	let createError = $state<{ personId?: string } | null>(null);

	const canSubmit = $derived(dbId !== '' && dbEntityId !== '');
	const isOffline = $derived(!$writesAvailable);

	let ownerTier = $state<OwnerTier | 'loading'>('loading');
	let joinStates = $state<Record<string, JoinState>>({});
	let personListError = $state(false);
	let selectedPersonId = $state('');
	let personMintError = $state<{ name: string; ownerOnly: boolean } | null>(null);

	const uninvitedPersons = $derived(roster.filter((p) => joinStates[p.personId] === 'absent'));
	const selectedPerson = $derived(
		uninvitedPersons.find((p) => p.personId === selectedPersonId) ?? null
	);
	const showPersonSelect = $derived(controlled && ownerTier === 'owner' && uninvitedPersons.length > 0);
	const ownerNoteVisible = $derived(controlled && (ownerTier === 'editor' || ownerTier === 'none'));

	const submitLabel = $derived(
		status === 'creating'
			? m.admin_invite_creating()
			: selectedPerson
				? m.admin_invite_submit_person({ name: selectedPerson.name })
				: m.admin_invite_submit()
	);

	let resolvedPersonDataKey = '';

	async function loadPersonInviteData(
		cfg: { db: string; token: string },
		dbEntityIdForTier: string,
		personIdForTier: string,
		personIds: string[]
	): Promise<void> {
		personListError = false;
		let tier: OwnerTier;
		try {
			tier = await resolveOwnerTier(cfg, personIdForTier, undefined, dbEntityIdForTier);
		} catch (e) {
			reportProblem({ area: 'admin/invite', action: 'reading the owner tier', error: e });
			tier = 'error';
		}
		ownerTier = tier;
		if (tier !== 'owner') {
			joinStates = {};
			return;
		}
		try {
			joinStates = await listJoinStates(cfg, personIds);
		} catch (e) {
			reportProblem({ area: 'admin/invite', action: 'loading the join states', error: e });
			joinStates = {};
			personListError = true;
		}
	}

	$effect(() => {
		if (!controlled || !presetDbEntityId || !viewerPersonId) return;
		const token = getToken();
		if (!token) return;
		const personIds = roster.map((p) => p.personId);
		const key = `${presetDb}|${presetDbEntityId}|${viewerPersonId}|${personIds.join(',')}`;
		if (key === resolvedPersonDataKey) return;
		resolvedPersonDataKey = key;
		void loadPersonInviteData({ db: presetDb, token }, presetDbEntityId, viewerPersonId, personIds);
	});

	let hasShownForm = !!(initialPresetDb && initialPresetDbEntityId);

	async function loadPrerequisites(targetDb: string): Promise<void> {
		if (!hasShownForm) status = 'loading';
		dbEntityId = '';
		const token = getToken();
		if (!token) {
			console.error('admin/invite: no auth token in storage on a protected route');
			status = 'load-error';
			return;
		}
		const cfg = { db: targetDb, token };
		try {
			const resolvedDbEntityId = await resolveInviteParentId(cfg);
			dbEntityId = resolvedDbEntityId;
			resolvedForDb = targetDb;
			status = 'ready';
			hasShownForm = true;
		} catch (e) {
			if (isAuthExpiredError(e)) {
				status = 'session-expired';
				return;
			}
			if (e instanceof InviteCreateError && e.reason === 'not-visible') {
				status = 'no-access';
			} else {
				reportProblem({ area: 'admin/invite', action: 'load', error: e });
				status = 'load-error';
			}
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
			void loadPrerequisites(dbId);
		} else {
			status = 'ready';
			hasShownForm = true;
		}
	});

	async function submit(): Promise<void> {
		if (isOffline) return;
		if (!dbId || !canSubmit || status === 'creating') return;
		const cfg = cfgFor(dbId);
		createError = null;
		personMintError = null;

		if (selectedPersonId) {
			const targetPersonId = selectedPersonId;
			const targetName = selectedPerson?.name ?? '';
			status = 'creating';
			try {
				const { inviteToken } = await mintSelfLinkInvite(cfg, targetPersonId);
				inviteLink = buildInviteUrl(window.location.origin, inviteToken);
				const parsed = parseInviteToken(inviteToken, Date.now());
				inviteExpiryDate =
					parsed.status === 'invalid' ? '' : inviteExpiryDateFmt.format(new Date(parsed.expMs));
				copied = false;
				copyFailed = false;
				selectedPersonId = '';
				try {
					const updated = await listJoinStates(cfg, [targetPersonId]);
					joinStates = { ...joinStates, ...updated };
				} catch (refreshErr) {
					reportProblem({ area: 'admin/invite', action: 're-reading the join state after an invite', error: refreshErr });
				}
				status = 'done';
			} catch (e) {
				if (isAuthExpiredError(e)) {
					status = 'session-expired';
					return;
				}
				console.error('admin/invite: person-targeted mint failed', e);
				const ownerOnly = e instanceof SelfLinkMintError && e.reason === 'missing-self-editor';
				personMintError = { name: targetName, ownerOnly };
				status = 'create-error';
			}
			return;
		}

		status = 'creating';
		try {
			const result = await createInvite(cfg, { dbEntityId });
			inviteLink = buildInviteUrl(window.location.origin, result.inviteToken);
			const parsed = parseInviteToken(result.inviteToken, Date.now());
			inviteExpiryDate =
				parsed.status === 'invalid' ? '' : inviteExpiryDateFmt.format(new Date(parsed.expMs));
			copied = false;
			copyFailed = false;
			status = 'done';
		} catch (e) {
			if (isAuthExpiredError(e)) {
				status = 'session-expired';
				return;
			}
			console.error('admin/invite: create failed', e);
			if (e instanceof InviteCreateError) {
				createError = { personId: e.personId };
			} else {
				createError = {};
			}
			status = 'create-error'; // form values stay — retry enabled
		}
	}

	async function copyLink(): Promise<void> {
		const pending = copier.copy();
		copied = copier.copied;
		copyFailed = copier.copyFailed;
		await pending;
		copied = copier.copied;
		copyFailed = copier.copyFailed;
	}

	function createAnother(): void {
		inviteLink = '';
		inviteExpiryDate = '';
		copied = false;
		copyFailed = false;
		createError = null;
		selectedPersonId = '';
		personMintError = null;
		status = 'ready';
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
			<p class="text-sm text-red-700">{m.admin_invite_load_error()}</p>
			<button
				type="button"
				data-testid="invite-admin-retry-load"
				class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
				onclick={() => dbId && loadPrerequisites(dbId)}
			>
				{m.admin_invite_retry_load()}
			</button>
		</div>
	{:else if status === 'done'}
		<div data-testid="invite-admin-result" class="flex flex-col gap-3">
			<p class="text-sm">{m.admin_invite_link_label()}</p>
			<button
				type="button"
				data-testid="invite-copy"
				class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
				onclick={copyLink}
			>
				{m.admin_invite_copy()}
			</button>
			<p
				data-testid="invite-copy-status"
				role="status"
				aria-live="polite"
				class="min-h-[16px] text-xs leading-[16px] text-ink-2"
			>
				{#if copied}{m.admin_invite_copied()}{/if}
			</p>
			{#if copyFailed}
				<p class="text-sm text-red-700" role="alert">{m.admin_invite_copy_error()}</p>
			{/if}
			<p data-testid="invite-bearer-warning" class="text-sm text-red-700">
				{m.admin_invite_bearer_warning()}
				{m.admin_invite_show_once({ date: inviteExpiryDate })}
			</p>
			<button
				type="button"
				class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
				onclick={createAnother}
			>
				{m.admin_invite_create_another()}
			</button>
		</div>
	{:else}
		{#if createError}
			<div data-testid="invite-admin-error" class="flex flex-col gap-1" role="alert">
				<p class="text-sm text-red-700">
					{m.admin_invite_error()}
				</p>
				{#if createError.personId}
					<p data-testid="invite-partial-failure" class="text-sm text-red-700">
						{m.admin_invite_partial_failure({ personId: createError.personId })}
					</p>
				{/if}
			</div>
		{/if}
		{#if personMintError}
			<div data-testid="invite-mint-error" class="flex flex-col gap-1" role="alert">
				<p class="text-sm text-red-700">
					<RedactedText
						>{personMintError.ownerOnly
							? m.admin_invite_mint_owner_only()
							: m.admin_invite_mint_error({ name: personMintError.name })}</RedactedText
					>
				</p>
			</div>
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
				<p data-testid="invite-person-list-error" class="text-sm text-red-700" role="alert">
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
							personMintError = null;
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
		</div>
	{/if}
</div>

<!-- (*MVOX:Palestrina* — #140/S3 GREEN, extracted from admin/invite/+page.svelte -->
