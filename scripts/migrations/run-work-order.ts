// Runs one work order (lib/work-order.ts): pnpm work-order:dry reads; pnpm work-order:live writes.
// Run from the app repo root: the ledger path is relative to it.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/entu/cfg';
import { errMsg, loadCredeCfg, runScript } from './lib/script-runner';
import { assertLiveGate } from './lib/work-order-live-gate';
import { loadCredentialsFile } from './lib/credentials-file';
import { assertLiveRunAuthorized, writeLedger } from './lib/ledger-writer';
import {
	assertGoFresh,
	authorizedByFromGo,
	parseWorkOrder,
	withResult,
	type CreatedId,
	type DeletePropertyOp,
	type OpRunner,
	type WorkOrderOp,
	type WorkOrderResult
} from './lib/work-order';
import { addEntityType } from './lib/add-entity-type';

export interface RunWorkOrderDeps {
	dryRun: boolean;
	fetchImpl: typeof fetch;
	log?: (line: string) => void;
	appRoot?: string;
	ordersDir?: string;
	now?: () => Date;
}

const APP_ROOT = join(import.meta.dirname, '..', '..');
const ORDERS_DIR = join(homedir(), 'workspace', 'teams', 'mvox-dev', 'work-orders');
const CREDENTIALS_FILE = join(homedir(), '.config', 'mvox', 'credentials.env');

// The mode is the script name, never an env var: a live run is its own command to allow.
export function parseCliArgs(argv: string[]): { dryRun: boolean; orderPath: string } {
	const [mode, orderPath] = argv;
	if (argv.length !== 2 || (mode !== '--dry' && mode !== '--live')) {
		throw new Error('usage: pnpm work-order:dry <order.yaml> | pnpm work-order:live <order.yaml>');
	}
	return { dryRun: mode === '--dry', orderPath };
}

type OpOutcome = WorkOrderResult['ops'][number];

// Each op narrows to its own runner; the mapped OP_RUNNERS type keeps the pairing sound.
function runnerOf(op: WorkOrderOp): OpRunner<WorkOrderOp> {
	return OP_RUNNERS[op.op] as OpRunner<WorkOrderOp>;
}

function where(index: number, op: WorkOrderOp): string {
	return `ops[${index}] ${runnerOf(op).describe(op)}`;
}

async function preCheckAll(cfg: EntuCfg, ops: WorkOrderOp[], deps: RunWorkOrderDeps, log: (l: string) => void) {
	for (const [index, op] of ops.entries()) {
		log(`  ${where(index, op)}`);
		try {
			await runnerOf(op).preCheck(cfg, op, deps.fetchImpl);
		} catch (err) {
			throw new Error(`${where(index, op)}: pre-check: ${errMsg(err)}`);
		}
		log(`  ops[${index}] pre-check ok; would write:`);
		for (const line of runnerOf(op).plan(op)) log(`    ${line}`);
	}
}

async function runOps(cfg: EntuCfg, ops: WorkOrderOp[], deps: RunWorkOrderDeps, log: (l: string) => void) {
	const outcomes: OpOutcome[] = ops.map((op) => ({ op: op.op, ...runnerOf(op).target(op), outcome: 'not-run' }));
	for (const [index, op] of ops.entries()) {
		const runner = runnerOf(op);
		const created: CreatedId[] = [];
		const withCreated = () => (created.length > 0 ? { created } : {});
		try {
			await runner.preCheck(cfg, op, deps.fetchImpl);
			await runner.execute(cfg, op, deps.fetchImpl, created);
			await runner.postCheck(cfg, op, deps.fetchImpl);
		} catch (err) {
			const error = `${where(index, op)}: ${errMsg(err)}`;
			outcomes[index] = { ...outcomes[index], ...withCreated(), outcome: 'failed', error };
			return { outcomes, failure: new Error(error) };
		}
		outcomes[index] = { ...outcomes[index], ...withCreated(), outcome: runner.done };
		log(`  ops[${index}] done, post-check ok`);
	}
	return { outcomes, failure: undefined };
}

export async function cliMain(
	argv: string[],
	deps: { credentialsPath?: string; fetchImpl: typeof fetch; log?: (line: string) => void }
): Promise<void> {
	const { dryRun, orderPath } = parseCliArgs(argv);
	loadCredentialsFile(deps.credentialsPath ?? CREDENTIALS_FILE, process.env);
	await runWorkOrder(orderPath, { dryRun, fetchImpl: deps.fetchImpl, log: deps.log });
}

export async function runWorkOrder(orderPath: string, deps: RunWorkOrderDeps): Promise<void> {
	const log = deps.log ?? console.log;
	const fileName = basename(orderPath);
	const source = readFileSync(orderPath, 'utf-8');
	const order = parseWorkOrder(source, fileName);
	const authorizedBy = authorizedByFromGo(order.go, fileName);
	assertLiveRunAuthorized(deps.dryRun, authorizedBy);
	if (!deps.dryRun) {
		assertGoFresh(order.go, deps.now?.() ?? new Date());
		assertLiveGate(orderPath, deps.appRoot ?? APP_ROOT, deps.ordersDir ?? ORDERS_DIR);
	}

	const cfg = await loadCredeCfg('MVOX_CREDE_DB', 'MVOX_CREDE_API_KEY', order.db, deps.fetchImpl);
	if (cfg.db !== order.db) {
		throw new Error(`run-work-order: the order is for '${order.db}', but MVOX_CREDE_DB opens '${cfg.db}'`);
	}
	log(`${deps.dryRun ? 'DRY RUN' : 'LIVE'}: ${fileName} on ${order.db}, ${order.ops.length} op(s)`);
	await preCheckAll(cfg, order.ops, deps, log);
	if (deps.dryRun) {
		log('dry run: nothing written. Commit the order, then pnpm work-order:live to apply.');
		return;
	}

	const { outcomes, failure } = await runOps(cfg, order.ops, deps, log);
	const ledger = writeLedger({
		scriptName: `work-order-${fileName.replace(/\.yaml$/, '')}`,
		dryRun: false,
		db: order.db,
		sensitive: true,
		payload: { order: fileName, ref: order.ref, ops: outcomes },
		authorizedBy
	});
	const result: WorkOrderResult = {
		ran_at: new Date().toISOString(),
		outcome: failure ? 'failed' : 'done',
		ledger,
		ops: outcomes
	};
	writeFileSync(orderPath, withResult(source, result));
	log(`${result.outcome}: result written to ${fileName}, ledger ${ledger}`);
	if (failure) throw failure;
}

async function readValues(cfg: EntuCfg, op: DeletePropertyOp, fetchImpl: typeof fetch) {
	const res = await entuFetch(cfg.db, `entity/${op.entity}?props=${op.expect.type}`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`reading entity ${op.entity} failed: HTTP ${res.status}`);
	const body = (await res.json()) as { entity?: Record<string, unknown> };
	const values = body.entity?.[op.expect.type];
	return (Array.isArray(values) ? values : []) as Array<Record<string, unknown>>;
}

// Errors name only what the order already holds: the live value may be personal data.
const deleteProperty: OpRunner<DeletePropertyOp> = {
	describe: (op) => `delete-property ${op.property} on ${op.entity} (${op.expect.type})`,
	target: (op) => ({ property: op.property }),
	done: 'deleted',
	plan: (op) => [`DELETE property ${op.property}`],
	async preCheck(cfg, op, fetchImpl) {
		const value = (await readValues(cfg, op, fetchImpl)).find((v) => v._id === op.property);
		if (!value) throw new Error(`property ${op.property} is not on entity ${op.entity} as '${op.expect.type}'`);
		for (const [key, expected] of Object.entries(op.expect)) {
			if (key !== 'type' && expected !== undefined && (value[key] ?? null) !== expected) {
				throw new Error(`${key} does not match the order's '${String(expected)}'`);
			}
		}
	},
	async execute(cfg, op, fetchImpl) {
		const res = await entuFetch(cfg.db, `property/${op.property}`, cfg.token, { method: 'DELETE' }, fetchImpl);
		if (!res.ok) throw new Error(`DELETE property ${op.property} failed: HTTP ${res.status}`);
	},
	async postCheck(cfg, op, fetchImpl) {
		if ((await readValues(cfg, op, fetchImpl)).some((v) => v._id === op.property)) {
			throw new Error(`post-check: property ${op.property} is still on entity ${op.entity}`);
		}
	}
};

const OP_RUNNERS: { [K in WorkOrderOp['op']]: OpRunner<Extract<WorkOrderOp, { op: K }>> } = {
	'delete-property': deleteProperty,
	'add-entity-type': addEntityType
};

const isMainModule = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
	runScript('run-work-order', async () => {
		await cliMain(process.argv.slice(2), { fetchImpl: fetch });
		return true;
	});
}
