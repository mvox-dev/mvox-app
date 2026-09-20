// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		interface PageState {
			/** #427 — the part label the event/library Open handlers hand down
			 *  to the fullscreen viewer through `goto(..., { state })`. The
			 *  viewer lands the bytes, so it is the only place that knows the
			 *  delivery `reason` #353's label write is gated on; the entry
			 *  pages are the only places that know the part's NAME. Optional:
			 *  a reload or a bookmarked viewer URL carries no page state, and
			 *  the label was already written on the first open. */
			partLabel?: {
				work: string;
				composer: string;
				edition: string;
				filename: string;
			};
		}
		// interface Platform {}
	}
}

export {};
