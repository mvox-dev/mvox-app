// #1048 — the build bakes in the commit it came from, read the way /version.json reads it.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import config from '../../../vite.config';
import { buildStamp } from './build-stamp';
import { buildCommit } from './running-build';

const FULL_SHA = '4169b0b8f2e1d3c5a7b9e0f1a2b3c4d5e6f70819';
const CF_ENV = { CF_PAGES_BRANCH: 'main', CF_PAGES_COMMIT_SHA: FULL_SHA };
const ENV_KEYS = ['CF_PAGES_BRANCH', 'CF_PAGES_COMMIT_SHA'] as const;

const gitHead = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();

/** What vite.config.ts defines for a build or a dev server, through its own plugin. */
function definedFor(command: 'build' | 'serve'): Record<string, string> | undefined {
	const plugins = (config.plugins as unknown[]).flat(9) as Plugin[];
	const plugin = plugins.find((p) => p?.name === 'mvox-running-build');
	expect(plugin, 'vite.config.ts must carry the running-build plugin').toBeDefined();
	const hook = plugin!.config as (c: object, e: object) => { define?: Record<string, string> };
	return hook({}, { command, mode: command === 'build' ? 'production' : 'development' }).define;
}

describe('#1048 the commit a build bakes in', () => {
	let saved: Record<string, string | undefined>;

	beforeEach(() => {
		saved = {};
		for (const key of ENV_KEYS) {
			saved[key] = process.env[key];
			delete process.env[key];
		}
	});

	afterEach(() => {
		for (const key of ENV_KEYS) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	});

	it('a CF Pages build bakes in its full commit, not a timestamp', () => {
		Object.assign(process.env, CF_ENV);
		expect(definedFor('build')).toEqual({ __BUILD_COMMIT__: JSON.stringify(FULL_SHA) });
	});

	it('names the same commit /version.json does for that build', () => {
		expect(buildCommit(CF_ENV, 'build')).toBe(buildStamp(CF_ENV).commit);
	});

	it('a build with no commit to name fails, naming the missing variables', () => {
		expect(() => definedFor('build')).toThrow('CF_PAGES_BRANCH is unset');
		expect(() => buildCommit({ CF_PAGES_BRANCH: 'main' }, 'build')).toThrow(/CF_PAGES_COMMIT_SHA/);
		expect(() => buildCommit({ ...CF_ENV, CF_PAGES_COMMIT_SHA: '4169b0b' }, 'build')).toThrow(
			/CF_PAGES_COMMIT_SHA/
		);
	});

	it('says which variable is wrong: unset, or set but not a full sha', () => {
		expect(() => buildCommit({ CF_PAGES_COMMIT_SHA: FULL_SHA }, 'build')).toThrow(
			'CF_PAGES_BRANCH is unset'
		);
		expect(() => buildCommit({ CF_PAGES_BRANCH: 'main' }, 'build')).toThrow(
			'CF_PAGES_COMMIT_SHA is unset'
		);
		const short = () => buildCommit({ ...CF_ENV, CF_PAGES_COMMIT_SHA: '4169b0b' }, 'build');
		expect(short).toThrow('CF_PAGES_COMMIT_SHA "4169b0b" is not a full 40-character sha');
		expect(short).not.toThrow(/unset/);
	});

	it('a dev server outside a git checkout fails, naming the cause', () => {
		const dir = mkdtempSync(join(tmpdir(), 'mvox-1048-'));
		try {
			expect(() => buildCommit({}, 'serve', dir)).toThrow(
				`#1048: a dev server names its checkout's commit, but ${dir} is not a git checkout`
			);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	it('a dev server names the commit its checkout is at', () => {
		expect(definedFor('serve')).toEqual({ __BUILD_COMMIT__: JSON.stringify(gitHead()) });
	});
});

// (*MVOX:Josquin*)
