// English copy for the profile page specs; a spec passes only the keys it words differently.
import { copyWith, englishMessages, type Copy } from '../messageMocks';

export const PROFILE_COPY = {
	profile_title: () => 'Your profile',
	profile_intro: () => 'Fill in your name and email.',
	profile_completion_required: () => 'Please add your name to continue.',
	profile_no_collective: () => 'Select a collective.',
	profile_load_error: () => 'Could not load your profile.',
	profile_load_retry: () => 'Retry',
	profile_field_name_label: () => 'Name',
	profile_field_email_label: () => 'Email',
	profile_name_edit_label: () => 'Edit name',
	profile_email_edit_label: () => 'Edit email',
	profile_level_public_label: () => 'Public',
	profile_level_public_hint: () => 'Anyone.',
	profile_level_domain_label: () => 'Collective',
	profile_level_domain_hint: () => 'Members.',
	profile_level_private_label: () => 'Private',
	profile_level_private_hint: () => 'Only you.',
	profile_save: () => 'Save',
	profile_saving: () => 'Saving…',
	profile_saved: () => 'Saved',
	profile_save_error: () => "Couldn't save — please try again.",
	profile_name_private_disabled: () => 'Name cannot be private',
	profile_visibility_title: () => 'Who can see each field',
	profile_visibility_intro: () => 'Pick an icon to move a field.',
	profile_visibility_active: (p: { level: string }) => `Visible at ${p.level}`,
	profile_visibility_move: (p: { field: string; level: string }) =>
		`Move ${p.field} to ${p.level}`,
	profile_visibility_moving: () => 'Moving…',
	profile_visibility_leak: (p: { level: string }) => `Still readable at ${p.level}`,
	profile_visibility_conflict: (p: { field: string }) =>
		`Your ${p.field} has different values at more than one level.`,
	profile_visibility_confirm_preview: (p: { level: string }) => `Tap again to keep ${p.level}`,
	profile_visibility_preview_note: () => 'Tap again to keep this version.',
	profile_move_error: () => "Couldn't change visibility. Nothing was lost — please try again.",
	profile_repair_title: () => 'Unfinished visibility change',
	profile_repair_body_tightening: (p: { field: string; level: string }) =>
		`Your ${p.field} is still readable at ${p.level}.`,
	profile_repair_body_widening: (p: { field: string; level: string }) =>
		`An old copy of your ${p.field} is still at ${p.level}.`,
	profile_repair_body_loaded: (p: { field: string; level: string }) =>
		`An unfinished change left your ${p.field} readable at ${p.level}.`,
	profile_repair_action: () => 'Finish now',
	profile_repair_working: () => 'Finishing…',
	profile_repair_error: (p: { field: string; level: string }) =>
		`Couldn't finish. Your ${p.field} is still readable at ${p.level}.`,
	profile_repair_done: () => 'Visibility change completed.',
	profile_sign_out: () => 'Sign out',
	profile_signed_in_as: (p: { account: string; provider: string }) =>
		`Signed in as ${p.account} via ${p.provider}`,
	profile_language_label: () => 'Language',
	profile_time_format_label: () => 'Time format',
	profile_time_format_24h: () => '24-hour',
	profile_time_format_ampm: () => 'AM/PM',
	profile_time_format_hint: () => 'Applies on this device.',
	profile_linked_accounts_title: (p: { collective: string }) =>
		`Sign-ins that work for ${p.collective}`,
	profile_link_another: () => 'Link another account',
	profile_link_choose_provider: () => 'Choose a provider to link',
	profile_link_error_conflict: () =>
		'That account is already in use by another member here.',
	profile_link_error_dead: () => 'The link attempt expired or was already used.',
	profile_link_error_failed: () => 'Linking failed — you can try again.',
	profile_link_error_missing_rights: () =>
		'Your account is missing the rights needed to link another sign-in.',
	profile_link_error_already_linked: () => 'That sign-in is already linked to your account.',
	profile_link_error_step: (p: { step: string }) =>
		`Linking could not be completed — it stopped at step: ${p.step}. You can try again.`,
	profile_link_success: (p: { collective: string }) =>
		`That sign-in now works for ${p.collective}.`,
	profile_link_noop_same_identity: () => 'That sign-in was already linked. Nothing changed.',
	profile_link_cancel: () => 'Cancel',
	profile_add_passkey: () => 'Add a passkey',
	auth_provider_smart_id: () => 'Smart-ID',
	auth_provider_mobile_id: () => 'Mobile-ID',
	auth_provider_id_card: () => 'ID-card',
	auth_provider_e_mail: () => 'E-mail',
	auth_provider_google: () => 'Google',
	auth_provider_apple: () => 'Apple',
	auth_provider_passkey: () => 'Passkey'
} satisfies Copy;

export function profileMessages(overrides: Partial<typeof PROFILE_COPY> = {}) {
	return englishMessages(copyWith(PROFILE_COPY, overrides));
}

// (*MVOX:Josquin*)
