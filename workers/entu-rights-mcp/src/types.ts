// #318 — entu-rights-mcp: shared types for the stamped view over
// docs/architecture/entu-rights-and-visibility-model.md.
//
// The server is a VIEW, never a second home (#318 body): rules are parsed out
// of the repo document at build time and every response carries the source
// commit (+ its date, Gama 2026-09-12 item 3) so a stale answer is detectable.

/** Evidence references parsed from a rule block's `Evidence:` line(s). */
export interface RuleEvidence {
	/**
	 * file:line citation tokens, backtick contents verbatim from the doc —
	 * e.g. "utils/entity.js:296-327" or "middleware/auth.js:21,31-33,46-48".
	 * A token is a backticked `path.ext:<digits[,ranges]>` on an Evidence: line.
	 */
	sourceRefs: string[];
	/** Probe-script paths cited, i.e. paths under scripts/migrations/probes/. */
	probeScripts: string[];
	/** Probe result-file paths cited, i.e. paths under scripts/migrations/seed-results/. */
	resultFiles: string[];
}

/** One identified rule block (`> **ER-<n>** — …`), per the guard-spec grammar. */
export interface ParsedRule {
	/** The identifier, e.g. "ER-13". Well-formed: /^ER-[1-9]\d*$/. */
	id: string;
	/**
	 * Byte-exact blockquote run as it appears in the doc, `>` markers and all,
	 * lines joined with \n. ALWAYS a byte-substring of the raw document — this
	 * is what makes "verbatim" checkable.
	 */
	raw: string;
	/**
	 * `raw` with the leading `>` markers stripped (/^>\s?/ per line), lines
	 * joined with \n — the same convention as src/rights-model-identifiers.spec.ts.
	 */
	text: string;
	/** True when the definition's first line carries the `superseded` marker. */
	superseded: boolean;
	/** True when the block carries an explicit `[unverified]` mark. */
	unverified: boolean;
	evidence: RuleEvidence;
}

/** A blockquote that LOOKS like an ER definition but violates the grammar. */
export interface ParseReject {
	/** 1-indexed line of the raw document the rejected block starts on. */
	line: number;
	reason: string;
}

export interface ParseResult {
	rules: ParsedRule[];
	rejects: ParseReject[];
}

/** The generated, GITIGNORED rules bundle — the build-time stamped view. */
export interface RulesBundle {
	/** Full commit SHA of the source tree the doc was read at. */
	sourceCommit: string;
	/** ISO date of that commit — the at-a-glance staleness signal (Gama item 3). */
	sourceCommitDate: string;
	rules: ParsedRule[];
}

/** MCP tool result (tools/call result payload). */
export interface ToolResult {
	content: { type: 'text'; text: string }[];
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
}

/** MCP tool definition (tools/list entry). */
export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: {
		type: 'object';
		properties: Record<string, unknown>;
		required: string[];
	};
}

/** JSON-RPC 2.0 response (success or error). */
export interface JsonRpcResponse {
	jsonrpc: '2.0';
	id: number | string | null;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}
