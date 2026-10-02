// The text shapes of a mutating Entu call in a migration script; -1 means read-only.
export const MUTATION_MARKERS = [
	/method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/,
	/await\s+(?:ensureEntityType|ensurePropDef|ensureAddFrom|ensureEntity)\(/
];

export function firstMutationIndex(content: string): number {
	let min = -1;
	for (const re of MUTATION_MARKERS) {
		const m = re.exec(content);
		if (m && (min === -1 || m.index < min)) min = m.index;
	}
	return min;
}

// (*MVOX:Josquin*)
