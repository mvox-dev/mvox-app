<!-- One pen-marks surface over any base snippet; persistence stays with the consumer. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import EraserIcon from './icons/EraserIcon.svelte';
	import UndoIcon from './icons/UndoIcon.svelte';
	import { DEFAULT_PENS, DEFAULT_STROKE_WIDTH, strokePath, type Stroke, type StrokeData } from '$lib/strokes/strokes';

	// `label` is the accessible name; without one a built-in id gets its translated name and any
	// other id names itself, never another pen's name.
	type Pen = { id: string; color: string; label?: string };

	// An `erase` keeps what it removed and where, so undo restores each stroke at its own index.
	type Op = { kind: 'add' } | { kind: 'erase'; removed: { index: number; stroke: Stroke }[] };

	// Half the default stroke width plus a touch tolerance, as a fraction of the base's width:
	// two marks 2% of the width apart (about 4mm on A4) are erased one at a time.
	const ERASE_THRESHOLD = DEFAULT_STROKE_WIDTH / 2 + 0.004;

	// aria-pressed alone is invisible, so an active pen or armed eraser also carries a ring.
	const PRESSED_CLASS = 'border-ink bg-paper-3 ring-2 ring-ink';
	const CONTROL_CLASS =
		'flex min-h-11 min-w-11 items-center justify-center rounded border border-ink-4 bg-paper text-ink disabled:cursor-default disabled:opacity-60';

	let {
		base,
		naturalWidth,
		naturalHeight,
		pens = DEFAULT_PENS,
		strokes = $bindable({ v: 1, strokes: [] }),
		readonly = false,
		activePenId = $bindable(pens[0]?.id ?? ''),
		onchange
	}: {
		base: Snippet;
		naturalWidth: number;
		naturalHeight: number;
		pens?: Pen[];
		strokes?: StrokeData;
		readonly?: boolean;
		activePenId?: string;
		onchange?: (strokes: StrokeData) => void;
	} = $props();

	let eraseMode = $state(false);
	let history = $state<Op[]>([]);

	let svgEl: SVGSVGElement | undefined;

	// $state because the stroke must appear under the pen as it is made, not on pointerup.
	let drawing = $state(false);
	let drawPts = $state<number[]>([]);
	let capturedPointerId: number | null = null;
	let capturedPointerType = '';
	let drawPressures: number[] | null = null;

	// One finger draws, two fingers pinch-zoom and pan the page.
	const svgStyle = $derived(
		`position: absolute; inset: 0; width: 100%; height: 100%;${readonly ? '' : ' touch-action: pinch-zoom;'}`
	);

	// The stored box is [0,1]x[0,1] but the rendered box is not square: this puts y in x's unit.
	const yPerX = $derived(naturalWidth === 0 ? 1 : naturalHeight / naturalWidth);

	const liveStroke = $derived<Stroke | null>(
		drawing && !eraseMode && drawPts.length > 0
			? { pen: activePenId, w: DEFAULT_STROKE_WIDTH, pts: drawPts }
			: null
	);

	function penColor(id: string): string {
		return pens.find((p) => p.id === id)?.color ?? pens[0]?.color ?? '#000000';
	}

	function penLabel(pen: Pen): string {
		if (pen.label) return pen.label;
		if (pen.id === 'red') return m.strokes_pen_red_aria_label();
		if (pen.id === 'black') return m.strokes_pen_black_aria_label();
		return pen.id;
	}

	function round4(n: number): number {
		return Math.round(n * 10000) / 10000;
	}

	function clamp01(n: number): number {
		return Math.min(1, Math.max(0, n));
	}

	// Clamped: capture keeps delivering moves off the base, and parse() rejects a point outside
	// [0,1], losing the whole save. A mark that runs off the base stops at the edge.
	function unitPoint(e: PointerEvent): [number, number] {
		const rect = (svgEl as SVGSVGElement).getBoundingClientRect();
		const x = rect.width === 0 ? 0 : (e.clientX - rect.left) / rect.width;
		const y = rect.height === 0 ? 0 : (e.clientY - rect.top) / rect.height;
		return [round4(clamp01(x)), round4(clamp01(y))];
	}

	function setStrokes(list: Stroke[]): void {
		strokes = { v: 1, strokes: list };
		onchange?.(strokes);
	}

	function selectPen(id: string): void {
		activePenId = id;
		eraseMode = false;
	}

	function toggleErase(): void {
		eraseMode = !eraseMode;
	}

	function commitDraw(): void {
		if (drawPts.length === 0) return;
		const stroke: Stroke = { pen: activePenId, w: DEFAULT_STROKE_WIDTH, pts: [...drawPts] };
		if (drawPressures) stroke.p = [...drawPressures];
		setStrokes([...strokes.strokes, stroke]);
		history.push({ kind: 'add' });
	}

	function pointSegDist(
		px: number,
		py: number,
		x1: number,
		y1: number,
		x2: number,
		y2: number
	): number {
		const dx = x2 - x1;
		const dy = y2 - y1;
		const lenSq = dx * dx + dy * dy;
		const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
		const cx = x1 + t * dx;
		const cy = y1 + t * dy;
		return Math.hypot(px - cx, py - cy);
	}

	function segmentsCross(
		ax1: number,
		ay1: number,
		ax2: number,
		ay2: number,
		bx1: number,
		by1: number,
		bx2: number,
		by2: number
	): boolean {
		const side = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
			Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
		const d1 = side(bx1, by1, bx2, by2, ax1, ay1);
		const d2 = side(bx1, by1, bx2, by2, ax2, ay2);
		const d3 = side(ax1, ay1, ax2, ay2, bx1, by1);
		const d4 = side(ax1, ay1, ax2, ay2, bx2, by2);
		// Collinear and touching cases fall to segSegDist's endpoint distances, which are 0 there.
		return d1 * d2 < 0 && d3 * d4 < 0;
	}

	function segSegDist(
		ax1: number,
		ay1: number,
		ax2: number,
		ay2: number,
		bx1: number,
		by1: number,
		bx2: number,
		by2: number
	): number {
		if (segmentsCross(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2)) return 0;
		return Math.min(
			pointSegDist(ax1, ay1, bx1, by1, bx2, by2),
			pointSegDist(ax2, ay2, bx1, by1, bx2, by2),
			pointSegDist(bx1, by1, ax1, ay1, ax2, ay2),
			pointSegDist(bx2, by2, ax1, ay1, ax2, ay2)
		);
	}

	// Without the y scaling the eraser would reach further vertically than horizontally.
	function erasePoints(pts: number[]): number[] {
		const out = new Array<number>(pts.length);
		for (let i = 0; i < pts.length; i += 2) {
			out[i] = pts[i];
			out[i + 1] = pts[i + 1] * yPerX;
		}
		return out;
	}

	// Segment against segment, so two coarse paths that visibly cross always meet however far
	// apart their sampled points are. A 1-point list is a zero-length segment.
	function pathHits(s: number[], eraserPts: number[]): boolean {
		const sSegs = Math.max(1, s.length / 2 - 1);
		const eSegs = Math.max(1, eraserPts.length / 2 - 1);
		const at = (pts: number[], i: number) => Math.min(i, pts.length / 2 - 1) * 2;
		for (let si = 0; si < sSegs; si++) {
			const s1 = at(s, si);
			const s2 = at(s, si + 1);
			for (let ei = 0; ei < eSegs; ei++) {
				const e1 = at(eraserPts, ei);
				const e2 = at(eraserPts, ei + 1);
				const d = segSegDist(
					s[s1],
					s[s1 + 1],
					s[s2],
					s[s2 + 1],
					eraserPts[e1],
					eraserPts[e1 + 1],
					eraserPts[e2],
					eraserPts[e2 + 1]
				);
				if (d <= ERASE_THRESHOLD) return true;
			}
		}
		return false;
	}

	function commitErase(): void {
		if (drawPts.length === 0) return;
		const eraser = erasePoints([...drawPts]);
		const removed: { index: number; stroke: Stroke }[] = [];
		const kept: Stroke[] = [];
		strokes.strokes.forEach((stroke, index) => {
			if (pathHits(erasePoints(stroke.pts), eraser)) removed.push({ index, stroke });
			else kept.push(stroke);
		});
		if (removed.length === 0) return;
		setStrokes(kept);
		history.push({ kind: 'erase', removed });
	}

	function undo(): void {
		const op = history.pop();
		if (!op) return;
		if (op.kind === 'add') {
			setStrokes(strokes.strokes.slice(0, -1));
			return;
		}
		const list = [...strokes.strokes];
		for (const { index, stroke } of [...op.removed].sort((a, b) => a.index - b.index)) {
			list.splice(index, 0, stroke);
		}
		setStrokes(list);
	}

	function handlePointerDown(e: PointerEvent): void {
		if (readonly) return;
		// A second finger is a pinch or pan: the finger stroke is dropped. Otherwise one stroke at a
		// time, so another pointer never orphans the first one's pointerup.
		if (e.pointerType === 'touch' && !e.isPrimary) {
			if (drawing && capturedPointerType === 'touch') abortStroke();
			return;
		}
		if (drawing) return;
		drawing = true;
		capturedPointerId = e.pointerId;
		capturedPointerType = e.pointerType;
		svgEl?.setPointerCapture(e.pointerId);
		const [x, y] = unitPoint(e);
		drawPts = [x, y];
		// Rounded like pts, so the emitted stroke equals parse(serialize(emitted)).
		drawPressures = !eraseMode && e.pointerType === 'pen' ? [round4(clamp01(e.pressure))] : null;
	}

	function handlePointerMove(e: PointerEvent): void {
		if (!drawing || e.pointerId !== capturedPointerId) return;
		const [x, y] = unitPoint(e);
		drawPts.push(x, y);
		drawPressures?.push(round4(clamp01(e.pressure)));
	}

	function endStroke(): void {
		drawing = false;
		capturedPointerId = null;
		drawPts = [];
		drawPressures = null;
	}

	function handlePointerUp(e: PointerEvent): void {
		if (!drawing || e.pointerId !== capturedPointerId) return;
		if (eraseMode) commitErase();
		else commitDraw();
		endStroke();
	}

	function abortStroke(): void {
		const id = capturedPointerId as number;
		if (svgEl?.hasPointerCapture(id)) svgEl.releasePointerCapture(id);
		endStroke();
	}

	// The pointer left without a pointerup: commit nothing, or a phantom stroke stays on screen.
	function handlePointerAbort(e: PointerEvent): void {
		if (!drawing || e.pointerId !== capturedPointerId) return;
		abortStroke();
	}

	// touch-action alone does not hold the page under a finger on iOS Safari (#825). Two fingers
	// still pass. Svelte's own ontouchmove is passive and could not cancel the move.
	function holdPage(svg: SVGSVGElement) {
		const hold = (e: TouchEvent) => {
			if (!readonly && e.touches.length === 1) e.preventDefault();
		};
		svg.addEventListener('touchmove', hold, { passive: false });
		return () => svg.removeEventListener('touchmove', hold);
	}
</script>

<div style={`position: relative; aspect-ratio: ${naturalWidth} / ${naturalHeight};`}>
	{@render base()}
	<svg
		bind:this={svgEl}
		data-testid="stroke-surface"
		role="presentation"
		viewBox={`0 0 ${naturalWidth} ${naturalHeight}`}
		preserveAspectRatio="xMidYMid meet"
		style={svgStyle}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerAbort}
		onlostpointercapture={handlePointerAbort}
		{@attach holdPage}
	>
		{#each strokes.strokes as stroke, i (i)}
			<path
				d={strokePath(stroke, naturalWidth, naturalHeight)}
				stroke={penColor(stroke.pen)}
				stroke-width={stroke.w * naturalWidth}
				fill="none"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		{/each}
		{#if liveStroke}
			<path
				data-testid="live-stroke"
				d={strokePath(liveStroke, naturalWidth, naturalHeight)}
				stroke={penColor(liveStroke.pen)}
				stroke-width={liveStroke.w * naturalWidth}
				fill="none"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		{/if}
	</svg>
</div>
{#if !readonly}
	<div class="flex gap-1">
		{#each pens as pen (pen.id)}
			<button
				type="button"
				class="{CONTROL_CLASS} {activePenId === pen.id && !eraseMode ? PRESSED_CLASS : ''}"
				aria-label={penLabel(pen)}
				aria-pressed={activePenId === pen.id && !eraseMode}
				onclick={() => selectPen(pen.id)}
			>
				<span
					data-testid={`pen-swatch-${pen.id}`}
					class="h-5 w-5 rounded-full border border-ink-4"
					style={`background-color: ${pen.color};`}
					aria-hidden="true"
				></span>
			</button>
		{/each}
		<button
			type="button"
			class="{CONTROL_CLASS} {eraseMode ? PRESSED_CLASS : ''}"
			aria-label={m.strokes_erase_aria_label()}
			aria-pressed={eraseMode}
			onclick={toggleErase}
		>
			<EraserIcon class="h-5 w-5" />
		</button>
		<button
			type="button"
			class={CONTROL_CLASS}
			aria-label={m.strokes_undo_aria_label()}
			disabled={history.length === 0}
			onclick={undo}
		>
			<UndoIcon class="h-5 w-5" />
		</button>
	</div>
{/if}

<!-- (*MVOX:Byrd*) (*MVOX:Josquin*) -->
