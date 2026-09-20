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
	// IDENTITY (#427 review finding 2): derived with ZERO NETWORK from the
	// decoded JWT — `deriveOfflineIdentities($authStore.personIdByDb, ?db=)`,
	// the same move /downloads makes and for the same reason
	// (offlineIdentity.ts, #353 spike 3): `collectiveState` /
	// `selectedCollectiveIdentityStore` are filled by a NETWORK call per db,
	// so on a cold offline start — the headline case of this issue — they are
	// null by construction. Reading them here also lost the reload/bookmark
	// race, since the read was an untracked `get()` inside an effect that
	// depended only on the fileId and so never re-ran once the stores
	// settled. The `?db=` the entry link carries plays the role /downloads
	// gives its persisted pick: it selects ONE partition when it names one
	// the token holds.
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
	//
	// THE FENCE (src/part-viewer-fence.spec.ts) forbids this tree a
	// STORE/Entu/webstorage write: no byte-store put, no evict, no wire
	// mutation. `recordPartLabel` below is none of those — it is the #353
	// LABEL INDEX write (a separate IndexedDB database that only NAMES bytes
	// someone else stored), and it is why a part opened from the library or
	// an event still shows its title on /downloads instead of "Unnamed part"
	// (#427 review finding 3). It writes only on a delivery whose `reason`
	// says bytes landed, and only when the entry handler handed a label down
	// through the navigation's page state.
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

	// 'missing'     — nothing could be reached and no stored copy exists: the
	//                 not-on-device notice, the offline truth.
	// 'open-failed' — something ANSWERED and the part still did not open (a
	//                 refused signing, a refused byte GET, bytes pdf.js
	//                 cannot parse). See wireUnreachable() below for why the
	//                 two are never collapsed into one notice.
	type Status = 'loading' | 'ready' | 'missing' | 'open-failed';

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

	// Renders are SERIALISED: pdf.js rejects a render issued while another is
	// still running on the same canvas, and three things can now issue one —
	// a page turn, a viewport re-fit, the first paint. Each waits for the one
	// before it; a failed render never breaks the chain.
	let renderChain: Promise<void> = Promise.resolve();

	function renderCurrentPage(): Promise<void> {
		renderChain = renderChain
			.then(async () => {
				if (!pdf || !canvasEl) return;
				await pdf.renderPage(currentPage, canvasEl);
			})
			.catch(() => {
				// A render that fails leaves the previous page on screen; there
				// is nothing truthful to say about it beyond that, and no retry
				// loop (see the route header).
			});
		return renderChain;
	}

	// ONE DRIVER PER PAGE TURN (#427 review round 2, finding 1). This is a
	// clamp-and-assign and nothing more: the render $effect below TRACKS
	// `currentPage`, so a turn that also rendered here rasterised the same
	// page twice on every tap. The serialised chain hid it — no crash, no
	// visual artefact — and the phone paid the full second rasterisation
	// anyway. `renderCurrentPage` has exactly two callers now: that effect,
	// and the viewport re-fit.
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

	// WHICH FAILURE WAS IT (#427 review round 2, finding 2). `openFileBytes`
	// throws on a genuine DELIVERY failure just as it does on a dead wire,
	// and the two owe the singer opposite answers. "This part isn't saved on
	// this device" is true only when nothing could be reached to ask: a
	// rejection raised by `fetch` ITSELF is a TypeError and means no server
	// answered. Everything else openFileBytes can throw — `signFileUrl: ...
	// signing failed: 500`, a signed response carrying no url, `byte fetch
	// failed: 403` from an expired bucket signature — is a server that
	// answered and REFUSED, on a wire that plainly works. Telling her the
	// part is not on her device there is false about the device and silent
	// about the server.
	function wireUnreachable(error: unknown): boolean {
		return error instanceof TypeError;
	}

	// Loads the file once per (fileId, auth) pair. DEPENDS ON $authStore on
	// purpose (#427 review finding 2): on a cold document load — a reload
	// while reading, a bookmarked viewer URL, an offline start — this
	// component mounts BEFORE +layout.svelte's onMount hydrateAuth resolves,
	// so the store's first value is 'loading'. Returning early there claims
	// nothing (`status` stays 'loading', no notice rendered) and the effect
	// re-runs on the real value. Svelte tears the previous run down before
	// re-running, so `cancelled` is all the staleness guard this needs: a
	// late resolve from a superseded run releases what it opened and writes
	// no state.
	$effect(() => {
		const auth = $authStore;
		const fileId = page.params.fileId ?? '';
		const dbParam = page.url.searchParams.get('db');
		// The label the entry handler carried down through `goto`'s page
		// state (event/library). Absent on a reload or a bookmark — the label
		// was already written the first time the part was opened from a page
		// that knows its name, so there is nothing to recover here.
		const label = page.state.partLabel;
		if (auth.status === 'loading') return;

		let cancelled = false;

		async function load(): Promise<void> {
			if (auth.status !== 'authenticated') {
				if (!cancelled) status = 'missing';
				return;
			}
			const token = getToken() ?? '';
			// `?db=` names one partition when the token holds it; otherwise the
			// single-collective singer's only one, or every one the token
			// proves is the same human (offlineIdentity.ts). Several candidates
			// are tried in order — a partition that cannot deliver says nothing
			// about the part, only about that partition.
			// Did any partition FAIL to deliver, as opposed to simply not
			// holding the file? Decides which notice the exhausted loop
			// falls out to (wireUnreachable above).
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
					if (!wireUnreachable(error)) deliveryFailed = true;
					continue;
				}
				if (cancelled) {
					result.release();
					return;
				}
				// #427 review finding 4 — a PASSTHROUGH delivery hands back the
				// cross-origin SIGNED url, not a blob: the byte fetch rejected
				// (the documented dev/preview CORS case, #343 finding 1(a)) or
				// the declared size was over the store cap. Feeding that url to
				// pdf.js would re-issue the very request that was just blocked,
				// from the page origin, and land the singer on a false "not on
				// this device" with no way to open the file at all. Hand it to
				// the browser instead — a top-level navigation is not
				// CORS-subject, and it is exactly the pre-#427 delivery path.
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
					// #353's label, written at the moment bytes land — see THE
					// FENCE in the route header. `reason` gates it to the two
					// deliveries that left an offline copy behind.
					if (label) {
						recordPartLabel(getAppLabelStore(), identity, fileId, label, result.reason);
					}
				} catch {
					// Bytes in hand that pdf.js cannot open: a failure of this
					// FILE, not of this partition — no other identity would open
					// it either. The bytes ARE on the device, so this is an open
					// failure, never the not-on-device notice.
					result.release();
					if (!cancelled) status = 'open-failed';
				}
				return;
			}
			// Nothing delivered. A dead network plus no stored copy is the
			// plain not-on-device notice, no retry loop (see the route header
			// — the behavioural half of "nothing drawn, nothing stored"). A
			// server that answered and refused is an OPEN failure instead.
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

	// Renders (or re-renders) the canvas whenever the page becomes ready or
	// the current page number changes. Separate from the load effect above:
	// the canvas element doesn't exist in the DOM until `status` flips to
	// 'ready', and this effect runs after that DOM update lands.
	$effect(() => {
		if (status !== 'ready') return;
		void currentPage;
		void renderCurrentPage();
	});

	// #427 review finding 6 — RE-FIT ON VIEWPORT CHANGE. pdfRenderer sizes the
	// canvas from its parent box AT RENDER TIME, so without this the page keeps
	// its portrait fit until the next page turn — and lifting a score to
	// landscape is the ordinary move at a music stand. Debounced to one frame:
	// a rotation fires a burst of callbacks and each render is real work. The
	// first ResizeObserver callback (delivered on observe, before anything has
	// changed) is skipped — the render effect above has just painted that size.
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
			// No ResizeObserver (older iOS Safari): the window's own resize and
			// orientationchange cover the rotation this exists for.
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

	// Android: an enhancement, called once there is something to read
	// fullscreen. iOS ships no Fullscreen API at all — the optional chain
	// makes that a plain no-op, and the full-viewport route is the fullscreen
	// there.
	//
	// #427 review finding 5 — the returned promise is CAUGHT. Outside a
	// transient user activation (a client-side `goto` may have outlived the
	// one the click created) browsers reject with NotAllowedError, and
	// discarding that promise raises an unhandled rejection on every entry.
	// Gated on 'ready' too: there is nothing to read fullscreen behind the
	// not-on-device notice.
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
	{:else if status === 'open-failed'}
		<!-- The server answered and the part still did not open. Reuses the
		     house open-error copy (repertoire_pdf_error, all four locales,
		     also on /downloads and the home repertoire): no new part_viewer_
		     key, so the exact-set pin in src/lib/i18n/partViewerKeys.spec.ts
		     and the i18n fence in src/part-viewer-fence.spec.ts both stay
		     honest. Still no retry loop — the way out is the same close. -->
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

<!-- (*MVOX:Josquin* — #427 GREEN; review-fix rounds 1+2 *MVOX:Josquin*) -->
