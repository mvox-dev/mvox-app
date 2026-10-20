// Read-only Entu client: request() is the one fetch call site, and it sends no method or body.
import type { DbEntry } from './config.ts';
import { assertDb, assertId } from './guards.ts';

export type RawEntity = Record<string, unknown> & { _id: string };

const BASE = 'https://api.entu.app';
const PAGE = 100;
const PROPS = 'name,description,metadata,doodle_layer,screenshot,issue_url,_parent,_created';

export class EntuReader {
	private readonly tokens = new Map<string, string>();

	constructor(
		private readonly dbs: DbEntry[],
		private readonly fetchImpl: typeof fetch = fetch
	) {}

	async listFeedback(db: string): Promise<RawEntity[]> {
		const all: RawEntity[] = [];
		for (let skip = 0; ; skip += PAGE) {
			const path = `entity?_type.string=feedback&props=${PROPS}&limit=${PAGE}&skip=${skip}`;
			const body = (await this.get(db, path)) as { entities?: RawEntity[] };
			const page = body.entities ?? [];
			all.push(...page);
			if (page.length < PAGE) return all;
		}
	}

	async getFeedback(db: string, id: string): Promise<RawEntity> {
		const body = (await this.get(db, `entity/${assertId(id)}?props=${PROPS},_type`)) as {
			entity?: RawEntity & { _type?: { string?: string }[] };
		};
		if (body.entity?._type?.[0]?.string !== 'feedback') {
			throw new Error(`getFeedback: no feedback ${id} in ${db}`);
		}
		return body.entity;
	}

	async signFile(db: string, fileId: string): Promise<string> {
		const body = (await this.get(db, `property/${assertId(fileId)}`)) as { url?: string };
		if (!body.url) throw new Error(`signFile: no url for file ${fileId} in ${db}`);
		return body.url;
	}

	async fetchBytes(url: string): Promise<Uint8Array> {
		if (!url.startsWith('https://')) throw new Error('fetchBytes: only https urls');
		const res = await this.request(url);
		if (!res.ok) throw new Error(`fetchBytes: HTTP ${res.status}`);
		return new Uint8Array(await res.arrayBuffer());
	}

	async listAll(): Promise<{
		results: { db: string; entities: RawEntity[] }[];
		errors: { db: string; message: string }[];
	}> {
		const settled = await Promise.allSettled(this.dbs.map((d) => this.listFeedback(d.db)));
		const results: { db: string; entities: RawEntity[] }[] = [];
		const errors: { db: string; message: string }[] = [];
		settled.forEach((s, i) => {
			const db = this.dbs[i].db;
			if (s.status === 'fulfilled') results.push({ db, entities: s.value });
			else errors.push({ db, message: s.reason instanceof Error ? s.reason.message : `${s.reason}` });
		});
		return { results, errors };
	}

	// Entu tokens expire mid-session: one 401 drops the cached token and retries once.
	private async get(db: string, path: string): Promise<unknown> {
		const entry = assertDb(this.dbs, db);
		let res = await this.request(`${BASE}/${db}/${path}`, await this.token(entry));
		if (res.status === 401) {
			this.tokens.delete(db);
			res = await this.request(`${BASE}/${db}/${path}`, await this.token(entry));
		}
		if (!res.ok) throw new Error(`${db}: GET ${path.split('?')[0]} failed: HTTP ${res.status}`);
		return res.json();
	}

	private async token(entry: DbEntry): Promise<string> {
		const cached = this.tokens.get(entry.db);
		if (cached) return cached;
		const res = await this.request(`${BASE}/auth?db=${entry.db}`, entry.key);
		if (!res.ok) throw new Error(`${entry.db}: auth failed: HTTP ${res.status}`);
		const body = (await res.json()) as { token?: string };
		if (!body.token) throw new Error(`${entry.db}: auth returned no token`);
		this.tokens.set(entry.db, body.token);
		return body.token;
	}

	private request(url: string, bearer?: string): Promise<Response> {
		const headers: Record<string, string> = bearer ? { Authorization: `Bearer ${bearer}` } : {};
		return this.fetchImpl(url, { headers });
	}
}
