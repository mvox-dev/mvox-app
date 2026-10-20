import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
			include: [
				'src/**/*.spec.ts',
				'scripts/**/*.spec.ts',
				'workers/**/*.spec.ts',
				'services/**/*.spec.ts'
			],
			environment: 'node',
			globals: false,
			// #163: no spec may reach a live Entu db; the env var carries that to child processes.
			setupFiles: ['./src/lib/testing/networkGuard.setup.ts'],
			// #504: the default triggers made any package.json diff rerun the full suite.
			forceRerunTriggers: [],
			env: {
				MVOX_TEST_NO_NETWORK: '1'
			}
		}
	})
);
