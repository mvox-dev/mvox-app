<!-- The admin page's two role lists (administrators, librarians) and their grant controls. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { cfgFor } from '$lib/entu/cfg';
	import { rosterOrder, type SectionNode } from '$lib/sections/sectionData';
	import type { RosterRow } from '$lib/roster/rosterData';
	import type * as RoleManagement from '$lib/admin/roleManagement';
	import type { RoleKind, RolePerson } from '$lib/admin/roleManagement';
	import PersonName from '$lib/components/PersonName.svelte';
	import RedactedText from '$lib/components/RedactedText.svelte';
	import RosterPersonSelect from '$lib/roster/RosterPersonSelect.svelte';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';

	type RoleWrites = Pick<
		typeof RoleManagement,
		'addAdmin' | 'removeAdmin' | 'addLibrarian' | 'removeLibrarian'
	>;

	interface Props {
		cfg: EntuCfg | null;
		dbEntityId: string | null;
		libraryId: string | null;
		viewerId: string | null;
		admins: RolePerson[];
		librarians: RolePerson[];
		canManageAdmins: boolean;
		canManageLibrarians: boolean;
		roster: RosterRow[];
		rosterPartial: boolean;
		sections: SectionNode[];
		sectionsError: boolean;
		isOffline: boolean;
		loadSeq: () => number;
		refreshRole: (kind: RoleKind, thisLoad: number) => Promise<void>;
		writes: RoleWrites;
	}

	let {
		cfg,
		dbEntityId,
		libraryId,
		viewerId,
		admins,
		librarians,
		canManageAdmins,
		canManageLibrarians,
		roster,
		rosterPartial,
		sections,
		sectionsError,
		isOffline,
		loadSeq,
		refreshRole,
		writes
	}: Props = $props();

	let actionError = $state(false);
	// Blocks a second grant or revoke while one is in flight: a second direct grant for a
	// reference silently retires the first (ER-6). Handlers check it; disabled is only a guard.
	let rolesPending = $state(false);
	// Live region: mounted blank, set on a settle, cleared when the next attempt starts.
	let rolesStatus = $state('');

	// A collective switch drops the trace of an in-flight write.
	export function reset(): void {
		actionError = false;
		rolesPending = false;
		rolesStatus = '';
	}

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

	// Handlers snapshot the sequence; a collective switch mid-write drops their results.
	async function runRoleWrite(
		kind: RoleKind,
		personId: string | null,
		write: (cfg: EntuCfg, entityId: string, personId: string) => Promise<void>,
		label: string
	): Promise<void> {
		// Before the attempt-start clears, so a refused pick keeps the last real error.
		if (isOffline) return;
		// Checked first: disabled on the select is a double-tap guard, not a state signal.
		if (rolesPending) return;
		const entityId = kind === 'admin' ? dbEntityId : libraryId;
		if (!personId || !cfg || !entityId) return;
		const thisLoad = loadSeq();
		actionError = false;
		rolesStatus = '';
		rolesPending = true;
		try {
			await write(cfgFor(cfg.db), entityId, personId);
			await refreshRole(kind, thisLoad);
			if (thisLoad !== loadSeq()) return;
			rolesStatus = m.admin_roles_saved();
		} catch (e) {
			if (thisLoad !== loadSeq()) return;
			console.error(label, e);
			actionError = true;
		} finally {
			if (thisLoad === loadSeq()) rolesPending = false;
		}
	}

	function onPickAdmin(selection: { id: string | null; label: string }): Promise<void> {
		return runRoleWrite('admin', selection.id, writes.addAdmin, 'admin roles: add admin failed');
	}

	function onPickLibrarian(selection: { id: string | null; label: string }): Promise<void> {
		return runRoleWrite(
			'librarian',
			selection.id,
			writes.addLibrarian,
			'admin roles: add librarian failed'
		);
	}

	function onRemoveAdmin(personId: string): Promise<void> {
		return runRoleWrite('admin', personId, writes.removeAdmin, 'admin roles: remove admin failed');
	}

	function onRemoveLibrarian(personId: string): Promise<void> {
		return runRoleWrite(
			'librarian',
			personId,
			writes.removeLibrarian,
			'admin roles: remove librarian failed'
		);
	}
</script>

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
				prompt={pickerPromptText(librarianOptions.length, m.admin_roles_add_librarian_placeholder())}
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
