// Before a live work-order run: clean main equal to origin/main, and a committed, unchanged order.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, dirname } from 'node:path';

function git(cwd: string, args: string[]): string {
	return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function refuse(message: string): never {
	throw new Error(`live run refused: ${message}`);
}

function assertAppTreeIsMain(appRoot: string): void {
	const branch = git(appRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
	if (branch !== 'main') refuse(`app tree is on '${branch}', not main`);
	git(appRoot, ['fetch', '-q', 'origin', 'main']);
	if (git(appRoot, ['rev-parse', 'HEAD']) !== git(appRoot, ['rev-parse', 'origin/main'])) {
		refuse('app tree HEAD is not origin/main: pull, or land the change through a PR first');
	}
	if (git(appRoot, ['status', '--porcelain'])) refuse('app tree is not clean');
}

function assertOrderCommitted(orderPath: string, ordersDir: string): void {
	if (dirname(realpathSync(orderPath)) !== realpathSync(ordersDir)) {
		refuse(`order ${orderPath} is not in ${ordersDir}`);
	}
	const name = basename(orderPath);
	let committed = '';
	try {
		committed = git(ordersDir, ['ls-tree', '--name-only', 'HEAD', '--', name]);
	} catch (err) {
		refuse(`order ${name} is not committed (${err instanceof Error ? err.message.split('\n')[0] : err})`);
	}
	if (!committed) refuse(`order ${name} is not committed`);
	if (git(ordersDir, ['status', '--porcelain', '--', name])) refuse(`order ${name} has changes not committed`);
}

export function assertLiveGate(orderPath: string, appRoot: string, ordersDir: string): void {
	assertAppTreeIsMain(appRoot);
	assertOrderCommitted(orderPath, ordersDir);
}
