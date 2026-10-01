import { m } from '$lib/paraglide/messages.js';

export function rowLinkLabel(name: string): string {
	return name.trim() === ''
		? m.agenda_row_link_label_unnamed()
		: m.agenda_row_link_label({ event: name });
}
