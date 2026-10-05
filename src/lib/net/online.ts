// The one online/offline signal every write control reads; online.spec.ts pins it as sole reader.

// Nothing is queued offline, except feedback, which waits on the device (#611, Mihkel 2026-10-01).
import { derived, readable, type Readable } from 'svelte/store';
import { clearReadFellBackToCache, readFellBackToCache } from './cacheFallback';

function currentOnLine(): boolean {
	return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export const online: Readable<boolean> = readable(currentOnLine(), (set) => {
	set(currentOnLine());
	if (typeof window === 'undefined') return () => {};
	const handleOnline = () => {
		set(true);
		clearReadFellBackToCache();
	};
	const handleOffline = () => set(false);
	window.addEventListener('online', handleOnline);
	window.addEventListener('offline', handleOffline);
	return () => {
		window.removeEventListener('online', handleOnline);
		window.removeEventListener('offline', handleOffline);
	};
});

// Also closed by a read that fell back to the cache: onLine stays true on wifi with no uplink.
export const writesAvailable: Readable<boolean> = derived(
	[online, readFellBackToCache],
	([isOnline, fellBack]) => isOnline && !fellBack
);

// (*MVOX:Josquin*)
