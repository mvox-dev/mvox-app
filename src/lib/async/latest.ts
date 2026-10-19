// One way to drop a stale async result: next() opens a load, current() reads it, cancel() voids it.
export function createLatest() {
	let gen = 0;
	return {
		next(): () => boolean {
			const mine = ++gen;
			return () => mine === gen;
		},
		current(): () => boolean {
			const mine = gen;
			return () => mine === gen;
		},
		cancel(): void {
			++gen;
		}
	};
}

// (*MVOX:Josquin*)
