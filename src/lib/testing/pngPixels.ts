// #408 — a minimal PNG decoder, TEST-ONLY (nothing in the app imports it).
//
// It exists so a spec can measure the ARTWORK WE COMMIT rather than artwork
// it re-renders for itself: the geometry claim that matters is about
// static/icons/*.png as they sit in the tree, and a spec that re-rasterises
// the SVG would pass even if the committed PNG were stale or hand-edited.
//
// Scope is deliberately the narrow case resvg emits and nothing else — 8-bit
// RGBA (colour type 6), non-interlaced, filter method 0. Anything else throws
// rather than guessing, so a format change surfaces as a loud failure instead
// of a silently wrong measurement.
import { inflateSync } from 'node:zlib';

export interface DecodedPng {
	width: number;
	height: number;
	/** Row-major RGBA, 4 bytes per pixel, no row padding. */
	data: Buffer;
}

/** Decodes an 8-bit RGBA non-interlaced PNG. Throws on any other shape. */
export function decodePng(png: Buffer): DecodedPng {
	const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	if (!png.subarray(0, 8).equals(SIGNATURE)) {
		throw new Error('decodePng: not a PNG (bad signature)');
	}

	let width = 0;
	let height = 0;
	let bitDepth = 0;
	let colorType = 0;
	let interlace = 0;
	const idatChunks: Buffer[] = [];

	// Chunk layout: 4-byte length, 4-byte type, `length` bytes of data, 4-byte CRC.
	let offset = 8;
	while (offset + 8 <= png.length) {
		const length = png.readUInt32BE(offset);
		const type = png.toString('ascii', offset + 4, offset + 8);
		const data = png.subarray(offset + 8, offset + 8 + length);
		if (type === 'IHDR') {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			bitDepth = data[8];
			colorType = data[9];
			interlace = data[12];
		} else if (type === 'IDAT') {
			idatChunks.push(data);
		} else if (type === 'IEND') {
			break;
		}
		offset += 12 + length;
	}

	if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
		throw new Error(
			`decodePng: unsupported PNG (bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace}); only 8-bit RGBA non-interlaced is handled`
		);
	}

	// Each scanline in the inflated stream is one filter-type byte followed by
	// `stride` filtered bytes; undo the filter against the already-reconstructed
	// pixel to the left (a) and the one above (b) / above-left (c).
	const raw = inflateSync(Buffer.concat(idatChunks));
	const bpp = 4;
	const stride = width * bpp;
	if (raw.length < height * (stride + 1)) {
		throw new Error('decodePng: truncated image data');
	}

	const out = Buffer.alloc(height * stride);
	const zeroRow = Buffer.alloc(stride);
	for (let y = 0; y < height; y++) {
		const rowStart = y * (stride + 1);
		const filterType = raw[rowStart];
		const line = raw.subarray(rowStart + 1, rowStart + 1 + stride);
		const cur = out.subarray(y * stride, (y + 1) * stride);
		const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : zeroRow;
		for (let i = 0; i < stride; i++) {
			const a = i >= bpp ? cur[i - bpp] : 0;
			const b = prev[i];
			const c = i >= bpp ? prev[i - bpp] : 0;
			let value = line[i];
			if (filterType === 1) {
				value += a;
			} else if (filterType === 2) {
				value += b;
			} else if (filterType === 3) {
				value += (a + b) >> 1;
			} else if (filterType === 4) {
				// Paeth: pick whichever of a/b/c the linear predictor is closest to.
				const p = a + b - c;
				const pa = Math.abs(p - a);
				const pb = Math.abs(p - b);
				const pc = Math.abs(p - c);
				value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			} else if (filterType !== 0) {
				throw new Error(`decodePng: unknown filter type ${filterType} on row ${y}`);
			}
			cur[i] = value & 0xff;
		}
	}

	return { width, height, data: out };
}

/**
 * The distance, in pixels, from the image centre to the FURTHEST "ink" pixel —
 * ink being anything darker than the midpoint between the mark colour and the
 * paper background, so antialiased edges do not count as ink.
 *
 * Returns 0 when the image carries no ink at all.
 */
export function maxInkRadius(png: DecodedPng, inkLuminanceBelow: number): number {
	const centerX = png.width / 2;
	const centerY = png.height / 2;
	let maxRadius = 0;
	for (let y = 0; y < png.height; y++) {
		for (let x = 0; x < png.width; x++) {
			const i = (y * png.width + x) * 4;
			// Rec. 601 luma — the same weighting browsers and image tools use for
			// "how dark does this read".
			const luminance = 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2];
			if (luminance >= inkLuminanceBelow) continue;
			// +0.5: measure from the pixel's centre, not its top-left corner.
			const radius = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
			if (radius > maxRadius) maxRadius = radius;
		}
	}
	return maxRadius;
}
