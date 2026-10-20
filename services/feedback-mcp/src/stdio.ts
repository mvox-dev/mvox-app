// Never rejects: one failing message answers -32603 for its id, and reading goes on.
import { handleMessage } from './protocol.ts';
import type { Ctx } from './tools.ts';

const idOf = (msg: unknown): number | string | null => {
	const id = typeof msg === 'object' && msg !== null ? (msg as { id?: unknown }).id : null;
	return typeof id === 'number' || typeof id === 'string' ? id : null;
};

export async function answerLine(ctx: Ctx, line: string): Promise<string | null> {
	if (line.trim() === '') return null;
	let msg: unknown;
	try {
		msg = JSON.parse(line);
	} catch {
		const error = { code: -32700, message: 'Parse error' };
		return JSON.stringify({ jsonrpc: '2.0', id: null, error });
	}
	try {
		const res = await handleMessage(ctx, msg);
		return res ? JSON.stringify(res) : null;
	} catch (err) {
		const message = `Internal error: ${err instanceof Error ? err.message : `${err}`}`;
		return JSON.stringify({ jsonrpc: '2.0', id: idOf(msg), error: { code: -32603, message } });
	}
}
