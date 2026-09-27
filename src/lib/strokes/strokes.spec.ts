// #394 RED — the stroke format: one storage for every surface that takes pen marks.
//
// CONTRACT (GREEN must implement — src/lib/strokes/strokes.ts, pure, no DOM,
// no network, no store):
//
//   type Stroke     = { pen: string; w: number; pts: number[]; p?: number[] }
//                     pen  — pen id (the colour lives on the component's `pens` prop)
//                     w    — width as a fraction of the base's width
//                     pts  — flat x,y pairs, each in [0,1] of the base's natural box
//                     p    — optional pressure per point, only when the pointer reports it
//   type StrokeData = { v: 1; strokes: Stroke[] }
//
//   serialize(data) → string   JSON, key order v, strokes / pen, w, pts, p;
//                               pts and p rounded to 4 decimals; no `p` key when absent.
//   parse(text)     → StrokeData   throws on non-JSON, unknown v, missing/odd pts,
//                               non-array strokes — fail loudly, no silent repair.
//                               AMENDED (review F3): and on any pts/p value that is
//                               not a finite number in [0,1], a p list that is not
//                               one value per point, and a w that is not a finite
//                               positive number. No casts — a list that passes is a
//                               list the renderer can trust.
//   strokePath(stroke, scaleX?, scaleY?) → string  the SVG `d` for one stroke:
//                               "M x y" then "L x y" per further point; a one-point
//                               stroke repeats its point so a round cap renders a
//                               dot. AMENDED (review F4): the optional scale puts
//                               the stored [0,1] pairs in the caller's viewBox — the
//                               surface passes the base's natural box so one stored
//                               `w` is one thickness in every direction. Default 1×1.
//   DEFAULT_STROKE_WIDTH        the width the surface gives a new stroke.
//   DEFAULT_PENS                [{id:'red',color},{id:'black',color}] — the surface's default pens.
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_STROKE_WIDTH,
	parse,
	serialize,
	strokePath,
	type StrokeData
} from './strokes';

const TWO_STROKES: StrokeData = {
	v: 1,
	strokes: [
		{ pen: 'red', w: 0.004, pts: [0.1, 0.1, 0.5, 0.5, 0.9, 0.9] },
		{ pen: 'black', w: 0.004, pts: [0.2, 0.8, 0.3, 0.7], p: [0.25, 0.75] }
	]
};

describe('#394 — serialize/parse round-trip', () => {
	it('two strokes (one with pressure, one without) survive serialize→parse unchanged', () => {
		expect(parse(serialize(TWO_STROKES))).toEqual(TWO_STROKES);
	});

	it('the serialized form is the smallest JSON: fixed key order, no `p` key on a stroke without pressure', () => {
		expect(serialize(TWO_STROKES)).toEqual(
			'{"v":1,"strokes":[{"pen":"red","w":0.004,"pts":[0.1,0.1,0.5,0.5,0.9,0.9]},{"pen":"black","w":0.004,"pts":[0.2,0.8,0.3,0.7],"p":[0.25,0.75]}]}'
		);
	});

	it('an empty set round-trips', () => {
		expect(parse(serialize({ v: 1, strokes: [] }))).toEqual({ v: 1, strokes: [] });
	});

	it('pts and p are rounded to 4 decimals on serialize', () => {
		const raw: StrokeData = {
			v: 1,
			strokes: [{ pen: 'red', w: 0.004, pts: [0.123456, 0.987654, 0.33333333, 0.00004], p: [0.55557, 0.12344] }]
		};
		expect(parse(serialize(raw))).toEqual({
			v: 1,
			strokes: [{ pen: 'red', w: 0.004, pts: [0.1235, 0.9877, 0.3333, 0], p: [0.5556, 0.1234] }]
		});
	});
});

describe('#394 — parse fails loudly on anything it does not recognise', () => {
	it('throws on an unknown version (v: 2)', () => {
		expect(() => parse('{"v":2,"strokes":[]}')).toThrow();
	});

	it('throws on a missing version', () => {
		expect(() => parse('{"strokes":[]}')).toThrow();
	});

	it('throws on a stroke without pts', () => {
		expect(() => parse('{"v":1,"strokes":[{"pen":"red","w":0.004}]}')).toThrow();
	});

	it('throws on odd-length pts (an x with no y)', () => {
		expect(() => parse('{"v":1,"strokes":[{"pen":"red","w":0.004,"pts":[0.1,0.1,0.5]}]}')).toThrow();
	});

	it('throws when strokes is not an array', () => {
		expect(() => parse('{"v":1,"strokes":{}}')).toThrow();
	});

	it('throws on non-JSON', () => {
		expect(() => parse('not json')).toThrow();
	});

	// review F3: the first GREEN cast the lists through `as number[]` without
	// looking at the elements, so all three payloads below parsed clean.
	// strokePath then emitted `d="Ma bLa b"` — an invalid path that renders
	// nothing, so a corrupt stored stroke disappeared with no error anywhere.
	it('throws on a non-numeric pts value', () => {
		expect(() => parse('{"v":1,"strokes":[{"pen":"red","w":0.004,"pts":["a","b"]}]}')).toThrow();
	});

	it('throws on a pts value outside the [0,1] unit box', () => {
		expect(() => parse('{"v":1,"strokes":[{"pen":"red","w":0.004,"pts":[5,-3]}]}')).toThrow();
	});

	it('throws on a non-numeric p value', () => {
		expect(() =>
			parse('{"v":1,"strokes":[{"pen":"red","w":0.004,"pts":[0.1,0.1],"p":["x"]}]}')
		).toThrow();
	});

	it('throws on a pressure outside [0,1]', () => {
		expect(() =>
			parse('{"v":1,"strokes":[{"pen":"red","w":0.004,"pts":[0.1,0.1],"p":[2]}]}')
		).toThrow();
	});

	it('throws when p is not one value per point', () => {
		expect(() =>
			parse('{"v":1,"strokes":[{"pen":"red","w":0.004,"pts":[0.1,0.1,0.2,0.2],"p":[0.5]}]}')
		).toThrow();
	});

	it('throws on a w that is not a finite positive number', () => {
		expect(() => parse('{"v":1,"strokes":[{"pen":"red","w":0,"pts":[0.1,0.1]}]}')).toThrow();
		expect(() => parse('{"v":1,"strokes":[{"pen":"red","w":-0.004,"pts":[0.1,0.1]}]}')).toThrow();
		expect(() => parse('{"v":1,"strokes":[{"pen":"red","w":"thick","pts":[0.1,0.1]}]}')).toThrow();
	});

	it('throws on a non-number JSON cannot carry: NaN serializes to null', () => {
		expect(() =>
			parse(JSON.stringify({ v: 1, strokes: [{ pen: 'red', w: 0.004, pts: [0.1, Number.NaN] }] }))
		).toThrow();
	});
});

describe('#394 — geometry: one SVG path per stroke', () => {
	it('a three-point stroke is M then two L segments, in base-fraction units', () => {
		expect(strokePath({ pen: 'red', w: 0.004, pts: [0.1, 0.1, 0.5, 0.5, 0.9, 0.9] })).toEqual(
			'M0.1 0.1L0.5 0.5L0.9 0.9'
		);
	});

	it('a one-point stroke repeats its point so the round cap renders a dot', () => {
		expect(strokePath({ pen: 'black', w: 0.004, pts: [0.3, 0.4] })).toEqual('M0.3 0.4L0.3 0.4');
	});

	// review F4: the surface renders in the base's natural box, so the path
	// builder scales the stored [0,1] pairs into it. Unscaled is still the unit
	// box, so storage and the format are unchanged.
	it('the path scales into the caller’s box, and unscaled is still the unit box', () => {
		const s = { pen: 'red', w: 0.004, pts: [0.1, 0.1, 0.5, 0.5] };
		expect(strokePath(s, 200, 100)).toEqual('M20 10L100 50');
		expect(strokePath(s)).toEqual('M0.1 0.1L0.5 0.5');
	});

	it('a scaled one-point stroke keeps its dot where it was made, rounded to 4 decimals', () => {
		expect(strokePath({ pen: 'black', w: 0.004, pts: [0.3, 0.4] }, 210, 297)).toEqual(
			'M63 118.8L63 118.8'
		);
	});

	it('the default width is a positive fraction of the base width', () => {
		expect(DEFAULT_STROKE_WIDTH).toBeGreaterThan(0);
		expect(DEFAULT_STROKE_WIDTH).toBeLessThan(0.05);
	});
});

// (*MVOX:Tallis* — #394 RED: the stroke format)
