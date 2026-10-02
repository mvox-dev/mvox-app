<!-- /admin: role management (admins, librarians), the collective name, and invites. -->
<script lang="ts">
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getToken } from '$lib/auth/storage';
	import { cfgFor } from '$lib/entu/cfg';
	import {
		selectedCollectiveStore,
		selectedCollectiveIdentityStore,
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
	import { listSections, type SectionNode } from '$lib/sections/sectionData';
	import InviteSurface from '$lib/components/admin/InviteSurface.svelte';
	// Role writes and the rename are refused while offline; nothing is queued.
	import { writesAvailable } from '$lib/net/online';
	import AdminRoles from '$lib/admin/AdminRoles.svelte';
	import CollectiveNameEditor from '$lib/admin/CollectiveNameEditor.svelte';
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
	// A name confirm refused offline, with the editor still open on the draft.
	let nameHeldOffline = $state(false);
	$effect(() => {
		if (!isOffline) nameHeldOffline = false;
	});

	// The marker's own name, not the picker label (see collectiveName.ts).
	let nameMarker = $state<CollectiveNameMarker | null>(null);
	let nameEditor = $state<CollectiveNameEditor>();
	let roles = $state<AdminRoles>();

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
		// Untracked: load runs inside the identity effect, and the refs change on every mount.
		untrack(() => roles?.reset());
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
		untrack(() => nameEditor?.reset());

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
			<CollectiveNameEditor
				bind:this={nameEditor}
				bind:nameMarker
				bind:nameHeldOffline
				{cfg}
				{isOffline}
				loadSeq={() => loadSeq}
				updateCollectiveName={(...a) => updateCollectiveName(...a)}
			/>

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

			<AdminRoles
				bind:this={roles}
				{cfg}
				{dbEntityId}
				{libraryId}
				{viewerId}
				{admins}
				{librarians}
				{canManageAdmins}
				{canManageLibrarians}
				{roster}
				{rosterPartial}
				{sections}
				{sectionsError}
				{isOffline}
				loadSeq={() => loadSeq}
				{refreshAdmins}
				{refreshLibrarians}
				writes={{
					addAdmin: (...a) => addAdmin(...a),
					removeAdmin: (...a) => removeAdmin(...a),
					addLibrarian: (...a) => addLibrarian(...a),
					removeLibrarian: (...a) => removeLibrarian(...a)
				}}
			/>

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
