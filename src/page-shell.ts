// #341 — the page-shell guard's instrument, pure: route files in, violations
// out. The spec (src/page-shell.spec.ts) owns the allowlist, the live walk and
// the WHY; this module only answers "does this source carry the house shell?"
// so the spec can pin the behaviour on inline string fixtures.
//
// The check is CONTAINS, not is-the-root — src/page-shell.spec.ts states the
// limit and its reason where the reader meets it. Comment/script/style
// stripping mirrors src/unclassed-controls.spec.ts (#335): prose that LOOKS
// like markup must never satisfy a markup check.

export const HOUSE_SHELL = '<main class="min-h-screen bg-paper px-6 py-10 text-ink">';

export interface RouteFile {
	/** Route path, '/'-rooted: '/', '/auth/login', '/event/[id]', ... */
	route: string;
	/** Full text of the route's +page.svelte. */
	source: string;
}

export interface ShellViolation {
	route: string;
	detail: string;
}

/** Blank a matched span, preserving newlines. */
function blank(span: string): string {
	return span.replace(/[^\n]/g, ' ');
}

/**
 * A commented-out shell is an ABSENT shell: HTML comments are blanked before
 * matching (#335's comment-blindness lesson, both prior sweeps bitten).
 */
export function stripHtmlComments(source: string): string {
	return source.replace(/<!--[\s\S]*?-->/g, blank);
}

/**
 * The shell is markup — the string as prose in a <script> // comment (or a
 * <style> block) must not satisfy contains() either. Same failure class as
 * HTML comments, one comment syntax over (#335 found 27 such phantoms).
 */
export function stripScriptAndStyle(source: string): string {
	return source
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, blank)
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, blank);
}

/**
 * Fail-closed by construction: a route is a violation UNLESS its template
 * (comments, script and style stripped) contains the house shell string, or
 * its route path is on the allowlist. An unknown route with no shell is a
 * violation — nothing needs registering for the guard to fire on it.
 */
export function findShellViolations(
	routeFiles: RouteFile[],
	allowlist: ReadonlyMap<string, string>
): ShellViolation[] {
	const violations: ShellViolation[] = [];
	for (const { route, source } of routeFiles) {
		if (allowlist.has(route)) continue;
		const template = stripHtmlComments(stripScriptAndStyle(source));
		if (template.includes(HOUSE_SHELL)) continue;
		violations.push({
			route,
			detail: 'carries neither the house shell nor an allowlist entry'
		});
	}
	return violations;
}

// (*MVOX:Tallis* — #341 RED)
