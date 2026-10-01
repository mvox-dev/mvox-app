// Which context each in-flight write belongs to, so a settle in a newer context applies nothing.
export interface WriteTokens<K> {
	begin(key: K): void;
	isCurrent(key: K): boolean;
	/** Forgets `key`; returns whether its write still belonged to the current context. */
	end(key: K): boolean;
}

/** `context` returns null when nothing is current for the key. */
export function createWriteTokens<K, T>(
	context: (key: K) => T | null,
	same: (a: T, b: T) => boolean = Object.is
): WriteTokens<K> {
	const tokens = new Map<K, T>();
	function isCurrent(key: K): boolean {
		if (!tokens.has(key)) return false;
		const now = context(key);
		return now !== null && same(tokens.get(key)!, now);
	}
	return {
		begin(key) {
			const now = context(key);
			if (now === null) tokens.delete(key);
			else tokens.set(key, now);
		},
		isCurrent,
		end(key) {
			const current = isCurrent(key);
			tokens.delete(key);
			return current;
		}
	};
}
