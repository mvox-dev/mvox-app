import { beforeEach, describe, expect, it, vi } from 'vitest';

// mvox-app#274 review round 1 (Bentham, RED-274.2) — lib/ledger-writer.ts
// shipped with zero tests. This pins the ten-cell redaction shape table
// (RED-274.1's fix) and the sensitive→directory / crede→acknowledgement
// cross-checks (YELLOW-274.3), all against mocked fs — zero real I/O, so
// nothing lands in the real seed-results/ tree from running this suite.

const writeFileSyncMock = vi.fn();
const mkdirSyncMock = vi.fn();

vi.mock('node:fs', () => ({
	writeFileSync: (...args: unknown[]) => writeFileSyncMock(...args),
	mkdirSync: (...args: unknown[]) => mkdirSyncMock(...args)
}));

import { DEFAULT_REDACT_FIELDS, writeLedger } from './ledger-writer';
import * as ledgerWriterModule from './ledger-writer';

// ─────────────────────────────────────────────────────────────────────────────
// mvox-app#417 (RED, Tallis) — live-run authorization gate.
//
// API DECISION, pinned by this block (research of record:
// ~/workspace/scratchpad/research-417-digest.md):
// - `assertLiveRunAuthorized(dryRun: boolean, authorizedBy: string | undefined): void`
//   is a NEW export of ledger-writer.ts — a synchronous preflight every live
//   script calls BEFORE its first mutating entuFetch. writeLedger runs only
//   AFTER the POSTs in every live script observed (grant-294: POST at :115,
//   writeLedger at :161), so a check inside writeLedger alone can never
//   satisfy #417's "throws before any POST" — writeLedger calling the same
//   preflight (pinned below) is defense in depth, not the gate itself. The
//   per-script call sites are fenced by lib/liveRunAuthorization.guard.spec.ts.
// - `WriteLedgerOptions.authorizedBy?: string` — ONE string: name, channel,
//   and the issue-comment URL where the authorization is recorded. Never an
//   email: any value containing '@' throws.
// - `NO_AUTHORIZATION_DRY_RUN` — exported constant written into the envelope
//   key `authorizedBy` on a dry run with no explicit value, so an ABSENT
//   field is never ambiguous (unrecorded vs not-required).
// - `authorizedBy` is NOT a DEFAULT_REDACT_FIELDS member — the committed twin
//   must carry it (issue Done-when box 3), and naming it in committed.allow
//   is legal.
//
// The destructure below pins the exact contract while the exports do not
// exist yet (RED fails with "not a function"/undefined, test-by-test, instead
// of taking the whole file down at import); GREEN makes it equivalent to a
// plain named import with zero test edits.
const { assertLiveRunAuthorized, NO_AUTHORIZATION_DRY_RUN } = ledgerWriterModule as unknown as {
	assertLiveRunAuthorized: (dryRun: boolean, authorizedBy: string | undefined) => void;
	NO_AUTHORIZATION_DRY_RUN: string;
};

/** #417: WriteLedgerOptions grows `authorizedBy?: string` — typed shim until GREEN adds the field. */
const writeLedgerWithAuth = writeLedger as (
	opts: Parameters<typeof writeLedger>[0] & { authorizedBy?: string }
) => string;

/** Canonical #417 value shape: name, channel, issue-comment URL — never an email. */
const LIVE_AUTH = 'Mihkel, team console, https://github.com/mvox-dev/mvox-app/issues/418#issuecomment-0000000001';

/** The exact bytes NO_AUTHORIZATION_DRY_RUN must carry — pinned as a literal, not via the (RED: undefined) export, so a missing key can never pass by comparing undefined to undefined. */
const NO_AUTH_DRY_RUN_LITERAL = 'dry run — no authorization required';

beforeEach(() => {
	writeFileSyncMock.mockClear();
	mkdirSyncMock.mockClear();
});

function lastWrite(): { path: string; content: Record<string, unknown> } {
	const call = writeFileSyncMock.mock.calls.at(-1) as [string, string];
	return { path: call[0], content: JSON.parse(call[1]) };
}

describe('writeLedger — sensitive→directory routing', () => {
	it('routes sensitive:true into seed-results/crede-instance/', () => {
		writeLedger({ scriptName: 'x', dryRun: true, db: 'mvox_crede', sensitive: true, payload: {} });
		const { path } = lastWrite();
		expect(path).toMatch(/seed-results[/\\]crede-instance[/\\]/);
	});

	it('routes sensitive:false into plain seed-results/, not crede-instance', () => {
		writeLedger({ scriptName: 'x', dryRun: true, db: 'sampledb', sensitive: false, payload: {} });
		const { path } = lastWrite();
		expect(path).toMatch(/seed-results[/\\]/);
		expect(path).not.toMatch(/crede-instance/);
	});
});

describe('writeLedger — crede + sensitive:false cross-check (YELLOW-274.3)', () => {
	it('throws before any write when db looks like crede and sensitive:false arrives unacknowledged', () => {
		expect(() =>
			writeLedger({ scriptName: 'x', dryRun: true, db: 'mvox_crede', sensitive: false, payload: {} })
		).toThrow(/acknowledgedNonSensitive/);
		expect(writeFileSyncMock).not.toHaveBeenCalled();
	});

	it('does not throw when acknowledgedNonSensitive:true is explicit', () => {
		expect(() =>
			writeLedger({ scriptName: 'x', dryRun: true, db: 'mvox_crede', sensitive: false, acknowledgedNonSensitive: true, payload: {} })
		).not.toThrow();
	});

	it('does not require acknowledgement for a non-crede db', () => {
		expect(() =>
			writeLedger({ scriptName: 'x', dryRun: true, db: 'sampledb', sensitive: false, payload: {} })
		).not.toThrow();
	});

	it('does not require acknowledgement when sensitive:true', () => {
		expect(() =>
			writeLedger({ scriptName: 'x', dryRun: true, db: 'mvox_crede', sensitive: true, payload: {} })
		).not.toThrow();
	});
});

describe('writeLedger — email content scrub runs unconditionally', () => {
	it('redacts an email-shaped string leaf even when sensitive:false and the field is not declared', () => {
		writeLedger({ scriptName: 'x', dryRun: true, db: 'sampledb', sensitive: false, payload: { note: 'contact jaan@example.ee please' } });
		const { content } = lastWrite();
		expect(content.note).toBe('contact [REDACTED-EMAIL] please');
	});
});

// RED-274.1 shape table — a declared field (default or caller-supplied) must
// redact its WHOLE subtree regardless of the value's shape. The original bug
// only redacted a string LEAF, so array/object-wrapped values (Entu's native
// multi-value property shape among them) passed through in the clear.
describe('writeLedger — redaction shape table (RED-274.1)', () => {
	type Cell = { label: string; build: () => Record<string, unknown>; read: (redacted: Record<string, unknown>) => unknown };

	function cellsFor(field: string): Cell[] {
		return [
			{ label: `${field}: scalar`, build: () => ({ [field]: 'Jaan Tamm' }), read: (r) => r[field] },
			{ label: `${field}: array-of-string`, build: () => ({ [field]: ['Jaan Tamm'] }), read: (r) => r[field] },
			{ label: `${field}: array-of-object`, build: () => ({ [field]: [{ string: 'Jaan Tamm' }] }), read: (r) => r[field] },
			{ label: `${field}: nested-object`, build: () => ({ [field]: { string: 'Jaan Tamm' } }), read: (r) => r[field] },
			{
				label: `${field}: deep-nested (array > object > object)`,
				build: () => ({ ledger: [{ profile: { [field]: 'Jaan Tamm' } }] }),
				read: (r) => (r.ledger as Array<{ profile: Record<string, unknown> }>)[0].profile[field]
			}
		];
	}

	const defaultFieldCells = cellsFor('surname'); // DEFAULT_REDACT_FIELDS member
	const customFieldCells = cellsFor('nickname'); // caller-supplied redactFields member

	it.each(defaultFieldCells)('DEFAULT_REDACT_FIELDS field — $label', ({ build, read }) => {
		writeLedger({ scriptName: 'x', dryRun: true, db: 'sampledb', sensitive: false, payload: build() });
		const { content } = lastWrite();
		expect(read(content)).toBe('[REDACTED]');
	});

	it.each(customFieldCells)('caller redactFields field — $label', ({ build, read }) => {
		writeLedger({ scriptName: 'x', dryRun: true, db: 'sampledb', sensitive: false, redactFields: ['nickname'], payload: build() });
		const { content } = lastWrite();
		expect(read(content)).toBe('[REDACTED]');
	});

	it('an undeclared field of the same shapes is left untouched (no false positives)', () => {
		writeLedger({ scriptName: 'x', dryRun: true, db: 'sampledb', sensitive: false, payload: { section: ['Soprano I'] } });
		const { content } = lastWrite();
		expect(content.section).toEqual(['Soprano I']);
	});

	// mvox-app#278 (Gama ruling) — 'name' joined DEFAULT_REDACT_FIELDS with NO
	// opt-out. Same five shapes as the other DEFAULT_REDACT_FIELDS member
	// above; this is the belt Gama's ruling asked for underneath the
	// acknowledgedNonSensitive exemption seed-246/265-crede now demonstrate
	// as a copy-template — the default has to be safe even when the
	// cross-check is (legitimately) bypassed.
	const nameFieldCells = cellsFor('name');

	it.each(nameFieldCells)('DEFAULT_REDACT_FIELDS field (#278) — $label', ({ build, read }) => {
		writeLedger({ scriptName: 'x', dryRun: true, db: 'sampledb', sensitive: false, payload: build() });
		const { content } = lastWrite();
		expect(read(content)).toBe('[REDACTED]');
	});

	// mvox-app#282 (PO-Approved, Gama comment 5573048456) — 'id_code' (the
	// Estonian isikukood) joined DEFAULT_REDACT_FIELDS in the same commit as
	// the admin_member_record prop-def that introduces it. Same five shapes,
	// same discipline: RED-274.1 was exactly this class of bug (a field-name
	// match that only fired for a string leaf), so every DEFAULT_REDACT_FIELDS
	// addition gets the full table, not just a scalar case.
	const idCodeFieldCells = cellsFor('id_code');

	it.each(idCodeFieldCells)('DEFAULT_REDACT_FIELDS field (#282) — $label', ({ build, read }) => {
		writeLedger({ scriptName: 'x', dryRun: true, db: 'sampledb', sensitive: false, payload: build() });
		const { content } = lastWrite();
		expect(read(content)).toBe('[REDACTED]');
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// mvox-app#402 (RED, Tallis) — committed ledger twin.
//
// API DECISION, pinned by this block: `writeLedger` gains an optional
// `committed?: { allow: readonly string[] }` field on WriteLedgerOptions —
// NO sibling `writeCommittedLedger` function. One entry point keeps the #278
// writer-by-construction guard's premise intact (the mechanism lives INSIDE
// ledger-writer.ts; no new file under scripts/migrations/ calls
// writeFileSync) and lets the ten existing `sensitive: true` call sites opt
// in with one added field instead of a second import.
//
// Semantics pinned here:
// - `committed` present AND `sensitive: true` → TWO writes: the instance
//   ledger exactly as today (crede-instance/, denylist-redacted payload),
//   plus a committed twin in tracked `seed-results/` whose filename is the
//   instance stem + `-committed` and whose payload is ASSEMBLED from the
//   allowlist — a key is copied iff its exact name is in `allow`, at EVERY
//   level: to reach `entries[].personId`, both `entries` and `personId`
//   must be named. A non-allowed container key drops its whole subtree even
//   if allowed names appear underneath (naming the full path is the point —
//   nothing reaches the committed file that was not spelled out).
//   Array elements are filtered element-wise; an element with no allowed
//   keys becomes `{}` so array LENGTH (a count, a §12 fact) survives.
// - Committed envelope: `{ dryRun, db, sensitive: true, committed: true,
//   ...allowlisted }` — self-describing on disk, not only via filename.
// - `writeLedger` still returns the INSTANCE path (backward compatible with
//   the ten call sites).
// - `sensitive: false` + `committed` THROWS (decision: throw, not no-op) —
//   a non-sensitive ledger already lands tracked in full; a committed twin
//   has nothing to twin, and a caller asking for one is confused in a way
//   worth hearing about loudly (fail-loudly-over-fallbacks).
// - Belt-and-braces: the committed payload still passes the EMAIL_RE scan —
//   allowlisting a field never exempts its VALUE from the content scrub.
// - Guard spec (#278 seedResultsWriter.guard.spec.ts) stays green by
//   construction: this block adds no writer files, only pins on the one
//   writer that already exists.
describe('writeLedger — committed ledger twin (#402)', () => {
	const ALLOW = [
		'total',
		'byStatus',
		'created',
		'skipped',
		'entries',
		'personId',
		'memberId',
		'status',
		'message',
		'createdIds'
	] as const;

	/** Envelope keys the writer itself owns on the committed file — #417 adds `authorizedBy`. */
	const ENVELOPE_KEYS = ['dryRun', 'db', 'sensitive', 'committed', 'authorizedBy'] as const;

	function allWrites(): Array<{ path: string; raw: string; content: Record<string, unknown> }> {
		return (writeFileSyncMock.mock.calls as Array<[string, string]>).map(([path, raw]) => ({
			path,
			raw,
			content: JSON.parse(raw) as Record<string, unknown>
		}));
	}

	function instanceWrite() {
		const hit = allWrites().find((w) => /crede-instance/.test(w.path));
		if (!hit) throw new Error('no instance (crede-instance/) write found');
		return hit;
	}

	function committedWrite() {
		const hit = allWrites().find((w) => /-committed\.json$/.test(w.path));
		if (!hit) throw new Error('no committed (-committed.json) write found');
		return hit;
	}

	/** Collect every object key anywhere in a parsed JSON tree. */
	function collectKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
		if (Array.isArray(value)) {
			for (const v of value) collectKeys(v, into);
		} else if (value && typeof value === 'object') {
			for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
				into.add(k);
				collectKeys(v, into);
			}
		}
		return into;
	}

	const crossSitePayload = {
		total: 2,
		byStatus: { created: 1, skipped: 1 },
		entries: [
			{
				personId: 'p1',
				memberId: 'm1',
				status: 'created',
				// The writer header's own recorded evasion: an interpolated
				// composite under an unrelated key — evades the denylist, must
				// never reach the committed file.
				summary: 'Jaan Tamm (39001010000)',
				email: 'jaan.tamm@example.ee',
				fullName: 'Jaan Tamm'
			}
		]
	};

	function runCommitted() {
		return writeLedgerWithAuth({
			scriptName: 'seed-999-crede-members',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: LIVE_AUTH, // #417: a live run records who authorized it
			committed: { allow: ALLOW },
			payload: crossSitePayload
		});
	}

	it('sensitive:true + committed → exactly two writes: instance ledger unchanged, committed twin allowlisted (full shape)', () => {
		const returned = runCommitted();

		expect(writeFileSyncMock).toHaveBeenCalledTimes(2);

		// Instance file: exactly today's behaviour — crede-instance/,
		// denylist-redacted payload, composite summary passing in the clear
		// (that is the documented evasion the committed twin exists for).
		const instance = instanceWrite();
		expect(instance.content).toEqual({
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: LIVE_AUTH,
			total: 2,
			byStatus: { created: 1, skipped: 1 },
			entries: [
				{
					personId: 'p1',
					memberId: 'm1',
					status: 'created',
					summary: 'Jaan Tamm (39001010000)',
					email: '[REDACTED]',
					fullName: 'Jaan Tamm'
				}
			]
		});

		// Committed file: tracked seed-results/, allowlist-assembled.
		const committed = committedWrite();
		expect(committed.path).not.toMatch(/crede-instance/);
		expect(committed.path).toMatch(/seed-results[/\\]/);
		expect(committed.content).toEqual({
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			committed: true,
			authorizedBy: LIVE_AUTH,
			total: 2,
			byStatus: { created: 1, skipped: 1 },
			entries: [{ personId: 'p1', memberId: 'm1', status: 'created' }]
		});

		// Return value stays the instance path — the ten existing call sites
		// log/print it; they must not silently start printing the twin.
		expect(returned).toBe(instance.path);
	});

	it('sensitive:true WITHOUT committed → one write, byte-pinned envelope (#417 adds authorizedBy after the payload)', () => {
		writeLedgerWithAuth({
			scriptName: 'seed-999-crede-members',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: LIVE_AUTH,
			payload: crossSitePayload
		});

		expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
		const only = allWrites()[0];
		expect(only.path).toMatch(/crede-instance/);
		// Byte-pin: the pre-#402 envelope + denylist-redacted payload + the #417
		// `authorizedBy` key LAST, 2-space JSON — no committed marker, no
		// reordering, nothing else. `authorizedBy` sits after the payload
		// spread deliberately (review round 1): a payload key of that name
		// must never shadow the recorded authorizer.
		expect(only.raw).toBe(
			JSON.stringify(
				{
					dryRun: false,
					db: 'mvox_crede',
					sensitive: true,
					total: 2,
					byStatus: { created: 1, skipped: 1 },
					entries: [
						{
							personId: 'p1',
							memberId: 'm1',
							status: 'created',
							summary: 'Jaan Tamm (39001010000)',
							email: '[REDACTED]',
							fullName: 'Jaan Tamm'
						}
					],
					authorizedBy: LIVE_AUTH
				},
				null,
				2
			)
		);
	});

	it('LOAD-BEARING: the composite-summary evasion, email and fullName never reach the committed file — no key outside the allowlist, no trace in the bytes', () => {
		runCommitted();
		const committed = committedWrite();

		// Walk: every key anywhere in the committed JSON is either an
		// envelope key or an allowlisted name.
		const permitted = new Set<string>([...ENVELOPE_KEYS, ...ALLOW]);
		for (const key of collectKeys(committed.content)) {
			expect(permitted.has(key), `unexpected key '${key}' in committed ledger`).toBe(true);
		}

		// String search over the serialized output: the composite value (and
		// its parts) appear NOWHERE — not under any key, not partially.
		expect(committed.raw).not.toContain('Jaan Tamm (39001010000)');
		expect(committed.raw).not.toContain('Jaan Tamm');
		expect(committed.raw).not.toContain('39001010000');
		expect(committed.raw).not.toContain('jaan.tamm@example.ee');
		expect(committed.raw).not.toContain('summary');
		expect(committed.raw).not.toContain('fullName');
	});

	it('allowlist copies nested ids/counts by exact key and drops everything else, including arrays of objects with mixed keys', () => {
		writeLedger({
			scriptName: 'seed-999-crede-members',
			dryRun: true,
			db: 'mvox_crede',
			sensitive: true,
			committed: { allow: ALLOW },
			payload: {
				total: 3,
				// 'weird' is not allowlisted → dropped from the counts object.
				byStatus: { created: 2, skipped: 1, weird: 9 },
				createdIds: ['68c1a', '68c1b'],
				entries: [
					{ personId: 'p1', status: 'created', message: 'ok', extra: { deep: 'secret' } },
					// 'roles' is not allowlisted → its whole subtree drops even
					// though 'personId' appears inside it — the full path must
					// be named for a value to survive.
					{ memberId: 'm2', status: 'skipped', summary: 'Mari Maasikas (48001010000)', roles: [{ name: 'x', personId: 'p9' }] },
					// No allowed keys at all → {} — array length (a count) survives.
					{ summary: 'Uku Uusberg (50001010000)' }
				],
				notes: 'free-form text that must not ride along'
			}
		});

		const committed = committedWrite();
		expect(committed.content).toEqual({
			dryRun: true,
			db: 'mvox_crede',
			sensitive: true,
			committed: true,
			// #417: a dry run with no explicit value records the fixed sentinel
			// — an absent field is never ambiguous.
			authorizedBy: NO_AUTH_DRY_RUN_LITERAL,
			total: 3,
			byStatus: { created: 2, skipped: 1 },
			createdIds: ['68c1a', '68c1b'],
			entries: [
				{ personId: 'p1', status: 'created', message: 'ok' },
				{ memberId: 'm2', status: 'skipped' },
				{}
			]
		});
	});

	it('committed twin shares the instance name stem with a -committed suffix and never routes to crede-instance/', () => {
		runCommitted();
		const instance = instanceWrite();
		const committed = committedWrite();

		const expectedTwinPath = instance.path
			.replace(/[/\\]crede-instance/, '')
			.replace(/\.json$/, '-committed.json');
		expect(committed.path).toBe(expectedTwinPath);
		expect(committed.path).not.toMatch(/crede-instance/);
	});

	it('sensitive:false + committed throws before any write — there is nothing to twin (DECISION: throw, not no-op)', () => {
		expect(() =>
			writeLedger({
				scriptName: 'x',
				dryRun: true,
				db: 'sampledb',
				sensitive: false,
				committed: { allow: ['total'] },
				payload: { total: 1 }
			})
		).toThrow(/committed/);
		expect(writeFileSyncMock).not.toHaveBeenCalled();
	});

	// mvox-app#402 review round 1 (Bentham) — the twin is assembled from the
	// RAW payload, so allowlisting a denylisted name is the one mistake with
	// no layer behind it: the value lands in tracked seed-results/, in git
	// history, in the clear. The writer must refuse the combination instead
	// of trusting the caller's naming discipline.
	it.each([...DEFAULT_REDACT_FIELDS, 'string'])(
		"committed.allow naming '%s' throws before any write — the twin is built from the raw payload",
		(field) => {
			expect(() =>
				writeLedgerWithAuth({
					scriptName: 'seed-999-crede-members',
					dryRun: false,
					db: 'mvox_crede',
					sensitive: true,
					authorizedBy: LIVE_AUTH, // #417: live call sites always record the authorizer
					committed: { allow: [...ALLOW, field] },
					payload: crossSitePayload
				})
			).toThrow(new RegExp(`committed\\.allow names redacted field\\(s\\) \\[${field}\\]`));
			expect(writeFileSyncMock).not.toHaveBeenCalled();
		}
	);

	it('the refusal is case-insensitive and names every offender — filterByAllowlist matches keys exactly, so a differently-cased leak is still a leak', () => {
		expect(() =>
			writeLedgerWithAuth({
				scriptName: 'seed-999-crede-members',
				dryRun: false,
				db: 'mvox_crede',
				sensitive: true,
				authorizedBy: LIVE_AUTH,
				committed: { allow: [...ALLOW, 'Name', 'ID_CODE'] },
				payload: crossSitePayload
			})
		).toThrow(/committed\.allow names redacted field\(s\) \[Name, ID_CODE\]/);
		expect(writeFileSyncMock).not.toHaveBeenCalled();
	});

	it("the caller's own redactFields count as denylisted too — allowlisting what this run just declared sensitive throws", () => {
		expect(() =>
			writeLedgerWithAuth({
				scriptName: 'seed-999-crede-members',
				dryRun: false,
				db: 'mvox_crede',
				sensitive: true,
				authorizedBy: LIVE_AUTH,
				redactFields: ['fullName'],
				committed: { allow: [...ALLOW, 'fullName'] },
				payload: crossSitePayload
			})
		).toThrow(/committed\.allow names redacted field\(s\) \[fullName\]/);
		expect(writeFileSyncMock).not.toHaveBeenCalled();
	});

	it('belt-and-braces: the committed payload still gets the EMAIL_RE scan — an allowlisted message carrying an email is scrubbed', () => {
		writeLedgerWithAuth({
			scriptName: 'seed-999-crede-members',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: LIVE_AUTH,
			committed: { allow: ['entries', 'status', 'message'] },
			payload: {
				entries: [{ status: 'failed', message: 'duplicate of jaan.tamm@example.ee — skipped' }]
			}
		});

		const committed = committedWrite();
		expect(committed.content).toEqual({
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			committed: true,
			authorizedBy: LIVE_AUTH,
			entries: [{ status: 'failed', message: 'duplicate of [REDACTED-EMAIL] — skipped' }]
		});
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// mvox-app#417 (RED, Tallis) — a live run cannot start without recording who
// authorized it. Contract header sits next to the shim imports at the top.
describe('assertLiveRunAuthorized — preflight unit contract (#417)', () => {
	it('throws when live (dryRun:false) and authorizedBy is absent', () => {
		expect(() => assertLiveRunAuthorized(false, undefined)).toThrow(/authorizedBy|AUTHORIZED_BY/i);
	});

	it('throws when live and authorizedBy is blank (whitespace-only) — a blank record is no record', () => {
		expect(() => assertLiveRunAuthorized(false, '   ')).toThrow(/authorizedBy|AUTHORIZED_BY/i);
	});

	it("throws when live and the value contains '@' — name, channel and issue-comment URL, never an email", () => {
		expect(() => assertLiveRunAuthorized(false, 'mihkel@example.test, team console')).toThrow(/@|email/i);
	});

	// Review round 1 (Bentham): the sentinel is non-blank and '@'-free, so the
	// two checks above let it through and a live ledger came out byte-identical
	// to a dry run's — the exact ambiguity the sentinel exists to remove.
	it('throws when live and the value IS the dry-run sentinel — "no authorization required" never authorizes a live run', () => {
		expect(() => assertLiveRunAuthorized(false, NO_AUTH_DRY_RUN_LITERAL)).toThrow(/sentinel|dry run/i);
		expect(() => assertLiveRunAuthorized(false, `  ${NO_AUTH_DRY_RUN_LITERAL}  `)).toThrow(/sentinel|dry run/i);
	});

	it('does not throw when live and the value is the full name+channel+issue-comment shape', () => {
		expect(() => assertLiveRunAuthorized(false, LIVE_AUTH)).not.toThrow();
	});

	it('does not throw on a dry run with no value — the live-run REQUIREMENT is live-only', () => {
		expect(() => assertLiveRunAuthorized(true, undefined)).not.toThrow();
	});

	it('does not throw on a dry run with an explicit non-email value — a pre-authorized rehearsal is legal', () => {
		expect(() => assertLiveRunAuthorized(true, LIVE_AUTH)).not.toThrow();
	});

	// Review round 2 (Bentham): the '@' test sat behind the dry-run early
	// return, so DRY_RUN=true with an email in AUTHORIZED_BY passed — and
	// writeLedger appends the envelope value after the payload, past both
	// scrubbing passes, into the TRACKED committed twin. The value-SHAPE
	// check binds every run; only the live-run REQUIREMENT is live-only.
	it("throws on a DRY run when the value contains '@' — the shape check is not a live-run-only check", () => {
		expect(() => assertLiveRunAuthorized(true, 'mihkel@example.test, team console')).toThrow(/@|email/i);
	});

	it('exports the fixed dry-run sentinel NO_AUTHORIZATION_DRY_RUN with these exact bytes', () => {
		expect(NO_AUTHORIZATION_DRY_RUN).toBe(NO_AUTH_DRY_RUN_LITERAL);
	});
});

describe('writeLedger — authorizedBy in the envelope (#417)', () => {
	function writes(): Array<{ path: string; content: Record<string, unknown> }> {
		return (writeFileSyncMock.mock.calls as Array<[string, string]>).map(([path, raw]) => ({
			path,
			content: JSON.parse(raw) as Record<string, unknown>
		}));
	}

	it('live + no authorizedBy throws before any fs write (defense in depth behind the per-script preflight)', () => {
		expect(() =>
			writeLedger({ scriptName: 'x', dryRun: false, db: 'mvox_crede', sensitive: true, payload: {} })
		).toThrow(/authorizedBy|AUTHORIZED_BY/i);
		expect(writeFileSyncMock).not.toHaveBeenCalled();
	});

	it("live + a value containing '@' throws before any fs write — never an email", () => {
		expect(() =>
			writeLedgerWithAuth({
				scriptName: 'x',
				dryRun: false,
				db: 'mvox_crede',
				sensitive: true,
				authorizedBy: 'mihkel@example.test, team console',
				payload: {}
			})
		).toThrow(/@|email/i);
		expect(writeFileSyncMock).not.toHaveBeenCalled();
	});

	it('live + valid value lands under authorizedBy in BOTH twins, and naming it in committed.allow is legal (not denylisted)', () => {
		writeLedgerWithAuth({
			scriptName: 'seed-999-crede-members',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: LIVE_AUTH,
			committed: { allow: ['total', 'authorizedBy'] },
			payload: { total: 1 }
		});

		expect(writeFileSyncMock).toHaveBeenCalledTimes(2);
		const instance = writes().find((w) => /crede-instance/.test(w.path));
		const committed = writes().find((w) => /-committed\.json$/.test(w.path));
		expect(instance?.content.authorizedBy).toBe(LIVE_AUTH);
		expect(committed?.content.authorizedBy).toBe(LIVE_AUTH);

		// The committed twin stays walkable: every key is either an envelope
		// key (now including authorizedBy) or an allowlisted name.
		const permitted = new Set(['dryRun', 'db', 'sensitive', 'committed', 'authorizedBy', 'total']);
		for (const key of Object.keys(committed?.content ?? {})) {
			expect(permitted.has(key), `unexpected key '${key}' in committed ledger`).toBe(true);
		}
	});

	// Review round 1 (Bentham): the envelope key used to be written BEFORE the
	// payload spread, so `{...envelope, ...payload}` handed a payload key named
	// `authorizedBy` the last word and the recorded authorizer vanished from
	// the ledger without a trace. Both twins now write it last.
	it('a payload key named authorizedBy cannot shadow the recorded authorizer — in either twin', () => {
		writeLedgerWithAuth({
			scriptName: 'seed-999-crede-members',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: LIVE_AUTH,
			committed: { allow: ['total', 'authorizedBy'] },
			payload: { total: 1, authorizedBy: 'PAYLOAD-SUPPLIED — not the recorded authorizer' }
		});

		expect(writeFileSyncMock).toHaveBeenCalledTimes(2);
		const instance = writes().find((w) => /crede-instance/.test(w.path));
		const committed = writes().find((w) => /-committed\.json$/.test(w.path));
		expect(instance?.content.authorizedBy).toBe(LIVE_AUTH);
		expect(committed?.content.authorizedBy).toBe(LIVE_AUTH);
	});

	it('dry run + no value writes exactly the fixed sentinel — an absent field is never ambiguous', () => {
		writeLedger({ scriptName: 'x', dryRun: true, db: 'sampledb', sensitive: false, payload: { total: 1 } });
		const { content } = lastWrite();
		expect(content.authorizedBy).toBe(NO_AUTH_DRY_RUN_LITERAL);
	});

	it('dry run + explicit non-email value keeps the explicit value — a pre-authorized rehearsal stays recorded as itself', () => {
		writeLedgerWithAuth({
			scriptName: 'x',
			dryRun: true,
			db: 'sampledb',
			sensitive: false,
			authorizedBy: LIVE_AUTH,
			payload: {}
		});
		const { content } = lastWrite();
		expect(content.authorizedBy).toBe(LIVE_AUTH);
	});

	// Review round 2 (Bentham): this case used to assert the opposite — a dry
	// run KEPT whatever it was handed, email included. The envelope value is
	// appended after the payload in both twins, so it meets neither the
	// instance denylist nor the committed twin's scrubEmails pass, and the
	// committed twin is tracked. The documented rehearsal order (export
	// AUTHORIZED_BY once, then DRY_RUN=true first) makes the dry run the
	// FIRST place a bad value reaches disk, so it has to throw there too.
	it("dry run + a value containing '@' throws before any fs write — the tracked twin never sees an address", () => {
		expect(() =>
			writeLedgerWithAuth({
				scriptName: 'x',
				dryRun: true,
				db: 'mvox_crede',
				sensitive: true,
				authorizedBy: 'mihkel@example.test, team console',
				committed: { allow: ['total'] },
				payload: { total: 1 }
			})
		).toThrow(/@|email/i);
		expect(writeFileSyncMock).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis*)
