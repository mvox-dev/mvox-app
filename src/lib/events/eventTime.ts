import { formatTime, tallinnHHMM, type TimeFormat } from '$lib/preferences/timeFormat';
import type { EventDetail } from '$lib/events/eventDetail';

export function parseStartAt(raw: string): Date | null {
	if (raw === '') return null;
	const parsed = new Date(raw);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isPastDetail(d: EventDetail): boolean {
	const start = parseStartAt(d.startDatetime);
	return start !== null && start.getTime() < Date.now();
}

export function timeRange(start: Date, minutes: number, mode: TimeFormat): string {
	const startStr = formatTime(tallinnHHMM(start), mode);
	if (minutes <= 0) return startStr;
	const endStr = formatTime(tallinnHHMM(new Date(start.getTime() + minutes * 60_000)), mode);
	return `${startStr}–${endStr}`;
}

export function scheduleRowTime(iso: string, mode: TimeFormat): string {
	return formatTime(tallinnHHMM(new Date(iso)), mode);
}

// (*MVOX:Josquin*)
