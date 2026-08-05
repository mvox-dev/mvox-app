import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';

export default defineConfig({
	plugins: [
		tailwindcss(),
		// Plain @inlang/paraglide-js, not @inlang/paraglide-sveltekit: the
		// -sveltekit package's locale routing and language detection assume a
		// server (hooks.server.ts + paraglideMiddleware). This app has ssr = false
		// and no server code at all, so locale detection is resolved entirely in
		// the browser via the strategy list below.
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			strategy: ['localStorage', 'preferredLanguage', 'baseLocale'],
		}),
		sveltekit(),
	],
});
