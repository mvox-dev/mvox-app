// The singer's strokes as an SVG overlay, drawn the way the app's StrokeSurface draws them.
const PENS = [
	{ id: 'red', color: '#dc2626' },
	{ id: 'black', color: '#111827' }
];

type Stroke = { pen: string; w: number; pts: number[] };

const round4 = (n: number) => Math.round(n * 10000) / 10000;

function readStrokes(text: string): Stroke[] {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new Error('strokes: not valid JSON');
	}
	if (typeof raw !== 'object' || raw === null) throw new Error('strokes: root is not an object');
	const obj = raw as Record<string, unknown>;
	if (obj.v !== 1) throw new Error(`strokes: unknown version ${JSON.stringify(obj.v)}`);
	if (!Array.isArray(obj.strokes)) throw new Error('strokes: strokes is not an array');
	return obj.strokes.map((entry, i) => {
		const s = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
		if (typeof s.pen !== 'string') throw new Error(`strokes: stroke ${i} has no pen`);
		if (typeof s.w !== 'number' || !Number.isFinite(s.w) || s.w <= 0) {
			throw new Error(`strokes: stroke ${i} has no usable w (${JSON.stringify(s.w)})`);
		}
		const pts = s.pts;
		if (!Array.isArray(pts) || pts.length === 0 || pts.length % 2 !== 0) {
			throw new Error(`strokes: stroke ${i} has malformed pts`);
		}
		if (!pts.every((n) => typeof n === 'number' && Number.isFinite(n))) {
			throw new Error(`strokes: stroke ${i} has malformed pts`);
		}
		return { pen: s.pen, w: s.w, pts: pts as number[] };
	});
}

function pathData(pts: number[], width: number, height: number): string {
	const at = (i: number) => `${round4(pts[i * 2] * width)} ${round4(pts[i * 2 + 1] * height)}`;
	const count = pts.length / 2;
	if (count <= 1) return `M${at(0)}L${at(0)}`;
	let d = `M${at(0)}`;
	for (let i = 1; i < count; i++) d += `L${at(i)}`;
	return d;
}

export function strokesSvg(strokesJson: string, width: number, height: number): string {
	const paths = readStrokes(strokesJson).map((s) => {
		const color = PENS.find((p) => p.id === s.pen)?.color ?? PENS[0].color;
		return (
			`<path d="${pathData(s.pts, width, height)}" stroke="${color}" ` +
			`stroke-width="${s.w * width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
		);
	});
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
		`viewBox="0 0 ${width} ${height}">${paths.join('')}</svg>`
	);
}
