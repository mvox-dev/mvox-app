// sharp is a service-only dependency: a computed specifier keeps tsc and vitest from resolving it.
type SharpImage = {
	metadata(): Promise<{ width?: number }>;
	resize(options: { width: number }): SharpImage;
	png(options: { compressionLevel: number }): SharpImage;
	toBuffer(): Promise<Uint8Array>;
};
type Sharp = (input: Uint8Array) => SharpImage;

const SHARP = 'sharp';
const MIN_WIDTH = 200;

export async function downscaleToFit(png: Uint8Array, maxBytes: number): Promise<Uint8Array> {
	const sharp = ((await import(SHARP)) as { default: Sharp }).default;
	let width = (await sharp(png).metadata()).width ?? 2000;
	let out = png;
	while (out.length > maxBytes && width > MIN_WIDTH) {
		width = Math.floor(width * 0.8);
		out = await sharp(png).resize({ width }).png({ compressionLevel: 9 }).toBuffer();
	}
	if (out.length > maxBytes) throw new Error(`screenshot still over ${maxBytes} bytes`);
	return out;
}

export async function composeDrawing(_png: Uint8Array, _strokesJson: string): Promise<Uint8Array> {
	throw new Error('composeDrawing: not implemented');
}
