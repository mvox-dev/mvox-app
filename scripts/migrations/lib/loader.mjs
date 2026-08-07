// ESM resolve hook for STANDALONE node execution of the T4.10 migration (#30).
//
// `$env/dynamic/public` is a Vite virtual module (no on-disk file); plain node/tsx
// cannot resolve it. This hook rewrites that specifier to the local shim, and — belt
// and suspenders — maps `$lib/*` → `src/lib/*` (tsx already honors the tsconfig
// `$lib` path mapping, but this keeps the script self-contained). Everything else
// delegates to the default resolver. RECON C proved this pattern imports and runs the
// real createProfile chain outside Vite.
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = pathResolve(here, '..', '..', '..');
const shimUrl = pathToFileURL(pathResolve(here, 'env-dynamic-public.ts')).href;

export async function resolve(specifier, context, nextResolve) {
	if (specifier === '$env/dynamic/public') {
		// Delegate (do NOT short-circuit) so tsx's load hook still transpiles the .ts shim.
		return nextResolve(shimUrl, context);
	}
	if (specifier === '$lib' || specifier.startsWith('$lib/')) {
		const rest = specifier === '$lib' ? '' : specifier.slice('$lib/'.length);
		const target = pathToFileURL(pathResolve(repoRoot, 'src', 'lib', rest)).href;
		return nextResolve(target, context);
	}
	return nextResolve(specifier, context);
}
