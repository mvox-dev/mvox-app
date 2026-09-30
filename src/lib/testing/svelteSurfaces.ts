// Every .svelte file under src/ for the page scans, derived so a new component is covered at once.
import { findSourceFiles } from './soleLiteralGuard';
import { COMMENT_FIXTURES_DIR } from './commentRules';

export const SURFACE_EXEMPT: Readonly<Record<string, string>> = {
	[COMMENT_FIXTURES_DIR]: 'planted comment-rule violations, never rendered'
};

export function selectSurfaces(paths: readonly string[]): string[] {
	return paths
		.filter((path) => path.startsWith('src/') && path.endsWith('.svelte'))
		.filter((path) => !Object.keys(SURFACE_EXEMPT).some((prefix) => path.startsWith(prefix)))
		.sort();
}

export function svelteSurfaces(): string[] {
	return selectSurfaces(findSourceFiles('src', ['.svelte']));
}

export function surfacesUnder(...folders: string[]): string[] {
	return svelteSurfaces().filter((path) => folders.some((folder) => path.startsWith(folder)));
}
