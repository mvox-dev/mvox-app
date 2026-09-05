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

// #230 — the two-pass Tallinn DST-aware wall-clock ↔ UTC conversion, extracted
// from src/routes/+page.svelte (eventCreateTallinnOffsetMinutes) and
// src/routes/event/[id]/+page.svelte (tallinnOffsetMinutes) — the bodies were
// byte-identical modulo names. AgendaList.svelte's calendar-day GROUPING
// formatters are a structurally different use of the timezone (PRESERVED
// VERBATIM, T5 DST guards) and stay local — deliberately not folded in here.

const TALLINN_TZ = 'Europe/Tallinn';

/** The Tallinn wall-clock offset (minutes, e.g. +180 in EEST) in effect AT
 *  `date` — rendering `date`'s Tallinn wall clock, then re-reading those same
 *  digits as if THEY were UTC and diffing against the real instant, gives
 *  exactly the offset. DST-aware because the formatter is. */
export function tallinnOffsetMinutes(date: Date): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: TALLINN_TZ,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	}).formatToParts(date);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
	const asUtc = Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		get('hour'),
		get('minute'),
		get('second')
	);
	return (asUtc - date.getTime()) / 60_000;
}

/** A `datetime-local` value typed AS TALLINN wall clock → the UTC instant to
 *  write on the wire. Two passes because the Tallinn offset (EET/EEST) itself
 *  depends on the INSTANT being converted — the first pass reads the offset
 *  at the UTC-as-if-Tallinn guess, the second re-reads it at the instant that
 *  guess produced. On the two DST transition days the guess sits on the far
 *  side of the changeover (a 01:30 EET wall clock on 29 March guesses
 *  01:30Z, still EET-side, and one pass would write 22:30Z — 00:30 Tallinn,
 *  an hour off), so the second pass is what makes every valid wall clock in
 *  the year round-trip. Only 03:00–03:59 on spring-forward day stays off,
 *  and those wall clocks do not exist locally.
 *
 *  TOTAL on purpose — '' for an empty or unparseable draft. An empty draft
 *  is a REACHABLE state (a timeless event's pencil seeds '', and an editor
 *  can clear the input), and `Date.UTC(NaN, …)` would feed an Invalid Date
 *  into `formatToParts`, which THROWS — escaping onblur handlers that
 *  depend on this never throwing. */
export function tallinnLocalToUtcIso(local: string): string {
	const [datePart, timePart] = local.split('T');
	const [y, mo, d] = (datePart ?? '').split('-').map(Number);
	const [h, mi] = (timePart ?? '00:00').split(':').map(Number);
	const guessUtcMs = Date.UTC(y, mo - 1, d, h, mi);
	if (Number.isNaN(guessUtcMs)) return '';
	const firstOffset = tallinnOffsetMinutes(new Date(guessUtcMs));
	let instantMs = guessUtcMs - firstOffset * 60_000;
	const secondOffset = tallinnOffsetMinutes(new Date(instantMs));
	if (secondOffset !== firstOffset) instantMs = guessUtcMs - secondOffset * 60_000;
	return new Date(instantMs).toISOString();
}

// (*MVOX:Palestrina* — #207 GREEN part 1: 24h default + AM/PM preference store)
// (*MVOX:Palestrina* — #220 GREEN: tallinnHHMM + formatTime, the one shared display formatter)
// (*MVOX:Palestrina* — #230 GREEN: tallinnOffsetMinutes + tallinnLocalToUtcIso, the shared DST-aware conversion moved from the two event-create/edit hosts)
