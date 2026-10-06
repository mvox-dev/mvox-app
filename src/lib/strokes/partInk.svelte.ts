// Her ink on one open part: every page read from the device before the part shows, each change
// saved. Ink that could not be read is not drawable: a save would erase what is stored.
import { reportProblem } from '$lib/problems/reportProblem';
import { liveInk, type InkPage, type InkStore } from './inkStore';
import type { StrokeData } from './strokes';

type InkPart = Omit<InkPage, 'page'>;

export function createPartInk(store: InkStore | null) {
	let marks = $state.raw<Record<number, StrokeData>>({});
	let drawable = $state(true);
	const hasMarks = $derived(Object.values(marks).some((page) => page.strokes.length > 0));
	let part: InkPart | null = null;
	let opening = 0;

	async function open(next: InkPart, pages: number): Promise<void> {
		const run = ++opening;
		part = null;
		marks = {};
		drawable = true;
		if (!store) return;
		const numbers = Array.from({ length: pages }, (_, i) => i + 1);
		try {
			const logs = await Promise.all(numbers.map((page) => store.load({ ...next, page })));
			if (run !== opening) return;
			marks = Object.fromEntries(numbers.map((page, i) => [page, liveInk(logs[i])]));
			part = next;
		} catch (error) {
			if (run !== opening) return;
			drawable = false;
			reportProblem({ area: 'part', action: 'loading the marks', error });
		}
	}

	function change(page: number, ink: StrokeData): void {
		const plain = $state.snapshot(ink) as StrokeData;
		marks = { ...marks, [page]: plain };
		if (!store || !part) return;
		store.save({ ...part, page }, plain).catch((error: unknown) => {
			reportProblem({ area: 'part', action: 'saving the marks', error });
		});
	}

	return {
		get marks() {
			return marks;
		},
		get drawable() {
			return drawable;
		},
		get hasMarks() {
			return hasMarks;
		},
		open,
		change
	};
}

// (*MVOX:Josquin*)
