// #318 — minimal MCP over JSON-RPC 2.0 (initialize, tools/list, tools/call)
// as pure functions. NO @modelcontextprotocol/sdk, no runtime dependencies.
import type { JsonRpcResponse, RulesBundle } from './types';
import { rightsRule, rightsRules, TOOL_DEFINITIONS } from './tools';

export const SERVER_NAME = 'entu-rights-mcp';
const PROTOCOL_VERSION = '2025-06-18';

const isRecord = (x: unknown): x is Record<string, unknown> =>
	typeof x === 'object' && x !== null && !Array.isArray(x);

const echoId = (message: Record<string, unknown>): number | string | null =>
	typeof message.id === 'number' || typeof message.id === 'string' ? message.id : null;

/**
 * Handle one already-JSON-parsed JSON-RPC message. Pure.
 * - initialize → protocolVersion + capabilities.tools + serverInfo
 * - tools/list → the two TOOL_DEFINITIONS
 * - tools/call → routes to rightsRule / rightsRules
 * - unknown method → error -32601; malformed message → -32600;
 *   tools/call with an unknown tool name → -32602.
 */
export function handleJsonRpcMessage(bundle: RulesBundle, message: unknown): JsonRpcResponse {
	if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
		return {
			jsonrpc: '2.0',
			id: isRecord(message) ? echoId(message) : null,
			error: { code: -32600, message: 'Invalid Request' }
		};
	}

	const id = echoId(message);
	const method = message.method;
	const params = isRecord(message.params) ? message.params : {};

	if (method === 'initialize') {
		return {
			jsonrpc: '2.0',
			id,
			result: {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: { name: SERVER_NAME, version: bundle.sourceCommit }
			}
		};
	}

	if (method === 'tools/list') {
		return { jsonrpc: '2.0', id, result: { tools: TOOL_DEFINITIONS } };
	}

	if (method === 'tools/call') {
		const name = params.name;
		const args = isRecord(params.arguments) ? params.arguments : {};
		if (name === 'rights_rule') {
			return { jsonrpc: '2.0', id, result: rightsRule(bundle, { id: String(args.id ?? '') }) };
		}
		if (name === 'rights_rules') {
			return { jsonrpc: '2.0', id, result: rightsRules(bundle, { topic: String(args.topic ?? '') }) };
		}
		return {
			jsonrpc: '2.0',
			id,
			error: { code: -32602, message: `Invalid params: unknown tool "${String(name)}"` }
		};
	}

	return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}
