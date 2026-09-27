// #394 GREEN — the stroke format: one storage for every surface that takes
// pen marks. Pure, no DOM, no network, no store — see strokes.spec.ts for
// the contract this implements.

export interface Stroke {
	/** Pen id — the colour lives on the component's `pens` prop, not here. */
	pen: string;
	/**
	 * Width as a fraction of the base's width, in BOTH directions — the
	 * surface renders in the base's natural box, so one stored `w` is one
	 * thickness whatever the direction of the stroke and whatever the base's
	 * aspect (#394 review F4: a unit-box render with
	 * preserveAspectRatio="none" made a horizontal stroke and a vertical one
	 * two different thicknesses on any non-square base).
	 */
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

/**
 * Every value of a coordinate/pressure list, checked one by one: a finite
 * number inside [0,1]. Returns a real number[] — no cast — so a list that
 * passes is a list the rest of the code can trust.
 *
 * #394 review F3: casting the list through `as number[]` let
 * `pts:["a","b"]` and `pts:[5,-3]` parse clean; strokePath then emitted
 * `d="Ma bLa b"`, an invalid path that renders nothing, so a corrupt stored
 * stroke vanished with no error anywhere.
 */
function unitValues(values: unknown[], what: string, i: number): number[] {
	return values.map((n) => {
		if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) {
			throw new Error(
				`strokes: stroke ${i} has ${what} value ${JSON.stringify(n)} outside the [0,1] unit box`
			);
		}
		return n;
	});
}

/** Throws on non-JSON, unknown v, non-array strokes, missing/odd pts, any pts
 * or p value that is not a finite number in [0,1], a p list whose length is
 * not one per point, and a w that is not a finite positive number — fail
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
		if (typeof stroke.w !== 'number' || !Number.isFinite(stroke.w) || stroke.w <= 0) {
			throw new Error(`strokes: stroke ${i} has no usable w (${JSON.stringify(stroke.w)})`);
		}
		if (!Array.isArray(stroke.pts) || stroke.pts.length === 0 || stroke.pts.length % 2 !== 0) {
			throw new Error(`strokes: stroke ${i} has malformed pts`);
		}
		const pts = unitValues(stroke.pts, 'pts', i);
		const out: Stroke = { pen: stroke.pen, w: stroke.w, pts };
		if (stroke.p !== undefined) {
			if (!Array.isArray(stroke.p) || stroke.p.length !== pts.length / 2) {
				throw new Error(`strokes: stroke ${i} has malformed p`);
			}
			out.p = unitValues(stroke.p, 'p', i);
		}
		return out;
	});
	return { v: 1, strokes };
}

/**
 * The SVG `d` for one stroke: "M x y" then "L x y" per further point; a
 * one-point stroke repeats its point so a round cap renders a dot.
 *
 * Stored coordinates are always [0,1]; `scaleX`/`scaleY` put them in the
 * viewBox the caller renders. Default 1×1 keeps the unit box, and a surface
 * drawing in the base's natural box passes naturalWidth/naturalHeight — which
 * is what makes one stored `w` one thickness in every direction (#394 review
 * F4). Scaled values are rounded to 4 decimals so the same stroke always
 * produces the same `d`.
 */
export function strokePath(stroke: Stroke, scaleX = 1, scaleY = 1): string {
	const pts = stroke.pts;
	const count = pts.length / 2;
	const point = (i: number) => `${round4(pts[i * 2] * scaleX)} ${round4(pts[i * 2 + 1] * scaleY)}`;
	if (count <= 1) return `M${point(0)}L${point(0)}`;
	let d = `M${point(0)}`;
	for (let i = 1; i < count; i++) d += `L${point(i)}`;
	return d;
}
