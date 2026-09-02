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

// #220 — the one shared display formatter every clock-time-rendering surface
// routes through, so the AM/PM preference can reach every one of them (and
// timeFormat.no-hardcoded-render.spec.ts can pin that nothing else renders a
// 24h clock time on its own). Not display sites' 24h-rendering Intl formatter
// itself — that lives HERE, once — but the shared conversion those formatters'
// output flows through.

/** The Europe/Tallinn 24h wall-clock 'HH:MM' of an instant — the exact
 *  Intl output the three display sites produced before #220 (en-GB,
 *  hour/minute '2-digit', hour12: false, timeZone Europe/Tallinn). Display
 *  sites call `formatTime(tallinnHHMM(date), $timeFormatStore)`. */
const tallinnHHMMFmt = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'Europe/Tallinn',
	hour: '2-digit',
	minute: '2-digit',
	hour12: false
});

export function tallinnHHMM(date: Date): string {
	return tallinnHHMMFmt.format(date);
}

/** Render an 'HH:MM' string per the viewer's time-format preference.
 *  '24h' → byte-identical passthrough (unset preference = today's output).
 *  'ampm' → `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`, minute string
 *  passed through verbatim, never re-derived. Malformed input (anything not
 *  'HH:MM') is returned unchanged in BOTH modes — fail loudly is for writes;
 *  a display formatter must never turn junk data into a crash or invented
 *  time text. */
export function formatTime(hhmm: string, mode: TimeFormat): string {
	if (mode === '24h') return hhmm;
	const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
	if (!match) return hhmm;
	const h = Number(match[1]);
	const minute = match[2];
	if (h > 23) return hhmm;
	const hour12 = h % 12 || 12;
	const meridiem = h < 12 ? 'AM' : 'PM';
	return `${hour12}:${minute} ${meridiem}`;
}

// (*MVOX:Palestrina* — #207 GREEN part 1: 24h default + AM/PM preference store)
// (*MVOX:Palestrina* — #220 GREEN: tallinnHHMM + formatTime, the one shared display formatter)
