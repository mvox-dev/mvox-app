<script lang="ts">
	// #394 GREEN — ONE pen-marks surface over ANY base. See
	// StrokeSurface.spec.ts for the full contract this implements.
	//
	// The base is a Snippet the consumer renders and this component never
	// touches; the surface only positions an SVG over it and holds the
	// strokes. Persistence, entity shape and feature naming stay entirely
	// with whoever adopts this component.
	//
	// REVIEW ROUND (#394, four code findings):
	//   F1 the stroke under the pen is drawn WHILE the pointer moves — the
	//      live points are $state and the template renders them, instead of
	//      nothing appearing until pointerup.
	//   F2 a pen's accessible name comes from the pen data (`label`), so the
	//      `pens` prop is an honest open API — it no longer resolves every
	//      unknown id to "Red pen".
	//   F4 the surface renders in the base's NATURAL box, not a unit box
	//      stretched by preserveAspectRatio="none": one stored `w` is now one
	//      thickness in every direction, round caps are round, and the
	//      eraser's reach is the same distance horizontally and vertically.
	//   F5 every control has a visible face: a colour swatch per pen, an
	//      eraser and an undo glyph, a visible pressed marker and a visible
	//      disabled state — four blank boxes were unusable by sight.
	//
	// REVIEW ROUND 2 (#394, three pointer findings — all in unitPoint and the
	// pointer handlers):
	//   R2-F1 captured coordinates are clamped to [0,1]: a stroke dragged off
	//         the base used to store out-of-box values that parse() then
	//         rejected, losing the whole save.
	//   R2-F2 a second pointer mid-stroke is ignored instead of taking the
	//         stroke over and discarding the points drawn so far.
	//   R2-F3 pointercancel / lostpointercapture abort the stroke, so a
	//         cancelled pointer takes its live mark with it.
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import EraserIcon from './icons/EraserIcon.svelte';
	import UndoIcon from './icons/UndoIcon.svelte';
	import { DEFAULT_PENS, DEFAULT_STROKE_WIDTH, strokePath, type Stroke, type StrokeData } from '$lib/strokes/strokes';

	// `label` is the control's accessible name, supplied by the consumer
	// alongside its own colours. Without one, the two built-in ids carry the
	// surface's own translated names and any other id names itself — never
	// another pen's name (#394 review F2).
	type Pen = { id: string; color: string; label?: string };

	// One undo step. An `add` reverses by dropping the last stroke; an
	// `erase` remembers what it removed and where, so undo puts every
	// erased stroke back at its original index. Never serialized.
	type Op = { kind: 'add' } | { kind: 'erase'; removed: { index: number; stroke: Stroke }[] };

	// How close an eraser pass must come to a stroke's path to remove it — a
	// fraction of the base's WIDTH, measured in a space where one unit means
	// the same distance in x and in y (see erasePoints), well inside a typical
	// stroke's own visual width and comfortably below the gap between two
	// distinct strokes.
	const ERASE_THRESHOLD = 0.03;

	// The visible pressed marker: aria-pressed alone is invisible, so an
	// active pen and an armed eraser also carry a ring (the pressed-chip
	// shape already used on the agenda).
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

	// Pointer bookkeeping. `drawing` and `drawPts` ARE read by the template
	// (through liveStroke), so they are $state: the stroke has to appear under
	// the pen as it is made, not on pointerup (#394 review F1).
	let drawing = $state(false);
	let drawPts = $state<number[]>([]);
	let capturedPointerId: number | null = null;
	let drawPressures: number[] | null = null;

	const svgStyle = $derived(
		`position: absolute; inset: 0; width: 100%; height: 100%;${readonly ? '' : ' touch-action: none;'}`
	);

	// y measured in the same unit as x: the stored box is [0,1]×[0,1] but the
	// rendered box is naturalWidth × naturalHeight, so a y distance of 1 is
	// naturalHeight/naturalWidth as far as an x distance of 1.
	const yPerX = $derived(naturalWidth === 0 ? 1 : naturalHeight / naturalWidth);

	// The stroke being made right now, rendered like any other and dropped the
	// moment it is committed. Erase passes leave no mark, so they draw none.
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

	/** The pointer's position in the stored [0,1] box, clamped to the box.
	 * Pointer capture keeps delivering pointermove after the pointer leaves the
	 * element, so a mark dragged off the base would otherwise store coordinates
	 * outside [0,1] — which parse() rejects, taking every other stroke in the
	 * same save down with it. A mark that runs off the base stops at the edge
	 * instead, so the invariant parse() enforces is true at the producer
	 * (#394 review F1: clamp at capture, never repair at parse). */
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

	/** Stored [0,1] pairs in the space the eraser measures in: x unchanged, y
	 * scaled so one unit is one width-fraction in either direction — otherwise
	 * ERASE_THRESHOLD would reach further vertically than horizontally on any
	 * non-square base (#394 review F4). */
	function erasePoints(pts: number[]): number[] {
		const out = new Array<number>(pts.length);
		for (let i = 0; i < pts.length; i += 2) {
			out[i] = pts[i];
			out[i + 1] = pts[i + 1] * yPerX;
		}
		return out;
	}

	/** Whether an eraser pass (flat x,y pairs) touches a stroke's own path —
	 * checked both ways, so a coarse stroke crossed by a fine eraser path
	 * and a coarse eraser pass grazing a fine stroke both register. Both lists
	 * are already in erasePoints space. */
	function pathHits(s: number[], eraserPts: number[]): boolean {
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
		// One stroke at a time: with `touch-action: none` the surface receives
		// every stray finger, and a second pointer used to take over the
		// in-progress stroke — resetting its points and orphaning the first
		// pointer's own pointerup, so the drawn line was lost (#394 review F2).
		if (drawing) return;
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

	/** The pointer went away without a pointerup — a touch interruption, a
	 * gesture takeover, a stylus leaving range, or capture lost to another
	 * element. Nothing is committed and the live stroke disappears with the
	 * pointer; without this the phantom stayed on screen, uncommittable and
	 * un-undoable, until the next pointerdown (#394 review F3). */
	function handlePointerAbort(e: PointerEvent): void {
		if (!drawing || e.pointerId !== capturedPointerId) return;
		if (svgEl?.hasPointerCapture(e.pointerId)) svgEl.releasePointerCapture(e.pointerId);
		endStroke();
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

<!-- (*MVOX:Byrd* — #394 GREEN: StrokeSurface, the one drawing component) -->
