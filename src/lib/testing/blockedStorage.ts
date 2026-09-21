// Simulates a browser told NOT to store site data (Chrome/Edge "Don't allow
// sites to save data", Safari "Block all cookies"). There, reading the
// `localStorage` PROPERTY throws SecurityError — the failure happens before any
// `getItem`/`setItem` call, which is why spying on those methods does not
// reproduce it, and why `typeof localStorage !== 'undefined'` guards do not help
// (typeof only suppresses ReferenceError for unresolvable bindings, never a
// getter that throws). #442 review F1.
//
// The accessor is installed on BOTH `globalThis` and `window` (vitest's
// happy-dom env copies window keys onto the global object, so a bare
// `localStorage` lookup in app code may resolve through either) and restored
// exactly as found.

type Target = Record<string, unknown>;

function install(target: Target): () => void {
	const had = Object.prototype.hasOwnProperty.call(target, 'localStorage');
	const original = Object.getOwnPropertyDescriptor(target, 'localStorage');
	Object.defineProperty(target, 'localStorage', {
		configurable: true,
		get() {
			throw new DOMException('The operation is insecure.', 'SecurityError');
		}
	});
	return () => {
		if (had && original) Object.defineProperty(target, 'localStorage', original);
		else delete target['localStorage'];
	};
}

/** Run `fn` with `localStorage` access throwing SecurityError; always restores. */
export function withBlockedStorage<T>(fn: () => T): T {
	const targets: Target[] = [globalThis as unknown as Target];
	if (typeof window !== 'undefined' && (window as unknown as Target) !== targets[0]) {
		targets.push(window as unknown as Target);
	}
	const restores = targets.map(install);
	try {
		return fn();
	} finally {
		for (const restore of restores.reverse()) restore();
	}
}

// (*MVOX:Josquin*)
