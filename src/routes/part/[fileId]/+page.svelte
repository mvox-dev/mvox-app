<script lang="ts">
	// #427 — the fullscreen part viewer. A full-viewport in-app route (NOT
	// the house shell — allowlisted in src/page-shell.spec.ts, the /auth/*
	// full-screen family taken one shape further): a singer reads her part
	// edge to edge on a dark, music-stand surround, with no nav chrome to
	// tap around.
	//
	// DATA PATH: bytes come through the EXISTING openFileBytes read-through
	// (src/lib/files/openFileBytes.ts) — the same read the event/library
	// entry points used to run themselves before #427 moved it here. A
	// cache hit touches no network at all (the offline promise); a miss
	// online signs + fetches + stores, exactly #334's existing behaviour.
	// pdf.js (src/lib/parts/pdfRenderer.ts — the one file in this tree
	// allowed a 2d canvas context) renders ONE page at a time.
	//
	// IDENTITY: the same store the event/library pages read
	// (`selectedCollectiveIdentityStore`), preferring the `?db=` the entry
	// link carried when the session already holds that collective — a
	// bookmarked/reloaded viewer URL should resolve identity from itself,
	// not from whatever the global picker happened to be showing last.
	//
	// PAGE TURNS (Mihkel's ruling on #333): two invisible corner zones, tap
	// thresholds in src/lib/parts/tapZone.ts. Nothing here calls
	// preventDefault — native scroll/pinch stay available, a swipe simply
	// never satisfies the tap check.
	//
	// FULLSCREEN: requested opportunistically where the API exists
	// (Android); where it does not (iOS has none), the route itself already
	// IS the fullscreen — no branch needed, the call is just a no-op via
	// optional chaining.
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import { getToken } from '$lib/auth/storage';
	import { get } from 'svelte/store';
	import {
		collectiveState,
		selectedCollectiveIdentityStore,
		type CollectiveIdentity
	} from '$lib/collectives/store';
	import { getAppByteStore } from '$lib/files/appByteStore';
	import { openFileBytes, type OpenedFileBytes } from '$lib/files/openFileBytes';
	import { openPdf, type OpenedPdf } from '$lib/parts/pdfRenderer';
	import { createTapTracker, type TapTracker } from '$lib/parts/tapZone';

	type Status = 'loading' | 'ready' | 'missing';

	let status = $state<Status>('loading');
	let currentPage = $state(1);
	let numPages = $state(0);
	let canvasEl = $state<HTMLCanvasElement | undefined>(undefined);
	let rootEl = $state<HTMLDivElement | undefined>(undefined);

	// Plain (non-reactive) handles: nothing in the template reads these
	// directly, they only need to survive between the load effect and its
	// own cleanup — see OBJECT-URL OWNERSHIP in openFileBytes.ts for why
	// `opened.release()` and `pdf.destroy()` are two SEPARATE disposals.
	let opened: OpenedFileBytes | null = null;
	let pdf: OpenedPdf | null = null;

	const tapPrev: TapTracker = createTapTracker();
	const tapNext: TapTracker = createTapTracker();

	function resolveIdentity(): CollectiveIdentity | null {
		const dbParam = page.url.searchParams.get('db');
		const state = get(collectiveState);
		if (dbParam && state.status === 'ready') {
			const match = state.collectives.find((c) => c.db === dbParam);
			if (match) return { db: match.db, personId: match.personId };
		}
		return get(selectedCollectiveIdentityStore);
	}

	async function renderCurrentPage(): Promise<void> {
		if (!pdf || !canvasEl) return;
		await pdf.renderPage(currentPage, canvasEl);
	}

	async function goToPage(target: number): Promise<void> {
		const clamped = Math.min(Math.max(target, 1), numPages);
		if (clamped === currentPage) return;
		currentPage = clamped;
		await renderCurrentPage();
	}

	function next(): void {
		if (status !== 'ready') return;
		void goToPage(currentPage + 1);
	}

	function previous(): void {
		if (status !== 'ready') return;
		void goToPage(currentPage - 1);
	}

	function close(): void {
		window.history.back();
	}

	function pointerTimeMs(): number {
		return typeof performance !== 'undefined' ? performance.now() : Date.now();
	}

	function handlePointerDown(tracker: TapTracker, event: PointerEvent): void {
		tracker.start({ x: event.clientX, y: event.clientY, timeMs: pointerTimeMs() });
		(event.currentTarget as Element | null)?.setPointerCapture(event.pointerId);
	}

	function handlePointerMove(tracker: TapTracker, event: PointerEvent): void {
		tracker.move({ x: event.clientX, y: event.clientY, timeMs: pointerTimeMs() });
	}

	function handlePointerUp(tracker: TapTracker, event: PointerEvent, onTap: () => void): void {
		const wasTap = tracker.end({ x: event.clientX, y: event.clientY, timeMs: pointerTimeMs() });
		if (wasTap) onTap();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'ArrowRight' || event.key === 'PageDown') next();
		else if (event.key === 'ArrowLeft' || event.key === 'PageUp') previous();
	}

	// Loads the file once per route entry (re-runs if `fileId` changes — a
	// navigation from one part straight to another reuses the mounted
	// route). `cancelled` guards a late resolve after the effect tore down
	// (an unmount, or a fileId change) from clobbering fresher state.
	$effect(() => {
		const fileId = page.params.fileId ?? '';
		let cancelled = false;

		async function load(): Promise<void> {
			const identity = resolveIdentity();
			if (!identity) {
				if (!cancelled) status = 'missing';
				return;
			}
			const cfg = { db: identity.db, token: getToken() ?? '' };
			try {
				const result = await openFileBytes(cfg, identity, fileId, getAppByteStore());
				if (cancelled) {
					result.release();
					return;
				}
				const doc = await openPdf(result.url);
				if (cancelled) {
					doc.destroy();
					result.release();
					return;
				}
				opened = result;
				pdf = doc;
				numPages = doc.numPages;
				currentPage = 1;
				status = 'ready';
			} catch {
				// A dead network plus a missing file, or any other open
				// failure: the plain not-on-device notice, no retry loop
				// (see the route header — this is the behavioural half of
				// "nothing drawn, nothing stored").
				if (!cancelled) status = 'missing';
			}
		}

		void load();

		return () => {
			cancelled = true;
			pdf?.destroy();
			pdf = null;
			opened?.release();
			opened = null;
		};
	});

	// Renders (or re-renders) the canvas whenever the page becomes ready or
	// the current page number changes. Separate from the load effect above:
	// the canvas element doesn't exist in the DOM until `status` flips to
	// 'ready', and this effect runs after that DOM update lands.
	$effect(() => {
		if (status !== 'ready') return;
		void currentPage;
		void renderCurrentPage();
	});

	// Android: an enhancement, called once the surround mounts. iOS ships no
	// Fullscreen API at all — the optional chain makes that a plain no-op,
	// and the full-viewport route is the fullscreen there.
	$effect(() => {
		rootEl?.requestFullscreen?.();
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	bind:this={rootEl}
	class="fixed inset-0 flex h-[100dvh] w-screen flex-col bg-ink text-paper"
	data-testid="part-viewer-root"
>
	{#if status === 'ready'}
		<div class="relative min-h-0 flex-1">
			<div class="flex h-full w-full items-center justify-center overflow-hidden">
				<canvas data-testid="part-viewer-canvas" bind:this={canvasEl}></canvas>
			</div>
			<!-- Invisible corner tap zones (Mihkel's #333 ruling): a TAP turns a
			     page, a swipe/scroll never does — see src/lib/parts/tapZone.ts
			     for the thresholds. No preventDefault anywhere here, so native
			     scroll/pinch inside the canvas area stay available. Deliberately
			     NOT given an interactive role: a screen-reader/keyboard user
			     already has the exact same page-turn via ArrowLeft/ArrowRight/
			     PageUp/PageDown (handleKeydown below) — a `role="button"` on an
			     invisible, quarter-viewport hit target would announce a control
			     with no discoverable name or bounds, which is worse than none. -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="absolute inset-y-0 left-0 w-1/4"
				data-testid="part-viewer-tap-prev"
				onpointerdown={(event) => handlePointerDown(tapPrev, event)}
				onpointermove={(event) => handlePointerMove(tapPrev, event)}
				onpointerup={(event) => handlePointerUp(tapPrev, event, previous)}
			></div>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="absolute inset-y-0 right-0 w-1/4"
				data-testid="part-viewer-tap-next"
				onpointerdown={(event) => handlePointerDown(tapNext, event)}
				onpointermove={(event) => handlePointerMove(tapNext, event)}
				onpointerup={(event) => handlePointerUp(tapNext, event, next)}
			></div>
		</div>
		<div class="flex shrink-0 items-center justify-between px-6 py-3">
			<span data-testid="part-viewer-page-indicator" class="font-sans text-sm text-ink-5">
				{m.part_viewer_page_of({ current: currentPage, total: numPages })}
			</span>
			<button
				type="button"
				class="font-sans text-sm text-paper underline"
				data-testid="part-viewer-close"
				onclick={close}
			>
				{m.part_viewer_close()}
			</button>
		</div>
	{:else if status === 'missing'}
		<div class="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
			<p data-testid="part-viewer-not-on-device" class="font-sans text-base text-paper">
				{m.part_viewer_not_on_device()}
			</p>
			<button
				type="button"
				class="font-sans text-sm text-paper underline"
				data-testid="part-viewer-close"
				onclick={close}
			>
				{m.part_viewer_close()}
			</button>
		</div>
	{/if}
</div>

<!-- (*MVOX:Josquin* — #427 GREEN) -->
