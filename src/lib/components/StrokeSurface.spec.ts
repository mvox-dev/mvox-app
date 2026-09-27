// @vitest-environment happy-dom
//
// #394 RED — StrokeSurface: ONE pen-marks surface over ANY base.
//
// The issue: a base (a raster image today, a PDF page later via #333) sits
// under a surface; the user marks it with two pens, undoes, erases; what is
// kept is the strokes, never a modified base. The component decides no
// persistence and names no feature — the consumer owns both.
//
// CONTRACT (GREEN must implement — src/lib/components/StrokeSurface.svelte,
// Svelte 5 runes, using src/lib/strokes/strokes.ts):
//
//   PROPS
//     base           Snippet — the consumer renders its own image/canvas; the
//                    component positions over it and never touches it.
//     naturalWidth,
//     naturalHeight  numbers — the base's natural box (aspect).
//     pens           {id, color, label?}[] — default DEFAULT_PENS (red + black).
//                    `label` IS the control's accessible name (review F2): the
//                    two built-in ids fall back to the surface's own
//                    translations, any other id names itself, and no pen ever
//                    borrows another pen's name.
//     strokes        $bindable StrokeData.
//     readonly       view mode: no controls, no pointer capture, native scroll.
//     onchange?      (strokes: StrokeData) => void, after every add/erase/undo.
//
//   RENDER  an absolutely positioned <svg data-testid="stroke-surface"> over
//           the base, one <path> per visible stroke: d = strokePath(stroke,
//           naturalWidth, naturalHeight), stroke = the pen's colour,
//           stroke-width = w × naturalWidth. `touch-action: none` on the svg
//           only in draw mode.
//
//           AMENDED (review F4 — the original contract said viewBox="0 0 1 1"
//           preserveAspectRatio="none"): the surface renders in the base's
//           NATURAL box, viewBox="0 0 {naturalWidth} {naturalHeight}" with a
//           uniform preserveAspectRatio. Stretching a unit box scaled x by the
//           element's width and y by its height, so one stored `w` rendered as
//           two different thicknesses (2× apart on the 200×100 base here,
//           ~41% on an A4 page) and round caps rendered as ellipses. Storage
//           is unchanged — coordinates stay normalized to [0,1].
//   POINTER pointerdown/move/up on the svg, setPointerCapture, coordinates
//           mapped via getBoundingClientRect to [0,1], rounded to 4 decimals.
//           `p` is recorded only for pointerType "pen" (a mouse/touch stroke
//           carries no `p` key). The stroke under the pointer renders WHILE it
//           is being made (review F1), not only once the pointer lifts.
//   ERASE   stroke eraser: a pass in erase mode removes every stroke its path
//           touches. The saved set holds visible strokes only.
//   UNDO    in-memory history (add stroke, erase set); undo reverses the last
//           op; an erased stroke comes back at its original index. The
//           history is never serialized.
//   CONTROLS native <button type="button">, min-h-11 min-w-11: one per pen
//           (aria-pressed), erase toggle (aria-pressed), undo (disabled when
//           history empty). Picking a pen leaves erase mode. Each one has a
//           VISIBLE face (review F5 — all four landed empty): the pen's own
//           colour as a swatch, an eraser and an undo glyph, a visible pressed
//           marker beside aria-pressed, and a visible disabled state.
//           en aria-labels: "Red pen", "Black pen", "Erase strokes", "Undo"
//           (keys strokes_pen_red_aria_label, strokes_pen_black_aria_label,
//           strokes_erase_aria_label, strokes_undo_aria_label).
//
// No integration-with-a-route test: by the issue's own Done-when the
// component names no feature and has no consumer yet (#395 and #333 adopt
// it). The base-snippet mount below IS its consumer contract.
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRawSnippet } from 'svelte';
import { DEFAULT_PENS, DEFAULT_STROKE_WIDTH, parse, serialize, strokePath, type StrokeData } from '$lib/strokes/strokes';

import StrokeSurface from './StrokeSurface.svelte';

const BASE_SRC =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const base = createRawSnippet(() => ({
	render: () => `<img data-testid="base" src="${BASE_SRC}" alt="" width="200" height="100">`
}));

const RECT = { left: 0, top: 0, x: 0, y: 0, width: 200, height: 100, right: 200, bottom: 100 };
const MOUSE = { pointerType: 'mouse', pointerId: 1, isPrimary: true } as const;

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
		...RECT,
		toJSON: () => RECT
	} as DOMRect);
	fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function mount(props: Record<string, unknown> = {}) {
	const onchange = vi.fn();
	const result = render(StrokeSurface, {
		props: { base, naturalWidth: 200, naturalHeight: 100, onchange, ...props }
	});
	return { ...result, onchange };
}

function surface(container: HTMLElement): SVGSVGElement {
	const el = container.querySelector('svg[data-testid="stroke-surface"]');
	expect(el, 'the stroke surface svg').not.toBeNull();
	return el as SVGSVGElement;
}

/** One pointer pass through the given px points on the surface. */
async function pass(
	container: HTMLElement,
	points: Array<[number, number]>,
	init: Record<string, unknown> = MOUSE,
	pressures?: number[]
) {
	const svg = surface(container);
	const at = (i: number) => ({
		...init,
		clientX: points[i][0],
		clientY: points[i][1],
		...(pressures ? { pressure: pressures[i] } : {})
	});
	await fireEvent.pointerDown(svg, at(0));
	for (let i = 1; i < points.length; i++) await fireEvent.pointerMove(svg, at(i));
	await fireEvent.pointerUp(svg, at(points.length - 1));
}

function lastEmitted(onchange: ReturnType<typeof vi.fn>): StrokeData {
	expect(onchange).toHaveBeenCalled();
	return onchange.mock.calls[onchange.mock.calls.length - 1][0] as StrokeData;
}

const btn = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

// Stroke 1: horizontal across the top band; stroke 2: across the bottom band.
const LINE_TOP: Array<[number, number]> = [
	[20, 10],
	[100, 10],
	[180, 10]
];
const LINE_BOTTOM: Array<[number, number]> = [
	[20, 90],
	[100, 90],
	[180, 90]
];
const S1 = { pen: 'red', w: DEFAULT_STROKE_WIDTH, pts: [0.1, 0.1, 0.5, 0.1, 0.9, 0.1] };
const S2 = { pen: 'black', w: DEFAULT_STROKE_WIDTH, pts: [0.1, 0.9, 0.5, 0.9, 0.9, 0.9] };

describe('#394 — drawing with two pens', () => {
	it('a 3-point red stroke emits exactly one stroke with normalized pts and pen "red"', async () => {
		const { container, onchange } = mount();
		await pass(container, [
			[20, 10],
			[100, 50],
			[180, 90]
		]);
		expect(lastEmitted(onchange)).toEqual({
			v: 1,
			strokes: [{ pen: 'red', w: DEFAULT_STROKE_WIDTH, pts: [0.1, 0.1, 0.5, 0.5, 0.9, 0.9] }]
		});
	});

	it('a stylus stroke records pressure per point', async () => {
		const { container, onchange } = mount();
		await pass(
			container,
			[
				[20, 10],
				[100, 50],
				[180, 90]
			],
			{ pointerType: 'pen', pointerId: 2, isPrimary: true },
			[0.3, 0.6, 0.9]
		);
		expect(lastEmitted(onchange)).toEqual({
			v: 1,
			strokes: [
				{ pen: 'red', w: DEFAULT_STROKE_WIDTH, pts: [0.1, 0.1, 0.5, 0.5, 0.9, 0.9], p: [0.3, 0.6, 0.9] }
			]
		});
	});

	it('switching to black then drawing adds a second stroke with pen "black"', async () => {
		const { container, onchange } = mount();
		await pass(container, LINE_TOP);
		await fireEvent.click(btn('Black pen'));
		await pass(container, LINE_BOTTOM);
		expect(lastEmitted(onchange)).toEqual({ v: 1, strokes: [S1, S2] });
	});

	it('one <path> per stroke: d = strokePath in the base box, stroke = the pen colour, one thickness', async () => {
		const { container } = mount();
		await pass(container, LINE_TOP);
		await fireEvent.click(btn('Black pen'));
		await pass(container, LINE_BOTTOM);
		const paths = [...surface(container).querySelectorAll('path')].map((p) => ({
			d: p.getAttribute('d'),
			stroke: p.getAttribute('stroke'),
			width: p.getAttribute('stroke-width')
		}));
		const colour = (id: string) => DEFAULT_PENS.find((p) => p.id === id)?.color;
		// review F4: the base box (200×100), so the width is w × 200 in BOTH
		// directions — the horizontal S1 and the vertical-capable S2 alike.
		const width = String(DEFAULT_STROKE_WIDTH * 200);
		expect(paths).toEqual([
			{ d: strokePath(S1, 200, 100), stroke: colour('red'), width },
			{ d: strokePath(S2, 200, 100), stroke: colour('black'), width }
		]);
		expect(paths[0].d).toEqual('M20 10L100 10L180 10');
	});

	it('pen colours come from the pens prop', async () => {
		const { container } = mount({
			pens: [
				{ id: 'red', color: '#ff0000' },
				{ id: 'black', color: '#000000' }
			]
		});
		await pass(container, LINE_TOP);
		expect(surface(container).querySelector('path')?.getAttribute('stroke')).toEqual('#ff0000');
	});

	it('default pens are red and black', () => {
		expect(DEFAULT_PENS.map((p) => p.id)).toEqual(['red', 'black']);
	});
});

// review F1: the stroke used to appear only on pointerup — the points lived in
// a plain closure array the template never read, so a user marking a score saw
// no line under the pen until they lifted it. Every assertion here runs MID-DRAG,
// which is exactly what the original tests (all of them after a completed pass)
// could not see.
describe('#394 — the stroke renders while the pointer is still down', () => {
	it('the live points render as a path before the pointer lifts, and become the committed path on up', async () => {
		const { container, onchange } = mount();
		const svg = surface(container);
		await fireEvent.pointerDown(svg, { ...MOUSE, clientX: 20, clientY: 10 });
		// one point down: a dot under the pen, already visible
		expect(surface(container).querySelectorAll('path')).toHaveLength(1);

		await fireEvent.pointerMove(svg, { ...MOUSE, clientX: 100, clientY: 10 });
		await fireEvent.pointerMove(svg, { ...MOUSE, clientX: 180, clientY: 10 });
		const live = [...surface(container).querySelectorAll('path')];
		expect(live).toHaveLength(1);
		expect(live[0].getAttribute('d')).toEqual('M20 10L100 10L180 10');
		expect(live[0].getAttribute('stroke')).toEqual(DEFAULT_PENS[0].color);
		expect(live[0].getAttribute('stroke-width')).toEqual(String(DEFAULT_STROKE_WIDTH * 200));
		// nothing is stored until the pointer lifts
		expect(onchange).not.toHaveBeenCalled();

		await fireEvent.pointerUp(svg, { ...MOUSE, clientX: 180, clientY: 10 });
		const after = [...surface(container).querySelectorAll('path')];
		expect(after).toHaveLength(1);
		expect(after[0].getAttribute('d')).toEqual('M20 10L100 10L180 10');
		expect(surface(container).querySelector('[data-testid="live-stroke"]')).toBeNull();
		expect(lastEmitted(onchange)).toEqual({ v: 1, strokes: [S1] });
	});

	it('the live stroke takes the active pen, and an erase pass draws nothing', async () => {
		const { container } = mount();
		await pass(container, LINE_TOP);
		await fireEvent.click(btn('Black pen'));
		const svg = surface(container);
		const liveEl = () => surface(container).querySelector('[data-testid="live-stroke"]');

		await fireEvent.pointerDown(svg, { ...MOUSE, clientX: 20, clientY: 90 });
		await fireEvent.pointerMove(svg, { ...MOUSE, clientX: 100, clientY: 90 });
		expect(liveEl()).not.toBeNull();
		expect((liveEl() as SVGPathElement).getAttribute('stroke')).toEqual(DEFAULT_PENS[1].color);
		expect(surface(container).querySelectorAll('path')).toHaveLength(2);
		await fireEvent.pointerUp(svg, { ...MOUSE, clientX: 100, clientY: 90 });
		expect(liveEl()).toBeNull();

		await fireEvent.click(btn('Erase strokes'));
		await fireEvent.pointerDown(svg, { ...MOUSE, clientX: 100, clientY: 50 });
		await fireEvent.pointerMove(svg, { ...MOUSE, clientX: 110, clientY: 50 });
		expect(liveEl()).toBeNull();
		await fireEvent.pointerUp(svg, { ...MOUSE, clientX: 110, clientY: 50 });
	});
});

// review F2: penLabel hardcoded `id === 'black' ? black : red`, so
// pens:[{id:'blue'},{id:'green'}] rendered two controls both named "Red pen".
describe('#394 — the pens prop names its own controls', () => {
	const CUSTOM = [
		{ id: 'blue', color: '#1d4ed8' },
		{ id: 'green', color: '#15803d' }
	];
	const names = (container: HTMLElement) =>
		[...container.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));

	it('custom pens carry the consumer’s own labels', () => {
		const { container } = mount({
			pens: CUSTOM.map((p, i) => ({ ...p, label: ['Blue pen', 'Green pen'][i] }))
		});
		expect(names(container)).toEqual(['Blue pen', 'Green pen', 'Erase strokes', 'Undo']);
		expect(btn('Blue pen').getAttribute('aria-pressed')).toEqual('true');
	});

	it('an unlabelled pen names itself and never borrows another pen’s name', () => {
		const { container } = mount({ pens: CUSTOM });
		const found = names(container);
		expect(found).toEqual(['blue', 'green', 'Erase strokes', 'Undo']);
		expect(new Set(found).size, 'every control distinctly named').toEqual(found.length);
	});

	it('a third pen beside the two built-ins leaves the built-in names alone', () => {
		const { container } = mount({
			pens: [...DEFAULT_PENS, { id: 'blue', color: '#1d4ed8', label: 'Blue pen' }]
		});
		expect(names(container)).toEqual(['Red pen', 'Black pen', 'Blue pen', 'Erase strokes', 'Undo']);
	});
});

// review round 2 — the three pointer findings. Every case here is a pointer
// sequence the original suite never made: it always dragged inside the rect,
// always used a single pointer, and always ended with a pointerup.
describe('#394 — a stroke dragged off the base stays inside the stored box', () => {
	it('points outside the rect are clamped to [0,1], and the save round-trips through parse', async () => {
		const { container, onchange } = mount();
		// starts inside the 200×100 base, ends well past its right-bottom corner
		// — pointer capture keeps delivering the moves either way.
		await pass(container, [
			[180, 50],
			[240, 120]
		]);
		const emitted = lastEmitted(onchange);
		expect(emitted).toEqual({
			v: 1,
			strokes: [{ pen: 'red', w: DEFAULT_STROKE_WIDTH, pts: [0.9, 0.5, 1, 1] }]
		});
		for (const n of emitted.strokes[0].pts) {
			expect(n, `pts value ${n} inside the unit box`).toBeGreaterThanOrEqual(0);
			expect(n, `pts value ${n} inside the unit box`).toBeLessThanOrEqual(1);
		}
		// parse() is strict on purpose: an out-of-box value used to throw here
		// and take every other stroke in the same save with it.
		expect(parse(serialize(emitted))).toEqual(emitted);
	});

	it('a stroke leaving past the left/top edge clamps at 0, and earlier strokes survive the save', async () => {
		const { container, onchange } = mount();
		await pass(container, LINE_TOP);
		await pass(container, [
			[20, 10],
			[-60, -40]
		]);
		const emitted = lastEmitted(onchange);
		expect(emitted).toEqual({
			v: 1,
			strokes: [S1, { pen: 'red', w: DEFAULT_STROKE_WIDTH, pts: [0.1, 0.1, 0, 0] }]
		});
		expect(parse(serialize(emitted))).toEqual(emitted);
	});
});

describe('#394 — a second pointer never takes over the stroke in progress', () => {
	it('a stray touch mid-stroke contributes nothing and the drawn line still commits in full', async () => {
		const { container, onchange } = mount();
		const svg = surface(container);
		const first = { pointerType: 'mouse', pointerId: 1, isPrimary: true } as const;
		const stray = { pointerType: 'touch', pointerId: 7, isPrimary: false } as const;

		await fireEvent.pointerDown(svg, { ...first, clientX: 20, clientY: 10 });
		await fireEvent.pointerMove(svg, { ...first, clientX: 100, clientY: 10 });
		// a second finger lands and lifts while the first is still down
		await fireEvent.pointerDown(svg, { ...stray, clientX: 20, clientY: 90 });
		await fireEvent.pointerUp(svg, { ...stray, clientX: 20, clientY: 90 });
		expect(onchange, 'the stray pointer commits nothing').not.toHaveBeenCalled();
		// the first pointer's own points are still there, live
		expect(
			(surface(container).querySelector('[data-testid="live-stroke"]') as SVGPathElement).getAttribute('d')
		).toEqual('M20 10L100 10');

		await fireEvent.pointerMove(svg, { ...first, clientX: 180, clientY: 10 });
		await fireEvent.pointerUp(svg, { ...first, clientX: 180, clientY: 10 });
		expect(onchange).toHaveBeenCalledTimes(1);
		expect(lastEmitted(onchange)).toEqual({ v: 1, strokes: [S1] });
	});
});

describe('#394 — a cancelled pointer takes its live mark with it', () => {
	const liveEl = (container: HTMLElement) =>
		surface(container).querySelector('[data-testid="live-stroke"]');

	for (const cancel of ['pointerCancel', 'lostPointerCapture'] as const) {
		it(`${cancel} mid-stroke leaves no phantom path and commits nothing`, async () => {
			const { container, onchange } = mount();
			const svg = surface(container);
			await fireEvent.pointerDown(svg, { ...MOUSE, clientX: 20, clientY: 10 });
			await fireEvent.pointerMove(svg, { ...MOUSE, clientX: 100, clientY: 10 });
			expect(liveEl(container)).not.toBeNull();

			await fireEvent[cancel](svg, { ...MOUSE, clientX: 100, clientY: 10 });
			expect(liveEl(container), 'the cancelled mark is gone').toBeNull();
			expect(surface(container).querySelectorAll('path')).toHaveLength(0);
			expect(onchange).not.toHaveBeenCalled();

			// a late pointerup for the cancelled pointer commits nothing either
			await fireEvent.pointerUp(svg, { ...MOUSE, clientX: 100, clientY: 10 });
			expect(onchange).not.toHaveBeenCalled();

			// and the next stroke starts clean — none of the cancelled points
			await pass(container, LINE_BOTTOM);
			expect(lastEmitted(onchange)).toEqual({
				v: 1,
				strokes: [{ pen: 'red', w: DEFAULT_STROKE_WIDTH, pts: S2.pts }]
			});
		});
	}

	it('lostpointercapture after a normal pointerup keeps the committed stroke', async () => {
		const { container, onchange } = mount();
		const svg = surface(container);
		await pass(container, LINE_TOP);
		// the browser releases capture implicitly on pointerup, then fires this
		await fireEvent.lostPointerCapture(svg, { ...MOUSE, clientX: 180, clientY: 10 });
		expect(lastEmitted(onchange)).toEqual({ v: 1, strokes: [S1] });
		expect(surface(container).querySelectorAll('path')).toHaveLength(1);
	});
});

describe('#394 — undo', () => {
	it('undo removes the last stroke, undo again empties, then the undo button is disabled', async () => {
		const { container, onchange } = mount();
		expect(btn('Undo').disabled).toBe(true);
		await pass(container, LINE_TOP);
		await fireEvent.click(btn('Black pen'));
		await pass(container, LINE_BOTTOM);
		expect(btn('Undo').disabled).toBe(false);

		await fireEvent.click(btn('Undo'));
		expect(lastEmitted(onchange)).toEqual({ v: 1, strokes: [S1] });
		expect(surface(container).querySelectorAll('path')).toHaveLength(1);

		await fireEvent.click(btn('Undo'));
		expect(lastEmitted(onchange)).toEqual({ v: 1, strokes: [] });
		expect(surface(container).querySelectorAll('path')).toHaveLength(0);
		expect(btn('Undo').disabled).toBe(true);
	});
});

describe('#394 — erase (stroke eraser)', () => {
	it('an erase pass crossing stroke 1 removes only stroke 1; undo restores it at its place', async () => {
		const { container, onchange } = mount();
		await pass(container, LINE_TOP);
		await fireEvent.click(btn('Black pen'));
		await pass(container, LINE_BOTTOM);

		await fireEvent.click(btn('Erase strokes'));
		expect(btn('Erase strokes').getAttribute('aria-pressed')).toBe('true');
		await pass(container, [
			[100, 5],
			[100, 10],
			[100, 15]
		]);
		expect(lastEmitted(onchange)).toEqual({ v: 1, strokes: [S2] });
		expect(surface(container).querySelectorAll('path')).toHaveLength(1);

		await fireEvent.click(btn('Undo'));
		expect(lastEmitted(onchange)).toEqual({ v: 1, strokes: [S1, S2] });
	});

	it('an erase pass that touches nothing changes nothing and adds no stroke', async () => {
		const { container, onchange } = mount();
		await pass(container, LINE_TOP);
		const before = lastEmitted(onchange);
		await fireEvent.click(btn('Erase strokes'));
		await pass(container, [
			[100, 50],
			[110, 50]
		]);
		expect(lastEmitted(onchange)).toEqual(before);
		expect(surface(container).querySelectorAll('path')).toHaveLength(1);
	});
});

// REVIEW ROUND 3 (#394): the eraser measured only point-to-segment distances,
// so two coarse paths that visibly cross never met; and its reach was 7.5x the
// stroke width, so it took out neighbouring marks. Pressure was stored at full
// precision while pts were rounded, so an emitted stroke differed from its own
// serialize/parse round-trip.
describe('#394 — the eraser removes what it crosses and nothing beside it', () => {
	it('a 2-point erase pass crossing a 2-point stroke removes it', async () => {
		const { container, onchange } = mount();
		await pass(container, [
			[100, 0],
			[100, 100]
		]);
		await fireEvent.click(btn('Erase strokes'));
		await pass(container, [
			[0, 50],
			[200, 50]
		]);
		expect(lastEmitted(onchange)).toEqual({ v: 1, strokes: [] });
	});

	it('a fast flick whose points land far either side of a stroke removes it', async () => {
		const { container, onchange } = mount();
		await pass(container, LINE_TOP);
		await fireEvent.click(btn('Erase strokes'));
		await pass(container, [
			[60, 0],
			[60, 40]
		]);
		expect(lastEmitted(onchange)).toEqual({ v: 1, strokes: [] });
	});

	it('two strokes 2% of the base width apart: erasing one leaves exactly the other', async () => {
		const { container, onchange } = mount();
		await pass(container, [
			[20, 50],
			[180, 50]
		]);
		await pass(container, [
			[20, 54],
			[180, 54]
		]);
		const [first, second] = lastEmitted(onchange).strokes;
		expect(first.pts).toEqual([0.1, 0.5, 0.9, 0.5]);
		await fireEvent.click(btn('Erase strokes'));
		await pass(container, [[100, 50]]);
		expect(lastEmitted(onchange)).toEqual({ v: 1, strokes: [second] });
	});
});

describe('#394 — an emitted stroke equals its own round-trip', () => {
	it('a stylus stroke with pressure that needs rounding round-trips toEqual', async () => {
		const { container, onchange } = mount();
		await pass(
			container,
			[
				[20, 10],
				[180, 90]
			],
			{ pointerType: 'pen', pointerId: 2, isPrimary: true },
			[0.4980392156862745, 0.73333333]
		);
		const emitted = lastEmitted(onchange);
		expect(emitted.strokes[0].p).toEqual([0.498, 0.7333]);
		expect(parse(serialize(emitted))).toEqual(emitted);
	});
});

describe('#394 — render identity: same strokes → same rendering', () => {
	it('a readonly surface mounted from the serialized strokes renders the identical paths', async () => {
		const producer = mount();
		await pass(producer.container, LINE_TOP);
		await fireEvent.click(btn('Black pen'));
		await pass(producer.container, LINE_BOTTOM);
		const saved = serialize(lastEmitted(producer.onchange));
		const producedPaths = [...surface(producer.container).querySelectorAll('path')].map((p) => p.outerHTML);
		cleanup();

		const viewer = mount({ readonly: true, strokes: parse(saved) });
		const viewedPaths = [...surface(viewer.container).querySelectorAll('path')].map((p) => p.outerHTML);
		expect(viewedPaths).toHaveLength(2);
		expect(viewedPaths).toEqual(producedPaths);
	});

	// review F4: the surface used to be a unit box stretched to the element, so
	// the x and y scales differed by the base's aspect — one stored `w` came
	// out 2× thicker vertically than horizontally on this very 200×100 base,
	// and round caps came out as ellipses. The natural box makes the scale
	// uniform; the wrapper already pins the same aspect-ratio.
	it('the surface svg is the base’s natural box, scaled uniformly', () => {
		const { container } = mount();
		const svg = surface(container);
		expect(svg.getAttribute('viewBox')).toEqual('0 0 200 100');
		expect(svg.getAttribute('preserveAspectRatio')).not.toEqual('none');
	});

	it('a taller base scales strokes by ITS box, so thickness follows the same rule', async () => {
		// A4 portrait shape (1:1.414) — the aspect where the old unit-box
		// render was ~41% off between directions.
		const { container, onchange } = mount({ naturalWidth: 210, naturalHeight: 297 });
		await pass(container, LINE_TOP);
		const stroke = lastEmitted(onchange).strokes[0];
		const path = surface(container).querySelector('path') as SVGPathElement;
		expect(surface(container).getAttribute('viewBox')).toEqual('0 0 210 297');
		expect(path.getAttribute('d')).toEqual(strokePath(stroke, 210, 297));
		expect(path.getAttribute('stroke-width')).toEqual(String(DEFAULT_STROKE_WIDTH * 210));
	});
});

describe('#394 — the base is never touched', () => {
	it('the base <img> outerHTML is identical before and after drawing, undo and erase', async () => {
		const { container } = mount();
		const img = () => container.querySelector('img[data-testid="base"]') as HTMLImageElement;
		expect(img()).not.toBeNull();
		const before = img().outerHTML;

		await pass(container, LINE_TOP);
		await fireEvent.click(btn('Undo'));
		await pass(container, LINE_TOP);
		await fireEvent.click(btn('Erase strokes'));
		await pass(container, [
			[100, 5],
			[100, 15]
		]);
		await fireEvent.click(btn('Undo'));

		expect(img().outerHTML).toEqual(before);
	});
});

describe('#394 — no network', () => {
	it('fetch is never called across a whole drawing session', async () => {
		const { container } = mount();
		await pass(container, LINE_TOP);
		await fireEvent.click(btn('Black pen'));
		await pass(container, LINE_BOTTOM);
		await fireEvent.click(btn('Erase strokes'));
		await pass(container, [
			[100, 5],
			[100, 15]
		]);
		await fireEvent.click(btn('Undo'));
		await fireEvent.click(btn('Undo'));
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

describe('#394 — readonly (view mode)', () => {
	it('renders no buttons, keeps native scroll, and pointer events add nothing', async () => {
		const strokes: StrokeData = { v: 1, strokes: [S1] };
		const { container, onchange } = mount({ readonly: true, strokes });
		expect(container.querySelectorAll('button')).toHaveLength(0);
		expect(surface(container).getAttribute('style') ?? '').not.toContain('touch-action: none');
		await pass(container, LINE_BOTTOM);
		expect(onchange).not.toHaveBeenCalled();
		expect(surface(container).querySelectorAll('path')).toHaveLength(1);
	});

	it('draw mode suppresses touch panning on the surface only', () => {
		const { container } = mount();
		expect(surface(container).getAttribute('style')).toContain('touch-action: none');
	});
});

describe('#394 — controls', () => {
	it('four native buttons, each named, each at least 44px by class', () => {
		const { container } = mount();
		const buttons = [...container.querySelectorAll('button')];
		expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
			'Red pen',
			'Black pen',
			'Erase strokes',
			'Undo'
		]);
		for (const b of buttons) {
			expect(b.getAttribute('type')).toEqual('button');
			expect(b.classList.contains('min-h-11')).toBe(true);
			expect(b.classList.contains('min-w-11')).toBe(true);
		}
	});

	// review F5: all four landed as empty <button class="min-h-11 min-w-11">
	// — no glyph, no swatch, no pressed styling. The names were there, so the
	// suite passed while nothing was usable by sight.
	it('each control has a visible face: a swatch in the pen’s own colour, an eraser and an undo glyph', () => {
		const { container } = mount();
		for (const pen of DEFAULT_PENS) {
			const swatch = container.querySelector(`[data-testid="pen-swatch-${pen.id}"]`);
			expect(swatch, `${pen.id} swatch`).not.toBeNull();
			expect((swatch as HTMLElement).getAttribute('style') ?? '').toContain(pen.color);
			// decorative: the accessible name stays on the button
			expect((swatch as HTMLElement).getAttribute('aria-hidden')).toEqual('true');
		}
		expect(btn('Erase strokes').querySelector('svg[data-icon="eraser"]')).not.toBeNull();
		expect(btn('Undo').querySelector('svg[data-icon="undo"]')).not.toBeNull();
	});

	it('the pressed state carries a visible marker, not aria-pressed alone', async () => {
		mount();
		const marked = (b: HTMLButtonElement) => b.classList.contains('ring-2');
		expect(marked(btn('Red pen'))).toBe(true);
		expect(marked(btn('Black pen'))).toBe(false);
		await fireEvent.click(btn('Black pen'));
		expect(marked(btn('Red pen'))).toBe(false);
		expect(marked(btn('Black pen'))).toBe(true);
		await fireEvent.click(btn('Erase strokes'));
		expect(marked(btn('Erase strokes'))).toBe(true);
		expect(marked(btn('Black pen'))).toBe(false);
	});

	it('the undo control reads as disabled, not merely inert', () => {
		mount();
		expect(btn('Undo').disabled).toBe(true);
		expect(btn('Undo').className).toContain('disabled:opacity-60');
	});

	it('aria-pressed tracks the active pen and the erase toggle; picking a pen leaves erase mode', async () => {
		mount();
		const pressed = () => ({
			red: btn('Red pen').getAttribute('aria-pressed'),
			black: btn('Black pen').getAttribute('aria-pressed'),
			erase: btn('Erase strokes').getAttribute('aria-pressed')
		});
		expect(pressed()).toEqual({ red: 'true', black: 'false', erase: 'false' });
		await fireEvent.click(btn('Black pen'));
		expect(pressed()).toEqual({ red: 'false', black: 'true', erase: 'false' });
		await fireEvent.click(btn('Erase strokes'));
		expect(pressed().erase).toEqual('true');
		await fireEvent.click(btn('Red pen'));
		expect(pressed()).toEqual({ red: 'true', black: 'false', erase: 'false' });
	});
});

describe('#394 — the component names no feature and decides no persistence', () => {
	const SOURCES = ['src/lib/components/StrokeSurface.svelte', 'src/lib/strokes/strokes.ts'];
	const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf-8');

	it('no network, Entu, store or web-storage reference in its sources', () => {
		for (const rel of SOURCES) {
			const src = read(rel);
			expect(src, rel).not.toMatch(/\bfetch\s*\(|entu|\$lib\/stores|localStorage|sessionStorage|indexedDB/i);
		}
	});

	it('no feature word in its sources or file names', () => {
		const banned = /\b(feedback|edition|part|screenshot|pdf)\b/i;
		for (const rel of SOURCES) {
			expect(rel, 'file name').not.toMatch(banned);
			const hit = read(rel).match(banned);
			expect(hit?.[0] ?? null, rel).toBeNull();
		}
		for (const f of readdirSync(resolve(process.cwd(), 'src/lib/strokes'))) {
			expect(f).not.toMatch(banned);
		}
	});
});

// (*MVOX:Tallis* — #394 RED: StrokeSurface)
