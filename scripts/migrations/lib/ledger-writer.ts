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
// 2. DECLARED-field redaction (unconditional) + gitignored routing (opt-in
//    via `sensitive: true`). Unlike email addresses, a bare `name` field is
//    genuinely ambiguous in this corpus — "Soprano I" (a section name) and
//    "Jaan Tamm" (a person's name) are both plausible values of a field
//    called `name`, and no regex tells them apart. So this layer is
//    EXPLICIT, not inferred: the calling script states `sensitive: true`
//    when its ledger may carry real per-person values (crede member/profile
//    provisioning). Redaction of DEFAULT_REDACT_FIELDS / the caller's own
//    `redactFields` runs REGARDLESS of `sensitive` — only the ROUTING is
//    gated on it: `sensitive: true` additionally routes the file to
//    `seed-results/crede-instance/`, the one directory `.gitignore`
//    excludes — belt-and-suspenders: even a redaction bug still cannot
//    reach git history. Schema/type-provisioning ledgers (#246, #265) and
//    every polyphony ledger stay `sensitive: false` and land in plain
//    `seed-results/`, tracked, per the #263 convention.
//
// This is a caller-declared flag, not an inferred one, on purpose — see
// "A prefill may never widen a value's sharing tier"
// (architecture-decisions.md, 2026-09-06): state the tier explicitly, then
// let the mechanism enforce it, never derive a safety-critical property
// from a default or a naming convention alone. mvox-app#274 review round 1
// (Bentham, YELLOW-274.3) added a companion assertion, not an inference: a
// crede-looking `db` combined with `sensitive: false` throws unless the
// caller also passes `acknowledgedNonSensitive: true` — refusing a
// suspicious combination loudly is not the same as guessing quietly.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_REDACT_FIELDS = ['email', 'forename', 'surname', 'phone', 'birthdate'] as const;

const EMAIL_RE = /[^\s"]+@[^\s"]+\.[^\s"]+/g;

/**
 * mvox-app#274 review round 1 (Bentham, RED-274.1): the key check MUST be
 * the first thing this function does, before any type dispatch. The
 * original version checked the key only inside the string branch, so a
 * declared field redacted only when its value was a string LEAF —
 * Entu's native multi-value property shape, `{name: ['Jaan Tamm']}`, has a
 * value in the array branch instead of the string branch, and passed
 * through IN THE CLEAR. Live-demonstrated: `probe-274-redaction-shape-
 * table` showed a scalar `surname: "Tamm"` redacting correctly while
 * `surname: ["Tamm"]` and `surname: {string: "Tamm"}` did not. Checking the
 * key FIRST, before asking what shape the value is, means a matched field
 * redacts its WHOLE subtree — array, object, or scalar — in one return,
 * with no shape-specific branch to miss.
 */
function redactValue(value: unknown, keyLower: string | null, redactFieldSet: Set<string>): unknown {
	if (keyLower && redactFieldSet.has(keyLower)) return '[REDACTED]';
	if (typeof value === 'string') {
		return value.replace(EMAIL_RE, '[REDACTED-EMAIL]');
	}
	if (Array.isArray(value)) return value.map((v) => redactValue(v, keyLower, redactFieldSet));
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[k] = redactValue(v, k.toLowerCase(), redactFieldSet);
		}
		return out;
	}
	return value;
}

/** `db` names that this module treats as the real-PII crede pilot — a
 * substring match, so `mvox_crede`, a future `crede`-named db, or an
 * env-overridden variant all match without maintaining an exact-name list. */
function looksLikeCrede(db: string): boolean {
	return db.toLowerCase().includes('crede');
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
	/**
	 * Required (and only meaningful) when `db` looks like crede AND
	 * `sensitive: false` — an explicit acknowledgement that THIS ledger
	 * genuinely carries no crede real-person data (schema/type-provisioning
	 * runs are the only legitimate case today). mvox-app#274 review round 1
	 * (Bentham, YELLOW-274.3): 16+ scripts hardcode `sensitive: false` one
	 * level above this module, which is a copy-paste hazard the type system
	 * can't catch on its own — a future crede-instance script could paste
	 * that pattern and silently skip both redaction routing AND the
	 * gitignored directory. This flag doesn't decide anything quietly; it
	 * forces the decision into the open at the one call site that needs it.
	 */
	acknowledgedNonSensitive?: boolean;
}

/**
 * Write one ledger artifact and return its path. Directory is
 * `seed-results/crede-instance/` when `sensitive: true` (gitignored),
 * otherwise plain `seed-results/` (tracked).
 *
 * Throws before writing anything if `db` looks like crede and
 * `sensitive: false` arrives without `acknowledgedNonSensitive: true` —
 * see that field's doc comment.
 */
export function writeLedger(opts: WriteLedgerOptions): string {
	if (!opts.sensitive && looksLikeCrede(opts.db) && !opts.acknowledgedNonSensitive) {
		throw new Error(
			`writeLedger: db '${opts.db}' looks like the crede real-PII pilot, but sensitive:false was passed ` +
				`without acknowledgedNonSensitive:true. If this ledger genuinely carries no crede real-person ` +
				`data (e.g. schema/type-provisioning, zero instances), pass acknowledgedNonSensitive:true ` +
				`explicitly. Never flip sensitive to true or false to silence this check without checking — ` +
				`that is exactly the copy-paste hazard it exists to catch.`
		);
	}

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
