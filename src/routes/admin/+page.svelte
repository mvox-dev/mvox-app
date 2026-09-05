<script lang="ts">
	// #134/S3 GREEN — the /admin role-management surface (admin + librarian
	// assignment). Contract: src/routes/page.admin.spec.ts (route integration)
	// + src/lib/admin/roleManagement.spec.ts (data layer).
	//
	// Access gate mirrors admin/invite/+page.svelte's shape (loading →
	// no-collective / no-access / load-error → ready), but the "which
	// collective" resolution reuses the ROOT LAYOUT's pattern instead —
	// `selectedCollectiveStore` (URL → persisted pick → first collective), not
	// the invite page's own db-picker (this surface acts on the person's
	// CURRENTLY selected collective, same as every other rights-gated page).
	//
	// #173 — the database entity is resolved ONCE, here, and threaded into both
	// `resolveAdmin` and `resolveLibrarian` via their pre-resolved-dbEntityId
	// param (adminStore.preresolved.spec.ts / librarianStore.preresolved.spec.ts).
	// Previously this page's own `resolveDatabaseEntityId` call plus the ones
	// buried inside `resolveAdmin` and `resolveLibrarian` -> `resolveMyLibraryId`
	// made THREE identical round-trips per load for one db-scoped, load-constant
	// id; now there is exactly one.
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getToken } from '$lib/auth/storage';
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
	// #209 (PO standing rule 1) — the add-admin/add-librarian pickers are NATIVE
	// <select> elements, fed in ROSTER ORDER (Gama ruling 3) by the SAME
	// `rosterOrder` helper the roster page's own grouping runs through
	// (`listSections` + `groupBySection`), not a re-derived ordering.
	import { listSections, rosterOrder, type SectionNode } from '$lib/sections/sectionData';
	// #140/S3 — the invite functionality merges into this page as a distinct
	// section, sharing the SAME live component the standalone /admin/invite
	// route still renders (backward compat) — see
	// src/lib/components/admin/InviteSurface.svelte.
	import InviteSurface from '$lib/components/admin/InviteSurface.svelte';

	type Status = 'no-collective' | 'loading' | 'no-access' | 'load-error' | 'ready';
	type Cfg = { db: string; token: string };

	let status = $state<Status>('loading');
	// The full selected collective — read ONLY for its display label (the invite
	// section's `presetDbName`), so it deliberately DOES track a rename. Anything
	// that decides "which collective is this page acting on" keys off
	// `selectedCollectiveIdentityStore` instead (see the load effect below).
	const selected = $derived($selectedCollectiveStore);
	let cfg = $state<Cfg | null>(null);
	let dbEntityId = $state<string | null>(null);
	let libraryId = $state<string | null>(null);
	let viewerId = $state<string | null>(null);
	let admins = $state<RolePerson[]>([]);
	let librarians = $state<RolePerson[]>([]);
	// Write gate, per entity. `resolveAdmin` (the ACCESS gate above) answers
	// 'admin' for an org `_editor` too, but entu-api refuses EVERY rights write
	// from a caller who is not in the entity's aggregated `private._owner` — POST
	// entity/{id} and DELETE property/{id} both 403. Showing an editing surface
	// that is guaranteed to 403 is exactly the silent-failure shape the house
	// rule forbids, so the lists stay readable and the write controls disappear.
	let canManageAdmins = $state(false);
	let canManageLibrarians = $state(false);
	let roster = $state<RosterRow[]>([]);
	// #209 — the section tree behind ROSTER ORDER; [] (no sections) degrades
	// `rosterOrder` to the roster's own (name) order.
	let sections = $state<SectionNode[]>([]);
	/** #209 review F2 — the section read is a picker ORDERING input, not a role
	 *  input: `listSections` throws on any non-2xx AND on data conditions of its
	 *  own (an unplaceable parent, a parent cycle), none of which say anything
	 *  about who may administer this collective. It is read OUTSIDE the load's
	 *  blocking `Promise.all` for exactly that reason — a failure annotates the
	 *  two selects (name order instead of roster order) and leaves the rest of
	 *  this page, including the read-only tier that renders no select at all,
	 *  untouched. Same posture the agenda's pickers take (+page.svelte's
	 *  `sectionsReadFailed`). */
	let sectionsError = $state(false);
	let actionError = $state(false);

	// #165 — the editable collective NAME (the `mvox_collective` marker's own
	// `name`, not the store's picker label — see collectiveName.ts module doc).
	// Same inline-edit shape as event/[id]/+page.svelte's field editing
	// (beginFieldEdit/confirmFieldEdit, editingField, pencilRefs, focus
	// management), collapsed to ONE field: no per-field key is needed.
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

	/** #209 review F1 — with nobody left to offer, say WHICH empty this is. The
	 *  roster here is read INSIDE the load's blocking `Promise.all`, so by the
	 *  time a select renders it has resolved (a failed read is the page's own
	 *  load-error, never a picker state): the only two empties left are "this
	 *  collective has no members" and "everyone is already granted". */
	function pickerPromptText(optionCount: number, addPrompt: string): string {
		if (optionCount > 0) return addPrompt;
		return roster.length === 0 ? m.picker_no_members() : m.picker_everyone_added();
	}

	function isLastOwner(person: RolePerson): boolean {
		return person.role === 'owner' && adminOwnerCount === 1;
	}

	// A library OWNER's grant is not this surface's to revoke: `removeLibrarian`
	// runs 'editor-only' scope and rejects with RoleGrantMissingError before any
	// write, so an enabled button here would be a guaranteed dead click.
	function isLibraryOwner(person: RolePerson): boolean {
		return person.role === 'owner';
	}

	// #147 — self-lockout guard. `isLastOwner` only catches the LAST org
	// _owner; an admin holding _editor (or an _owner when other owners remain)
	// could otherwise remove HERSELF and lose access to this page with no way
	// back in. Applies to both lists — a librarian can self-lock out of the
	// library section the same way.
	function isSelf(person: RolePerson): boolean {
		return person.id === viewerId;
	}

	// `RolePerson.role` is a wire-level enum ('owner' | 'editor'), never a label.
	// The badge is user-visible text, so it goes through `m.*` like every other
	// string on the page (house convention — cf. rsvp_status_*).
	function roleLabel(role: RolePerson['role']): string {
		return role === 'owner' ? m.admin_roles_role_owner() : m.admin_roles_role_editor();
	}

	// Request-sequence guard. Switching collectives is an IN-PLACE store update
	// (`selectCollective` sets the store then `goto`s the same pathname) and the
	// root layout renders `{@render children?.()}` with no `{#key}` — so this
	// component is never remounted and a slow load(A) can resolve after load(B)
	// started, pairing B's `cfg.db` with A's org/library/rows/canManage. Every
	// state write that follows an `await` is fenced behind `thisLoad`, the same
	// pattern src/routes/+page.svelte uses for its own collective switch.
	let loadSeq = 0;

	async function refreshAdmins(thisLoad: number): Promise<void> {
		if (thisLoad !== loadSeq) return; // the collective moved on before this read
		if (!cfg || !dbEntityId || !viewerId) return;
		// #146 — roster rides along as the id→name lookup for rows whose display
		// name hasn't caught up in Entu's aggregated read yet (see
		// resolveNamesFromRoster in roleManagement.ts). `undefined` for fetchImpl
		// keeps its own default (real `fetch`) rather than reaching for the
		// browser global here.
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

	// `target` is the collective IDENTITY (db + personId) — the page's data all
	// hangs off those two, never off the display label.
	async function load(target: CollectiveIdentity): Promise<void> {
		const thisLoad = ++loadSeq;
		status = 'loading';
		actionError = false;
		const token = getToken();
		if (!token) {
			// Inconsistency on a protected route — fail loudly, never as "not admin".
			console.error('admin roles: no auth token in storage on a protected route');
			status = 'load-error';
			return;
		}
		const c: Cfg = { db: target.db, token };
		cfg = c;
		viewerId = target.personId;
		canManageAdmins = false;
		canManageLibrarians = false;
		nameMarker = null;
		editingName = false;
		nameDraft = '';
		nameError = false;
		nameWritePending = false;

		// #173 — resolve the database entity ONCE, here. It is db-scoped and
		// constant for the whole load, so it is safe to thread the SAME id into
		// both `resolveAdmin` and `resolveLibrarian` below instead of letting
		// each resolve it again internally.
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
			// No visible database entity: mirrors `resolveAdmin`'s own "cannot
			// evaluate any rights" answer for the same condition.
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

		// #209 review F2 — the section tree behind ROSTER ORDER (Gama ruling 3),
		// read ALONGSIDE the blocking resolutions below but never as one of them:
		// a section-tree failure costs the two selects their roster order (they
		// fall back to the roster's own name order, with `picker_order_fallback`
		// saying so), not the whole role surface.
		sections = [];
		sectionsError = false;
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
			const [libResult, rosterRows, resolvedNameMarker] = await Promise.all([
				resolveLibrarian(c, target.personId, undefined, resolvedDbEntityId),
				loadRoster(c),
				// #165 — a FAILED marker read must land here, in the SAME catch as every
				// sibling resolution (load-error + retry), never rendered as "no name".
				resolveCollectiveNameMarker(c)
			]);
			if (thisLoad !== loadSeq) return; // superseded by a newer selection
			// `resolveLibrarian` SWALLOWS its failures (non-2xx / throw) into
			// { state: 'error', libraryId: null } — the same libraryId shape it
			// returns for the legitimate "this collective has no library" case.
			// Reading libraryId alone would render a failed fetch as the factual
			// claim "no library entity is visible in this collective". Branch on
			// `state` first, so a broken read fails loudly (load-error + retry,
			// same as its sibling resolutions, which throw and land in the catch).
			if (libResult.state === 'error') {
				console.error('admin roles: librarian resolution failed');
				status = 'load-error';
				return;
			}
			dbEntityId = resolvedDbEntityId;
			libraryId = libResult.libraryId;
			roster = rosterRows;
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

	// #165 — inline edit of the collective name. `beginNameEdit`/`cancelNameEdit`/
	// `confirmNameEdit` mirror event/[id]/+page.svelte's beginFieldEdit/
	// cancelFieldEdit/confirmFieldEdit shape, collapsed to the ONE field this
	// surface owns (no per-field key needed).
	function beginNameEdit(): void {
		if (!nameMarker || nameWritePending) return;
		nameError = false;
		nameDraft = nameMarker.name;
		editingName = true;
	}

	/** Escape AND blur both dismiss without writing — #165 AC deliberately
	 *  diverges from the event page's blur-confirms for THIS surface.
	 *  `restoreFocus` — same #105-shaped rule as the event page: a KEYBOARD
	 *  dismissal (Escape) owes the pencil its focus back; a blur means the
	 *  viewer already moved focus somewhere else deliberately. */
	function cancelNameEdit(restoreFocus: boolean): void {
		editingName = false;
		nameDraft = '';
		if (restoreFocus) tick().then(() => namePencilRef?.focus());
	}

	/** Enter confirms: an immediate write, no optimistic-then-reconcile queue
	 *  needed (one field, one caller) — the editor closes at once and the
	 *  pencil is disabled for the write's duration (`nameWritePending`), same
	 *  posture as every other write surface on this page. A failed write
	 *  reverts the displayed name and surfaces `nameError`; a successful one
	 *  also renames the SELECTED COLLECTIVE STORE entry so the picker + agenda
	 *  header pick it up without a reload (#165 AC).
	 *
	 *  The draft is TRIMMED once, up front, and the trimmed value is what the
	 *  guards compare AND what goes on the wire (#165 review F4): the read side
	 *  (`resolveCollectiveNameMarker`) trims, so writing the raw draft would
	 *  round-trip padding — a "  Koor  " edit would fire a full GET/POST/DELETE
	 *  cycle, show the padded label until the next reload, and then silently
	 *  undo itself. Trimming first also makes a whitespace-only edit read as
	 *  what it is: no change.
	 *
	 *  `restoreFocus` — the #105 rule, governing BOTH branches (review F2).
	 *  Enter is a KEYBOARD dismissal, so it owes the pencil its focus back
	 *  exactly like Escape does; the no-change branch hands that straight to
	 *  `cancelNameEdit`, and the write branch cannot act on it immediately
	 *  (the pencil is `disabled` for the write's duration and `focus()` is a
	 *  no-op on a disabled element) so it lands in the `finally`, after
	 *  `nameWritePending` has flipped back. A blur passes `false`: the viewer
	 *  already moved focus somewhere deliberate. */
	async function confirmNameEdit(restoreFocus: boolean): Promise<void> {
		if (!editingName || !cfg || !nameMarker) return;
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
		const writeCfg = cfg;
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
				// `!editingName` — a re-opened editor since this write started owns
				// focus now; a late restore would rip it out of the input.
				if (restoreFocus && !editingName) {
					await tick();
					namePencilRef?.focus();
				}
			}
		}
	}

	function handleNameKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			// Keyboard dismissal — the pencil owes this focus back.
			cancelNameEdit(true);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			// Keyboard dismissal too — same rule, whichever branch confirm takes.
			void confirmNameEdit(true);
		}
	}

	/** Svelte action: focus the element the instant it mounts — same helper
	 *  event/[id]/+page.svelte uses for its own edit inputs. */
	function focusOnMount(node: HTMLElement): void {
		node.focus();
	}

	// Which identity this page's data belongs to — also what `retryLoad` re-runs
	// against, so a retry can never silently target a different collective than
	// the failed load did.
	let loadedIdentity = $state<CollectiveIdentity | null>(null);

	// EFFECT — react to the resolved selected collective: no-collective gate, or
	// (re-)load. Same "no selected collective ⇒ no-collective" collapse the
	// admin/invite page uses for its own picker (loading and none read the
	// same to the user here — there is nothing actionable to distinguish).
	//
	// Keyed on `selectedCollectiveIdentityStore`, NOT `selectedCollectiveStore`
	// (#165 review F1): this page's own `renameCollectiveInStore` republishes a
	// fresh `Collective` object (same db, new label) and the raw store re-emits
	// it, which would re-run `load()` on the page's OWN successful write and
	// clobber the just-set optimistic name with whatever
	// `resolveCollectiveNameMarker` answers next. The identity store emits only
	// on a genuine db/person change, so no per-page guard is needed here.
	$effect(() => {
		const id = $selectedCollectiveIdentityStore;
		loadedIdentity = id;
		if (!id) {
			status = 'no-collective';
			return;
		}
		void load(id);
	});

	// The write handlers SNAPSHOT the current sequence (they do not bump it —
	// this is a same-collective refresh, not a switch). A collective switch that
	// lands mid-write invalidates the snapshot, so neither the refetched rows nor
	// the error banner can leak into the collective the viewer moved to.
	async function onPickAdmin(selection: { id: string | null; label: string }): Promise<void> {
		if (!selection.id || !cfg || !dbEntityId) return;
		const thisLoad = loadSeq;
		actionError = false;
		try {
			await addAdmin(cfg, dbEntityId, selection.id);
			await refreshAdmins(thisLoad);
		} catch (e) {
			if (thisLoad !== loadSeq) return;
			console.error('admin roles: add admin failed', e);
			actionError = true;
		}
	}

	async function onPickLibrarian(selection: { id: string | null; label: string }): Promise<void> {
		if (!selection.id || !cfg || !libraryId) return;
		const thisLoad = loadSeq;
		actionError = false;
		try {
			await addLibrarian(cfg, libraryId, selection.id);
			await refreshLibrarians(thisLoad);
		} catch (e) {
			if (thisLoad !== loadSeq) return;
			console.error('admin roles: add librarian failed', e);
			actionError = true;
		}
	}

	async function onRemoveAdmin(personId: string): Promise<void> {
		if (!cfg || !dbEntityId) return;
		const thisLoad = loadSeq;
		actionError = false;
		try {
			await removeAdmin(cfg, dbEntityId, personId);
			await refreshAdmins(thisLoad);
		} catch (e) {
			if (thisLoad !== loadSeq) return;
			console.error('admin roles: remove admin failed', e);
			actionError = true;
		}
	}

	async function onRemoveLibrarian(personId: string): Promise<void> {
		if (!cfg || !libraryId) return;
		const thisLoad = loadSeq;
		actionError = false;
		try {
			await removeLibrarian(cfg, libraryId, personId);
			await refreshLibrarians(thisLoad);
		} catch (e) {
			if (thisLoad !== loadSeq) return;
			console.error('admin roles: remove librarian failed', e);
			actionError = true;
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
			<!-- ready -->
			<!-- #165 — the editable collective name, at the top of the ready view.
			     `nameMarker === null` (marker resolved but not found in this db) hides
			     the whole surface — nothing to edit. A FAILED resolution never reaches
			     here: it lands in 'load-error' above, alongside every other sibling
			     resolution (house rule). -->
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
						<!-- #157's whole-field shape (the one event/[id]/+page.svelte settled
						     on), not a bare pencil glyph: the WHOLE field is the button, so the
						     tap target is `min-h-11 w-full` instead of a ~12px ✎ (#165 review
						     F3 — `min-h-11` alone with `p-0` collapses the width to the glyph,
						     under the 44x44 house minimum). `aria-labelledby` keeps the
						     control's own accessible name pinned to the value span while the
						     button carries its action label in an `sr-only` child.
						     #165 review F6/F7 — this is page-level context (which collective
						     you're administering), not a content section like "Administrators"
						     below, so it is a plain <div>, not an <h2>: an empty-name marker
						     would otherwise render a blank heading to screen readers. F7 — an
						     empty marker name falls back to a translated "Unnamed collective"
						     placeholder so the control is never blank, styled to read as a
						     placeholder rather than real content. -->
						<div
							data-testid="admin-collective-name"
							aria-labelledby="admin-collective-name-value"
							class="font-display text-2xl"
						>
							<button
								type="button"
								data-testid="admin-collective-name-edit"
								disabled={nameWritePending}
								bind:this={namePencilRef}
								class="group flex min-h-11 w-full appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left font-display text-2xl disabled:opacity-40"
								onclick={beginNameEdit}
							>
								<span class="sr-only">{m.admin_collective_name_edit_aria_label()}</span>
								<!-- `group-hover:text-ink` — Tailwind's preflight sets no
								     `cursor: pointer` on <button>, so growing the target to the
								     whole field would otherwise leave a mouse user with no
								     pointer cue at all (same note as the event page). -->
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

			{#if actionError}
				<p data-testid="admin-roles-action-error" role="alert" class="text-sm text-red-700">
					{m.admin_roles_action_error()}
				</p>
			{/if}

			<section data-testid="admin-roles-admins" class="flex flex-col gap-3">
				<h2 class="font-display text-lg">{m.admin_roles_admins_title()}</h2>
				<ul class="flex flex-col gap-1">
					{#each admins as person (person.id)}
						<li
							data-testid="admin-entry-{person.id}"
							class="flex items-center justify-between gap-2 border-b border-ink-5 py-1 text-sm"
						>
							<span
								>{person.name}
								<span class="text-xs text-ink-2">({roleLabel(person.role)})</span></span
							>
							<!-- #164 — the viewer's OWN row renders NO Remove button at all
							     (not merely disabled): a disabled control was still read as
							     clickable on live /admin. Same shape #148 chose for the
							     library-owner row.
							     #175 — the explanatory reason moves INLINE, into the button's
							     own position in this same row, instead of a separate paragraph
							     below the whole list (which read as detached from the row it
							     explained). -->
							{#if !isSelf(person)}
								<button
									type="button"
									data-testid="admin-remove-{person.id}"
									disabled={!canManageAdmins || isLastOwner(person)}
									class="min-h-11 rounded-md border border-ink px-2 py-1 text-xs hover:bg-ink hover:text-paper disabled:opacity-50"
									onclick={() => onRemoveAdmin(person.id)}
								>
									{m.admin_roles_remove({ name: person.name })}
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
					<!-- #209 (PO standing rule 1) — native <select>, no custom widget.
					     Prompt option (value '') is `disabled selected hidden` (Gama
					     ruling 1) so it can never be committed. Everyone-added stays
					     MOUNTED-but-disabled with the shared exhausted-state prompt
					     (Gama ruling 2), never hidden. -->
					<select
						data-testid="admin-add-admin-select"
						aria-label={m.admin_roles_add_admin_label()}
						disabled={adminOptions.length === 0}
						value=""
						onchange={(e) => {
							const target = e.currentTarget as HTMLSelectElement;
							const personId = target.value;
							target.value = '';
							if (!personId) return;
							const label = adminOptions.find((o) => o.id === personId)?.label ?? '';
							void onPickAdmin({ id: personId, label });
						}}
						class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
					>
						<option value="" disabled selected hidden>
							{pickerPromptText(adminOptions.length, m.admin_roles_add_admin_placeholder())}
						</option>
						{#each adminOptions as option (option.id)}
							<option value={option.id}>{option.label}</option>
						{/each}
					</select>
					<!-- #209 review F2 — the section read failed: the select still works
					     off the roster's own name order, and says so. -->
					{#if sectionsError}
						<p data-testid="admin-add-admin-order-note" class="text-xs text-ink-2">
							{m.picker_order_fallback()}
						</p>
					{/if}
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
									>{person.name}
									<span class="text-xs text-ink-2">({roleLabel(person.role)})</span></span
								>
								<!-- #148 — a library OWNER's grant is not this surface's to
								     revoke (removeLibrarian is 'editor-only' scope and would
								     reject before any write). The role badge above already says
								     "omanik" — a disabled button plus an explanatory note was
								     confusing; the fix is to not offer a control that can never
								     do anything, full stop. -->
								{#if !isLibraryOwner(person)}
									<button
										type="button"
										data-testid="librarian-remove-{person.id}"
										disabled={!canManageLibrarians || isSelf(person)}
										title={isSelf(person) ? m.admin_roles_remove_self_hint() : undefined}
										class="min-h-11 rounded-md border border-ink px-2 py-1 text-xs hover:bg-ink hover:text-paper disabled:opacity-50"
										onclick={() => onRemoveLibrarian(person.id)}
									>
										{m.admin_roles_remove({ name: person.name })}
									</button>
								{/if}
							</li>
						{/each}
					</ul>
					{#if canManageLibrarians}
						<!-- Same visible-reason rule as the admin list. A library OWNER row
						     renders no button at all (#148), so it needs no explanation —
						     only a self row that IS rendered-but-disabled does. -->
						{#if librarians.some((p) => isSelf(p) && !isLibraryOwner(p))}
							<p data-testid="admin-roles-librarians-self-hint" class="text-xs text-ink-2">
								{m.admin_roles_remove_self_hint()}
							</p>
						{/if}
						<!-- #209 — same native-select pattern as the admin picker above. -->
						<select
							data-testid="admin-add-librarian-select"
							aria-label={m.admin_roles_add_librarian_label()}
							disabled={librarianOptions.length === 0}
							value=""
							onchange={(e) => {
								const target = e.currentTarget as HTMLSelectElement;
								const personId = target.value;
								target.value = '';
								if (!personId) return;
								const label = librarianOptions.find((o) => o.id === personId)?.label ?? '';
								void onPickLibrarian({ id: personId, label });
							}}
							class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
						>
							<option value="" disabled selected hidden>
								{pickerPromptText(
									librarianOptions.length,
									m.admin_roles_add_librarian_placeholder()
								)}
							</option>
							{#each librarianOptions as option (option.id)}
								<option value={option.id}>{option.label}</option>
							{/each}
						</select>
						<!-- #209 review F2 — the section read failed: the select still works
						     off the roster's own name order, and says so. -->
						{#if sectionsError}
							<p data-testid="admin-add-librarian-order-note" class="text-xs text-ink-2">
								{m.picker_order_fallback()}
							</p>
						{/if}
					{:else}
						<p data-testid="admin-roles-librarians-read-only" class="text-xs text-ink-2">
							{m.admin_roles_read_only()}
						</p>
					{/if}
				{/if}
			</section>

			<!-- #140/S3 — merged invite surface (was the standalone /admin/invite
			     nav tab). Same live component the backward-compat /admin/invite
			     route still renders — no duplicated state machine. -->
			<section data-testid="admin-invite-section" class="flex flex-col gap-3">
				<!-- Controlled: this page has ALREADY resolved (db, org) for the
				     SELECTED collective and hands BOTH — so the embedded surface renders
				     no db picker of its own and an invite can never be minted against a
				     different collective than the role sections above act on (review F1).
				     `heading="h2"` keeps it under this page's h1 (review F2). -->
				<InviteSurface
					presetDb={cfg?.db ?? ''}
					presetDbEntityId={dbEntityId ?? ''}
					presetDbName={selected?.name ?? ''}
					heading="h2"
					layout="embedded"
				/>
			</section>
		{/if}
	</div>
</main>

<!-- (*MVOX:Tallis* — #134/S3 RED route stub) -->
<!-- (*MVOX:Palestrina* — #134/S3 GREEN implementation) -->
