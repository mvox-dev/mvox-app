import { writable, type Writable } from 'svelte/store';
import { getLocale } from '$lib/paraglide/runtime.js';

// Per-device, localStorage-backed; 24h unless the profile page opts into AM/PM.

export type TimeFormat = '24h' | 'ampm';

export const TIME_FORMAT_KEY = 'mvox.time_format';

function sanitize(raw: string | null): TimeFormat {
	return raw === 'ampm' ? 'ampm' : '24h';
}

export function readStoredTimeFormat(): TimeFormat {
	if (typeof localStorage === 'undefined') return '24h';
	return sanitize(localStorage.getItem(TIME_FORMAT_KEY));
}

export const timeFormatStore: Writable<TimeFormat> = writable(readStoredTimeFormat());

export function setTimeFormat(value: TimeFormat): void {
	timeFormatStore.set(value);
	if (typeof localStorage !== 'undefined') localStorage.setItem(TIME_FORMAT_KEY, value);
}

export const TALLINN_TZ = 'Europe/Tallinn';

// Every clock-time display routes through tallinnHHMM + formatTime so the AM/PM preference
// reaches it.
const tallinnHHMMFmt = new Intl.DateTimeFormat('en-GB', {
	timeZone: TALLINN_TZ,
	hour: '2-digit',
	minute: '2-digit',
	hour12: false
});

export function tallinnHHMM(date: Date): string {
	return tallinnHHMMFmt.format(date);
}

// Malformed input comes back unchanged: a display formatter never invents a time.
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

// Tallinn's digits read back as UTC, minus the real instant, is the offset in effect then.
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

// Two passes: the offset depends on the instant, so on DST days one pass lands an hour off.
// Returns '' for an empty or unparseable draft; Date.UTC(NaN) would make formatToParts throw.
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

// An omitted timeZone stays omitted: the invite-expiry sites rely on process-local time.
export function isoDateFormatter(timeZone?: string): Intl.DateTimeFormat {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
}

const tallinnIsoDate = isoDateFormatter(TALLINN_TZ);

export function tallinnDayKey(date: Date): string {
	return tallinnIsoDate.format(date);
}

export function longDayFormatter(): Intl.DateTimeFormat {
	return new Intl.DateTimeFormat(getLocale(), {
		timeZone: TALLINN_TZ,
		weekday: 'long',
		day: 'numeric',
		month: 'long'
	});
}

// keyOf returns a YYYY-MM-DD day key; runs of the same month form one group.
export function groupByMonth<T>(
	items: readonly T[],
	keyOf: (item: T) => string
): Array<{ month: string; items: T[] }> {
	const groups: Array<{ month: string; items: T[] }> = [];
	for (const item of items) {
		const month = keyOf(item).slice(0, 7);
		const current = groups[groups.length - 1];
		if (current && current.month === month) {
			current.items.push(item);
		} else {
			groups.push({ month, items: [item] });
		}
	}
	return groups;
}

export function monthLabel(month: string): string {
	const [year, monthNum] = month.split('-').map(Number);
	return new Intl.DateTimeFormat(getLocale(), { month: 'long', year: 'numeric' }).format(
		new Date(year, monthNum - 1, 1)
	);
}

export function tallinnWallClockParts(isoUtc: string): { date: string; time: string } {
	const instant = new Date(isoUtc);
	if (Number.isNaN(instant.getTime())) return { date: '', time: '' };
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: TALLINN_TZ,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit'
	}).formatToParts(instant);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

export function toTallinnLocalInputValue(iso: string): string {
	const { date, time } = tallinnWallClockParts(iso);
	return date ? `${date}T${time}` : '';
}

// (*MVOX:Palestrina*)
