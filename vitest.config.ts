import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// Reuse the app's Vite config (SvelteKit + Paraglide + Tailwind plugins) so that
// `$lib`, `$env/*`, and `$app/*` virtual modules resolve inside unit tests. Default
// environment is `node`; specs that touch localStorage/sessionStorage opt into
// happy-dom per-file via `// @vitest-environment happy-dom`.
export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
			include: ['src/**/*.spec.ts'],
			environment: 'node',
			globals: false
		}
	})
);
