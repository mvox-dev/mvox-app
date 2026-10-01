<!-- /admin: role management (admins, librarians), the collective name, and invites. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { getToken } from '$lib/auth/storage';
	import { cfgFor } from '$lib/entu/cfg';
	import {
		selectedCollectiveStore,
		selectedCollectiveIdentityStore,
		renameCollectiveInStore,
		type CollectiveIdentity
	} from '$lib/collectives/store';
	import {
		resolveCollectiveNameMarker,
		updateCollectiveName,
		type CollectiveNameMarker
	} from '$lib/collectives/collectiveName';
	import { resolveAdmin } from '$lib/nav/adminStore';
	import { resolveLibrarian } from '$lib/library/librarianStore';
	import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
	import { loadRoster, type RosterRow } from '$lib/roster/rosterData';
	import {
		listAdmins,
		addAdmin,
		removeAdmin,
		listLibrarians,
		addLibrarian,
		removeLibrarian,
		type RolePerson
	} from '$lib/admin/roleManagement';
	import { listSections, rosterOrder, type SectionNode } from '$lib/sections/sectionData';
	import InviteSurface from '$lib/components/admin/InviteSurface.svelte';
	// Role writes and the rename are refused while offline; nothing is queued.
	import { writesAvailable } from '$lib/net/online';
	import PersonName from '$lib/components/PersonName.svelte';
	import RedactedText from '$lib/components/RedactedText.svelte';
	import RosterPersonSelect from '$lib/roster/RosterPersonSelect.svelte';
	import { focusAfterRender, focusOnMount } from '$lib/a11y/focusable';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';

	type Status = 'no-collective' | 'loading' | 'no-access' | 'load-error' | 'ready';

	let status = $state<Status>('loading');
	// Only the invite label reads this; what the page acts on keys off the identity store.
	const selected = $derived($selectedCollectiveStore);
	const isOffline = $derived(!$writesAvailable);
	let cfg = $state<EntuCfg | null>(null);
	let dbEntityId = $state<string | null>(null);
	let libraryId = $state<string | null>(null);
	let viewerId = $state<string | null>(null);
	let admins = $state<RolePerson[]>([]);
	let librarians = $state<RolePerson[]>([]);
	// Write controls need _owner, not just the access gate: entu-api 403s every rights write
	// from a non-owner, so the lists stay readable and the controls disappear.
	let canManageAdmins = $state(false);
	let canManageLibrarians = $state(false);
	let roster = $state<RosterRow[]>([]);
	/** The member read was partial: a missing person would read as "not a member". */
	let rosterPartial = $state(false);
	// [] (no sections) falls back to the roster's own name order.
	let sections = $state<SectionNode[]>([]);
	/** The section read only orders the pickers, so it sits outside the blocking load: a
	 *  failure falls back to name order and leaves the rest of the page alone. */
	let sectionsError = $state(false);
	let actionError = $state(false);
	// Blocks a second grant or revoke while one is in flight: a second direct grant for a
	// reference silently retires the first (ER-6). Handlers check it; disabled is only a guard.
	let rolesPending = $state(false);
	// A name confirm refused offline, with the editor still open on the draft.
	let nameHeldOffline = $state(false);
	$effect(() => {
		if (!isOffline) nameHeldOffline = false;
	});
	// Live region: mounted blank, set on a settle, cleared when the next attempt starts.
	let rolesStatus = $state('');

	// The marker's own name, not the picker label (see collectiveName.ts).
	let nameMarker = $state<CollectiveNameMarker | null>(null);
	let editingName = $state(false);
	let nameDraft = $state('');
	let nameWritePending = $state(false);
	let nameError = $state(false);
	let namePencilRef = $state<HTMLButtonElement | undefined>(undefined);

	const adminOwnerCount = $derived(admins.filter((p) => p.role === 'owner').length);

	// #209 — ROSTER ORDER (Gama ruling 3), not the roster's own array order.
	const adminOptions = $derived(
		rosterOrder(roster, sections)
			.filter((r) => !admins.some((a) => a.id === r.personId))
			.map((r) => ({ id: r.personId, label: r.name }))
	);
	const librarianOptions = $derived(
		rosterOrder(roster, sections)
			.filter((r) => !librarians.some((l) => l.id === r.personId))
			.map((r) => ({ id: r.personId, label: r.name }))
	);

	/** Says which empty this is: no members, or everyone already granted. */
	function pickerPromptText(optionCount: number, addPrompt: string): string {
		if (optionCount > 0) return addPrompt;
		return roster.length === 0 ? m.picker_no_members() : m.picker_everyone_added();
	}

	function isLastOwner(person: RolePerson): boolean {
		return person.role === 'owner' && adminOwnerCount === 1;
	}

	// removeLibrarian rejects a library owner's grant, so its button would be a dead click.
	function isLibraryOwner(person: RolePerson): boolean {
		return person.role === 'owner';
	}

	// Self-lockout guard: isLastOwner only catches the last owner.
	function isSelf(person: RolePerson): boolean {
		return person.id === viewerId;
	}

	function roleLabel(role: RolePerson['role']): string {
		return role === 'owner' ? m.admin_roles_role_owner() : m.admin_roles_role_editor();
	}

	// A collective switch updates the store in place, so a slow load can land after a newer
	// one. Every state write after an await is fenced behind thisLoad.
	let loadSeq = 0;

	async function refreshAdmins(thisLoad: number): Promise<void> {
		if (thisLoad !== loadSeq) return; // the collective moved on before this read
		if (!cfg || !dbEntityId || !viewerId) return;
		// The roster maps ids to names for rows whose aggregated name has not caught up yet.
		const listing = await listAdmins(cfg, dbEntityId, viewerId, undefined, roster);
		if (thisLoad !== loadSeq) return; // superseded by a newer selection
		admins = listing.persons;
		canManageAdmins = listing.canManage;
	}

	async function refreshLibrarians(thisLoad: number): Promise<void> {
		if (thisLoad !== loadSeq) return; // the collective moved on before this read
		if (!cfg || !libraryId || !viewerId) return;
		const listing = await listLibrarians(cfg, libraryId, viewerId, undefined, roster);
		if (thisLoad !== loadSeq) return; // superseded by a newer selection
		librarians = listing.persons;
		canManageLibrarians = listing.canManage;
	}

	async function load(target: CollectiveIdentity): Promise<void> {
		const thisLoad = ++loadSeq;
		status = 'loading';
		actionError = false;
		// A collective switch drops the trace of an in-flight write.
		rolesPending = false;
		rolesStatus = '';
		if (!getToken()) {
			console.error('admin roles: no auth token in storage on a protected route');
			status = 'load-error';
			return;
		}
		const c: EntuCfg = cfgFor(target.db);
		cfg = c;
		viewerId = target.personId;
		canManageAdmins = false;
		canManageLibrarians = false;
		nameMarker = null;
		editingName = false;
		nameDraft = '';
		nameError = false;
		nameWritePending = false;

		// Resolve the database entity once and pass it to both resolvers.
		let resolvedDbEntityId: string | null;
		try {
			resolvedDbEntityId = await resolveDatabaseEntityId(c);
		} catch (e) {
			if (thisLoad !== loadSeq) return; // superseded by a newer selection
			console.error('admin roles: database entity resolution failed', e);
			status = 'load-error';
			return;
		}
		if (thisLoad !== loadSeq) return; // superseded by a newer selection
		if (!resolvedDbEntityId) {
			status = 'load-error';
			return;
		}

		const adminState = await resolveAdmin(c, target.personId, undefined, resolvedDbEntityId);
		if (thisLoad !== loadSeq) return; // superseded by a newer selection
		if (adminState === 'not-admin') {
			status = 'no-access';
			return;
		}
		if (adminState === 'error') {
			status = 'load-error';
			return;
		}

		// Read alongside the blocking reads, never as one: a failure costs only the picker order.
		sections = [];
		sectionsError = false;
		// The partial notice goes down while the list is re-read.
		rosterPartial = false;
		listSections(c)
			.then((tree) => {
				if (thisLoad !== loadSeq) return; // superseded by a newer selection
				sections = tree;
			})
			.catch((e) => {
				if (thisLoad !== loadSeq) return;
				console.error(
					'admin roles: section tree read failed — the person selects fall back to name order',
					e
				);
				sectionsError = true;
			});

		try {
			const [libResult, rosterRead, resolvedNameMarker] = await Promise.all([
				resolveLibrarian(c, target.personId, undefined, resolvedDbEntityId),
				loadRoster(c),
				// A failed marker read is a load-error, never "no name".
				resolveCollectiveNameMarker(c)
			]);
			if (thisLoad !== loadSeq) return; // superseded by a newer selection
			// resolveLibrarian turns a failed read into libraryId null, the same as "no library".
			// Branch on state first, so a failed read fails loudly.
			if (libResult.state === 'error') {
				console.error('admin roles: librarian resolution failed');
				status = 'load-error';
				return;
			}
			dbEntityId = resolvedDbEntityId;
			libraryId = libResult.libraryId;
			roster = rosterRead.items;
			rosterPartial = rosterRead.truncated;
			nameMarker = resolvedNameMarker;
			await Promise.all([
				refreshAdmins(thisLoad),
				libraryId ? refreshLibrarians(thisLoad) : Promise.resolve()
			]);
			if (thisLoad !== loadSeq) return; // superseded by a newer selection
			status = 'ready';
		} catch (e) {
			if (thisLoad !== loadSeq) return; // a superseded load's failure is not this view's
			console.error('admin roles: load failed', e);
			status = 'load-error';
		}
	}

	function retryLoad(): void {
		if (loadedIdentity) void load(loadedIdentity);
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
		const thisLoad = loadSeq;
		const writeCfg = cfgFor(cfg.db);
		nameWritePending = true;
		try {
			await updateCollectiveName(writeCfg, before.markerId, draft);
			if (thisLoad !== loadSeq) return; // superseded by a newer selection
			nameMarker = { ...before, name: draft };
			renameCollectiveInStore(writeCfg.db, draft);
			nameError = false;
		} catch (e) {
			if (thisLoad !== loadSeq) return;
			console.error('admin collective name: write failed', e);
			nameError = true;
		} finally {
			if (thisLoad === loadSeq) {
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

	// Also what retryLoad re-runs against, so a retry never targets a different collective.
	let loadedIdentity = $state<CollectiveIdentity | null>(null);

	// Keyed on the identity store, not selectedCollectiveStore: a rename republishes the
	// collective, and re-running load() would clobber the name just set.
	$effect(() => {
		const id = $selectedCollectiveIdentityStore;
		loadedIdentity = id;
		if (!id) {
			status = 'no-collective';
			return;
		}
		void load(id);
	});

	// Handlers snapshot the sequence; a collective switch mid-write drops their results.
	async function onPickAdmin(selection: { id: string | null; label: string }): Promise<void> {
		// Before the attempt-start clears, so a refused pick keeps the last real error.
		if (isOffline) return;
		// Checked first: disabled on the select is a double-tap guard, not a state signal.
		if (rolesPending) return;
		if (!selection.id || !cfg || !dbEntityId) return;
		const thisLoad = loadSeq;
		actionError = false;
		rolesStatus = '';
		rolesPending = true;
		try {
			await addAdmin(cfgFor(cfg.db), dbEntityId, selection.id);
			await refreshAdmins(thisLoad);
			if (thisLoad !== loadSeq) return;
			rolesStatus = m.admin_roles_saved();
		} catch (e) {
			if (thisLoad !== loadSeq) return;
			console.error('admin roles: add admin failed', e);
			actionError = true;
		} finally {
			if (thisLoad === loadSeq) rolesPending = false;
		}
	}

	async function onPickLibrarian(selection: { id: string | null; label: string }): Promise<void> {
		if (isOffline) return;
		if (rolesPending) return;
		if (!selection.id || !cfg || !libraryId) return;
		const thisLoad = loadSeq;
		actionError = false;
		rolesStatus = '';
		rolesPending = true;
		try {
			await addLibrarian(cfgFor(cfg.db), libraryId, selection.id);
			await refreshLibrarians(thisLoad);
			if (thisLoad !== loadSeq) return;
			rolesStatus = m.admin_roles_saved();
		} catch (e) {
			if (thisLoad !== loadSeq) return;
			console.error('admin roles: add librarian failed', e);
			actionError = true;
		} finally {
			if (thisLoad === loadSeq) rolesPending = false;
		}
	}

	async function onRemoveAdmin(personId: string): Promise<void> {
		if (isOffline) return;
		if (rolesPending) return;
		if (!cfg || !dbEntityId) return;
		const thisLoad = loadSeq;
		actionError = false;
		rolesStatus = '';
		rolesPending = true;
		try {
			await removeAdmin(cfgFor(cfg.db), dbEntityId, personId);
			await refreshAdmins(thisLoad);
			if (thisLoad !== loadSeq) return;
			rolesStatus = m.admin_roles_saved();
		} catch (e) {
			if (thisLoad !== loadSeq) return;
			console.error('admin roles: remove admin failed', e);
			actionError = true;
		} finally {
			if (thisLoad === loadSeq) rolesPending = false;
		}
	}

	async function onRemoveLibrarian(personId: string): Promise<void> {
		if (isOffline) return;
		if (rolesPending) return;
		if (!cfg || !libraryId) return;
		const thisLoad = loadSeq;
		actionError = false;
		rolesStatus = '';
		rolesPending = true;
		try {
			await removeLibrarian(cfgFor(cfg.db), libraryId, personId);
			await refreshLibrarians(thisLoad);
			if (thisLoad !== loadSeq) return;
			rolesStatus = m.admin_roles_saved();
		} catch (e) {
			if (thisLoad !== loadSeq) return;
			console.error('admin roles: remove librarian failed', e);
			actionError = true;
		} finally {
			if (thisLoad === loadSeq) rolesPending = false;
		}
	}
</script>

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<div class="mx-auto flex w-full max-w-2xl flex-col gap-6">
		<h1 class="font-display text-2xl">{m.admin_roles_title()}</h1>

		{#if status === 'no-collective'}
			<p data-testid="admin-roles-no-collective" class="text-sm">
				{m.admin_roles_no_collective()}
			</p>
		{:else if status === 'loading'}
			<p class="text-sm" aria-busy="true">…</p>
		{:else if status === 'no-access'}
			<p data-testid="admin-roles-no-access" class="text-sm" role="alert">
				{m.admin_roles_no_access()}
			</p>
		{:else if status === 'load-error'}
			<div data-testid="admin-roles-load-error" class="flex flex-col gap-2" role="alert">
				<p class="text-sm text-red-700">{m.admin_roles_load_error()}</p>
				<button
					type="button"
					data-testid="admin-roles-retry-load"
					class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
					onclick={retryLoad}
				>
					{m.admin_roles_retry_load()}
				</button>
			</div>
		{:else}
			<!-- ready. A missing marker hides the name surface; a failed read is a load-error. -->
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
							<button
								type="button"
								data-testid="admin-collective-name-edit"
								disabled={nameWritePending || isOffline}
								bind:this={namePencilRef}
								class="group flex min-h-11 w-full appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left font-display text-2xl disabled:opacity-40"
								onclick={beginNameEdit}
							>
								<span class="sr-only">{m.admin_collective_name_edit_aria_label()}</span>
								<!-- Preflight sets no pointer cursor on buttons; the hover colour is the cue. -->
								<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
								{#if nameMarker.name}
									<span id="admin-collective-name-value">{nameMarker.name}</span>
								{:else}
									<span id="admin-collective-name-value" class="text-ink-3 italic">
										{m.admin_collective_name_unnamed()}
									</span>
								{/if}
							</button>
						</div>
					{/if}
					{#if nameError}
						<p data-testid="admin-collective-name-error" role="alert" class="text-sm text-red-700">
							{m.admin_collective_name_save_error()}
						</p>
					{/if}
				</div>
			{/if}

			{#if isOffline}
				<p data-testid="admin-write-unavailable" class="text-sm text-ink-2">
					{m.write_unavailable_no_signal()}
				</p>
			{/if}
			<!-- A confirm refused offline keeps the draft, and says so. -->
			{#if nameHeldOffline}
				<p data-testid="admin-name-held-offline" role="alert" class="text-sm text-ink-2">
					{m.write_held_no_signal()}
				</p>
			{/if}

			{#if actionError}
				<p data-testid="admin-roles-action-error" role="alert" class="text-sm text-red-700">
					{m.admin_roles_action_error()}
				</p>
			{/if}
			<!-- A write in flight is visible, not only a disabled control. -->
			{#if rolesPending}
				<p data-testid="admin-roles-pending-notice" role="status" class="text-sm text-ink-2">
					{m.admin_roles_saving()}
				</p>
			{/if}
			<!-- Mounted blank: a live region announces only changes. -->
			<div data-testid="admin-roles-status" role="status" aria-live="polite" class="sr-only">
				{rolesStatus}
			</div>

			<section data-testid="admin-roles-admins" class="flex flex-col gap-3">
				<h2 class="font-display text-lg">{m.admin_roles_admins_title()}</h2>
				<ul class="flex flex-col gap-1">
					{#each admins as person (person.id)}
						<li
							data-testid="admin-entry-{person.id}"
							class="flex items-center justify-between gap-2 border-b border-ink-5 py-1 text-sm"
						>
							<span
								><PersonName name={person.name} />
								<span class="text-xs text-ink-2">({roleLabel(person.role)})</span></span
							>
							<!-- The viewer's own row gets no Remove button; the reason sits in its place. -->
							{#if !isSelf(person)}
								<button
									type="button"
									data-testid="admin-remove-{person.id}"
									disabled={!canManageAdmins || isLastOwner(person) || rolesPending || isOffline}
									class="min-h-11 rounded-md border border-ink px-2 py-1 text-xs hover:bg-ink hover:text-paper disabled:opacity-50"
									onclick={() => onRemoveAdmin(person.id)}
								>
									<RedactedText>{m.admin_roles_remove({ name: person.name })}</RedactedText>
								</button>
							{:else}
								<span data-testid="admin-roles-admins-self-hint" class="text-xs text-ink-2">
									{m.admin_roles_remove_self_hint()}
								</span>
							{/if}
						</li>
					{/each}
				</ul>
				{#if canManageAdmins}
					{#if adminOwnerCount === 1}
						<p class="text-xs text-ink-2">{m.admin_roles_last_owner_hint()}</p>
					{/if}
					<RosterPersonSelect
						testid="admin-add-admin"
						options={adminOptions}
						prompt={pickerPromptText(adminOptions.length, m.admin_roles_add_admin_placeholder())}
						ariaLabel={m.admin_roles_add_admin_label()}
						disabled={rolesPending || isOffline}
						partial={rosterPartial}
						orderFallback={sectionsError}
						onselect={(selection) => void onPickAdmin(selection)}
					/>
				{:else}
					<p data-testid="admin-roles-admins-read-only" class="text-xs text-ink-2">
						{m.admin_roles_read_only()}
					</p>
				{/if}
			</section>

			<section data-testid="admin-roles-librarians" class="flex flex-col gap-3">
				<h2 class="font-display text-lg">{m.admin_roles_librarians_title()}</h2>
				{#if libraryId === null}
					<p data-testid="admin-roles-no-library" class="text-sm">{m.admin_roles_no_library()}</p>
				{:else}
					<ul class="flex flex-col gap-1">
						{#each librarians as person (person.id)}
							<li
								data-testid="librarian-entry-{person.id}"
								class="flex items-center justify-between gap-2 border-b border-ink-5 py-1 text-sm"
							>
								<span
									><PersonName name={person.name} />
									<span class="text-xs text-ink-2">({roleLabel(person.role)})</span></span
								>
								<!-- A library owner's grant is not revocable here, so no control is offered. -->
								{#if !isLibraryOwner(person)}
									<button
										type="button"
										data-testid="librarian-remove-{person.id}"
										disabled={!canManageLibrarians || isSelf(person) || rolesPending || isOffline}
										title={isSelf(person) ? m.admin_roles_remove_self_hint() : undefined}
										class="min-h-11 rounded-md border border-ink px-2 py-1 text-xs hover:bg-ink hover:text-paper disabled:opacity-50"
										onclick={() => onRemoveLibrarian(person.id)}
									>
										<RedactedText>{m.admin_roles_remove({ name: person.name })}</RedactedText>
									</button>
								{/if}
							</li>
						{/each}
					</ul>
					{#if canManageLibrarians}
						{#if librarians.some((p) => isSelf(p) && !isLibraryOwner(p))}
							<p data-testid="admin-roles-librarians-self-hint" class="text-xs text-ink-2">
								{m.admin_roles_remove_self_hint()}
							</p>
						{/if}
						<RosterPersonSelect
							testid="admin-add-librarian"
							options={librarianOptions}
							prompt={pickerPromptText(
								librarianOptions.length,
								m.admin_roles_add_librarian_placeholder()
							)}
							ariaLabel={m.admin_roles_add_librarian_label()}
							disabled={rolesPending || isOffline}
							partial={rosterPartial}
							orderFallback={sectionsError}
							onselect={(selection) => void onPickLibrarian(selection)}
						/>
					{:else}
						<p data-testid="admin-roles-librarians-read-only" class="text-xs text-ink-2">
							{m.admin_roles_read_only()}
						</p>
					{/if}
				{/if}
			</section>

			<section data-testid="admin-invite-section" class="flex flex-col gap-3">
				<!-- Controlled: db and org come from this page, so an invite cannot target another
				     collective. -->
				<InviteSurface
					presetDb={cfg?.db ?? ''}
					presetDbEntityId={dbEntityId ?? ''}
					presetDbName={selected?.name ?? ''}
					viewerPersonId={viewerId ?? ''}
					roster={roster}
					rosterPartial={rosterPartial}
					heading="h2"
					layout="embedded"
				/>
			</section>
		{/if}
	</div>
</main>

<!-- (*MVOX:Tallis* — #134/S3 RED route stub) -->
<!-- (*MVOX:Palestrina* — #134/S3 GREEN implementation) -->
