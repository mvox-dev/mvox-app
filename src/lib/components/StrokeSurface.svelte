<script lang="ts">
	// #394 GREEN — ONE pen-marks surface over ANY base. See
	// StrokeSurface.spec.ts for the full contract this implements.
	//
	// The base is a Snippet the consumer renders and this component never
	// touches; the surface only positions an SVG over it and holds the
	// strokes. Persistence, entity shape and feature naming stay entirely
	// with whoever adopts this component.
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { DEFAULT_PENS, DEFAULT_STROKE_WIDTH, strokePath, type Stroke, type StrokeData } from '$lib/strokes/strokes';

	type Pen = { id: string; color: string };

	// One undo step. An `add` reverses by dropping the last stroke; an
	// `erase` remembers what it removed and where, so undo puts every
	// erased stroke back at its original index. Never serialized.
	type Op = { kind: 'add' } | { kind: 'erase'; removed: { index: number; stroke: Stroke }[] };

	// How close an eraser pass must come to a stroke's path to remove it —
	// a fraction of the unit box, well inside a typical stroke's own visual
	// width and comfortably below the gap between two distinct strokes.
	const ERASE_THRESHOLD = 0.03;

	let {
		base,
		naturalWidth,
		naturalHeight,
		pens = DEFAULT_PENS,
		strokes = $bindable({ v: 1, strokes: [] }),
		readonly = false,
		onchange
	}: {
		base: Snippet;
		naturalWidth: number;
		naturalHeight: number;
		pens?: Pen[];
		strokes?: StrokeData;
		readonly?: boolean;
		onchange?: (strokes: StrokeData) => void;
	} = $props();

	// The initial pen only — a later change to the `pens` prop never
	// reassigns the active pick, so this is a one-time snapshot, not a
	// derived value; `untrack` says so to the compiler.
	let activePenId = $state(untrack(() => pens[0]?.id ?? ''));
	let eraseMode = $state(false);
	let history = $state<Op[]>([]);

	let svgEl: SVGSVGElement | undefined;

	// Imperative pointer bookkeeping — never read by the template, so a
	// plain closure variable, not $state.
	let drawing = false;
	let capturedPointerId: number | null = null;
	let drawPts: number[] = [];
	let drawPressures: number[] | null = null;

	const svgStyle = $derived(
		`position: absolute; inset: 0; width: 100%; height: 100%;${readonly ? '' : ' touch-action: none;'}`
	);

	function penColor(id: string): string {
		return pens.find((p) => p.id === id)?.color ?? pens[0]?.color ?? '#000000';
	}

	function penLabel(id: string): string {
		return id === 'black' ? m.strokes_pen_black_aria_label() : m.strokes_pen_red_aria_label();
	}

	function round4(n: number): number {
		return Math.round(n * 10000) / 10000;
	}

	function unitPoint(e: PointerEvent): [number, number] {
		const rect = (svgEl as SVGSVGElement).getBoundingClientRect();
		const x = rect.width === 0 ? 0 : (e.clientX - rect.left) / rect.width;
		const y = rect.height === 0 ? 0 : (e.clientY - rect.top) / rect.height;
		return [round4(x), round4(y)];
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

	/** Closest distance from point (px,py) to the segment (x1,y1)-(x2,y2). */
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

	/** Whether an eraser pass (flat x,y pairs) touches a stroke's own path —
	 * checked both ways, so a coarse stroke crossed by a fine eraser path
	 * and a coarse eraser pass grazing a fine stroke both register. */
	function pathHits(stroke: Stroke, eraserPts: number[]): boolean {
		const s = stroke.pts;
		const sCount = s.length / 2;
		const eCount = eraserPts.length / 2;
		for (let ei = 0; ei < eCount; ei++) {
			const ex = eraserPts[ei * 2];
			const ey = eraserPts[ei * 2 + 1];
			if (sCount === 1) {
				if (Math.hypot(ex - s[0], ey - s[1]) <= ERASE_THRESHOLD) return true;
				continue;
			}
			for (let si = 0; si < sCount - 1; si++) {
				const d = pointSegDist(ex, ey, s[si * 2], s[si * 2 + 1], s[(si + 1) * 2], s[(si + 1) * 2 + 1]);
				if (d <= ERASE_THRESHOLD) return true;
			}
		}
		for (let si = 0; si < sCount; si++) {
			const sx = s[si * 2];
			const sy = s[si * 2 + 1];
			for (let ei = 0; ei < eCount - 1; ei++) {
				const d = pointSegDist(
					sx,
					sy,
					eraserPts[ei * 2],
					eraserPts[ei * 2 + 1],
					eraserPts[(ei + 1) * 2],
					eraserPts[(ei + 1) * 2 + 1]
				);
				if (d <= ERASE_THRESHOLD) return true;
			}
		}
		return false;
	}

	function commitErase(): void {
		if (drawPts.length === 0) return;
		const removed: { index: number; stroke: Stroke }[] = [];
		const kept: Stroke[] = [];
		strokes.strokes.forEach((stroke, index) => {
			if (pathHits(stroke, drawPts)) removed.push({ index, stroke });
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
		drawing = true;
		capturedPointerId = e.pointerId;
		svgEl?.setPointerCapture(e.pointerId);
		const [x, y] = unitPoint(e);
		drawPts = [x, y];
		drawPressures = !eraseMode && e.pointerType === 'pen' ? [e.pressure] : null;
	}

	function handlePointerMove(e: PointerEvent): void {
		if (!drawing || e.pointerId !== capturedPointerId) return;
		const [x, y] = unitPoint(e);
		drawPts.push(x, y);
		drawPressures?.push(e.pressure);
	}

	function handlePointerUp(e: PointerEvent): void {
		if (!drawing || e.pointerId !== capturedPointerId) return;
		if (eraseMode) commitErase();
		else commitDraw();
		drawing = false;
		capturedPointerId = null;
		drawPts = [];
		drawPressures = null;
	}
</script>

<div style={`position: relative; aspect-ratio: ${naturalWidth} / ${naturalHeight};`}>
	{@render base()}
	<svg
		bind:this={svgEl}
		data-testid="stroke-surface"
		role="presentation"
		viewBox="0 0 1 1"
		preserveAspectRatio="none"
		style={svgStyle}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
	>
		{#each strokes.strokes as stroke, i (i)}
			<path
				d={strokePath(stroke)}
				stroke={penColor(stroke.pen)}
				stroke-width={stroke.w}
				fill="none"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		{/each}
	</svg>
</div>
{#if !readonly}
	<div class="flex gap-1">
		{#each pens as pen (pen.id)}
			<button
				type="button"
				class="min-h-11 min-w-11"
				aria-label={penLabel(pen.id)}
				aria-pressed={activePenId === pen.id && !eraseMode}
				onclick={() => selectPen(pen.id)}
			></button>
		{/each}
		<button
			type="button"
			class="min-h-11 min-w-11"
			aria-label={m.strokes_erase_aria_label()}
			aria-pressed={eraseMode}
			onclick={toggleErase}
		></button>
		<button
			type="button"
			class="min-h-11 min-w-11"
			aria-label={m.strokes_undo_aria_label()}
			disabled={history.length === 0}
			onclick={undo}
		></button>
	</div>
{/if}

<!-- (*MVOX:Byrd* — #394 GREEN: StrokeSurface, the one drawing component) -->
