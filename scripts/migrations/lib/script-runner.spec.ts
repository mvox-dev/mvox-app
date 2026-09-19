import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCredeCfg, readDryRun } from './script-runner';
import * as scriptRunnerModule from './script-runner';

// mvox-app#417 (RED, Tallis) — scripts read the live-run authorizer from env
// `AUTHORIZED_BY` via a NEW `readAuthorizedBy()` export, sibling of
// readDryRun. loadCredeCfg's signature and return are deliberately untouched
// (its exact-shape toEqual below keeps guarding that). The destructure pins
// the contract while the export does not exist yet (RED fails test-by-test
// with "not a function" instead of taking the whole file down at import);
// GREEN makes it equivalent to a plain named import with zero test edits.
const { readAuthorizedBy } = scriptRunnerModule as unknown as {
	readAuthorizedBy: () => string | undefined;
};

// mvox-app#274 review round 1 (Bentham, RED-274.2) — lib/script-runner.ts
// shipped with zero tests.

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

describe('readDryRun', () => {
	const saved: string | undefined = process.env.DRY_RUN;
	afterEach(() => {
		if (saved === undefined) delete process.env.DRY_RUN;
		else process.env.DRY_RUN = saved;
	});

	it('defaults to true when DRY_RUN is unset', () => {
		delete process.env.DRY_RUN;
		expect(readDryRun()).toBe(true);
	});

	it('is false only for the literal string "false" (case-insensitive)', () => {
		process.env.DRY_RUN = 'false';
		expect(readDryRun()).toBe(false);
	});

	it('is false for "FALSE" (case-insensitive)', () => {
		process.env.DRY_RUN = 'FALSE';
		expect(readDryRun()).toBe(false);
	});

	it('stays true (safe) for any other value, including a plausible misspelling', () => {
		process.env.DRY_RUN = 'no';
		expect(readDryRun()).toBe(true);
	});

	it('stays true (safe) for an empty string', () => {
		process.env.DRY_RUN = '';
		expect(readDryRun()).toBe(true);
	});
});

describe('loadCredeCfg', () => {
	const KEYS = ['MVOX_CREDE_DB', 'MVOX_CREDE_API_KEY'] as const;
	const saved: Record<string, string | undefined> = {};

	beforeEach(() => {
		for (const k of KEYS) saved[k] = process.env[k];
		delete process.env.MVOX_CREDE_DB;
		process.env.MVOX_CREDE_API_KEY = 'crede-key-123';
	});
	afterEach(() => {
		for (const k of KEYS) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	});

	it('throws when MVOX_CREDE_API_KEY is not set — fails loud before any network call', async () => {
		delete process.env.MVOX_CREDE_API_KEY;
		const fetchImpl = vi.fn().mockResolvedValue(json({ token: 't' }));
		await expect(loadCredeCfg(undefined, undefined, undefined, fetchImpl)).rejects.toThrow(/MVOX_CREDE_API_KEY is not set/);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('throws on a non-2xx auth exchange', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 401));
		await expect(loadCredeCfg(undefined, undefined, undefined, fetchImpl)).rejects.toThrow(/401/);
	});

	it('throws on a 2xx body carrying no token (apparent-success trap)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}));
		await expect(loadCredeCfg(undefined, undefined, undefined, fetchImpl)).rejects.toThrow(/no token/i);
	});

	it('succeeds and defaults db to mvox_crede when MVOX_CREDE_DB is unset', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ token: 'the-jwt' }));
		const cfg = await loadCredeCfg(undefined, undefined, undefined, fetchImpl);
		expect(cfg).toEqual({ db: 'mvox_crede', token: 'the-jwt' });
		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
		expect(url).toMatch(/\/auth\?db=mvox_crede$/);
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer crede-key-123');
	});

	it('honours an overridden MVOX_CREDE_DB', async () => {
		process.env.MVOX_CREDE_DB = 'mvox_other';
		const fetchImpl = vi.fn().mockResolvedValue(json({ token: 't' }));
		const cfg = await loadCredeCfg(undefined, undefined, undefined, fetchImpl);
		expect(cfg.db).toBe('mvox_other');
		expect((fetchImpl.mock.calls[0] as [string])[0]).toMatch(/\/auth\?db=mvox_other$/);
	});
});

describe('readAuthorizedBy (#417)', () => {
	const saved: string | undefined = process.env.AUTHORIZED_BY;
	afterEach(() => {
		if (saved === undefined) delete process.env.AUTHORIZED_BY;
		else process.env.AUTHORIZED_BY = saved;
	});

	it('is undefined when AUTHORIZED_BY is unset — the preflight, not this reader, decides whether that is fatal', () => {
		delete process.env.AUTHORIZED_BY;
		expect(readAuthorizedBy()).toBeUndefined();
	});

	it('is undefined for a blank (whitespace-only) value — a blank record is no record', () => {
		process.env.AUTHORIZED_BY = '   ';
		expect(readAuthorizedBy()).toBeUndefined();
	});

	it('returns the trimmed string when set', () => {
		process.env.AUTHORIZED_BY =
			'  Mihkel, team console, https://github.com/mvox-dev/mvox-app/issues/418#issuecomment-0000000001  ';
		expect(readAuthorizedBy()).toBe(
			'Mihkel, team console, https://github.com/mvox-dev/mvox-app/issues/418#issuecomment-0000000001'
		);
	});
});
