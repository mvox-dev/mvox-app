import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { runningBuild } from './src/routes/version.json/running-build';

export default defineConfig({
	plugins: [
		tailwindcss(),
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			// No 'localStorage' (#442): its unguarded read threw in a browser that stores nothing.
			strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
		}),
		sveltekit(),
		runningBuild(),
	],
	// #347: bucket GET allowlist is http://localhost:3000 only; see docs/architecture/build-config.md
	server: { port: 3000, strictPort: true },
	resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
});
