// Which route pages reach a module through their imports, so a page contract finds its pages.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { findSourceFiles } from './soleLiteralGuard';
import { stripComments } from './commentRules';

const IMPORT = /(?:import|export)\s+(?!type\s)[^;]*?\bfrom\s*['"]((?:\$lib\/|\.)[^'"]+)['"]/g;

function moduleFile(spec: string, from: string): string | null {
	const base = spec.startsWith('$lib/') ? join('src/lib', spec.slice('$lib/'.length)) : join(dirname(from), spec);
	const bare = base.replace(/\.js$/, '');
	return [base, bare + '.ts', join(bare, 'index.ts')].find((path) => existsSync(path) && statSync(path).isFile()) ?? null;
}

function imports(file: string): string[] {
	const source = stripComments(readFileSync(file, 'utf-8'));
	return [...source.matchAll(IMPORT)].flatMap(([, spec]) => moduleFile(spec, file) ?? []);
}

type Target = string | ((file: string) => boolean);

export function reaches(file: string, target: Target, seen = new Set<string>()): boolean {
	if (typeof target === 'string' ? file === target : target(file)) return true;
	if (seen.has(file)) return false;
	seen.add(file);
	return imports(file).some((next) => reaches(next, target, seen));
}

/** Route paths ('/', '/event/[id]', ...) whose +page.svelte reaches `target`. */
export function pagesReaching(target: Target): string[] {
	return findSourceFiles('src/routes', ['/+page.svelte'])
		.filter((page) => reaches(page, target))
		.map((page) => page.slice('src/routes'.length).replace(/\/\+page\.svelte$/, '') || '/')
		.sort();
}
