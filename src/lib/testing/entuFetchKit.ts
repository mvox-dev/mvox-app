// Shared builders for specs that stub Entu's fetch: responses, settle-later promises, cfg, calls.
import type { EntuCfg } from '$lib/seasons/entuSeasons';

export function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
	return new Response(JSON.stringify(body), headers ? { status, headers } : { status });
}

export interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
}

export function deferred<T = void>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

export function testCfg(db: string, token = 'jwt'): EntuCfg {
	return { db, token };
}

export interface Call {
	url: string;
	method: string;
	body?: unknown;
	headers?: unknown;
}
