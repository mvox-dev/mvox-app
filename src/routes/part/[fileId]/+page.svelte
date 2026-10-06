<script lang="ts">
	import { reportProblem } from '$lib/problems/reportProblem';
	// The fullscreen part viewer (#427): bytes via openFileBytes, identity from the JWT alone so a
	// cold offline start works, corner taps turn pages (#333). The fence forbids store and wire
	// writes here; recordPartLabel is the #353 label index, which only names stored bytes.
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/auth/session';
	import { getToken } from '$lib/auth/storage';
	import { deriveOfflineIdentities } from '$lib/collectives/offlineIdentity';
	import { getAppByteStore } from '$lib/files/appByteStore';
	import { getAppLabelStore } from '$lib/files/appLabelStore';
	import { recordPartLabel } from '$lib/files/labelStore';
	import { openFileBytes, type OpenedFileBytes } from '$lib/files/openFileBytes';
	import { openPdf, type OpenedPdf } from '$lib/parts/pdfRenderer';
	import { createTapTracker, type TapTracker } from '$lib/parts/tapZone';

	// 'missing': nothing reachable and nothing stored. 'open-failed': something answered and the
	// part still did not open. The two are never collapsed (see wireUnreachable).
	type Status = 'loading' | 'ready' | 'missing' | 'open-failed';

	let status = $state<Status>('loading');
	let currentPage = $state(1);
	let numPages = $state(0);
	let canvasEl = $state<HTMLCanvasElement | undefined>(undefined);
	let rootEl = $state<HTMLDivElement | undefined>(undefined);

	// Two separate disposals: opened.release() and pdf.destroy() (openFileBytes.ts).
	let opened: OpenedFileBytes | null = null;
	let pdf: OpenedPdf | null = null;

	const tapPrev: TapTracker = createTapTracker();
	const tapNext: TapTracker = createTapTracker();

	// Renders are serialised: pdf.js rejects a render while another runs on the same canvas.
	let renderChain: Promise<void> = Promise.resolve();

	function renderCurrentPage(): Promise<void> {
		renderChain = renderChain
			.then(async () => {
				if (!pdf || !canvasEl) return;
				await pdf.renderPage(currentPage, canvasEl);
			})
			.catch(() => {
				// A failed render leaves the previous page on screen; no retry loop.
			});
		return renderChain;
	}

	// Clamp and assign only: the render effect tracks currentPage, so rendering here doubles it.
	function goToPage(target: number): void {
		const clamped = Math.min(Math.max(target, 1), numPages);
		if (clamped === currentPage) return;
		currentPage = clamped;
	}

	function next(): void {
		if (status !== 'ready') return;
		goToPage(currentPage + 1);
	}

	function previous(): void {
		if (status !== 'ready') return;
		goToPage(currentPage - 1);
	}

	// A fresh document load has no in-app history: Close goes home, otherwise it goes back.
	let enteredInApp = false;
	afterNavigate((navigation) => {
		if (navigation.type !== 'enter') enteredInApp = true;
	});

	function close(): void {
		if (enteredInApp) window.history.back();
		else void goto('/');
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

	// Only a fetch TypeError means nothing answered (not on this device). Anything else is a
	// server that answered and refused: an open failure, never "not on this device".
	function wireUnreachable(error: unknown): boolean {
		return error instanceof TypeError;
	}

	// Depends on $authStore: on a cold load the store starts 'loading', so this claims nothing
	// and re-runs on the real value. `cancelled` guards every late resolve of a superseded run.
	$effect(() => {
		const auth = $authStore;
		const fileId = page.params.fileId ?? '';
		const dbParam = page.url.searchParams.get('db');
		// Handed down by the entry page; absent on a reload, where it was already written.
		const label = page.state.partLabel;
		if (auth.status === 'loading') return;

		let cancelled = false;

		async function load(): Promise<void> {
			if (auth.status !== 'authenticated') {
				if (!cancelled) status = 'missing';
				return;
			}
			const token = getToken() ?? '';
			// Partitions are tried in order; one that cannot deliver says nothing about the part.
			// deliveryFailed: did any partition refuse, as opposed to not holding the file?
			let deliveryFailed = false;
			for (const identity of deriveOfflineIdentities(auth.personIdByDb, dbParam)) {
				let result: OpenedFileBytes;
				try {
					result = await openFileBytes(
						{ db: identity.db, token },
						identity,
						fileId,
						getAppByteStore()
					);
				} catch (error) {
					if (!wireUnreachable(error)) {
						deliveryFailed = true;
						if (!cancelled) {
							reportProblem({ area: 'part', action: 'delivering the part', error });
						}
					}
					continue;
				}
				if (cancelled) {
					result.release();
					return;
				}
				// A passthrough delivery returns the signed URL (CORS-blocked byte fetch or over the
				// cap): hand it to the browser, since pdf.js would repeat the blocked request.
				if (!result.url.startsWith('blob:')) {
					result.release();
					window.location.href = result.url;
					return;
				}
				try {
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
					// The #353 label, written only for the deliveries that left a stored copy.
					if (label) {
						recordPartLabel(getAppLabelStore(), identity, fileId, label, result.reason);
					}
				} catch (error) {
					if (!cancelled) reportProblem({ area: 'part', action: 'opening the part', error });
					// Bytes pdf.js cannot open: a failure of this file, not of the partition.
					result.release();
					if (!cancelled) status = 'open-failed';
				}
				return;
			}
			// Nothing delivered: not-on-device when nothing answered, an open failure if refused.
			if (!cancelled) status = deliveryFailed ? 'open-failed' : 'missing';
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

	// The canvas exists only once status is 'ready', so rendering is its own effect.
	$effect(() => {
		if (status !== 'ready') return;
		void currentPage;
		void renderCurrentPage();
	});

	// Re-fit on viewport change (rotating to landscape at a music stand), one frame debounced;
	// the observer's first callback is skipped, the render effect just painted that size.
	let refitFrame: number | null = null;

	function scheduleRefit(): void {
		if (status !== 'ready' || refitFrame !== null) return;
		refitFrame = requestAnimationFrame(() => {
			refitFrame = null;
			void renderCurrentPage();
		});
	}

	$effect(() => {
		if (status !== 'ready') return;
		const box = canvasEl?.parentElement;
		if (!box) return;
		const cancelPending = (): void => {
			if (refitFrame !== null) cancelAnimationFrame(refitFrame);
			refitFrame = null;
		};
		if (typeof ResizeObserver === 'undefined') {
			// No ResizeObserver (older iOS Safari): window resize and orientationchange instead.
			window.addEventListener('resize', scheduleRefit);
			window.addEventListener('orientationchange', scheduleRefit);
			return () => {
				window.removeEventListener('resize', scheduleRefit);
				window.removeEventListener('orientationchange', scheduleRefit);
				cancelPending();
			};
		}
		let initial = true;
		const observer = new ResizeObserver(() => {
			if (initial) {
				initial = false;
				return;
			}
			scheduleRefit();
		});
		observer.observe(box);
		return () => {
			observer.disconnect();
			cancelPending();
		};
	});

	// Fullscreen where the API exists (iOS has none: the route is the fullscreen). The promise is
	// caught: outside a user activation browsers reject with NotAllowedError.
	$effect(() => {
		if (status !== 'ready') return;
		const request = rootEl?.requestFullscreen?.();
		void request?.catch(() => {});
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
			<!-- Invisible tap zones (#333): no interactive role, keyboards page with the arrow keys. -->
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
	{:else if status === 'open-failed'}
		<!-- Reuses repertoire_pdf_error: no new part_viewer_ key, so the i18n pins stay true. -->
		<div class="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
			<p data-testid="part-viewer-open-failed" class="font-sans text-base text-paper">
				{m.repertoire_pdf_error()}
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

<!-- (*MVOX:Josquin*) -->
