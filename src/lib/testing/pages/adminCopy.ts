// English copy for the admin page specs; a spec passes only the keys it words differently.
import { copyWith, englishMessages, type Copy } from '../messageMocks';

export const ADMIN_COPY = {
	admin_roles_title: () => 'Role management',
	admin_roles_no_collective: () => 'Select a collective to manage roles.',
	admin_roles_no_access: () => 'Managing roles requires administrator rights.',
	admin_roles_load_error: () => 'Could not load role management.',
	admin_roles_retry_load: () => 'Retry',
	admin_roles_admins_title: () => 'Administrators',
	admin_roles_librarians_title: () => 'Librarians',
	admin_roles_add_admin_label: () => 'Add an administrator',
	admin_roles_add_admin_placeholder: () => 'Add administrator…',
	admin_roles_add_librarian_label: () => 'Add a librarian',
	admin_roles_add_librarian_placeholder: () => 'Add librarian…',
	picker_everyone_added: () => 'Everyone is already added',
	picker_no_members: () => 'No members to add',
	picker_order_fallback: () => 'Sorted by name — section order unavailable',
	picker_partial_members_notice: () => 'Not every member is listed here',
	admin_roles_remove: (p: { name: string }) => `Remove ${p.name}`,
	admin_roles_last_owner_hint: () => 'The last owner cannot be removed.',
	admin_roles_no_library: () => 'No library entity is visible in this collective.',
	admin_roles_action_error: () => 'Role change failed.',
	admin_roles_saving: () => 'Saving…',
	admin_roles_saved: () => 'Saved.',
	admin_roles_read_only: () => 'Only an owner of this collective can change these roles.',
	admin_roles_remove_self_hint: () => 'Cannot remove your own rights.',
	admin_roles_role_owner: () => 'omanik',
	admin_roles_role_editor: () => 'toimetaja',
	admin_collective_name_edit_aria_label: () => 'Edit collective name',
	admin_collective_name_save_error: () => "Couldn't save.",
	nav_admin: () => 'Admin',
	admin_invite_title: () => 'Invite a new member',
	admin_invite_no_collective: () => 'Select a collective before creating invites.',
	admin_invite_no_access: () => 'Creating invites requires administrator rights.',
	admin_invite_load_error: () => 'Could not load invite prerequisites.',
	admin_invite_retry_load: () => 'Retry',
	admin_invite_db_label: () => 'Collective',
	admin_invite_submit: () => 'Create invite',
	admin_invite_creating: () => 'Creating…',
	admin_invite_link_label: () => 'Invite link',
	admin_invite_copy: () => 'Copy link',
	admin_invite_copied: () => 'Copied',
	admin_invite_bearer_warning: () => 'Bearer secret — send only to the invited person.',
	admin_invite_show_once: (p: { date: string }) => `Shown only once. Expires on ${p.date}.`,
	admin_invite_error: () => 'Invite creation failed.',
	admin_invite_copy_error: () => "Couldn't copy the link.",
	admin_invite_partial_failure: (p: { personId: string }) =>
		`A person entity (${p.personId}) was already created and carries a live invite token.`,
	admin_invite_create_another: () => 'Create another invite',
	admin_invite_person_label: () => 'Who are you inviting?',
	admin_invite_person_new: () => 'A new person',
	admin_invite_submit_person: (p: { name: string }) => `Invite ${p.name}`,
	admin_invite_person_list_error: () => 'Could not load the list of uninvited people.',
	admin_invite_mint_error: (p: { name: string }) => `Could not invite ${p.name}.`,
	admin_invite_mint_owner_only: () => 'Inviting an existing person requires owner rights.',
	roster_member_invite_owner_only: () => 'Managing invites requires owner rights.'
} satisfies Copy;

export function adminMessages(overrides: Partial<typeof ADMIN_COPY> = {}) {
	return englishMessages(copyWith(ADMIN_COPY, overrides));
}

// (*MVOX:Josquin*)
