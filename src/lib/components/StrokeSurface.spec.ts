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
//     pens           {id, color}[] — default DEFAULT_PENS (red + black).
//     strokes        $bindable StrokeData.
//     readonly       view mode: no controls, no pointer capture, native scroll.
//     onchange?      (strokes: StrokeData) => void, after every add/erase/undo.
//
//   RENDER  an absolutely positioned <svg data-testid="stroke-surface"
//           viewBox="0 0 1 1" preserveAspectRatio="none"> over the base, one
//           <path> per visible stroke: d = strokePath(stroke), stroke = the
//           pen's colour. `touch-action: none` on the svg only in draw mode.
//   POINTER pointerdown/move/up on the svg, setPointerCapture, coordinates
//           mapped via getBoundingClientRect to [0,1], rounded to 4 decimals.
//           `p` is recorded only for pointerType "pen" (a mouse/touch stroke
//           carries no `p` key).
//   ERASE   stroke eraser: a pass in erase mode removes every stroke its path
//           touches. The saved set holds visible strokes only.
//   UNDO    in-memory history (add stroke, erase set); undo reverses the last
//           op; an erased stroke comes back at its original index. The
//           history is never serialized.
//   CONTROLS native <button type="button">, min-h-11 min-w-11: one per pen
//           (aria-pressed), erase toggle (aria-pressed), undo (disabled when
//           history empty). Picking a pen leaves erase mode.
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

	it('one <path> per stroke: d = strokePath, stroke = the pen colour', async () => {
		const { container } = mount();
		await pass(container, LINE_TOP);
		await fireEvent.click(btn('Black pen'));
		await pass(container, LINE_BOTTOM);
		const paths = [...surface(container).querySelectorAll('path')].map((p) => ({
			d: p.getAttribute('d'),
			stroke: p.getAttribute('stroke')
		}));
		const colour = (id: string) => DEFAULT_PENS.find((p) => p.id === id)?.color;
		expect(paths).toEqual([
			{ d: strokePath(S1), stroke: colour('red') },
			{ d: strokePath(S2), stroke: colour('black') }
		]);
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

	it('the surface is a unit-box svg stretched over the base', () => {
		const { container } = mount();
		const svg = surface(container);
		expect(svg.getAttribute('viewBox')).toEqual('0 0 1 1');
		expect(svg.getAttribute('preserveAspectRatio')).toEqual('none');
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
