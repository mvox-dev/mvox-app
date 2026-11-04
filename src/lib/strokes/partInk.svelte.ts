// Her ink on one open part: every page read from the device before the part shows, each change
// saved. Ink that could not be read is not drawable: a save would erase what is stored.

// Entu's ink is joined in after the part shows (#1069). Joins and saves run in one line, and a
// save takes the page as shown when it runs, so a mark Entu added is never read as erased.
import { reportProblem } from '$lib/problems/reportProblem';
import type { FileKey } from '$lib/files/idb';
import { isSynced, liveInk, type InkLog, type InkStore, type SyncedInkStore } from './inkStore';
import type { StrokeData } from './strokes';

/** The shown page after a join: marks the join added appear, marks it erased go; hers stay. */
function rebase(shown: StrokeData, before: InkLog, after: InkLog): StrokeData {
	const had = new Set(before.strokes.map((s) => s.id));
	const wasErased = new Set(before.erased);
	const nowErased = new Set(after.erased);
	const strokes = [...shown.strokes];
	for (const { id, stroke } of before.strokes) {
		if (wasErased.has(id) || !nowErased.has(id)) continue;
		const at = strokes.findIndex((s) => JSON.stringify(s) === JSON.stringify(stroke));
		if (at >= 0) strokes.splice(at, 1);
	}
	const added = after.strokes.filter((s) => !had.has(s.id) && !nowErased.has(s.id));
	return { v: 1, strokes: [...strokes, ...added.map((s) => s.stroke)] };
}

export function createPartInk(store: InkStore | null) {
	let marks = $state.raw<Record<number, StrokeData>>({});
	let drawable = $state(true);
	// The page to show: hers from the device at open, then Entu's unless she turned first.
	let landing = $state(1);
	const hasMarks = $derived(Object.values(marks).some((page) => page.strokes.length > 0));
	let part: FileKey | null = null;
	let opening = 0;
	let turned = false;
	let line: Promise<void> = Promise.resolve();

	function enqueue(action: string, step: () => Promise<void>): void {
		line = line.then(step).catch((error: unknown) => {
			reportProblem({ area: 'part', action, error });
		});
	}

	const clamp = (page: number, pages: number) => Math.min(Math.max(page, 1), pages);

	async function join(synced: SyncedInkStore, run: number, next: FileKey, pages: number) {
		let remote;
		try {
			remote = await synced.pull(next);
		} catch (error) {
			if (run === opening) reportProblem({ area: 'part', action: 'loading the marks from Entu', error });
			return;
		}
		if (!remote || run !== opening) return;
		if (remote.page !== null && !turned) landing = clamp(remote.page, pages);
		for (const [key, log] of Object.entries(remote.pages)) {
			const page = Number(key);
			if (page < 1 || page > pages) continue;
			const at = { ...next, page };
			// Once another part opened, the saves left for this one carry their own page: a join
			// they do not show would be read as erased, so it waits for the next open.
			enqueue('joining the marks', async () => {
				if (run !== opening) return;
				const before = await synced.load(at);
				const after = await synced.merge(at, log);
				if (run !== opening) return;
				marks = { ...marks, [page]: rebase(marks[page] ?? { v: 1, strokes: [] }, before, after) };
			});
		}
	}

	async function open(next: FileKey, pages: number): Promise<void> {
		const run = ++opening;
		part = null;
		marks = {};
		drawable = true;
		landing = 1;
		turned = false;
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
		if (!isSynced(store)) return;
		try {
			const place = await store.placeOf(next);
			if (run === opening && place !== null) landing = clamp(place, pages);
		} catch (error) {
			if (run === opening) reportProblem({ area: 'part', action: 'reading her page', error });
		}
		if (run === opening && drawable) void join(store, run, next, pages);
	}

	function change(page: number, ink: StrokeData): void {
		const plain = $state.snapshot(ink) as StrokeData;
		marks = { ...marks, [page]: plain };
		if (!store || !part) return;
		const [target, at, run] = [store, { ...part, page }, opening];
		enqueue('saving the marks', () => target.save(at, run === opening ? marks[page] : plain));
	}

	function turn(page: number): void {
		turned = true;
		if (!isSynced(store) || !part) return;
		store.turn(part, page).catch((error: unknown) => {
			reportProblem({ area: 'part', action: 'keeping her page', error });
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
		get landing() {
			return landing;
		},
		open,
		change,
		turn
	};
}

// (*MVOX:Josquin*)
