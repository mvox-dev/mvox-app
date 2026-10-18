import type { PartLabel } from '$lib/files/labelStore';

declare global {
	namespace App {
		interface PageState {
			// The part name for the viewer (#427); a reload carries none, the label is already stored.
			partLabel?: PartLabel;
		}
	}
}

export {};
