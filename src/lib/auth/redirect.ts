// Client-safe redirect helper (open-redirect guard).

/** Return a safe local redirect target, or `/` for anything non-local (open-redirect guard). */
export function safeRedirectTarget(raw: string | null): string {
	if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
	return raw;
}

// (*MVOX:Josquin*) — lifted as-is from the polyphony harvest (*FR:Celes*)
