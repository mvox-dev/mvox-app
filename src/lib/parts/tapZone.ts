// #427 — the tap/swipe distinction Mihkel ruled on for #333: a TAP on a
// corner zone turns a page; anything that moves further is a swipe/scroll
// gesture and must turn nothing (native scroll/pinch stay available — this
// module never calls preventDefault, it only classifies a finished gesture).
//
// Two named constants, not inline literals, so the RULE reads at a glance
// wherever it is checked or tested:
//   - TAP_MAX_DURATION_MS — pointerdown→pointerup no slower than this counts.
//   - TAP_MAX_MOVEMENT_PX — total displacement from the down point, checked
//     on EVERY intermediate pointermove (not just the final up position) —
//     a finger that strays past the threshold and wanders back before
//     lifting is still a swipe, not a tap.
export const TAP_MAX_DURATION_MS = 300;
export const TAP_MAX_MOVEMENT_PX = 10;

export interface TapPoint {
	x: number;
	y: number;
	timeMs: number;
}

export interface TapTracker {
	/** A pointerdown on the zone — starts tracking one candidate gesture. */
	start(point: TapPoint): void;
	/** A pointermove while the pointer is still down on the zone. */
	move(point: TapPoint): void;
	/** A pointerup — settles the candidate. Returns true iff it was a TAP. */
	end(point: TapPoint): boolean;
}

function distance(a: TapPoint, b: TapPoint): number {
	return Math.hypot(b.x - a.x, b.y - a.y);
}

/** One tracker per zone (left/right are independent gestures). */
export function createTapTracker(): TapTracker {
	let origin: TapPoint | null = null;
	let movedTooFar = false;

	return {
		start(point) {
			origin = point;
			movedTooFar = false;
		},
		move(point) {
			if (origin && distance(origin, point) >= TAP_MAX_MOVEMENT_PX) movedTooFar = true;
		},
		end(point) {
			if (origin === null) return false;
			const isTap =
				!movedTooFar &&
				distance(origin, point) < TAP_MAX_MOVEMENT_PX &&
				point.timeMs - origin.timeMs <= TAP_MAX_DURATION_MS;
			origin = null;
			return isTap;
		}
	};
}

// (*MVOX:Byrd*)
