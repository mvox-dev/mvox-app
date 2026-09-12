// #318 — the two tools, and ONLY these two (#318 body):
//   rights_rule(id)     — one rule, VERBATIM, + probe-script/result-file paths
//   rights_rules(topic) — matching identifiers for a caller without the id
//
// Deliberately NOT served: generated per-question answers. Every served text
// is doc-derived: the verbatim rule text, or a context line that is a
// byte-substring of that rule's own text — never generated prose. The
// human-readable `content` channel is exactly the JSON serialization of
// `structuredContent`, so no free-prose channel exists at all.
import type { RulesBundle, ToolDefinition, ToolResult } from './types';

const CONTEXT_MAX_CHARS = 300;

export const TOOL_DEFINITIONS: ToolDefinition[] = [
	{
		name: 'rights_rule',
		description:
			'One rights-model rule, verbatim, plus its evidence (source refs, probe-script and result-file paths) and the source-commit stamp.',
		inputSchema: {
			type: 'object',
			properties: { id: { type: 'string', description: 'The rule identifier, e.g. "ER-13".' } },
			required: ['id']
		}
	},
	{
		name: 'rights_rules',
		description:
			'Rule identifiers matching a topic, for a caller who does not know the identifier, each with a doc-derived context line.',
		inputSchema: {
			type: 'object',
			properties: { topic: { type: 'string', description: 'Free-text topic to search rule text for.' } },
			required: ['topic']
		}
	}
];

const toContent = (structuredContent: Record<string, unknown>): ToolResult['content'] => [
	{ type: 'text', text: JSON.stringify(structuredContent) }
];

/** A doc-derived context line for `topic` inside `text` — a byte-substring of `text`, never generated prose. */
function extractContext(text: string, topic: string): string {
	const topicLower = topic.toLowerCase();
	const lines = text.split('\n');
	const matchLine = lines.find((l) => l.toLowerCase().includes(topicLower)) ?? lines[0] ?? '';
	if (matchLine.length <= CONTEXT_MAX_CHARS) return matchLine;

	const idx = matchLine.toLowerCase().indexOf(topicLower);
	if (idx === -1) return matchLine.slice(0, CONTEXT_MAX_CHARS);

	let start = Math.max(0, idx - Math.floor((CONTEXT_MAX_CHARS - topic.length) / 2));
	let end = start + CONTEXT_MAX_CHARS;
	if (end > matchLine.length) {
		end = matchLine.length;
		start = Math.max(0, end - CONTEXT_MAX_CHARS);
	}
	return matchLine.slice(start, end);
}

/** rights_rule(id): one rule, verbatim, + evidence + probe paths + stamp. Unknown id → MCP tool-error result, never a throw. */
export function rightsRule(bundle: RulesBundle, args: { id: string }): ToolResult {
	const rule = bundle.rules.find((r) => r.id === args.id);
	if (!rule) {
		const structuredContent = {
			error: `unknown rule id "${args.id}"`,
			sourceCommit: bundle.sourceCommit,
			sourceCommitDate: bundle.sourceCommitDate
		};
		return {
			isError: true,
			content: [{ type: 'text', text: `unknown rule id "${args.id}"` }],
			structuredContent
		};
	}

	const structuredContent = {
		id: rule.id,
		text: rule.text,
		evidence: rule.evidence,
		sourceCommit: bundle.sourceCommit,
		sourceCommitDate: bundle.sourceCommitDate
	};
	return { content: toContent(structuredContent), structuredContent };
}

/** rights_rules(topic): case-insensitive match over rule text → matching ids + a doc-derived context line each. No match → empty list, stamp still present. */
export function rightsRules(bundle: RulesBundle, args: { topic: string }): ToolResult {
	const topicLower = args.topic.toLowerCase();
	const matches = bundle.rules
		.filter((r) => r.text.toLowerCase().includes(topicLower))
		.map((r) => ({ id: r.id, context: extractContext(r.text, args.topic) }));

	const structuredContent = {
		topic: args.topic,
		matches,
		sourceCommit: bundle.sourceCommit,
		sourceCommitDate: bundle.sourceCommitDate
	};
	return { content: toContent(structuredContent), structuredContent };
}
