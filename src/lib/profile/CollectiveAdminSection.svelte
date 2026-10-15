<!-- The collective's admin section at the end of /profile (#916): name, rights, invites. -->
<script lang="ts">
	import { untrack } from 'svelte';
	import { reportProblem } from '$lib/problems/reportProblem';
	import { isAuthExpiredError } from '$lib/entu/auth-expired';
	import { m } from '$lib/paraglide/messages.js';
	import { selectedCollectiveStore } from '$lib/collectives/store';
	import type { RouteLoadStatus } from '$lib/loading/routeLoad';
	import {
		resolveCollectiveNameMarker,
		updateCollectiveName,
		type CollectiveNameMarker
	} from '$lib/collectives/collectiveName';
	import { dbEditRight } from '$lib/nav/dbRights';
	import { resolveLibraryEditRight } from '$lib/library/libraryRights';
	import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
	import { updateRosterShowRealNames } from '$lib/collective/rosterNames';
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
	import InviteSurface from '$lib/invite/InviteSurface.svelte';
	import { writesAvailable } from '$lib/net/online';
	import AdminRoles from '$lib/admin/AdminRoles.svelte';
	import CollectiveNameEditor from '$lib/admin/CollectiveNameEditor.svelte';
	import RosterNamesToggle from '$lib/profile/RosterNamesToggle.svelte';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';

	interface Props {
		generation: () => number;
		activeContext: () => { cfg: EntuCfg; personId: string } | null;
		onSessionExpired: () => void;
	}

	let { generation, activeContext, onSessionExpired }: Props = $props();

	type Request = { cfg: EntuCfg; personId: string; g: number };

	const editRight = $derived($dbEditRight);
	const selected = $derived($selectedCollectiveStore);
	const isOffline = $derived(!$writesAvailable);
	let status = $state<Exclude<RouteLoadStatus, 'no-collective'>>('loading');
	let request = $state<Request | null>(null);
	let started: Request | null = null;
	let seq = 0;
	let cfg = $state<EntuCfg | null>(null);
	let dbEntityId = $state<string | null>(null);
	let libraryId = $state<string | null>(null);
	let viewerId = $state<string | null>(null);
	let admins = $state<RolePerson[]>([]);
	let librarians = $state<RolePerson[]>([]);
	// Write controls need _owner, not just the edit right: entu-api 403s every rights write
	// from a non-owner, so the lists stay readable and the controls disappear.
	let canManageAdmins = $state(false);
	let canManageLibrarians = $state(false);
	let roster = $state<RosterRow[]>([]);
	let rosterPartial = $state(false);
	let rosterLoading = $state(false);
	let rosterFailed = $state(false);
	const namedAdmins = $derived(resolveNamesFromRoster(admins, roster));
	const namedLibrarians = $derived(resolveNamesFromRoster(librarians, roster));
	let sections = $state<SectionNode[]>([]);
	let sectionsError = $state(false);
	let nameHeldOffline = $state(false);
	$effect(() => {
		if (!isOffline) nameHeldOffline = false;
	});

	let nameMarker = $state<CollectiveNameMarker | null>(null);
	let nameEditor = $state<CollectiveNameEditor>();
	let roles = $state<AdminRoles>();
	let rosterNames = $state<RosterNamesToggle>();
	let sectionEl = $state<HTMLElement>();
	let scrolled = false;

	export function reset(): void {
		request = null;
		started = null;
		seq++;
		status = 'loading';
		roles?.reset();
		nameEditor?.reset();
		rosterNames?.reset();
		admins = [];
		librarians = [];
		canManageAdmins = false;
		canManageLibrarians = false;
		nameMarker = null;
	}

	// The reads wait for the edit right: a member, or a right still loading, fetches nothing.
	export function load(c: EntuCfg, personId: string, g: number): void {
		request = { cfg: c, personId, g };
	}

	$effect(() => {
		const r = request;
		if (editRight !== 'editor' || !r || r === started) return;
		started = r;
		untrack(() => void run(r));
	});

	$effect(() => {
		if (status !== 'ready' || scrolled || !sectionEl) return;
		scrolled = true;
		if (window.location.hash === '#collective') sectionEl.scrollIntoView({ block: 'start' });
	});

	// The page shows the one notice; the section only steps aside.
	function expireSession(): void {
		status = 'session-expired';
		onSessionExpired();
	}

	function currentFor(r: Request, mine: number): () => boolean {
		return () => mine === seq && r.g === generation();
	}

	async function refreshRole(kind: RoleKind, thisLoad: number): Promise<void> {
		if (thisLoad !== seq) return;
		const entityId = kind === 'admin' ? dbEntityId : libraryId;
		if (!cfg || !entityId || !viewerId) return;
		// The roster maps ids to names for rows whose aggregated name has not caught up yet.
		const list = kind === 'admin' ? listAdmins : listLibrarians;
		const listing = await list(cfg, entityId, viewerId, undefined, roster);
		if (thisLoad !== seq) return;
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
					expireSession();
					return;
				}
				reportProblem({ area: 'admin', action: 'loading members', error: e });
				rosterFailed = true;
			})
			.finally(() => {
				if (isCurrent()) rosterLoading = false;
			});
	}

	async function run(r: Request): Promise<void> {
		const mine = ++seq;
		const isCurrent = currentFor(r, mine);
		status = 'loading';
		cfg = r.cfg;
		viewerId = r.personId;
		try {
			const resolvedDbEntityId = await resolveDatabaseEntityId(r.cfg);
			if (!isCurrent()) return;
			if (!resolvedDbEntityId) throw new Error('admin roles: no database entity visible');
			void rosterNames?.load(r.cfg, r.g, resolvedDbEntityId);
			// Read alongside the blocking reads, never as one: a failure costs only the order.
			loadSections(r.cfg, isCurrent);
			loadMembers(r.cfg, isCurrent);
			const [libResult, resolvedNameMarker] = await Promise.all([
				resolveLibraryEditRight(r.cfg, r.personId, undefined, resolvedDbEntityId),
				// A failed marker read is a load-error, never "no name".
				resolveCollectiveNameMarker(r.cfg)
			]);
			if (!isCurrent()) return;
			// resolveLibraryEditRight turns a failed read into libraryId null, the same as "no library".
			if (libResult.state === 'error') throw new Error('admin roles: librarian resolution failed');
			dbEntityId = resolvedDbEntityId;
			libraryId = libResult.libraryId;
			nameMarker = resolvedNameMarker;
			await Promise.all([
				refreshRole('admin', mine),
				libraryId ? refreshRole('librarian', mine) : Promise.resolve()
			]);
			if (isCurrent() && status === 'loading') status = 'ready';
		} catch (e) {
			if (!isCurrent()) return;
			if (isAuthExpiredError(e)) {
				expireSession();
				return;
			}
			reportProblem({ area: 'admin roles', action: 'load', error: e });
			status = 'load-error';
		}
	}
</script>

{#if editRight === 'editor' && request}
	<section
		bind:this={sectionEl}
		id="collective"
		data-testid="profile-collective-admin"
		aria-labelledby="profile-collective-admin-title"
		class="flex flex-col gap-6 border-t border-paper-3 pt-6"
	>
		<h2 id="profile-collective-admin-title" class="font-display text-xl">{m.profile_collective_heading()}</h2>

		<RosterNamesToggle
			bind:this={rosterNames}
			{isOffline}
			{generation}
			{activeContext}
			updateRosterShowRealNames={(...a) => updateRosterShowRealNames(...a)}
		/>

		{#if status === 'loading'}
			<p class="text-sm" aria-busy="true">…</p>
		{:else if status === 'session-expired'}
			<!-- The page's notice covers it. -->
		{:else if status === 'load-error'}
			<div data-testid="admin-roles-load-error" class="flex flex-col gap-2" role="alert">
				<p class="text-sm text-red-700">{m.admin_roles_load_error()}</p>
				<button
					type="button"
					data-testid="admin-roles-retry-load"
					class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
					onclick={() => request && void run(request)}
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
				loadSeq={() => seq}
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
				loadSeq={() => seq}
				{refreshRole}
				writes={{
					addAdmin: (...a) => addAdmin(...a),
					removeAdmin: (...a) => removeAdmin(...a),
					addLibrarian: (...a) => addLibrarian(...a),
					removeLibrarian: (...a) => removeLibrarian(...a)
				}}
			/>

			<section data-testid="admin-invite-section" class="flex flex-col gap-3">
				<!-- Controlled: db and org come from this section, so an invite cannot target another
				     collective. -->
				<InviteSurface
					presetDb={cfg?.db ?? ''}
					presetDbEntityId={dbEntityId ?? ''}
					presetDbName={selected?.name ?? ''}
					viewerPersonId={viewerId ?? ''}
					{roster}
					{rosterPartial}
					heading="h3"
					layout="embedded"
				/>
			</section>
		{/if}
	</section>
{/if}

<!-- (*MVOX:Josquin*) -->
