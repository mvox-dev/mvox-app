import { beforeEach, describe, expect, it, vi } from 'vitest';

// lib/ledger-writer.ts: the redaction shape table, sensitive→directory routing and the crede
// acknowledgement cross-check, all against mocked fs so nothing lands in seed-results/.

const writeFileSyncMock = vi.fn();
const mkdirSyncMock = vi.fn();

vi.mock('node:fs', () => ({
	writeFileSync: (...args: unknown[]) => writeFileSyncMock(...args),
	mkdirSync: (...args: unknown[]) => mkdirSyncMock(...args)
}));

import {
	assertLiveRunAuthorized,
	DEFAULT_REDACT_FIELDS,
	NO_AUTHORIZATION_DRY_RUN,
	UNRECORDED_AUTHORIZATION,
	writeLedger
} from './ledger-writer';

/** An authorizer is a name, a channel and an issue-comment URL, never an email. */
const LIVE_AUTH = 'Mihkel, team console, https://github.com/mvox-dev/mvox-app/issues/418#issuecomment-0000000001';

/** Literals, not the exports, so a missing key cannot pass by comparing undefined to undefined. */
const NO_AUTH_DRY_RUN_LITERAL = 'dry run — no authorization required';

const UNRECORDED_AUTH_LITERAL = 'live run — authorizer not recorded';

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

// A declared field redacts its WHOLE subtree whatever the value's shape: Entu's multi-value
// arrays and objects must not pass through in the clear.
describe('writeLedger — redaction shape table', () => {
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

	// 'name' has no opt-out: the default must be safe even when the acknowledgement bypasses
	// the cross-check.
	const nameFieldCells = cellsFor('name');

	it.each(nameFieldCells)('DEFAULT_REDACT_FIELDS field (#278) — $label', ({ build, read }) => {
		writeLedger({ scriptName: 'x', dryRun: true, db: 'sampledb', sensitive: false, payload: build() });
		const { content } = lastWrite();
		expect(read(content)).toBe('[REDACTED]');
	});

	// Every DEFAULT_REDACT_FIELDS member gets the full shape table, not just a scalar case.
	const idCodeFieldCells = cellsFor('id_code');

	it.each(idCodeFieldCells)('DEFAULT_REDACT_FIELDS field (#282) — $label', ({ build, read }) => {
		writeLedger({ scriptName: 'x', dryRun: true, db: 'sampledb', sensitive: false, payload: build() });
		const { content } = lastWrite();
		expect(read(content)).toBe('[REDACTED]');
	});
});

// The committed twin is assembled from an allowlist: a key is copied only if its exact name is
// allowed at every level, and an array element with no allowed keys becomes {} so counts survive.
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
		return writeLedger({
			scriptName: 'seed-999-crede-members',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: LIVE_AUTH,
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
		writeLedger({
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
		// authorizedBy comes after the payload so a payload key of that name cannot shadow it.
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

	// The twin is built from the RAW payload, so allowlisting a denylisted name would put the
	// value in git in the clear: the writer refuses it.
	it.each([...DEFAULT_REDACT_FIELDS, 'string'])(
		"committed.allow naming '%s' throws before any write — the twin is built from the raw payload",
		(field) => {
			expect(() =>
				writeLedger({
					scriptName: 'seed-999-crede-members',
					dryRun: false,
					db: 'mvox_crede',
					sensitive: true,
					authorizedBy: LIVE_AUTH,
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
				authorizedBy: LIVE_AUTH,
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
				authorizedBy: LIVE_AUTH,
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

	// The sentinel passes the blank and '@' checks; accepting it would make a live ledger
	// identical to a dry run's.
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

	// The authorizer lands in the tracked twin unscrubbed, so its shape is checked on every run.
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

	// Callers write their ledger after their mutations; throwing here would lose the record of a
	// live run. The preflight is what refuses the run.
	it('live + no authorizedBy writes UNRECORDED_AUTHORIZATION — the ledger lands and names the gap', () => {
		writeLedger({ scriptName: 'x', dryRun: false, db: 'sampledb', sensitive: false, payload: { total: 1 } });

		expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
		const { content } = lastWrite();
		expect(content).toEqual({
			dryRun: false,
			db: 'sampledb',
			sensitive: false,
			total: 1,
			authorizedBy: UNRECORDED_AUTH_LITERAL
		});
	});

	it('the preflight still throws on that same live run — the gate is the call site, not the writer', () => {
		expect(() => assertLiveRunAuthorized(false, undefined)).toThrow(/authorizedBy|AUTHORIZED_BY/i);
	});

	it('exports UNRECORDED_AUTHORIZATION with these exact bytes, distinct from the dry-run sentinel', () => {
		expect(UNRECORDED_AUTHORIZATION).toBe(UNRECORDED_AUTH_LITERAL);
		expect(UNRECORDED_AUTHORIZATION).not.toBe(NO_AUTHORIZATION_DRY_RUN);
	});

	it('live + the dry-run sentinel still throws before any fs write — a value-shape refusal, not an opt-in check', () => {
		expect(() =>
			writeLedger({
				scriptName: 'x',
				dryRun: false,
				db: 'sampledb',
				sensitive: false,
				authorizedBy: NO_AUTH_DRY_RUN_LITERAL,
				payload: { total: 1 }
			})
		).toThrow(/sentinel|dry run/i);
		expect(writeFileSyncMock).not.toHaveBeenCalled();
	});

	it("live + a value containing '@' throws before any fs write — never an email", () => {
		expect(() =>
			writeLedger({
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
		writeLedger({
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

	it('a payload key named authorizedBy cannot shadow the recorded authorizer — in either twin', () => {
		writeLedger({
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
		writeLedger({
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

	// A rehearsal runs DRY_RUN=true first, so the dry run is the first place a bad value reaches disk.
	it("dry run + a value containing '@' throws before any fs write — the tracked twin never sees an address", () => {
		expect(() =>
			writeLedger({
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
