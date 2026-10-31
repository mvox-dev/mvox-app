// The overlay the MCP draws must match what the app's StrokeSurface draws for the same strokes.
import { describe, expect, it } from 'vitest';
import { DEFAULT_PENS, strokePath, type StrokeData } from '../../src/lib/strokes/strokes.ts';
import { strokesSvg } from './src/drawing.ts';

const W = 800;
const H = 600;
const data: StrokeData = {
	v: 1,
	strokes: [
		{ pen: 'red', w: 0.004, pts: [0.1, 0.2, 0.5, 0.5, 0.9, 0.1] },
		{ pen: 'black', w: 0.01, pts: [0.3, 0.3] },
		{ pen: 'chartreuse', w: 0.002, pts: [0.7, 0.7, 0.8, 0.9] }
	]
};

describe('strokesSvg', () => {
	const svg = strokesSvg(JSON.stringify(data), W, H);

	it('sizes the canvas to the screenshot', () => {
		expect(svg).toContain(`width="${W}"`);
		expect(svg).toContain(`height="${H}"`);
		expect(svg).toContain(`viewBox="0 0 ${W} ${H}"`);
	});

	it('draws each stroke as the app does, with round caps and joins', () => {
		for (const s of data.strokes) expect(svg).toContain(`d="${strokePath(s, W, H)}"`);
		expect(svg.match(/<path /g)).toHaveLength(3);
		expect(svg.match(/stroke-linecap="round"/g)).toHaveLength(3);
		expect(svg.match(/stroke-linejoin="round"/g)).toHaveLength(3);
		expect(svg).toContain(`stroke-width="${0.01 * W}"`);
	});

	it('uses the app pen colours and the first pen for an unknown id', () => {
		const [red, black] = DEFAULT_PENS;
		const colours = [...svg.matchAll(/<path [^>]*stroke="([^"]+)"/g)].map((m) => m[1]);
		expect(colours).toEqual([red.color, black.color, red.color]);
	});

	it('refuses strokes that are not stroke JSON', () => {
		expect(() => strokesSvg('nope', W, H)).toThrow('strokes: not valid JSON');
		expect(() => strokesSvg('{"v":2,"strokes":[]}', W, H)).toThrow('strokes: unknown version 2');
	});
});
