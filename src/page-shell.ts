// The page-shell check, pure: route files in, violations out. Why: docs/architecture/guards.md.

export const HOUSE_SHELL = '<main class="min-h-screen bg-paper px-6 py-10 text-ink">';

export interface RouteFile {
	route: string;
	source: string;
}

export interface ShellViolation {
	route: string;
	detail: string;
}

function blank(span: string): string {
	return span.replace(/[^\n]/g, ' ');
}

// A commented-out shell is an absent shell.
export function stripHtmlComments(source: string): string {
	return source.replace(/<!--[\s\S]*?-->/g, blank);
}

// The shell string as prose in a <script> comment or a <style> block is no shell either.
export function stripScriptAndStyle(source: string): string {
	return source
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, blank)
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, blank);
}

// Fail-closed: a route without the shell and without an allowlist entry is a violation.
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
