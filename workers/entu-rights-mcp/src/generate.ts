// #318 — the build-time generator: doc + source commit SHA/date → the
// GITIGNORED rules bundle.
//
// The bundle is a stamped VIEW: every rule in it is the parser's verbatim
// extraction, and the stamp (sourceCommit + sourceCommitDate) rides on it so
// a stale answer is detectable at a glance rather than merely plausible. The
// generated file is never committed — a committed copy would be the
// independent rule store #318 forbids.
import type { RulesBundle } from './types';
import { parseRightsDoc } from './parse';

/**
 * Build the in-memory bundle: parsed rules + the source stamp. Throws if the
 * doc has parse rejects — fail loudly, never emit a partial rule store.
 */
export function buildBundle(doc: string, sourceCommit: string, sourceCommitDate: string): RulesBundle {
	const { rules, rejects } = parseRightsDoc(doc);
	if (rejects.length > 0) {
		throw new Error(
			`buildBundle: refusing to emit a partial rules bundle — ${rejects.length} parse reject(s): ` +
				rejects.map((r) => `line ${r.line}: ${r.reason}`).join('; ')
		);
	}
	return { sourceCommit, sourceCommitDate, rules };
}

/**
 * Emit the bundle as the exact byte content of the generated JSON module
 * (workers/entu-rights-mcp/generated/rules-bundle.json — gitignored).
 * Deterministic: same inputs → byte-identical output.
 */
export function generateBundleJson(doc: string, sourceCommit: string, sourceCommitDate: string): string {
	const bundle = buildBundle(doc, sourceCommit, sourceCommitDate);
	return `${JSON.stringify(bundle, null, 2)}\n`;
}
