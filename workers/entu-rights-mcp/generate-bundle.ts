// #318 — CLI wrapper for the pure generator (src/generate.ts). Run at deploy
// time (see README.md): reads the rights model doc plus the current commit
// SHA/date and writes the GITIGNORED rules bundle that the Worker entry
// point (src/index.ts, at activation) imports.
//
// This file is the only place that shells out (`git rev-parse HEAD`) or
// touches the filesystem for writing — src/generate.ts's buildBundle /
// generateBundleJson stay pure functions, exercised directly by
// generator.spec.ts without ever running this script.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateBundleJson } from './src/generate';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC_PATH = resolve(HERE, '../../docs/architecture/entu-rights-and-visibility-model.md');
const OUT_DIR = resolve(HERE, 'generated');
const OUT_PATH = resolve(OUT_DIR, 'rules-bundle.json');

function git(...args: string[]): string {
	return execFileSync('git', args, { cwd: resolve(HERE, '../..'), encoding: 'utf-8' }).trim();
}

function main(): void {
	const doc = readFileSync(DOC_PATH, 'utf-8');
	const sourceCommit = process.argv[2] ?? git('rev-parse', 'HEAD');
	const sourceCommitDate = process.argv[3] ?? git('show', '-s', '--format=%cI', sourceCommit);

	const json = generateBundleJson(doc, sourceCommit, sourceCommitDate);
	mkdirSync(OUT_DIR, { recursive: true });
	writeFileSync(OUT_PATH, json, 'utf-8');
	// eslint-disable-next-line no-console
	console.log(`entu-rights-mcp: wrote ${OUT_PATH} @ ${sourceCommit.slice(0, 7)} (${sourceCommitDate})`);
}

main();
