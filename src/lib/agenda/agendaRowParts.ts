import { m } from '$lib/paraglide/messages.js';
import { getLocale } from '$lib/paraglide/runtime.js';
import type { RsvpStatus } from '$lib/rsvp/rsvpData';

export function rowLinkLabel(name: string): string {
	return name.trim() === ''
		? m.agenda_row_link_label_unnamed()
		: m.agenda_row_link_label({ event: name });
}

const ANSWER_LABEL: Record<RsvpStatus, () => string> = {
	going: m.rsvp_status_going,
	not_going: m.rsvp_status_not_going,
	maybe: m.rsvp_status_maybe,
	late: m.rsvp_status_late
};

export function rsvpAnswerText(status: RsvpStatus | undefined): string | null {
	return status ? ANSWER_LABEL[status]().toLocaleLowerCase(getLocale()) : null;
}
