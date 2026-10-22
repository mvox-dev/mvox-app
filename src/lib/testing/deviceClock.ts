// Pins the device clock and zone, so a spec can stand just past local midnight.
import { vi } from 'vitest';
import { TALLINN_TZ } from '$lib/preferences/timeFormat';

export const TALLINN_SUMMER_NIGHT = '2026-10-20T22:30:00Z'; // 01:30 EEST on the 21st in Tallinn

export function setDeviceClock(instant: string, timeZone = TALLINN_TZ): void {
	vi.stubEnv('TZ', timeZone);
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(instant));
}

export function resetDeviceClock(): void {
	vi.useRealTimers();
	vi.unstubAllEnvs();
}

// (*MVOX:Josquin*)
