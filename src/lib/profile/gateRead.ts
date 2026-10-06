// One generation for every completion-gate read, from the layout and /profile alike (#800).
let generation = 0;

export function beginGateRead(): () => boolean {
	const g = ++generation;
	return () => g === generation;
}
