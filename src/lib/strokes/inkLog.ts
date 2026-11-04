// Her ink on one page as a log: strokes under store-minted ids, and the ids she erased.
import type { FileKey } from '$lib/files/idb';
import type { Stroke, StrokeData } from './strokes';

export type InkPage = FileKey & { page: number };

export interface InkLog {
	v: 1;
	strokes: Array<{ id: string; stroke: Stroke }>;
	erased: string[];
}

export function emptyLog(): InkLog {
	return { v: 1, strokes: [], erased: [] };
}

export function liveInk(log: InkLog): StrokeData {
	const erased = new Set(log.erased);
	return { v: 1, strokes: log.strokes.filter((s) => !erased.has(s.id)).map((s) => s.stroke) };
}

/** Two devices' logs as one: every stroke by id, every tombstone; nothing is dropped. */
export function joinLogs(...logs: InkLog[]): InkLog {
	const strokes = new Map<string, InkLog['strokes'][number]>();
	const erased = new Set<string>();
	for (const log of logs) {
		for (const s of log.strokes) if (!strokes.has(s.id)) strokes.set(s.id, s);
		for (const id of log.erased) erased.add(id);
	}
	return { v: 1, strokes: [...strokes.values()], erased: [...erased] };
}

// (*MVOX:Josquin*)
