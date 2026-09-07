// mvox-app#274 — shared ledger writer with redaction built in. Replaces the
// per-script `writeLedger` idiom (13 writer scripts, two divergent output
// directories — `seed-results/` and the now-retired `ledgers/`) with one
// function every script calls the same way.
//
// Two independent safety layers, deliberately not one:
//
// 1. CONTENT-based email redaction runs on every write, unconditionally.
//    A raw email address is the sharpest, least ambiguous PII shape this
//    domain produces (seed-186's real fixed 20-row TARGETS array was the
//    concrete precedent — already externalized to a gitignored snapshot,
//    but that was a per-script fix, not a structural guarantee). Regex-
//    scanning every string leaf costs nothing on a schema-metadata payload
//    (an email pattern cannot appear in a prop-def name) and catches a
//    stray real address on ANY script, crede or polyphony, sensitive or not.
//
// 2. DECLARED-field redaction + gitignored routing, opt-in via `sensitive:
//    true`. Unlike email addresses, a bare `name` field is genuinely
//    ambiguous in this corpus — "Soprano I" (a section name) and "Jaan
//    Tamm" (a person's name) are both plausible values of a field called
//    `name`, and no regex tells them apart. So this layer is EXPLICIT, not
//    inferred: the calling script states `sensitive: true` when its ledger
//    may carry real per-person values (crede member/profile provisioning),
//    and the writer (a) redacts every value under a name in
//    DEFAULT_REDACT_FIELDS or the caller's own `redactFields`, and (b)
//    routes the file to `seed-results/crede-instance/`, the one directory
//    `.gitignore` excludes — belt-and-suspenders: even a redaction bug
//    still cannot reach git history. Schema/type-provisioning ledgers
//    (#246, #265) and every polyphony ledger stay `sensitive: false` and
//    land in plain `seed-results/`, tracked, per the #263 convention.
//
// This is a caller-declared flag, not an inferred one, on purpose — see
// "A prefill may never widen a value's sharing tier"
// (architecture-decisions.md, 2026-09-06): state the tier explicitly, then
// let the mechanism enforce it, never derive a safety-critical property
// from a default or a naming convention alone.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_REDACT_FIELDS = ['email', 'forename', 'surname', 'phone', 'birthdate'] as const;

const EMAIL_RE = /[^\s"]+@[^\s"]+\.[^\s"]+/g;

function redactValue(value: unknown, keyLower: string | null, redactFieldSet: Set<string>): unknown {
	if (typeof value === 'string') {
		if (keyLower && redactFieldSet.has(keyLower)) return '[REDACTED]';
		return value.replace(EMAIL_RE, '[REDACTED-EMAIL]');
	}
	if (Array.isArray(value)) return value.map((v) => redactValue(v, null, redactFieldSet));
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[k] = redactValue(v, k.toLowerCase(), redactFieldSet);
		}
		return out;
	}
	return value;
}

export interface WriteLedgerOptions {
	/** Base name for the artifact file, e.g. 'seed-184-crede-members-menu'. */
	scriptName: string;
	dryRun: boolean;
	/** cfg.db — recorded in the artifact for audit, not used to infer sensitivity. */
	db: string;
	/**
	 * Explicit, caller-declared: true when this run's ledger may carry real
	 * per-person values (crede member/profile instance data). false for
	 * schema/type-provisioning runs and all polyphony (synthetic) runs.
	 * Never inferred from `db` or the script name — see module doc above.
	 */
	sensitive: boolean;
	payload: Record<string, unknown>;
	/** Extra field names (case-insensitive) to redact beyond DEFAULT_REDACT_FIELDS. */
	redactFields?: string[];
}

/**
 * Write one ledger artifact and return its path. Directory is
 * `seed-results/crede-instance/` when `sensitive: true` (gitignored),
 * otherwise plain `seed-results/` (tracked).
 */
export function writeLedger(opts: WriteLedgerOptions): string {
	const redactFieldSet = new Set(
		[...DEFAULT_REDACT_FIELDS, ...(opts.redactFields ?? [])].map((f) => f.toLowerCase())
	);
	const redactedPayload = redactValue(opts.payload, null, redactFieldSet) as Record<string, unknown>;

	const dir = opts.sensitive
		? join('scripts', 'migrations', 'seed-results', 'crede-instance')
		: join('scripts', 'migrations', 'seed-results');
	mkdirSync(dir, { recursive: true });

	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const filename = `${opts.scriptName}-${opts.dryRun ? 'dry' : 'live'}-${timestamp}.json`;
	const filePath = join(dir, filename);

	writeFileSync(
		filePath,
		JSON.stringify({ dryRun: opts.dryRun, db: opts.db, sensitive: opts.sensitive, ...redactedPayload }, null, 2)
	);
	return filePath;
}

// (*MVOX:Perotin*)
