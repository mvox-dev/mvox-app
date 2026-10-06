// Detailne (the day list) is the default; Kompaktne (month) is opt-in, kept per device (#247).
import { writable, type Writable } from 'svelte/store';

export type AgendaView = 'list' | 'month';

export const AGENDA_VIEW_KEY = 'mvox.agenda_view';

function sanitize(raw: string | null): AgendaView {
	return raw === 'month' ? 'month' : 'list';
}

// Guarded so a server render, or a test without localStorage, reads the default.
export function readStoredAgendaView(): AgendaView {
	if (typeof localStorage === 'undefined') return 'list';
	return sanitize(localStorage.getItem(AGENDA_VIEW_KEY));
}

export const agendaViewStore: Writable<AgendaView> = writable(readStoredAgendaView());

export function setAgendaView(value: AgendaView): void {
	agendaViewStore.set(value);
	if (typeof localStorage !== 'undefined') localStorage.setItem(AGENDA_VIEW_KEY, value);
}

// (*MVOX:Byrd* — #247)
