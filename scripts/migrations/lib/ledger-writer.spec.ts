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
		writeLedger({ scriptName: 'x', dryRun: true, db: 'polyphony', sensitive: false, payload: {} });
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
			writeLedger({ scriptName: 'x', dryRun: true, db: 'polyphony', sensitive: false, payload: {} })
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
		writeLedger({ scriptName: 'x', dryRun: true, db: 'polyphony', sensitive: false, payload: { note: 'contact jaan@example.ee please' } });
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
		writeLedger({ scriptName: 'x', dryRun: true, db: 'polyphony', sensitive: false, payload: build() });
		const { content } = lastWrite();
		expect(read(content)).toBe('[REDACTED]');
	});

	it.each(customFieldCells)('caller redactFields field — $label', ({ build, read }) => {
		writeLedger({ scriptName: 'x', dryRun: true, db: 'polyphony', sensitive: false, redactFields: ['nickname'], payload: build() });
		const { content } = lastWrite();
		expect(read(content)).toBe('[REDACTED]');
	});

	it('an undeclared field of the same shapes is left untouched (no false positives)', () => {
		writeLedger({ scriptName: 'x', dryRun: true, db: 'polyphony', sensitive: false, payload: { section: ['Soprano I'] } });
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
		writeLedger({ scriptName: 'x', dryRun: true, db: 'polyphony', sensitive: false, payload: build() });
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
		writeLedger({ scriptName: 'x', dryRun: true, db: 'polyphony', sensitive: false, payload: build() });
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

	/** Envelope keys the writer itself owns on the committed file. */
	const ENVELOPE_KEYS = ['dryRun', 'db', 'sensitive', 'committed'] as const;

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
		return writeLedger({
			scriptName: 'seed-999-crede-members',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
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
			total: 2,
			byStatus: { created: 1, skipped: 1 },
			entries: [{ personId: 'p1', memberId: 'm1', status: 'created' }]
		});

		// Return value stays the instance path — the ten existing call sites
		// log/print it; they must not silently start printing the twin.
		expect(returned).toBe(instance.path);
	});

	it('sensitive:true WITHOUT committed → one write, byte-identical to today', () => {
		writeLedger({
			scriptName: 'seed-999-crede-members',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			payload: crossSitePayload
		});

		expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
		const only = allWrites()[0];
		expect(only.path).toMatch(/crede-instance/);
		// Byte-pin: the serialized form is exactly the pre-#402 envelope +
		// denylist-redacted payload, 2-space JSON — no committed marker, no
		// reordering, nothing.
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
					]
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
				db: 'polyphony',
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
				writeLedger({
					scriptName: 'seed-999-crede-members',
					dryRun: false,
					db: 'mvox_crede',
					sensitive: true,
					committed: { allow: [...ALLOW, field] },
					payload: crossSitePayload
				})
			).toThrow(new RegExp(`committed\\.allow names redacted field\\(s\\) \\[${field}\\]`));
			expect(writeFileSyncMock).not.toHaveBeenCalled();
		}
	);

	it('the refusal is case-insensitive and names every offender — filterByAllowlist matches keys exactly, so a differently-cased leak is still a leak', () => {
		expect(() =>
			writeLedger({
				scriptName: 'seed-999-crede-members',
				dryRun: false,
				db: 'mvox_crede',
				sensitive: true,
				committed: { allow: [...ALLOW, 'Name', 'ID_CODE'] },
				payload: crossSitePayload
			})
		).toThrow(/committed\.allow names redacted field\(s\) \[Name, ID_CODE\]/);
		expect(writeFileSyncMock).not.toHaveBeenCalled();
	});

	it("the caller's own redactFields count as denylisted too — allowlisting what this run just declared sensitive throws", () => {
		expect(() =>
			writeLedger({
				scriptName: 'seed-999-crede-members',
				dryRun: false,
				db: 'mvox_crede',
				sensitive: true,
				redactFields: ['fullName'],
				committed: { allow: [...ALLOW, 'fullName'] },
				payload: crossSitePayload
			})
		).toThrow(/committed\.allow names redacted field\(s\) \[fullName\]/);
		expect(writeFileSyncMock).not.toHaveBeenCalled();
	});

	it('belt-and-braces: the committed payload still gets the EMAIL_RE scan — an allowlisted message carrying an email is scrubbed', () => {
		writeLedger({
			scriptName: 'seed-999-crede-members',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
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
			entries: [{ status: 'failed', message: 'duplicate of [REDACTED-EMAIL] — skipped' }]
		});
	});
});

// (*MVOX:Tallis*)
