// MCP over JSON-RPC 2.0 as pure handlers, in the shape of workers/entu-rights-mcp/src/protocol.ts.
import { callTool, TOOL_DEFINITIONS, type Ctx } from './tools.ts';

export const SERVER_NAME = 'mvox-feedback';
const SERVER_VERSION = '0.0.1';
const PROTOCOL_VERSION = '2025-06-18';

export type JsonRpcResponse = {
	jsonrpc: '2.0';
	id: number | string | null;
	result?: unknown;
	error?: { code: number; message: string };
};

const isRecord = (x: unknown): x is Record<string, unknown> =>
	typeof x === 'object' && x !== null && !Array.isArray(x);

const echoId = (message: Record<string, unknown>): number | string | null =>
	typeof message.id === 'number' || typeof message.id === 'string' ? message.id : null;

export async function handleMessage(ctx: Ctx, msg: unknown): Promise<JsonRpcResponse | null> {
	if (!isRecord(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
		return {
			jsonrpc: '2.0',
			id: isRecord(msg) ? echoId(msg) : null,
			error: { code: -32600, message: 'Invalid Request' }
		};
	}
	if (!('id' in msg)) return null;

	const id = echoId(msg);
	const params = isRecord(msg.params) ? msg.params : {};

	if (msg.method === 'initialize') {
		return {
			jsonrpc: '2.0',
			id,
			result: {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
			}
		};
	}

	if (msg.method === 'tools/list') {
		return { jsonrpc: '2.0', id, result: { tools: TOOL_DEFINITIONS } };
	}

	if (msg.method === 'tools/call') {
		const name = params.name;
		if (typeof name !== 'string' || !TOOL_DEFINITIONS.some((t) => t.name === name)) {
			return {
				jsonrpc: '2.0',
				id,
				error: { code: -32602, message: `Invalid params: unknown tool "${String(name)}"` }
			};
		}
		return { jsonrpc: '2.0', id, result: await callTool(ctx, name, params.arguments ?? {}) };
	}

	return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
}
