<!-- One page's pen marks over a rendered page of that size; the page itself is never touched. -->
<script lang="ts">
	import StrokeSurface from '$lib/components/StrokeSurface.svelte';
	import { createTapTracker, type TapPoint } from '$lib/parts/tapZone';
	import { DEFAULT_PENS, type StrokeData } from './strokes';

	let {
		width,
		height,
		page,
		strokes,
		editable,
		penId = $bindable(DEFAULT_PENS[0].id),
		onchange,
		onprev,
		onnext
	}: {
		width: number;
		height: number;
		page: number;
		strokes: StrokeData;
		editable: boolean;
		penId?: string;
		onchange: (strokes: StrokeData) => void;
		onprev: () => void;
		onnext: () => void;
	} = $props();

	let layerEl: HTMLDivElement | undefined;
	const tracker = createTapTracker();
	let tapPointerId: number | null = null;
	let tapTurn: (() => void) | null = null;

	function point(e: PointerEvent): TapPoint {
		const timeMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
		return { x: e.clientX, y: e.clientY, timeMs };
	}

	// The corner zones are the outer quarters of the viewer, as for the tap zones under the layer.
	function cornerTurn(x: number): (() => void) | null {
		const rect = (layerEl as HTMLDivElement).getBoundingClientRect();
		if (x < rect.left + rect.width / 4) return onprev;
		if (x >= rect.right - rect.width / 4) return onnext;
		return null;
	}

	function down(e: PointerEvent): void {
		tapPointerId = null;
		if (!editable || !e.isPrimary || !(e.target as Element).closest('svg')) return;
		tapTurn = cornerTurn(e.clientX);
		if (!tapTurn) return;
		tapPointerId = e.pointerId;
		tracker.start(point(e));
	}

	function move(e: PointerEvent): void {
		if (e.pointerId === tapPointerId) tracker.move(point(e));
	}

	// A corner tap turns the page; the cancel drops the dot the surface would commit on pointerup.
	function up(e: PointerEvent): void {
		if (e.pointerId !== tapPointerId) return;
		tapPointerId = null;
		if (!tracker.end(point(e))) return;
		const cancel = new PointerEvent('pointercancel', { pointerId: e.pointerId, bubbles: true });
		e.target?.dispatchEvent(cancel);
		tapTurn?.();
	}

	function cancel(e: PointerEvent): void {
		if (e.pointerId === tapPointerId) tapPointerId = null;
	}
</script>

{#snippet base()}
	<div class="h-full w-full"></div>
{/snippet}

<div
	bind:this={layerEl}
	class="pointer-events-none absolute inset-0 flex items-center justify-center"
	data-testid="part-viewer-ink"
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="relative *:not-first:absolute *:not-first:top-2 *:not-first:left-1/2 *:not-first:-translate-x-1/2 {editable
			? 'pointer-events-auto'
			: ''}"
		style={`width: ${width}px; height: ${height}px;`}
		onpointerdowncapture={down}
		onpointermovecapture={move}
		onpointerupcapture={up}
		onpointercancelcapture={cancel}
	>
		{#key page}
			<StrokeSurface
				{base}
				naturalWidth={width}
				naturalHeight={height}
				{strokes}
				readonly={!editable}
				bind:activePenId={penId}
				{onchange}
			/>
		{/key}
	</div>
</div>

<!-- (*MVOX:Josquin*) -->
