// English copy for the library page specs; a spec passes only the keys it words differently.
import { copyWith, englishMessages, type Copy } from '../messageMocks';

export const LIBRARY_COPY = {
	write_unavailable_no_signal: () => 'No signal — nothing can be saved right now.',
	library_title: () => 'Library',
	library_no_collective: () => 'Select a collective to view the library.',
	library_load_error: () => 'Something went wrong loading the library.',
	library_retry: () => 'Retry',
	library_empty: () => 'Nothing in the library yet.',
	library_work_composer_unknown: () => 'Unknown composer',
	library_editions_empty: () => 'No editions yet.',
	library_edition_publisher_unknown: () => 'Unknown publisher',
	library_copies_empty: () => 'No copies yet.',
	library_copy_available: () => 'Available',
	library_copy_lent_to: (p: { name: string }) => `Out — ${p.name}`,
	library_borrower_unknown: () => 'an unnamed member',
	library_copy_name_unknown: () => 'Untitled copy',
	library_lent_since: (p: { date: string }) => `since ${p.date}`,
	library_node_load_error: () => 'Could not load.',
	library_node_retry: () => 'Retry',
	library_librarian_tools: () => 'Librarian tools',
	library_librarian_load_error: () => 'Could not check librarian access.',
	library_librarian_retry: () => 'Retry',
	library_my_loans_title: (p: { count: number }) => `My loans (${p.count})`,
	library_my_loans_copy_label: (p: { copyName: string }) => `${p.copyName}`,
	library_my_loans_overdue: () => 'Overdue',
	library_checkout_submit: () => 'Checkout',
	library_return: () => 'Return',
	library_bulk_checkout_title: () => 'Bulk checkout',
	library_bulk_checkout_edition_placeholder: () => 'Select edition',
	library_bulk_checkout_work_placeholder: () => 'Select work',
	library_bulk_checkout_availability: (p: { available: number; total: number }) =>
		`${p.available}/${p.total} available`,
	library_bulk_checkout_already_lent: (p: { date: string }) => `Lent since ${p.date}`,
	library_bulk_checkout_too_many: () => 'Not enough copies available',
	library_work_availability: (p: { available: number; total: number }) =>
		`${p.available}/${p.total}`,
	library_inline_checkout_placeholder: () => 'Select member',
	library_inline_checkout_already_lent: (p: { date: string }) => `Lent since ${p.date}`,
	library_inline_checkout_error: () => 'Checkout failed',
	library_copy_sort_label: () => 'Sort copies by',
	library_copy_sort_nr: () => 'Nr',
	library_copy_sort_member: () => 'Member',
	library_copy_sort_since: () => 'Since',
	library_available_summary: (p: { count: number }) => `${p.count} copies available for lending`,
	library_create_work_button: () => 'Add work',
	library_create_work_name_label: () => 'Title',
	library_create_work_composer_label: () => 'Composer',
	library_create_work_submit: () => 'Create work',
	library_create_work_cancel: () => 'Cancel',
	library_create_work_name_required: () => 'Work title is required.',
	library_create_work_created: (p: { name: string }) => `${p.name} created.`,
	library_create_work_error: () => 'Could not create the work.',
	library_create_edition_button: () => 'Add edition',
	library_create_edition_name_label: () => 'Name',
	library_create_edition_publisher_label: () => 'Publisher',
	library_create_edition_submit: () => 'Create edition',
	library_create_edition_cancel: () => 'Cancel',
	library_create_edition_name_required: () => 'Edition name is required.',
	library_create_edition_created: (p: { name: string }) => `${p.name} created.`,
	library_create_edition_error: () => 'Could not create the edition.',
	library_edition_file_attach: () => 'Attach files',
	library_edition_file_open: () => 'Open',
	library_edition_file_uploading: () => 'Uploading…',
	library_edition_file_uploaded: (p: { filenames: string }) => `${p.filenames} attached.`,
	library_edition_file_failed: (p: { filename: string }) => `Could not attach ${p.filename}.`,
	library_edition_file_broken: (p: { filename: string }) =>
		`${p.filename} failed and could not be cleaned up.`,
	library_edition_file_error: () => 'Could not attach files.',
	library_edition_file_not_created: (p: { filename: string }) =>
		`${p.filename} was not attached — the server returned nothing for it.`,
	file_presence_on_device: () => 'On this device',
	file_presence_needs_network: () => 'Needs network'
} satisfies Copy;

export function libraryMessages(overrides: Partial<typeof LIBRARY_COPY> = {}) {
	return englishMessages(copyWith(LIBRARY_COPY, overrides));
}

// (*MVOX:Josquin*)
