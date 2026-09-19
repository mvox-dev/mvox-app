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
//    stray real address on ANY script, crede or a synthetic db, sensitive or not.
//
// 2. DECLARED-field redaction (unconditional) + gitignored routing (opt-in
//    via `sensitive: true`). `name` is a DEFAULT_REDACT_FIELDS member (added
//    mvox-app#278) even though a bare `name` field is genuinely ambiguous in
//    this corpus — "Soprano I" (a section name) and "Jaan Tamm" (a person's
//    name) are both plausible values of a field called `name`, and no regex
//    tells them apart. #278's ruling (Gama): no opt-out for schema ledgers —
//    a redacted type/prop-def name in a schema-provisioning ledger costs a
//    reader nothing they cannot recover from the type definition itself, so
//    the safe default costs nothing even where it turns out unnecessary. So
//    this layer is EXPLICIT, not inferred: the calling script states
//    `sensitive: true` when its ledger may carry real per-person values
//    (crede member/profile provisioning). Redaction of DEFAULT_REDACT_FIELDS
//    / the caller's own `redactFields` runs REGARDLESS of `sensitive` — only
//    the ROUTING is gated on it: `sensitive: true` additionally routes the
//    file to `seed-results/crede-instance/`, the one directory `.gitignore`
//    excludes — belt-and-suspenders: even a redaction bug still cannot
//    reach git history. Schema/type-provisioning ledgers (#246, #265) and
//    every synthetic-db ledger stay `sensitive: false` and land in plain
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
// suspicious combination loudly is not the same as guessing quietly. This
// cross-check is load-bearing, not decorative: with `seed-results/` tracked
// (per hole A's #274 resolution), the caller's `sensitive: true` is the
// only fence between a real-PII payload and a public git history — nothing
// else in the pipeline stops it (Bentham, #274 review, relayed via #278).
//
// `id_code` (added mvox-app#282, PO-Approved comment 5573048456) is the
// Estonian national identity code (isikukood) on `admin_member_record` —
// landed in the SAME commit as the prop-def that introduces it, per Gama's
// carried requirement: no window may exist where the field is defined in
// the schema layer and uncovered here. Known limit, recorded not fixed
// (Gama, same ruling): field-name redaction only protects a value sitting
// directly under a key literally named `id_code` — an interpolated
// composite under an unrelated key (e.g. `summary: "${name} (${id_code})"`)
// would evade it, the same blind spot every DEFAULT_REDACT_FIELDS member
// has had since #274. Not specific to this field; not fixed here. Trigger
// for revisiting: the first ledger line that actually writes an
// interpolated composite value.
//
// mvox-app#402 closes that evasion for COMMITTED ledgers by construction:
// `committed` doesn't redact by field NAME (the denylist's blind spot —
// an evasion only needs an unlisted key), it builds the committed twin by
// ALLOWLIST instead — copy a key iff its name is spelled out in `allow`,
// at every level, dropping the whole subtree otherwise. A composite value
// like `summary: "${name} (${id_code})"` has no home in an allowlisted
// payload unless `summary` itself is named, which a caller assembling an
// ids/counts/outcomes-only twin has no reason to do. The instance ledger
// (crede-instance/, gitignored) is unchanged and keeps the denylist and
// its recorded blind spot — this closes the evasion only for the file that
// actually lands in git history.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_REDACT_FIELDS = ['email', 'forename', 'surname', 'phone', 'birthdate', 'name', 'id_code'] as const;

const EMAIL_RE = /[^\s"]+@[^\s"]+\.[^\s"]+/g;

/**
 * mvox-app#417 — `writeLedger` records this literal under `authorizedBy`
 * on a dry run with no explicit value, so an absent field is never
 * ambiguous between "nobody recorded an authorizer" and "not required".
 */
export const NO_AUTHORIZATION_DRY_RUN = 'dry run — no authorization required';

/**
 * mvox-app#417 — the live-run authorization preflight. Every crede-mutating
 * script calls this BEFORE its first mutating entuFetch (fenced by
 * lib/liveRunAuthorization.guard.spec.ts): `writeLedger` runs only AFTER
 * the POSTs in every live script observed, so a check placed only inside
 * `writeLedger` could never stop a mutation — the per-script call site is
 * the actual gate. `writeLedger` also calls this (defense in depth).
 *
 * Throws synchronously when the run is live (`dryRun === false`) and
 * `authorizedBy` is absent, blank, the reserved dry-run sentinel, or
 * contains '@'. The recorded value is a name, the channel it came through,
 * and the issue-comment URL where the authorization is recorded — never an
 * email address. Never throws on a dry run; this is a live-run gate only.
 */
export function assertLiveRunAuthorized(dryRun: boolean, authorizedBy: string | undefined): void {
	if (dryRun) return;
	if (!authorizedBy || !authorizedBy.trim()) {
		throw new Error(
			`assertLiveRunAuthorized: a live run needs authorizedBy recorded — set env AUTHORIZED_BY to a name, ` +
				`the channel it came through, and the issue-comment URL where the authorization is recorded ` +
				`(e.g. 'Mihkel, team console, https://github.com/mvox-dev/mvox-app/issues/418#issuecomment-…'). ` +
				`Never an email address.`
		);
	}
	// mvox-app#417 review round 1 (Bentham) — the sentinel is non-blank and
	// carries no '@', so without this it passed the live gate verbatim and the
	// ledger's `authorizedBy` came out byte-identical to a genuine dry run's.
	// That is exactly the ambiguity the sentinel exists to remove, so the
	// reserved value is refused on a live run.
	if (authorizedBy.trim() === NO_AUTHORIZATION_DRY_RUN) {
		throw new Error(
			`assertLiveRunAuthorized: AUTHORIZED_BY '${authorizedBy}' is the reserved dry-run sentinel — it means ` +
				`"no authorization required" and may never stand in for one on a live run. Set AUTHORIZED_BY to a ` +
				`name, the channel it came through, and the issue-comment URL where the authorization is recorded.`
		);
	}
	if (authorizedBy.includes('@')) {
		throw new Error(
			`assertLiveRunAuthorized: AUTHORIZED_BY '${authorizedBy}' contains '@' — this is a name, a channel, ` +
				`and an issue-comment URL, never an email address.`
		);
	}
}

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

/**
 * mvox-app#402 — the committed-twin half of the allowlist mechanism.
 * Copy a key iff its exact name is in `allow`, at EVERY level: a container
 * key (e.g. `entries`) must itself be named to recurse into it, and an
 * unnamed container drops its WHOLE subtree even if allowed names appear
 * underneath — the full path has to be spelled out, nothing is reached by
 * accident. Array elements are filtered element-wise; an element that ends
 * up with no allowed keys becomes `{}` rather than being dropped, so array
 * LENGTH (a count) survives.
 */
function filterByAllowlist(value: unknown, allow: ReadonlySet<string>): unknown {
	if (Array.isArray(value)) return value.map((v) => filterByAllowlist(v, allow));
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			if (allow.has(k)) out[k] = filterByAllowlist(v, allow);
		}
		return out;
	}
	return value;
}

/**
 * mvox-app#402 — belt-and-braces content scrub for the committed twin.
 * Allowlisting a field by NAME never exempts its VALUE from the same
 * unconditional EMAIL_RE scan every ledger already gets — an allowlisted
 * `message` carrying a stray email still needs the email caught.
 */
function scrubEmails(value: unknown): unknown {
	if (typeof value === 'string') return value.replace(EMAIL_RE, '[REDACTED-EMAIL]');
	if (Array.isArray(value)) return value.map(scrubEmails);
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubEmails(v);
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
	 * schema/type-provisioning runs and all synthetic-db runs.
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
	/**
	 * mvox-app#402 — when present, writes a SECOND artifact alongside the
	 * instance ledger: a committed twin, allowlist-assembled from `payload`
	 * (see `filterByAllowlist`), landing tracked in plain `seed-results/`
	 * with an `-committed.json` suffix on the instance filename. Only
	 * meaningful (and only accepted) alongside `sensitive: true` — a
	 * non-sensitive ledger already lands tracked in full, so there is
	 * nothing to twin; `sensitive: false` + `committed` throws. Naming a
	 * denylisted field in `allow` (DEFAULT_REDACT_FIELDS, this call's own
	 * `redactFields`, or the literal Entu wrapper key `string`) throws too —
	 * the twin is built from the raw payload, so nothing else would catch it.
	 */
	committed?: { allow: readonly string[] };
	/**
	 * mvox-app#417 — a name, the channel it came through, and the
	 * issue-comment URL where the authorization is recorded. Never an
	 * email. Required (and checked via `assertLiveRunAuthorized`, defense
	 * in depth behind the per-script preflight) when `dryRun: false`. On a
	 * dry run with no value, the envelope records `NO_AUTHORIZATION_DRY_RUN`
	 * so the field is never ambiguously absent. Not a DEFAULT_REDACT_FIELDS
	 * member — the committed twin must carry it, and it may be named in
	 * `committed.allow`.
	 */
	authorizedBy?: string;
}

/**
 * Write one ledger artifact and return its path. Directory is
 * `seed-results/crede-instance/` when `sensitive: true` (gitignored),
 * otherwise plain `seed-results/` (tracked).
 *
 * Throws before writing anything if `db` looks like crede and
 * `sensitive: false` arrives without `acknowledgedNonSensitive: true`, or
 * if `committed.allow` names a denylisted field — see those fields' doc
 * comments.
 */
export function writeLedger(opts: WriteLedgerOptions): string {
	// mvox-app#417 — defense in depth: the per-script preflight (called
	// before the first mutating entuFetch) is the actual gate; this call
	// still runs before any fs write here so a script that skipped the
	// preflight cannot get a ledger written for an unauthorized live run.
	assertLiveRunAuthorized(opts.dryRun, opts.authorizedBy);
	// assertLiveRunAuthorized already guaranteed a non-blank value on a live
	// run; a dry run with nothing explicit records the fixed sentinel.
	const authorizedBy = opts.authorizedBy ?? NO_AUTHORIZATION_DRY_RUN;

	if (opts.committed && !opts.sensitive) {
		throw new Error(
			`writeLedger: committed twin requested with sensitive:false. A non-sensitive ledger already lands ` +
				`tracked in full — there is nothing to twin. Pass sensitive:true, or drop 'committed'.`
		);
	}

	if (opts.committed) {
		// mvox-app#402 review round 1 (Bentham) — the committed twin is
		// assembled from the RAW payload, deliberately (allowlisting an
		// already-denylisted payload would only copy `[REDACTED]` markers
		// around). The price of that choice is that the denylist does NOT
		// stand behind the twin: name a denylisted field in `allow` and the
		// real value lands in tracked `seed-results/` in the clear, with no
		// layer left to catch it — `scrubEmails` only matches EMAIL_RE, and
		// the gitignored routing applies to the instance file only. Git
		// history is not retractable, so refuse the combination at the gate,
		// the same shape as the YELLOW-274.3 `acknowledgedNonSensitive`
		// check below: name the offending keys and make the caller choose in
		// the open. The literal key `string` is refused alongside the
		// redact fields — it is Entu's value/reference wrapper
		// (`{person: {string: 'Jaan Tamm'}}`), so allowing it turns any
		// allowlisted container into a name-carrying leaf. Compared
		// case-insensitively: `filterByAllowlist` matches keys exactly, so
		// `Name` would not copy a `name` key, but it would copy a `Name` one.
		const deniedInCommitted = new Set(
			[...DEFAULT_REDACT_FIELDS, ...(opts.redactFields ?? []), 'string'].map((f) => f.toLowerCase())
		);
		const offenders = opts.committed.allow.filter((f) => deniedInCommitted.has(f.toLowerCase()));
		if (offenders.length > 0) {
			throw new Error(
				`writeLedger: committed.allow names redacted field(s) [${offenders.join(', ')}]. The committed ` +
					`twin is built from the RAW payload, so the denylist does not stand behind it — an ` +
					`allowlisted '${offenders[0]}' would land in tracked seed-results/ in the clear, and git ` +
					`history cannot be retracted. Allowlist ids, counts and outcomes instead; resolve any ` +
					`human-readable label from the ids at read time.`
			);
		}
	}

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

	// mvox-app#417 review round 1 (Bentham) — `authorizedBy` is written AFTER
	// the payload spread, in both twins. With the envelope key first, a payload
	// key of the same name won the merge and silently replaced the recorded
	// authorizer with caller-supplied text. Last writer wins, so the envelope's
	// value is the one that lands, whatever the payload carries.
	writeFileSync(
		filePath,
		JSON.stringify(
			{ dryRun: opts.dryRun, db: opts.db, sensitive: opts.sensitive, ...redactedPayload, authorizedBy },
			null,
			2
		)
	);

	if (opts.committed) {
		const allowSet = new Set(opts.committed.allow);
		const filtered = filterByAllowlist(opts.payload, allowSet) as Record<string, unknown>;
		const scrubbed = scrubEmails(filtered) as Record<string, unknown>;

		const committedDir = join('scripts', 'migrations', 'seed-results');
		mkdirSync(committedDir, { recursive: true });
		const committedFilename = filename.replace(/\.json$/, '-committed.json');
		const committedPath = join(committedDir, committedFilename);

		writeFileSync(
			committedPath,
			JSON.stringify(
				{
					dryRun: opts.dryRun,
					db: opts.db,
					sensitive: opts.sensitive,
					committed: true,
					...scrubbed,
					authorizedBy
				},
				null,
				2
			)
		);
	}

	return filePath;
}

// (*MVOX:Perotin*)
