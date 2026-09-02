// @vitest-environment happy-dom
//
// #207 RED — the time-format preference store (PO standing rule 5's second
// half: 24h is the DEFAULT, AM/PM is available only via a profile preference).
//
// CONTRACT (GREEN must implement — src/lib/preferences/timeFormat.ts, the
// house localStorage-store pattern of src/lib/collectives/store.ts:20-22):
//
//   export type TimeFormat = '24h' | 'ampm';
//   export const TIME_FORMAT_KEY = 'mvox.time_format';   // mvox.<name> convention
//   export function readStoredTimeFormat(): TimeFormat;  // sanitizing read of
//                                                        // localStorage NOW:
//                                                        // absent/invalid → '24h'
//   export const timeFormatStore: Writable<TimeFormat>;  // init from readStoredTimeFormat()
//   export function setTimeFormat(v: TimeFormat): void;  // store.set + persist
//
//   SSR-safe: the module guards `typeof localStorage !== 'undefined'` — import
//   and setTimeFormat must not throw where localStorage is absent, and the
//   store then defaults to '24h'. Gama ruling 2026-09-02: localStorage
//   confirmed, per-device, no schema change. Values are '24h' | 'ampm' (the
//   ruling's shorthand "12h" names the MODE; the stored token is 'ampm').
//
// Every init-behaviour test goes through a FRESH module instance
// (vi.resetModules + dynamic import) — module-level init runs once per import.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

type TimeFormatModule = typeof import('./timeFormat');

async function freshModule(): Promise<TimeFormatModule> {
	vi.resetModules();
	return await import('./timeFormat');
}

// `vi.unstubAllGlobals()` FIRST in afterEach — the SSR-safety tests below stub
// `localStorage` away with `vi.stubGlobal('localStorage', undefined)`, so a
// `localStorage.clear()` ahead of the unstub throws and (because a throwing
// afterEach never reaches the unstub) leaves the stub in place to poison every
// later test. Both hooks also guard the clear, so neither can throw.
function clearStorage(): void {
	if (typeof localStorage !== 'undefined') localStorage.clear();
}

beforeEach(() => {
	clearStorage();
});

afterEach(() => {
	vi.unstubAllGlobals();
	clearStorage();
});

describe('timeFormat preference — defaults (#207 rule 5)', () => {
	it("uses the pinned localStorage key 'mvox.time_format'", async () => {
		const mod = await freshModule();
		expect(mod.TIME_FORMAT_KEY).toBe('mvox.time_format');
	});

	it("defaults to '24h' with EMPTY localStorage — 24h is the rule, AM/PM the opt-in", async () => {
		const mod = await freshModule();
		expect(mod.readStoredTimeFormat()).toBe('24h');
		expect(get(mod.timeFormatStore)).toBe('24h');
	});

	it("sanitizes an INVALID stored value to '24h' — never trusts localStorage verbatim", async () => {
		for (const junk of ['12h', 'AMPM', 'garbage', '']) {
			localStorage.setItem('mvox.time_format', junk);
			const mod = await freshModule();
			expect(mod.readStoredTimeFormat(), `stored ${JSON.stringify(junk)}`).toBe('24h');
			expect(get(mod.timeFormatStore), `stored ${JSON.stringify(junk)}`).toBe('24h');
		}
	});
});

describe('timeFormat preference — round trip (#207 rule 5)', () => {
	it("setTimeFormat('ampm') persists to localStorage AND updates the store", async () => {
		const mod = await freshModule();
		mod.setTimeFormat('ampm');
		expect(localStorage.getItem('mvox.time_format')).toBe('ampm');
		expect(get(mod.timeFormatStore)).toBe('ampm');
	});

	it('a persisted preference survives a fresh module load (the round trip)', async () => {
		const first = await freshModule();
		first.setTimeFormat('ampm');

		const second = await freshModule();
		expect(second.readStoredTimeFormat()).toBe('ampm');
		expect(get(second.timeFormatStore)).toBe('ampm');

		second.setTimeFormat('24h');
		expect(localStorage.getItem('mvox.time_format')).toBe('24h');
		const third = await freshModule();
		expect(get(third.timeFormatStore)).toBe('24h');
	});
});

describe('timeFormat preference — SSR safety (#207)', () => {
	it("module import without localStorage does not throw and defaults to '24h'", async () => {
		vi.stubGlobal('localStorage', undefined);
		const mod = await freshModule();
		expect(get(mod.timeFormatStore)).toBe('24h');
		expect(mod.readStoredTimeFormat()).toBe('24h');
	});

	it('setTimeFormat without localStorage does not throw (store still updates in memory)', async () => {
		vi.stubGlobal('localStorage', undefined);
		const mod = await freshModule();
		expect(() => mod.setTimeFormat('ampm')).not.toThrow();
		expect(get(mod.timeFormatStore)).toBe('ampm');
	});
});

// ── #220 — one shared formatter for every DISPLAYED clock time ───────────────
//
// CONTRACT (GREEN must implement, same module — the formatter lives NEXT TO
// the #207 preference read so no surface can consult one without the other):
//
//   export function formatTime(hhmm: string, mode: TimeFormat): string;
//     '24h'  → the input, byte-identical (unset preference = today's output).
//     'ampm' → `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}` — the minute
//              string is passed through verbatim, never re-derived.
//     Malformed input (anything that is not 'HH:MM') → returned unchanged in
//     BOTH modes (fail loudly is for writes; a display formatter must never
//     turn junk data into a crash or into invented time text).
//
//   export function tallinnHHMM(date: Date): string;
//     The 24h Europe/Tallinn wall-clock 'HH:MM' of the instant — the EXACT
//     Intl output the three display sites produce today (en-GB, hour/minute
//     '2-digit', hour12: false, timeZone Europe/Tallinn). The sites move
//     their per-file Intl formatters here and render
//     formatTime(tallinnHHMM(d), mode) — which is what lets
//     timeFormat.no-hardcoded-render.spec.ts pin "no 24h-rendering Intl
//     formatter outside this module".
//
// AM/PM tokens are TimeSelect's literal 'AM'/'PM' — no new Paraglide keys
// (team-lead default, Gama informed 2026-09-02 12:15).

type FormatterExports = {
	formatTime?: (hhmm: string, mode: import('./timeFormat').TimeFormat) => string;
	tallinnHHMM?: (date: Date) => string;
};

/** RED-phase seam: the two #220 exports don't exist yet, so a STATIC import
 *  would be a typecheck error while the suite must still RUN (and fail). The
 *  cast keeps `pnpm check` green; the missing functions fail loudly at call
 *  time as `... is not a function`. */
async function formatterExports(): Promise<Required<FormatterExports>> {
	const mod = (await import('./timeFormat')) as FormatterExports;
	return mod as Required<FormatterExports>;
}

describe('#220 — formatTime (the one shared display formatter)', () => {
	it("'24h' mode returns the input BYTE-IDENTICAL — an unset preference renders exactly today's strings", async () => {
		const { formatTime } = await formatterExports();
		for (const hhmm of ['19:00', '00:05', '12:00', '07:05', '23:55', '00:00']) {
			expect(formatTime(hhmm, '24h'), hhmm).toBe(hhmm);
		}
	});

	it("'ampm' mode: the pinned conversion table (midnight, noon, leading zero stripped from the HOUR only)", async () => {
		const { formatTime } = await formatterExports();
		const table: Array<[string, string]> = [
			['19:00', '7:00 PM'],
			['00:05', '12:05 AM'], // midnight hour is 12 AM, minute kept verbatim
			['12:00', '12:00 PM'], // noon is 12 PM, not 0 PM
			['07:05', '7:05 AM'], // hour loses its leading zero; minute keeps its own
			['00:00', '12:00 AM'],
			['11:59', '11:59 AM'],
			['12:05', '12:05 PM'],
			['13:00', '1:00 PM'],
			['23:55', '11:55 PM']
		];
		for (const [input, expected] of table) {
			expect(formatTime(input, 'ampm'), input).toBe(expected);
		}
	});

	it("'ampm' mode passes the MINUTE string through verbatim — a legacy off-grid minute like '09:03' renders '9:03 AM', never re-derived or snapped", async () => {
		const { formatTime } = await formatterExports();
		expect(formatTime('09:03', 'ampm')).toBe('9:03 AM');
	});

	it('malformed input is returned unchanged in BOTH modes — junk data never crashes a display surface and never becomes invented time text', async () => {
		const { formatTime } = await formatterExports();
		for (const junk of ['', 'junk', '9 PM', 'T19', '19.00']) {
			expect(formatTime(junk, '24h'), JSON.stringify(junk)).toBe(junk);
			expect(formatTime(junk, 'ampm'), JSON.stringify(junk)).toBe(junk);
		}
	});
});

describe('#220 — tallinnHHMM (the shared Tallinn wall-clock reader the sites migrate to)', () => {
	it("matches today's per-site Intl output exactly, across both 2026 DST transitions (the 'preserved verbatim' guarantee)", async () => {
		const { tallinnHHMM } = await formatterExports();
		// The reference IS the formatter the three sites carry today (AgendaList
		// timeFmt / event-detail timeFmt / eventCreateStatusTimeFmt — en-GB,
		// 2-digit hour+minute, 24h, Europe/Tallinn).
		const reference = new Intl.DateTimeFormat('en-GB', {
			timeZone: 'Europe/Tallinn',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		});
		const instants = [
			'2026-03-29T00:30:00.000Z', // 02:30 EET — spring-forward day, before the jump
			'2026-03-29T01:30:00.000Z', // 04:30 EEST — 03:xx never exists on this day
			'2026-10-25T00:30:00.000Z', // 03:30 EEST — fall-back day, first pass
			'2026-10-25T01:30:00.000Z', // 03:30 EET — the repeated hour, second pass
			'2026-06-15T21:30:00.000Z', // 00:30 next Tallinn day — midnight is '00', never '24'
			'2026-09-01T16:00:00.000Z' // 19:00 — the fixture instant every page spec leans on
		];
		for (const iso of instants) {
			const d = new Date(iso);
			expect(tallinnHHMM(d), iso).toBe(reference.format(d));
		}
	});

	it('pinned concrete values on the DST edges (belt to the reference-formatter braces above)', async () => {
		const { tallinnHHMM } = await formatterExports();
		expect(tallinnHHMM(new Date('2026-03-29T00:30:00.000Z'))).toBe('02:30');
		expect(tallinnHHMM(new Date('2026-03-29T01:30:00.000Z'))).toBe('04:30');
		expect(tallinnHHMM(new Date('2026-10-25T00:30:00.000Z'))).toBe('03:30');
		expect(tallinnHHMM(new Date('2026-10-25T01:30:00.000Z'))).toBe('03:30');
		expect(tallinnHHMM(new Date('2026-06-15T21:30:00.000Z'))).toBe('00:30');
	});
});

// (*MVOX:Tallis* — #220 RED: formatTime + tallinnHHMM, the one shared display formatter)
