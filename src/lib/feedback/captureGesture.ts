// The double tap (or double click) that opens the feedback editor.
export const NO_CAPTURE_SELECTOR = [
	'input',
	'textarea',
	'select',
	'[contenteditable]:not([contenteditable="false"])',
	'button',
	'a',
	'label',
	'[role="button"]',
	'[role="link"]',
	'[data-testid="part-viewer-root"]',
	'[data-testid="stroke-surface"]'
].join(', ');

const MAX_GAP_MS = 400;
const MAX_TAP_DRIFT_PX = 10;
const MAX_TAP_DISTANCE_PX = 30;

type Point = { x: number; y: number };

function apart(a: Point, b: Point, limit: number): boolean {
	return Math.hypot(a.x - b.x, a.y - b.y) > limit;
}

// Pointer events rather than dblclick: one path for mouse, pen and touch, where mobile
// browsers do not all fire dblclick for a double tap.
export function listenForDoubleTap(
	root: Document | HTMLElement,
	onDoubleTap: () => void,
	now: () => number = () => performance.now()
): () => void {
	let down: Point | null = null;
	let lastTap: (Point & { at: number }) | null = null;

	function onPointerDown(e: PointerEvent): void {
		down = e.isPrimary && e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
	}

	function onPointerUp(e: PointerEvent): void {
		const start = down;
		down = null;
		const target = e.target instanceof Element ? e.target : null;
		if (!start || !e.isPrimary || !target || target.closest(NO_CAPTURE_SELECTOR)) {
			lastTap = null;
			return;
		}
		const tap = { x: e.clientX, y: e.clientY, at: now() };
		if (apart(start, tap, MAX_TAP_DRIFT_PX)) {
			lastTap = null;
			return;
		}
		const isSecond =
			lastTap !== null &&
			tap.at - lastTap.at <= MAX_GAP_MS &&
			!apart(lastTap, tap, MAX_TAP_DISTANCE_PX);
		if (!isSecond) {
			lastTap = tap;
			return;
		}
		lastTap = null;
		window.getSelection()?.removeAllRanges();
		onDoubleTap();
	}

	root.addEventListener('pointerdown', onPointerDown as EventListener);
	root.addEventListener('pointerup', onPointerUp as EventListener);
	return () => {
		root.removeEventListener('pointerdown', onPointerDown as EventListener);
		root.removeEventListener('pointerup', onPointerUp as EventListener);
	};
}
