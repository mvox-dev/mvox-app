// The member-picker prompt the agenda and /admin share.
import { m } from '$lib/paraglide/messages.js';

export interface RosterReadState {
	failed: boolean;
	loading: boolean;
	rowCount: number;
}

export function pickerPromptText(optionCount: number, addPrompt: string, read: RosterReadState): string {
	if (optionCount > 0) return addPrompt;
	if (read.failed) return m.picker_roster_unavailable();
	if (read.loading) return m.picker_roster_loading();
	if (read.rowCount === 0) return m.picker_no_members();
	return m.picker_everyone_added();
}

// (*MVOX:Josquin*)
