// composeDrawing with real sharp: a stroke changes the pixels under it and nowhere else.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { composeDrawing } from './src/image.ts';

type Sharp = (input: unknown) => {
	png(): { toBuffer(): Promise<Buffer> };
	raw(): { toBuffer(): Promise<Buffer> };
};
let sharp: Sharp | null = null;
try {
	sharp = createRequire(import.meta.url)('sharp') as Sharp;
} catch {
	sharp = null;
}

const pixel = (raw: Buffer, x: number, y: number, width: number) =>
	[...raw.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];

describe.skipIf(sharp === null)('composeDrawing', () => {
	it('draws the stroke in the pen colour at its position, leaving the rest alone', async () => {
		const white = await sharp!({
			create: { width: 40, height: 20, channels: 4, background: '#ffffff' }
		})
			.png()
			.toBuffer();
		const layer = JSON.stringify({ v: 1, strokes: [{ pen: 'red', w: 0.1, pts: [0.1, 0.5, 0.9, 0.5] }] });
		const out = await composeDrawing(white, layer);
		const raw = await sharp!(out).raw().toBuffer();
		expect(pixel(raw, 20, 10, 40)).toEqual([0xdc, 0x26, 0x26, 255]);
		expect(pixel(raw, 20, 1, 40)).toEqual([255, 255, 255, 255]);
	});
});
