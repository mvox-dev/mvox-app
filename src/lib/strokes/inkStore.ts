import type { Stroke, StrokeData } from './strokes';

export interface InkPage {
	db: string;
	personId: string;
	fileId: string;
	page: number;
}

export interface InkLog {
	v: 1;
	strokes: Array<{ id: string; stroke: Stroke }>;
	erased: string[];
}

export interface InkStore {
	load(at: InkPage): Promise<InkLog>;
	save(at: InkPage, ink: StrokeData): Promise<void>;
}

export function liveInk(_log: InkLog): StrokeData {
	throw new Error('not implemented');
}

export function createInkStore(_factory?: IDBFactory): InkStore {
	const notYet = () => Promise.reject(new Error('not implemented'));
	return { load: notYet, save: notYet };
}

export function getInkStore(): InkStore | null {
	throw new Error('not implemented');
}
