// The two ways a real browser refuses `localStorage`, as test instruments (#442).
//
// 1. SITE DATA BLOCKED (Chrome/Edge "Don't allow sites to save data", Safari
//    "Block all cookies"): reading the `localStorage` PROPERTY throws
//    SecurityError. The throw precedes any `getItem`/`setItem` call, so method
//    spies cannot reproduce it, and `typeof localStorage !== 'undefined'` does
//    not shield a caller either — `typeof` only suppresses ReferenceError for
//    unresolvable bindings, never a getter that throws.
// 2. WRITES REFUSED (quota exhausted, Safari private browsing): the object is
//    readable, `setItem` throws on every call.
//
// Both install an accessor on `globalThis` AND `window` (vitest's happy-dom env
// copies window keys onto the global object, so a bare `localStorage` lookup in
// app code may resolve through either) and restore it exactly as found. Patching
// `Storage.prototype` instead does NOT work: happy-dom hands out a Proxy that
// caches the bound method on first access, and the cache outlives the restore.

type Target = Record<string, unknown>;

function install(target: Target, get: () => unknown): () => void {
	const had = Object.prototype.hasOwnProperty.call(target, 'localStorage');
	const original = Object.getOwnPropertyDescriptor(target, 'localStorage');
	Object.defineProperty(target, 'localStorage', { configurable: true, get });
	return () => {
		if (had && original) Object.defineProperty(target, 'localStorage', original);
		else delete target['localStorage'];
	};
}

function withAccessor<T>(get: () => unknown, fn: () => T): T {
	const targets: Target[] = [globalThis as unknown as Target];
	if (typeof window !== 'undefined' && (window as unknown as Target) !== targets[0]) {
		targets.push(window as unknown as Target);
	}
	const restores = targets.map((target) => install(target, get));
	try {
		return fn();
	} finally {
		for (const restore of restores.reverse()) restore();
	}
}

/** Case 1: `localStorage` access itself throws SecurityError. Always restores. */
export function withBlockedStorage<T>(fn: () => T): T {
	return withAccessor(() => {
		throw new DOMException('The operation is insecure.', 'SecurityError');
	}, fn);
}

/** Case 2: reads work, every `setItem` throws QuotaExceededError. Always restores. */
export function withRefusedWrites<T>(fn: () => T): T {
	const real = globalThis.localStorage;
	const refusing = new Proxy(real, {
		get(target, prop) {
			if (prop === 'setItem') {
				return () => {
					throw new DOMException('quota exceeded', 'QuotaExceededError');
				};
			}
			return target[prop as keyof Storage];
		}
	});
	return withAccessor(() => refusing, fn);
}

// (*MVOX:Josquin*)
