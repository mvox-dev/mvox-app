// The work-order runner on a fake Entu and temp git repos: what it reads, deletes, records, refuses
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { json } from '$lib/testing/entuFetchKit';

const LEDGER_PATH = 'scripts/migrations/seed-results/crede-instance/work-order-fake.json';
const writeLedgerMock = vi.fn((..._args: unknown[]) => LEDGER_PATH);

vi.mock('./lib/ledger-writer', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./lib/ledger-writer')>();
	return { ...actual, writeLedger: (...args: unknown[]) => writeLedgerMock(...args) };
});

import { cliMain, parseCliArgs, runWorkOrder } from './run-work-order';

const NAME = '2026-11-01-phantom-file.yaml';
const ENTITY = '6ae5fb5ad665720a18b9e400';
const PROPERTY = '6ae5fb5ad665720a18b9e420';
const ENTITY_2 = '6ae5fb5ad665720a18b9e401';
const PROPERTY_2 = '6ae5fb5ad665720a18b9e421';
const TOKEN = 'secret-jwt-value';
const BASE = 'https://api.entu-test.invalid/mvox_crede';

function opYaml(entity: string, property: string, filesize: number | null = 0): string {
	return [
		'  - op: delete-property',
		`    entity: '${entity}'`,
		`    property: '${property}'`,
		'    expect:',
		'      type: photo',
		`      filesize: ${filesize}`
	].join('\n');
}

function orderYaml(ops = [opYaml(ENTITY, PROPERTY)]): string {
	return [
		'db: mvox_crede',
		'why: drop a file property whose upload never landed',
		"ref: 'mihkel:2026-11-01'",
		'go:',
		'  by: Mihkel',
		"  at: '2026-11-01T23:53:00+02:00'",
		'  quote: yes, delete it',
		'ops:',
		...ops,
		''
	].join('\n');
}

interface Wire {
	calls: Array<{ method: string; url: string }>;
	authKeys: string[];
	values: Record<string, Array<Record<string, unknown>>>;
	deleteStatus: number;
	keepAfterDelete: boolean;
}

function fakeEntu(wire: Wire): typeof fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = (init?.method ?? 'GET').toUpperCase();
		wire.calls.push({ method, url });
		if (/\/auth\?db=mvox_crede$/.test(url)) {
			wire.authKeys.push(String(new Headers(init?.headers).get('Authorization')));
			return json({ token: TOKEN, accounts: [{ _id: 'mvox_crede', user: { _id: 'runner-1' } }] });
		}
		const read = /\/entity\/([0-9a-f]{24})\?props=photo$/.exec(url);
		if (method === 'GET' && read) {
			const photo = wire.values[read[1]];
			return photo ? json({ entity: { _id: read[1], photo } }) : json({ error: 'not found' }, 404);
		}
		const del = /\/property\/([0-9a-f]{24})$/.exec(url);
		if (method === 'DELETE' && del) {
			if (wire.deleteStatus === 200 && !wire.keepAfterDelete) {
				for (const id of Object.keys(wire.values)) {
					wire.values[id] = wire.values[id].filter((v) => v._id !== del[1]);
				}
			}
			return json({ deleted: true }, wire.deleteStatus);
		}
		throw new Error(`fake Entu: unexpected ${method} ${url}`);
	}) as typeof fetch;
}

let dir: string;
let app: string;
let ordersDir: string;
let path: string;
let wire: Wire;
let lines: string[];

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', '-C', cwd, ...args], {
		encoding: 'utf-8',
		stdio: ['ignore', 'pipe', 'pipe']
	});
}

// origin.git <- app (on main, pushed, clean); a home repo holding work-orders/.
function buildWorld(): void {
	git(dir, 'init', '-q', '--bare', '-b', 'main', 'origin.git');
	git(dir, 'clone', '-q', join(dir, 'origin.git'), 'app');
	app = join(dir, 'app');
	git(app, 'checkout', '-q', '-b', 'main');
	writeFileSync(join(app, 'a.txt'), 'a\n');
	git(app, 'add', 'a.txt');
	git(app, 'commit', '-q', '-m', 'a');
	git(app, 'push', '-q', 'origin', 'main');
	git(dir, 'init', '-q', '-b', 'main', 'home');
	ordersDir = join(dir, 'home', 'work-orders');
	mkdirSync(ordersDir);
	path = join(ordersDir, NAME);
}

function writeOrder(text: string): void {
	writeFileSync(path, text);
	git(ordersDir, 'add', NAME);
	git(ordersDir, 'commit', '-q', '-m', 'order');
}

const NOW = new Date('2026-11-02T00:10:00Z');

function run(dryRun: boolean, orderPath = path, now = NOW) {
	return runWorkOrder(orderPath, {
		dryRun,
		now: () => now,
		fetchImpl: fakeEntu(wire),
		log: (line) => lines.push(line),
		appRoot: app,
		ordersDir
	});
}

const deletes = () => wire.calls.filter((c) => c.method === 'DELETE');

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'work-order-'));
	buildWorld();
	wire = {
		calls: [],
		authKeys: [],
		values: {
			[ENTITY]: [
				{ _id: PROPERTY, filename: 'scan.pdf', filesize: 0 },
				{ _id: '6ae5fb5ad665720a18b9e499', filename: 'keep.pdf', filesize: 10 }
			],
			[ENTITY_2]: [{ _id: PROPERTY_2, filename: 'two.pdf' }]
		},
		deleteStatus: 200,
		keepAfterDelete: false
	};
	lines = [];
	writeLedgerMock.mockClear();
	vi.stubEnv('MVOX_CREDE_API_KEY', 'secret-api-key');
	vi.stubEnv('MVOX_CREDE_DB', 'mvox_crede');
	vi.stubEnv('AUTHORIZED_BY', 'someone else, from the environment');
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('dry run', () => {
	it('reads the target, prints the plan and writes nothing', async () => {
		writeOrder(orderYaml());
		await run(true);
		expect(deletes()).toEqual([]);
		expect(wire.calls.map((c) => c.method)).toEqual(['GET', 'GET']);
		expect(readFileSync(path, 'utf-8')).toBe(orderYaml());
		expect(writeLedgerMock).not.toHaveBeenCalled();
		expect(lines.join('\n')).toContain(`delete-property ${PROPERTY} on ${ENTITY}`);
		expect(lines.join('\n')).toContain('pre-check ok');
	});
});

describe('pre-check stops before any write', () => {
	it('a value that differs from expect', async () => {
		writeOrder(orderYaml([opYaml(ENTITY, PROPERTY, 7)]));
		await expect(run(false)).rejects.toThrow(`filesize does not match the order's '7'`);
		expect(deletes()).toEqual([]);
		expect(readFileSync(path, 'utf-8')).toBe(orderYaml([opYaml(ENTITY, PROPERTY, 7)]));
		expect(writeLedgerMock).not.toHaveBeenCalled();
	});

	it('a property that is not on the entity', async () => {
		wire.values[ENTITY] = [];
		writeOrder(orderYaml());
		await expect(run(false)).rejects.toThrow(`property ${PROPERTY} is not on entity ${ENTITY}`);
		expect(deletes()).toEqual([]);
	});

	it('an entity that cannot be read', async () => {
		delete wire.values[ENTITY];
		writeOrder(orderYaml());
		await expect(run(false)).rejects.toThrow('HTTP 404');
		expect(deletes()).toEqual([]);
	});

	it('a later op that does not match: the first op is not run either', async () => {
		writeOrder(orderYaml([opYaml(ENTITY, PROPERTY), opYaml(ENTITY_2, PROPERTY_2, 9)]));
		await expect(run(false)).rejects.toThrow('ops[1]');
		expect(deletes()).toEqual([]);
		expect(writeLedgerMock).not.toHaveBeenCalled();
	});
});

describe('filesize null', () => {
	it('matches a property with no size', async () => {
		writeOrder(orderYaml([opYaml(ENTITY_2, PROPERTY_2, null)]));
		await run(true);
		expect(lines.join('\n')).toContain('ops[0] pre-check ok');
	});

	it('does not match a property that has a size', async () => {
		writeOrder(orderYaml([opYaml(ENTITY, PROPERTY, null)]));
		await expect(run(true)).rejects.toThrow("filesize does not match the order's 'null'");
	});
});

describe('refusals before any call', () => {
	it('a spent order', async () => {
		writeOrder(orderYaml() + "result:\n  ran_at: '2026-11-02T00:10:00Z'\n");
		await expect(run(false)).rejects.toThrow('spent');
		expect(wire.calls).toEqual([]);
	});

	it('an order for another db than the key opens', async () => {
		writeOrder(orderYaml().replace('db: mvox_crede', 'db: mvox_other'));
		await expect(run(true)).rejects.toThrow("order is for 'mvox_other'");
		expect(wire.calls.filter((c) => !c.url.includes('/auth?'))).toEqual([]);
	});
});

describe('live run', () => {
	it('deletes exactly the named property, then records the ledger and the result', async () => {
		writeOrder(orderYaml());
		await run(false);
		expect(deletes()).toEqual([{ method: 'DELETE', url: `${BASE}/property/${PROPERTY}` }]);
		expect(wire.values[ENTITY].map((v) => v._id)).toEqual(['6ae5fb5ad665720a18b9e499']);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		const ledger = writeLedgerMock.mock.calls[0][0] as Record<string, unknown>;
		expect(ledger).toMatchObject({
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: `Mihkel, 2026-11-01T23:53:00+02:00, work order ${NAME}`
		});

		const written = readFileSync(path, 'utf-8');
		expect(written.startsWith(orderYaml().trimEnd())).toBe(true);
		const result = parse(written).result;
		expect(result).toMatchObject({ outcome: 'done', ledger: LEDGER_PATH });
		expect(result.ops).toEqual([{ op: 'delete-property', property: PROPERTY, outcome: 'deleted' }]);
		expect(Date.parse(result.ran_at)).not.toBeNaN();
	});

	it('a property still there after the delete fails loudly and is recorded as failed', async () => {
		wire.keepAfterDelete = true;
		writeOrder(orderYaml([opYaml(ENTITY, PROPERTY), opYaml(ENTITY_2, PROPERTY_2, null)]));
		await expect(run(false)).rejects.toThrow(`post-check: property ${PROPERTY} is still on entity ${ENTITY}`);
		expect(deletes()).toHaveLength(1);
		const result = parse(readFileSync(path, 'utf-8')).result;
		expect(result.outcome).toBe('failed');
		expect(result.ops.map((o: { outcome: string }) => o.outcome)).toEqual(['failed', 'not-run']);
		expect(result.ops[0].error).toContain('still on entity');
		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
	});

	it('a refused delete stops the run and is recorded as failed', async () => {
		wire.deleteStatus = 403;
		writeOrder(orderYaml([opYaml(ENTITY, PROPERTY), opYaml(ENTITY_2, PROPERTY_2, null)]));
		await expect(run(false)).rejects.toThrow('HTTP 403');
		expect(deletes()).toHaveLength(1);
		const result = parse(readFileSync(path, 'utf-8')).result;
		expect(result.ops.map((o: { outcome: string }) => o.outcome)).toEqual(['failed', 'not-run']);
	});

	it('never prints the token or the API key', async () => {
		writeOrder(orderYaml());
		await run(false);
		expect(lines.length).toBeGreaterThan(0);
		expect(lines.join('\n')).not.toContain(TOKEN);
		expect(lines.join('\n')).not.toContain('secret-api-key');
	});
});

describe('a live run refuses, before any call to Entu', () => {
	const cases: Array<[string, () => string, string]> = [
		[
			'an app tree not on main',
			() => (git(app, 'checkout', '-q', '-b', 'side'), path),
			"app tree is on 'side', not main"
		],
		[
			'an app tree with a commit origin/main lacks',
			() => (git(app, 'commit', '-q', '--allow-empty', '-m', 'local'), path),
			'app tree HEAD is not origin/main'
		],
		[
			'an app tree behind origin/main',
			() => {
				git(dir, 'clone', '-q', join(dir, 'origin.git'), 'other');
				git(join(dir, 'other'), 'commit', '-q', '--allow-empty', '-m', 'ahead');
				git(join(dir, 'other'), 'push', '-q', 'origin', 'main');
				return path;
			},
			'app tree HEAD is not origin/main'
		],
		[
			'an app tree with a changed file',
			() => (writeFileSync(join(app, 'a.txt'), 'b\n'), path),
			'app tree is not clean'
		],
		[
			'an app tree with an untracked file',
			() => (writeFileSync(join(app, 'new.ts'), 'x\n'), path),
			'app tree is not clean'
		],
		[
			'an order outside the work-orders folder',
			() => {
				const outside = join(dir, 'home', NAME);
				writeFileSync(outside, orderYaml());
				return outside;
			},
			'is not in'
		],
		[
			'an order not committed',
			() => (writeFileSync(path, orderYaml()), path),
			'is not committed'
		],
		[
			'an order staged but not committed, in a repo with other commits',
			() => {
				writeFileSync(join(ordersDir, 'README.md'), 'x\n');
				git(ordersDir, 'add', 'README.md');
				git(ordersDir, 'commit', '-q', '-m', 'readme');
				writeFileSync(path, orderYaml());
				git(ordersDir, 'add', NAME);
				return path;
			},
			'is not committed'
		],
		[
			'an order changed since its commit',
			() => {
				writeOrder(orderYaml());
				writeFileSync(path, orderYaml().replace('yes, delete it', 'yes, delete them all'));
				return path;
			},
			'has changes not committed'
		]
	];
	it.each(cases)('%s', async (_label, arrange, message) => {
		if (!_label.startsWith('an order')) writeOrder(orderYaml());
		const orderPath = arrange();
		await expect(run(false, orderPath)).rejects.toThrow(message);
		expect(wire.calls).toEqual([]);
	});

	it('a go older than 7 days', async () => {
		writeOrder(orderYaml());
		await expect(run(false, path, new Date('2026-11-09T00:10:00Z'))).rejects.toThrow('older than 7 days');
		expect(wire.calls).toEqual([]);
	});

	it('a go in the future', async () => {
		writeOrder(orderYaml());
		await expect(run(false, path, new Date('2026-11-01T20:00:00Z'))).rejects.toThrow('in the future');
		expect(wire.calls).toEqual([]);
	});

	it('a dry run takes an old go', async () => {
		writeOrder(orderYaml());
		await run(true, path, new Date('2026-12-01T00:00:00Z'));
		expect(lines.join('\n')).toContain('pre-check ok');
	});

	it('a dry run needs none of that', async () => {
		writeFileSync(join(app, 'a.txt'), 'b\n');
		writeFileSync(path, orderYaml());
		await run(true);
		expect(lines.join('\n')).toContain('pre-check ok');
	});
});

describe('the command line', () => {
	it('--dry is dry whatever DRY_RUN says', () => {
		vi.stubEnv('DRY_RUN', 'false');
		expect(parseCliArgs(['--dry', 'x.yaml'])).toEqual({ dryRun: true, orderPath: 'x.yaml' });
	});

	it('--live is live whatever DRY_RUN says', () => {
		vi.stubEnv('DRY_RUN', 'true');
		expect(parseCliArgs(['--live', 'x.yaml'])).toEqual({ dryRun: false, orderPath: 'x.yaml' });
	});

	it.each([[[]], [['x.yaml']], [['--live']], [['--LIVE', 'x.yaml']], [['--live', 'x.yaml', 'y.yaml']]])(
		'refuses %j',
		(argv) => {
			expect(() => parseCliArgs(argv)).toThrow('usage');
		}
	);

	it('reads the API key from the credentials file itself, with nothing in env', async () => {
		vi.stubEnv('MVOX_CREDE_API_KEY', undefined);
		vi.stubEnv('MVOX_CREDE_DB', undefined);
		const creds = join(dir, 'credentials.env');
		writeFileSync(creds, "MVOX_CREDE_DB=mvox_crede\nMVOX_CREDE_API_KEY='key-from-file'\n");
		writeOrder(orderYaml());
		await cliMain(['--dry', path], { credentialsPath: creds, fetchImpl: fakeEntu(wire), log: (l) => lines.push(l) });
		expect(wire.authKeys).toEqual(['Bearer key-from-file']);
		expect(lines.join('\n')).not.toContain('key-from-file');
	});

	it('package.json offers work-order:dry and work-order:live, and nothing that picks the mode from env', () => {
		const scripts = JSON.parse(readFileSync('package.json', 'utf-8')).scripts as Record<string, string>;
		const named = Object.entries(scripts).filter(([, cmd]) => cmd.includes('run-work-order.ts'));
		expect(named.map(([name]) => name).sort()).toEqual(['work-order:dry', 'work-order:live']);
		expect(scripts['work-order:dry'].endsWith('run-work-order.ts --dry')).toBe(true);
		expect(scripts['work-order:live'].endsWith('run-work-order.ts --live')).toBe(true);
	});
});
