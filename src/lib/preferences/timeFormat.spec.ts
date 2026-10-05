// @vitest-environment happy-dom
// The time-format preference: 24h by default, AM/PM by choice, stored per device and SSR-safe.
// Init tests use a fresh module instance, since module-level init runs once per import.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { formatTime, tallinnHHMM } from './timeFormat';

type TimeFormatModule = typeof import('./timeFormat');

async function freshModule(): Promise<TimeFormatModule> {
	vi.resetModules();
	return await import('./timeFormat');
}

// SSR tests stub localStorage away, so afterEach unstubs FIRST and the clear is guarded.
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

// formatTime and tallinnHHMM: the one display formatter. Malformed input comes back unchanged.

describe('#220 — formatTime (the one shared display formatter)', () => {
	it("'24h' mode returns the input BYTE-IDENTICAL — an unset preference renders exactly today's strings", async () => {
		for (const hhmm of ['19:00', '00:05', '12:00', '07:05', '23:55', '00:00']) {
			expect(formatTime(hhmm, '24h'), hhmm).toBe(hhmm);
		}
	});

	it("'ampm' mode: the pinned conversion table (midnight, noon, leading zero stripped from the HOUR only)", async () => {
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
		expect(formatTime('09:03', 'ampm')).toBe('9:03 AM');
	});

	it('malformed input is returned unchanged in BOTH modes — junk data never crashes a display surface and never becomes invented time text', async () => {
		for (const junk of ['', 'junk', '9 PM', 'T19', '19.00']) {
			expect(formatTime(junk, '24h'), JSON.stringify(junk)).toBe(junk);
			expect(formatTime(junk, 'ampm'), JSON.stringify(junk)).toBe(junk);
		}
	});
});

describe('#220 — tallinnHHMM (the shared Tallinn wall-clock reader the sites migrate to)', () => {
	it("matches today's per-site Intl output exactly, across both 2026 DST transitions (the 'preserved verbatim' guarantee)", async () => {
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
		expect(tallinnHHMM(new Date('2026-03-29T00:30:00.000Z'))).toBe('02:30');
		expect(tallinnHHMM(new Date('2026-03-29T01:30:00.000Z'))).toBe('04:30');
		expect(tallinnHHMM(new Date('2026-10-25T00:30:00.000Z'))).toBe('03:30');
		expect(tallinnHHMM(new Date('2026-10-25T01:30:00.000Z'))).toBe('03:30');
		expect(tallinnHHMM(new Date('2026-06-15T21:30:00.000Z'))).toBe('00:30');
	});
});

// (*MVOX:Tallis* — #220 RED: formatTime + tallinnHHMM, the one shared display formatter)
