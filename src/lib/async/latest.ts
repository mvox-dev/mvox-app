// Drops stale async results: next() opens a load, whileCurrent() reads it, cancel() voids it.
export function createLatest() {
	let gen = 0;
	return {
		next(): () => boolean {
			const mine = ++gen;
			return () => mine === gen;
		},
		whileCurrent(): () => boolean {
			const mine = gen;
			return () => mine === gen;
		},
		cancel(): void {
			++gen;
		}
	};
}

// (*MVOX:Josquin*)
