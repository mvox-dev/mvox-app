// #318 — entu-rights-mcp parser: extracts the identified rule blocks
// (`> **ER-<n>** — …`) out of the rights model document, verbatim.
//
// Grammar: the one src/rights-model-identifiers.spec.ts (the guard spec)
// already enforces on the doc — this parser is a second CONSUMER of that
// grammar, never a second definition of the doc's content (see
// workers/entu-rights-mcp/parser.spec.ts). A block is a contiguous run of
// `>`-prefixed lines whose FIRST line opens with a bold `**ER-<token>**`
// identifier. Ordinary blockquotes (no such opener) are skipped silently. A
// block whose opener looks ER-shaped but is not well-formed (`ER-0`,
// `ER-2a`, …) is a REJECT — never silently dropped, never served.
import type { ParsedRule, ParseReject, ParseResult, RuleEvidence } from './types';

/** Loosely matches a bold ER-shaped opener on a blockquote's first line. */
const DEFINITION_FIRST_LINE = /^>\s*\*\*(ER-[0-9A-Za-z]*)\*\*/;
/** Well-formed identifier: positive integer, no leading zeros, no letter suffix. */
const WELL_FORMED_ID = /^ER-[1-9]\d*$/;
/** A backtick-quoted path token with a recognised source-file extension,
 * optionally followed by a `:line[,range...]` citation. */
const PATH_TOKEN = /^[\w./-]+\.(?:js|ts|md|json)(?::[\d,-]+)?$/;

const PROBE_SCRIPT_PREFIX = 'scripts/migrations/probes/';
const RESULT_FILE_PREFIX = 'scripts/migrations/seed-results/';

const stripMarker = (line: string): string => line.replace(/^>\s?/, '');

function parseEvidence(text: string): RuleEvidence {
	const sourceRefs: string[] = [];
	const probeScripts: string[] = [];
	const resultFiles: string[] = [];

	const evidenceLine = text.split('\n').find((l) => /^Evidence:/.test(l.trim()));
	if (evidenceLine) {
		const tokens = evidenceLine.match(/`([^`]+)`/g) ?? [];
		for (const quoted of tokens) {
			const token = quoted.slice(1, -1);
			if (token.startsWith(PROBE_SCRIPT_PREFIX)) {
				probeScripts.push(token);
			} else if (token.startsWith(RESULT_FILE_PREFIX)) {
				resultFiles.push(token);
			} else if (PATH_TOKEN.test(token)) {
				sourceRefs.push(token);
			}
		}
	}

	return { sourceRefs, probeScripts, resultFiles };
}

/**
 * Parse every identified rule block out of the rights model document.
 * Returns the well-formed rules plus any rejects (malformed identifiers) —
 * a reject is reported, never silently dropped and never served.
 */
export function parseRightsDoc(doc: string): ParseResult {
	const lines = doc.split('\n');
	const rules: ParsedRule[] = [];
	const rejects: ParseReject[] = [];

	let i = 0;
	while (i < lines.length) {
		if (!lines[i].startsWith('>')) {
			i += 1;
			continue;
		}
		const start = i;
		while (i < lines.length && lines[i].startsWith('>')) i += 1;
		const rawLines = lines.slice(start, i);
		const raw = rawLines.join('\n');

		const opener = rawLines[0].match(DEFINITION_FIRST_LINE);
		if (!opener) continue; // ordinary blockquote — not a rule definition

		const id = opener[1];
		if (!WELL_FORMED_ID.test(id)) {
			rejects.push({
				line: start + 1,
				reason: `malformed identifier "${id}" at doc line ${start + 1} — ER-<n> requires a positive integer with no leading zeros and no letter suffix`
			});
			continue;
		}

		const text = rawLines.map(stripMarker).join('\n');
		rules.push({
			id,
			raw,
			text,
			superseded: /superseded/i.test(rawLines[0]),
			unverified: /\[unverified\]/i.test(text),
			evidence: parseEvidence(text)
		});
	}

	return { rules, rejects };
}
