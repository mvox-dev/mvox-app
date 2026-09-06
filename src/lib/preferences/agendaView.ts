import { writable, type Writable } from 'svelte/store';

// #247 — the agenda view-mode preference: the day-grouped list is the
// DEFAULT, the month overview is an explicit opt-in via the Nimekiri|Kuu
// toggle (Ruled 2026-09-06, item 9). Per-device, localStorage-backed — a
// straight transplant of timeFormat.ts's shape (#207), not a hand-rolled
// variant: same sanitize-never-trust read, same SSR guard, same
// store-then-persist write order.

export type AgendaView = 'list' | 'month';

export const AGENDA_VIEW_KEY = 'mvox.agenda_view';

/** Never trusts localStorage verbatim — anything but the exact 'month' token
 *  (junk, a stale value from an earlier draft, '') sanitizes to the 'list'
 *  default. */
function sanitize(raw: string | null): AgendaView {
	return raw === 'month' ? 'month' : 'list';
}

/** SSR-safe: `typeof localStorage !== 'undefined'` guards every access, so
 *  import/read/write on a server render (or a stubbed-away global in tests)
 *  never throws — it just answers/behaves as the default. */
export function readStoredAgendaView(): AgendaView {
	if (typeof localStorage === 'undefined') return 'list';
	return sanitize(localStorage.getItem(AGENDA_VIEW_KEY));
}

export const agendaViewStore: Writable<AgendaView> = writable(readStoredAgendaView());

/** Set the preference: updates the store immediately AND persists it — the
 *  toggle fires this on every tap, no autosave queue. */
export function setAgendaView(value: AgendaView): void {
	agendaViewStore.set(value);
	if (typeof localStorage !== 'undefined') localStorage.setItem(AGENDA_VIEW_KEY, value);
}

// (*MVOX:Byrd* — #247 GREEN: the agenda view-mode preference store, transplanted from timeFormat.ts's #207 shape)
