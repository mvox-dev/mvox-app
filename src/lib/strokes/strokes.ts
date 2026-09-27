// #394 GREEN — the stroke format: one storage for every surface that takes
// pen marks. Pure, no DOM, no network, no store — see strokes.spec.ts for
// the contract this implements.

export interface Stroke {
	/** Pen id — the colour lives on the component's `pens` prop, not here. */
	pen: string;
	/** Width as a fraction of the base's width. */
	w: number;
	/** Flat x,y pairs, each in [0,1] of the base's natural box. */
	pts: number[];
	/** Optional pressure per point, only when the pointer reports it. */
	p?: number[];
}

export interface StrokeData {
	v: 1;
	strokes: Stroke[];
}

/** The width the surface gives a new stroke, as a fraction of the base width. */
export const DEFAULT_STROKE_WIDTH = 0.004;

/** The surface's default pens. */
export const DEFAULT_PENS: { id: string; color: string }[] = [
	{ id: 'red', color: '#dc2626' },
	{ id: 'black', color: '#111827' }
];

function round4(n: number): number {
	return Math.round(n * 10000) / 10000;
}

/** JSON, fixed key order v, strokes / pen, w, pts, p; pts and p rounded to
 * 4 decimals; no `p` key when the stroke carries no pressure. */
export function serialize(data: StrokeData): string {
	const strokes = data.strokes.map((stroke) => {
		const out: Stroke = {
			pen: stroke.pen,
			w: stroke.w,
			pts: stroke.pts.map(round4)
		};
		if (stroke.p) out.p = stroke.p.map(round4);
		return out;
	});
	return JSON.stringify({ v: data.v, strokes });
}

/** Throws on non-JSON, unknown v, missing/odd pts, non-array strokes — fail
 * loudly, no silent repair. */
export function parse(text: string): StrokeData {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new Error('strokes: not valid JSON');
	}
	if (typeof raw !== 'object' || raw === null) {
		throw new Error('strokes: root is not an object');
	}
	const obj = raw as Record<string, unknown>;
	if (obj.v !== 1) {
		throw new Error(`strokes: unknown version ${JSON.stringify(obj.v)}`);
	}
	if (!Array.isArray(obj.strokes)) {
		throw new Error('strokes: strokes is not an array');
	}
	const strokes = obj.strokes.map((entry, i) => {
		if (typeof entry !== 'object' || entry === null) {
			throw new Error(`strokes: stroke ${i} is not an object`);
		}
		const stroke = entry as Record<string, unknown>;
		if (typeof stroke.pen !== 'string') {
			throw new Error(`strokes: stroke ${i} has no pen`);
		}
		if (typeof stroke.w !== 'number') {
			throw new Error(`strokes: stroke ${i} has no w`);
		}
		if (!Array.isArray(stroke.pts) || stroke.pts.length === 0 || stroke.pts.length % 2 !== 0) {
			throw new Error(`strokes: stroke ${i} has malformed pts`);
		}
		const out: Stroke = { pen: stroke.pen, w: stroke.w, pts: stroke.pts as number[] };
		if (stroke.p !== undefined) {
			if (!Array.isArray(stroke.p)) {
				throw new Error(`strokes: stroke ${i} has malformed p`);
			}
			out.p = stroke.p as number[];
		}
		return out;
	});
	return { v: 1, strokes };
}

/** The SVG `d` for one stroke: "M x y" then "L x y" per further point; a
 * one-point stroke repeats its point so a round cap renders a dot. */
export function strokePath(stroke: Stroke): string {
	const pts = stroke.pts;
	const count = pts.length / 2;
	const point = (i: number) => `${pts[i * 2]} ${pts[i * 2 + 1]}`;
	if (count <= 1) return `M${point(0)}L${point(0)}`;
	let d = `M${point(0)}`;
	for (let i = 1; i < count; i++) d += `L${point(i)}`;
	return d;
}
