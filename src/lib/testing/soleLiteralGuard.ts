// Source-tree walks for the structural guard specs, shared so no spec imports another.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function isSoleCreatePathViolation(
	relPath: string,
	content: string,
	needle: string,
	exemptRelPaths: string[]
): boolean {
	if (relPath.endsWith('.spec.ts')) return false; // tests may reference the literal in assertions/comments
	if (exemptRelPaths.includes(relPath)) return false;
	return content.includes(needle);
}

export interface FindOptions {
	excludeSpecs?: boolean;
	skipDirs?: string[];
}

export function findSourceFiles(
	dir: string,
	extensions: string[],
	options: FindOptions = {}
): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			if (options.skipDirs?.includes(entry)) continue;
			out.push(...findSourceFiles(full, extensions, options));
			continue;
		}
		if (options.excludeSpecs && full.endsWith('.spec.ts')) continue;
		if (extensions.some((ext) => full.endsWith(ext))) out.push(full);
	}
	return out;
}
