<!-- /admin: role management (admins, librarians), the collective name, and invites. -->
<script lang="ts">
	import { reportProblem } from '$lib/problems/reportProblem';
	import { isAuthExpiredError } from '$lib/entu/auth-expired';
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { selectedCollectiveStore, selectedCollectiveIdentityStore } from '$lib/collectives/store';
	import { createRouteLoadMachine, type GatedRouteLoadStatus } from '$lib/loading/routeLoad';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import {
		resolveCollectiveNameMarker,
		updateCollectiveName,
		type CollectiveNameMarker
	} from '$lib/collectives/collectiveName';
	import { resolveAdmin } from '$lib/nav/adminStore';
	import { resolveLibrarian } from '$lib/library/librarianStore';
	import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
	import { loadRoster, type RosterRow } from '$lib/roster/rosterData';
	import { resolveNamesFromRoster } from '$lib/admin/rosterNames';
	import {
		listAdmins,
		addAdmin,
		removeAdmin,
		listLibrarians,
		addLibrarian,
		removeLibrarian,
		type RoleKind,
		type RolePerson
	} from '$lib/admin/roleManagement';
	import { listSections, type SectionNode } from '$lib/sections/sectionData';
	import InviteSurface from '$lib/components/admin/InviteSurface.svelte';
	// Role writes and the rename are refused while offline; nothing is queued.
	import { writesAvailable } from '$lib/net/online';
	import AdminRoles from '$lib/admin/AdminRoles.svelte';
	import CollectiveNameEditor from '$lib/admin/CollectiveNameEditor.svelte';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';

	let status = $state<GatedRouteLoadStatus>('loading');
	// Keyed on the identity store: a rename republishes the collective, and a reload would
	// clobber the name just set. The label alone reads selectedCollectiveStore.
	const identity = $derived($selectedCollectiveIdentityStore);
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
	// The roster read does not hold up the page: the pickers say it is loading or failed.
	let rosterLoading = $state(false);
	let rosterFailed = $state(false);
	// The role lists may be read before the roster lands.
	const namedAdmins = $derived(resolveNamesFromRoster(admins, roster));
	const namedLibrarians = $derived(resolveNamesFromRoster(librarians, roster));
	// [] (no sections) falls back to the roster's own name order.
	let sections = $state<SectionNode[]>([]);
	// The section read only orders the pickers: a failure falls back to name order.
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
	// Handed from the gate to the body; no await sits between them.
	let gatedDbEntityId: string | null = null;

	async function refreshRole(kind: RoleKind, thisLoad: number): Promise<void> {
		if (!routeLoad.isCurrent(thisLoad)) return;
		const entityId = kind === 'admin' ? dbEntityId : libraryId;
		if (!cfg || !entityId || !viewerId) return;
		// The roster maps ids to names for rows whose aggregated name has not caught up yet.
		const list = kind === 'admin' ? listAdmins : listLibrarians;
		const listing = await list(cfg, entityId, viewerId, undefined, roster);
		if (!routeLoad.isCurrent(thisLoad)) return;
		if (kind === 'admin') {
			admins = listing.persons;
			canManageAdmins = listing.canManage;
		} else {
			librarians = listing.persons;
			canManageLibrarians = listing.canManage;
		}
	}

	function loadSections(c: EntuCfg, isCurrent: () => boolean): void {
		sections = [];
		sectionsError = false;
		listSections(c)
			.then((tree) => {
				if (isCurrent()) sections = tree;
			})
			.catch((e) => {
				if (!isCurrent()) return;
				reportProblem({ area: 'admin', action: 'loading the section tree', error: e });
				sectionsError = true;
			});
	}

	function loadMembers(c: EntuCfg, isCurrent: () => boolean): void {
		roster = [];
		rosterPartial = false;
		rosterFailed = false;
		rosterLoading = true;
		loadRoster(c)
			.then((read) => {
				if (!isCurrent()) return;
				roster = read.items;
				rosterPartial = read.truncated;
			})
			.catch((e) => {
				if (!isCurrent()) return;
				if (isAuthExpiredError(e)) {
					status = 'session-expired';
					return;
				}
				reportProblem({ area: 'admin', action: 'loading members', error: e });
				rosterFailed = true;
			})
			.finally(() => {
				if (isCurrent()) rosterLoading = false;
			});
	}

	const routeLoad = createRouteLoadMachine({
		name: 'admin roles',
		selected: () => identity,
		setStatus: (s) => {
			status = s;
		},
		reset: () => {
			roles?.reset();
			nameEditor?.reset();
			canManageAdmins = false;
			canManageLibrarians = false;
			nameMarker = null;
		},
		async gate({ cfg: c, selected: target, isCurrent }) {
			cfg = c;
			viewerId = target.personId;
			// Resolved once here and passed to both resolvers.
			const resolved = await resolveDatabaseEntityId(c);
			if (!isCurrent()) return false;
			gatedDbEntityId = resolved;
			if (!gatedDbEntityId) throw new Error('admin roles: no database entity visible');
			const adminState = await resolveAdmin(c, target.personId, undefined, gatedDbEntityId);
			if (adminState === 'error') throw new Error('admin roles: admin resolution failed');
			return adminState !== 'not-admin';
		},
		async load({ cfg: c, selected: target, g, isCurrent }) {
			const resolvedDbEntityId = gatedDbEntityId!;
			// Read alongside the blocking reads, never as one: a failure costs only the order.
			loadSections(c, isCurrent);
			loadMembers(c, isCurrent);
			const [libResult, resolvedNameMarker] = await Promise.all([
				resolveLibrarian(c, target.personId, undefined, resolvedDbEntityId),
				// A failed marker read is a load-error, never "no name".
				resolveCollectiveNameMarker(c)
			]);
			if (!isCurrent()) return;
			// resolveLibrarian turns a failed read into libraryId null, the same as "no library".
			if (libResult.state === 'error') throw new Error('admin roles: librarian resolution failed');
			dbEntityId = resolvedDbEntityId;
			libraryId = libResult.libraryId;
			nameMarker = resolvedNameMarker;
			await Promise.all([
				refreshRole('admin', g),
				libraryId ? refreshRole('librarian', g) : Promise.resolve()
			]);
			if (isCurrent()) status = 'ready';
		}
	});

	$effect(() => {
		void identity;
		// Untracked: the refs reset in the hook change on every mount.
		untrack(() => void routeLoad.loadForSelected());
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
		{:else if status === 'session-expired'}
			<SessionExpiredNotice />
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
					onclick={() => routeLoad.loadForSelected()}
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
				loadSeq={() => routeLoad.generation}
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
				admins={namedAdmins}
				librarians={namedLibrarians}
				{canManageAdmins}
				{canManageLibrarians}
				{roster}
				{rosterPartial}
				{rosterLoading}
				{rosterFailed}
				{sections}
				{sectionsError}
				{isOffline}
				loadSeq={() => routeLoad.generation}
				{refreshRole}
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
