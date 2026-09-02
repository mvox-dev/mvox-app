import { writable, type Writable } from 'svelte/store';

// #207 rule 5 — the time-format preference: 24h is the DEFAULT, AM/PM is an
// explicit opt-in via the profile page. localStorage-backed, per-device (Gama
// ruling 2026-09-02), mirroring the house pattern in
// $lib/collectives/store.ts (SELECTED_KEY / selectedCollectiveDbStore).

export type TimeFormat = '24h' | 'ampm';

export const TIME_FORMAT_KEY = 'mvox.time_format';

/** Never trusts localStorage verbatim — anything but the exact 'ampm' token
 *  (junk, a stale '12h' from an earlier draft of this feature, '') sanitizes
 *  to the '24h' default. */
function sanitize(raw: string | null): TimeFormat {
	return raw === 'ampm' ? 'ampm' : '24h';
}

/** SSR-safe: `typeof localStorage !== 'undefined'` guards every access, so
 *  import/read/write on a server render (or a stubbed-away global in tests)
 *  never throws — it just answers/behaves as the default. */
export function readStoredTimeFormat(): TimeFormat {
	if (typeof localStorage === 'undefined') return '24h';
	return sanitize(localStorage.getItem(TIME_FORMAT_KEY));
}

export const timeFormatStore: Writable<TimeFormat> = writable(readStoredTimeFormat());

/** Set the preference: updates the store immediately AND persists it — the
 *  profile page's select fires this on every change, no autosave queue. */
export function setTimeFormat(value: TimeFormat): void {
	timeFormatStore.set(value);
	if (typeof localStorage !== 'undefined') localStorage.setItem(TIME_FORMAT_KEY, value);
}

// (*MVOX:Palestrina* — #207 GREEN part 1: 24h default + AM/PM preference store)
