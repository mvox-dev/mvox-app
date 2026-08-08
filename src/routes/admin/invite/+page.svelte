<script lang="ts">
	// T4.5 (#31) — the admin invite surface (protected automatically: not on the
	// guard allowlist; URL-only, no nav affordance in T4.5). State machine over
	// resolvePersonParentId + resolveOrgId (prerequisite load doubles as a LABELED
	// not-admin heuristic — the authoritative gate is Entu's create POST) and
	// createInvite. The minted invite token is a BEARER SECRET: it lives ONLY in
	// component state — never localStorage/sessionStorage, never logged — and the
	// link is shown exactly once.
	//
	// #67 (Mihkel ruling, 2026-08-08): the picker enumerates DATABASES (the
	// collectives this account has a person in, from the collective store — same
	// source the root layout already hydrates), never `organization` entities —
	// polyphony verifiably carries 6 org entities (EFK + 5 unreferenced v4E-era
	// legacy, #41), so offering all 6 for pick misrepresented five ghosts as real
	// invite targets. The member's required org-entity `_parent` is still resolved
	// (via `resolveOrgId`, a single `limit=1` read, NOT a user-facing list) once a
	// target database is chosen.
	// Contract: src/routes/page.admin-invite.spec.ts.
	import { m } from '$lib/paraglide/messages.js';
	import { getToken } from '$lib/auth/storage';
	import { collectiveState } from '$lib/collectives/store';
	import {
		createInvite,
		InviteCreateError,
		resolveOrgId,
		resolvePersonParentId
	} from '$lib/invite/inviteData';
	import { buildInviteUrl } from '$lib/invite/invite-links';
	import { parseInviteToken } from '$lib/invite/parse-invite-token';

	type Status =
		| 'loading'
		| 'no-collective'
		| 'no-access'
		| 'load-error'
		| 'ready'
		| 'creating'
		| 'done'
		| 'create-error';

	// The enumerable set: mvox collectives (databases) this account has a person
	// in — NOT organization entities. Today that's exactly one (polyphony).
	const availableDbs = $derived(
		$collectiveState.status === 'ready' ? $collectiveState.collectives : []
	);

	let status = $state<Status>('loading');
	let dbId = $state('');
	// The member's required org-entity parent — resolved internally per chosen
	// `dbId` (never rendered as a picker; see #67 note above).
	let orgId = $state('');

	// Done-panel state — the token-carrying link exists ONLY here (component state).
	let inviteLink = $state('');
	let inviteExpiryDate = $state('');
	let copied = $state(false);
	let copyFailed = $state(false);

	let createError = $state<{ personId?: string } | null>(null);

	const canSubmit = $derived(dbId !== '' && orgId !== '');

	// Plain (non-reactive) flag, not $state — mirrors +layout.svelte's
	// `lastAuthStatus`/`hydrating` pattern. Once the picker has been shown once
	// (either the sole-db bootstrap resolved, or a multi-db "none chosen yet"
	// ready state was reached), a LATER db switch keeps the select mounted and
	// just disables submit while it re-resolves — it never collapses back to the
	// bare loading spinner, which would unmount the select mid-interaction.
	let hasShownForm = false;

	async function loadPrerequisites(targetDb: string): Promise<void> {
		if (!hasShownForm) status = 'loading';
		orgId = '';
		const token = getToken();
		if (!token) {
			// Inconsistency on a protected route — fail loudly as a load error, never
			// silently as "not admin".
			console.error('admin/invite: no auth token in storage on a protected route');
			status = 'load-error';
			return;
		}
		const cfg = { db: targetDb, token };
		try {
			const [, resolvedOrgId] = await Promise.all([
				resolvePersonParentId(cfg),
				resolveOrgId(cfg)
			]);
			orgId = resolvedOrgId;
			status = 'ready';
			hasShownForm = true;
		} catch (e) {
			if (e instanceof InviteCreateError && e.reason === 'not-visible') {
				// Labeled HEURISTIC: the prerequisites are not visible to this account.
				// The authoritative admin gate stays Entu's parent-expander check on the
				// create POST. Only `not-visible` lands here — an HTTP/network failure is
				// NEVER presented as "not admin".
				status = 'no-access';
			} else {
				console.error('admin/invite: load failed', e);
				status = 'load-error';
			}
		}
	}

	// EFFECT A — derive dbId from the available collectives: no-collective gate,
	// sole-collective preselect. Pure state derivation, no fetches — kept
	// separate from effect B below so a preselect-write doesn't also re-fire the
	// fetch-triggering effect a second time in the same settle (each effect only
	// reruns on an ACTUAL dependency value change, so splitting the write from
	// the read-and-fetch keeps loadPrerequisites to exactly one call per db).
	$effect(() => {
		if (availableDbs.length === 0) {
			status = 'no-collective';
			dbId = '';
			orgId = '';
			hasShownForm = false;
			return;
		}
		if (dbId === '' && availableDbs.length === 1) {
			dbId = availableDbs[0].db; // sole database preselected, select still rendered
		}
	});

	// EFFECT B — react to the resolved dbId: load its prerequisites, or (multiple
	// databases, none chosen yet) show the picker with submit disabled.
	$effect(() => {
		if (availableDbs.length === 0) return; // effect A already set no-collective
		if (dbId) {
			void loadPrerequisites(dbId);
		} else {
			status = 'ready';
			hasShownForm = true;
		}
	});

	async function submit(): Promise<void> {
		if (!dbId || !canSubmit || status === 'creating') return;
		const token = getToken();
		if (!token) {
			console.error('admin/invite: no auth token in storage on a protected route');
			createError = {};
			status = 'create-error';
			return;
		}
		status = 'creating';
		createError = null;
		try {
			const result = await createInvite({ db: dbId, token }, { orgId });
			inviteLink = buildInviteUrl(window.location.origin, result.inviteToken);
			// The shown expiry is the minted token's OWN exp — never an assumed +7d.
			const parsed = parseInviteToken(result.inviteToken, Date.now());
			inviteExpiryDate = parsed.status === 'invalid' ? '' : new Date(parsed.expMs).toLocaleDateString();
			copied = false;
			copyFailed = false;
			status = 'done';
		} catch (e) {
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
		copied = false;
		copyFailed = false;
		try {
			// No silent no-op: an unavailable clipboard (non-secure context) fails
			// visibly; the readonly input stays manually copyable.
			if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable in this context');
			await navigator.clipboard.writeText(inviteLink);
			copied = true;
		} catch (e) {
			console.error('admin/invite: copy failed', e);
			copyFailed = true;
		}
	}

	function createAnother(): void {
		// Discards the link for good — the token was shown once and is not stored.
		inviteLink = '';
		inviteExpiryDate = '';
		copied = false;
		copyFailed = false;
		createError = null;
		status = 'ready';
	}
</script>

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<div class="mx-auto flex w-full max-w-md flex-col gap-4">
		<h1 class="font-display text-2xl">{m.admin_invite_title()}</h1>

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
				<label class="flex flex-col gap-1 text-sm">
					{m.admin_invite_link_label()}
					<input
						data-testid="invite-link"
						readonly
						value={inviteLink}
						class="rounded-md border border-ink px-3 py-2 font-mono text-xs"
					/>
				</label>
				<button
					type="button"
					data-testid="invite-copy"
					class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
					onclick={copyLink}
				>
					{copied ? m.admin_invite_copied() : m.admin_invite_copy()}
				</button>
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
			<!-- ready | creating | create-error: the form -->
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
			<div class="flex flex-col gap-3">
				<label class="flex flex-col gap-1 text-sm">
					{m.admin_invite_db_label()}
					<select
						data-testid="invite-db"
						value={dbId}
						onchange={(e) => (dbId = e.currentTarget.value)}
						class="rounded-md border border-ink px-3 py-2 text-sm"
					>
						<!-- Explicit empty-value option, ALWAYS present (not `{#if}`-gated) so
						     the option SET never changes shape mid-interaction: a native
						     <select> silently defaults its DOM selection to the FIRST real
						     option whenever '' has no matching option, fighting the '' state
						     (the multi-collective "none chosen yet" case). One-way `value=` +
						     explicit `onchange` (not `bind:value`) — `bind:value`'s own
						     controlled-select sync effect raced this page's async prerequisite
						     effect in testing, landing on the wrong option. -->
						<option value="" disabled hidden>—</option>
						{#each availableDbs as c (c.db)}
							<option value={c.db}>{c.name}</option>
						{/each}
					</select>
				</label>
				<button
					type="button"
					data-testid="invite-admin-submit"
					disabled={!canSubmit || status === 'creating'}
					class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper disabled:opacity-50"
					onclick={submit}
				>
					{status === 'creating' ? m.admin_invite_creating() : m.admin_invite_submit()}
				</button>
			</div>
		{/if}
	</div>
</main>


