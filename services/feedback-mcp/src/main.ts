#!/usr/bin/env node
// Started by sshd's forced command: newline-delimited JSON-RPC on stdin, responses only on stdout.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { loadConfig } from './config.ts';
import { EntuReader } from './entu.ts';
import { downscaleToFit } from './image.ts';
import { handleMessage } from './protocol.ts';
import type { Ctx } from './tools.ts';

const { values } = parseArgs({
	options: {
		team: { type: 'string' },
		config: { type: 'string', default: '/etc/feedback-mcp/config.json' },
		log: { type: 'string', default: '/var/log/feedback-mcp/calls.log' }
	}
});

if (!values.team || !/^[a-z0-9-]+$/.test(values.team)) {
	process.stderr.write('feedback-mcp: --team <name> is required ([a-z0-9-]+)\n');
	process.exit(2);
}

const dbs = loadConfig(values.config);
const logPath = values.log;

function log(line: string): void {
	try {
		appendFileSync(logPath, `${line}\n`);
	} catch (err) {
		process.stderr.write(`feedback-mcp: log not written: ${(err as Error).message}\n${line}\n`);
	}
}

const ctx: Ctx = {
	reader: new EntuReader(dbs),
	dbs,
	team: values.team,
	log,
	resize: downscaleToFit
};

async function answer(line: string): Promise<void> {
	if (line.trim() === '') return;
	let msg: unknown;
	try {
		msg = JSON.parse(line);
	} catch {
		const error = { code: -32700, message: 'Parse error' };
		process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error })}\n`);
		return;
	}
	const res = await handleMessage(ctx, msg);
	if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
}

let queue = Promise.resolve();
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
	queue = queue.then(() => answer(line));
});
