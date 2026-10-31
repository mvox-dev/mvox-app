// #1048 — the commit the bundle is built from, baked in as __BUILD_COMMIT__ by vite.config.ts.
// A build reads it as /version.json does, so the two agree; a dev server names its checkout.
import { execFileSync } from 'node:child_process';
import type { Plugin } from 'vite';
import { buildStamp, type BuildStampEnv } from './build-stamp';

function checkoutHead(cwd: string): string {
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd,
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'pipe']
		}).trim();
	} catch (error) {
		const cause = (error as NodeJS.ErrnoException).code === 'ENOENT'
			? 'git is not installed'
			: `${cwd} is not a git checkout`;
		throw new Error(`#1048: a dev server names its checkout's commit, but ${cause}`, {
			cause: error
		});
	}
}

function whatIsWrong(env: BuildStampEnv): string {
	if (!env.CF_PAGES_BRANCH) return 'CF_PAGES_BRANCH is unset';
	if (!env.CF_PAGES_COMMIT_SHA) return 'CF_PAGES_COMMIT_SHA is unset';
	const sha = JSON.stringify(env.CF_PAGES_COMMIT_SHA);
	return `CF_PAGES_COMMIT_SHA ${sha} is not a full 40-character sha`;
}

export function buildCommit(
	env: BuildStampEnv,
	command: 'build' | 'serve',
	cwd = process.cwd()
): string {
	if (command === 'serve') return checkoutHead(cwd);
	const { commit } = buildStamp(env);
	if (commit === null) throw new Error(`#1048: a build must name its commit: ${whatIsWrong(env)}`);
	return commit;
}

export function runningBuild(): Plugin {
	return {
		name: 'mvox-running-build',
		config: (_config, { command }) => ({
			define: { __BUILD_COMMIT__: JSON.stringify(buildCommit(process.env, command)) }
		})
	};
}
