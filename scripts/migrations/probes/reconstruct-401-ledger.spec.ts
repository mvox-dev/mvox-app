import { beforeAll, describe, expect, it, vi } from 'vitest';
import { basename } from 'node:path';

// mvox-app#401 — RED. The 15.09 crede grant run (#369 remedy, live 15.09
// 14:39 EEST) left its result ledger only in gitignored crede-instance/.
// issue-standard.md §12 requires a live run to commit its ledger; this run
// predates the rule, so a reconstruction script builds the ledger after the
// fact from #369's own recorded counts — NO live Entu call, no network —
// and writes ONLY one tracked file, via the #402 committed-allowlist
// mechanism in lib/ledger-writer.ts (the seedResultsWriter guard spec
// requires that import). Precedent for the reconstruction marker:
// seed-results/t3-1-bundles-1-2-3-reconstructed-2026-08-07T10-46-51-000Z.json.
//
// Pinned here (task ruling "either is fine, pin it"): the instance twin IS
// written, to the gitignored crede-instance/ path — writeLedger's stock
// sensitive:true behavior — and exactly ONE file lands tracked.

const writeFileSyncMock = vi.fn();
const mkdirSyncMock = vi.fn();

vi.mock('node:fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs')>();
	return {
		...actual,
		writeFileSync: (...args: unknown[]) => writeFileSyncMock(...args),
		mkdirSync: (...args: unknown[]) => mkdirSyncMock(...args)
	};
});

// `readFileSync` resolves to the REAL one — the mock factory spreads the
// actual module and only replaces the two write functions.
import { readFileSync } from 'node:fs';
import { DEFAULT_REDACT_FIELDS } from '../lib/ledger-writer';

const SCRIPT_BASENAME = 'reconstruct-401-ledger-15-09-grant-run-2026-09-18.ts';
const SCRIPT_PATH = new URL(`./${SCRIPT_BASENAME}`, import.meta.url).pathname;

// The 19 person ids of the #369 remedy's TARGET_IDS (ids only, never
// .string — ER-26), frozen in
// scripts/migrations/probes/remedy-369-crede-self-editor-grant-2026-09-15.ts:47-67.
const EXPECTED_PERSON_IDS = [
	'6a92a3f0ca67df980f415489',
	'6a92a3f1ca67df980f4154a3',
	'6a92a3f2ca67df980f4154bd',
	'6a92a3f3ca67df980f4154d7',
	'6a92a3f4ca67df980f4154f1',
	'6a92a3f4ca67df980f41550b',
	'6a92a3f5ca67df980f415525',
	'6a92a3f6ca67df980f41553f',
	'6a92a3f6ca67df980f415559',
	'6a92a3f7ca67df980f415573',
	'6a92a3f8ca67df980f41558d',
	'6a92a3f8ca67df980f4155a7',
	'6a92a3f9ca67df980f4155c1',
	'6a92a3faca67df980f4155db',
	'6a92a3faca67df980f4155f5',
	'6a92a3fbca67df980f41560f',
	'6a92a3fcca67df980f415629',
	'6a92a3fcca67df980f415643',
	'6a92a3feca67df980f415677'
];

const EMAIL_SHAPE = /[^\s"]+@[^\s"]+\.[^\s"]+/;

// Every fetch invocation is a violation — the reconstruction has no business
// on the wire. Installed BEFORE the script module loads, replacing the
// networkGuard.setup.ts guard with an observable spy that rejects the same way.
const fetchSpy = vi.fn(() => Promise.reject(new Error('reconstruct-401: network access is forbidden')));

function writtenPaths(): string[] {
	return writeFileSyncMock.mock.calls.map((c) => String(c[0]).replace(/\\/g, '/'));
}

function trackedWrites(): Array<{ path: string; content: string }> {
	return writeFileSyncMock.mock.calls
		.map((c) => ({ path: String(c[0]).replace(/\\/g, '/'), content: String(c[1]) }))
		.filter((w) => w.path.includes('seed-results/') && !w.path.includes('crede-instance'));
}

function collectKeys(value: unknown, out: string[]): string[] {
	if (Array.isArray(value)) {
		for (const v of value) collectKeys(v, out);
	} else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out.push(k.toLowerCase());
			collectKeys(v, out);
		}
	}
	return out;
}

beforeAll(async () => {
	globalThis.fetch = fetchSpy as unknown as typeof fetch;
	await import(SCRIPT_PATH);
	// The script runs at import time; give a promise-chained main() time to settle.
	const deadline = Date.now() + 1000;
	while (writeFileSyncMock.mock.calls.length === 0 && Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 10));
	}
});

describe('reconstruct-401 — one tracked reconstructed ledger in seed-results/', () => {
	it('writes exactly one tracked file, its name carrying `reconstructed`', () => {
		const tracked = trackedWrites();
		expect(tracked).toHaveLength(1);
		expect(basename(tracked[0].path)).toMatch(/reconstructed/);
	});

	it('pins the instance twin to the gitignored crede-instance/ path — exactly one write there, none anywhere else', () => {
		const others = writtenPaths().filter(
			(p) => !(p.includes('seed-results/') && !p.includes('crede-instance'))
		);
		expect(others).toHaveLength(1);
		expect(others[0]).toMatch(/seed-results\/crede-instance\//);
	});

	it('carries the full recorded shape of the 15.09 run — ids, counts, sweep, authorization, reconstruction marker', () => {
		const tracked = trackedWrites();
		expect(tracked).toHaveLength(1);
		const parsed = JSON.parse(tracked[0].content) as Record<string, unknown>;
		expect(parsed).toEqual({
			// writeLedger committed-twin envelope
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			committed: true,
			// the run of record, from #369's body
			personIds: EXPECTED_PERSON_IDS,
			grantCount: 19,
			postSweep: { held: 24, of: 24 },
			runAt: '2026-09-15T14:39+03:00',
			authorizedBy: 'Mihkel (team console, verbatim)',
			// the reconstruction marker (t3-1 precedent shape)
			reconstructed: true,
			reconstructedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
			reconstructionNote: expect.stringMatching(/#369[\s\S]*#401|#401[\s\S]*#369/)
		});
	});

	it('personIds are bare 24-hex Entu ids — never .string resolutions (ER-26)', () => {
		const parsed = JSON.parse(trackedWrites()[0].content) as { personIds: string[] };
		for (const id of parsed.personIds) expect(id).toMatch(/^[0-9a-f]{24}$/);
	});
});

describe('reconstruct-401 — no redacted-field value, no email shape', () => {
	it('no key of any DEFAULT_REDACT_FIELDS member appears anywhere in the tracked output', () => {
		const parsed = JSON.parse(trackedWrites()[0].content);
		const keys = collectKeys(parsed, []);
		for (const field of DEFAULT_REDACT_FIELDS) {
			expect(keys).not.toContain(field.toLowerCase());
		}
	});

	it('no email-shaped string anywhere in the serialized tracked output', () => {
		expect(trackedWrites()[0].content).not.toMatch(EMAIL_SHAPE);
	});
});

describe('reconstruct-401 — no network, no live loaders', () => {
	it('never invokes fetch', () => {
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('imports lib/ledger-writer (seedResultsWriter guard) and none of the live loaders (script-runner, creds, $lib/entu/request)', () => {
		const source = readFileSync(SCRIPT_PATH, 'utf8');
		expect(source).toMatch(/from\s+'\.\.\/lib\/ledger-writer'/);
		expect(source).not.toMatch(/script-runner/);
		expect(source).not.toMatch(/lib\/creds/);
		expect(source).not.toMatch(/\$lib\/entu\/request/);
	});
});

describe('reconstruct-401 — honest provenance', () => {
	it("reconstructionNote states 'reconstructed, never live-captured' verbatim", () => {
		const parsed = JSON.parse(trackedWrites()[0].content) as { reconstructionNote: string };
		expect(parsed.reconstructionNote).toContain('reconstructed, never live-captured');
	});
});

// (*MVOX:Tallis*)
