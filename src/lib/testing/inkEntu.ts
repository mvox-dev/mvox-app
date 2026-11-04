// A fake Entu for ink sync: editions with files, private layers seen only by their owner.
import { vi } from 'vitest';
import { json } from './entuFetchKit';

export const INK_TYPE_ID = 'type-ink-layer-1';

interface Value {
	_id: string;
	string?: string;
	number?: number;
	reference?: string;
	boolean?: boolean;
	at: string;
}

interface Entity {
	_id: string;
	db: string;
	owner: string;
	props: Record<string, Value[]>;
}

export interface InkEntuOpts {
	/** Each token's person in each db: one JWT carries every collective. */
	tokens: Record<string, Record<string, string>>;
	/** fileId -> edition id, per db. */
	files: Record<string, Record<string, string>>;
}

export function inkEntu(opts: InkEntuOpts) {
	const state = {
		offline: false,
		/** Writes answer this status instead of landing. */
		refuse: null as number | null,
		/** Every request answers 401. */
		expired: false,
		clock: Date.parse('2026-11-03T10:00:00.000Z'),
		ids: 0,
		entities: [] as Entity[]
	};
	const nextId = (kind: string) => `${kind}-${++state.ids}`;
	const now = () => new Date((state.clock += 1000)).toISOString();

	function personOf(db: string, init?: RequestInit): string | undefined {
		const auth = new Headers(init?.headers).get('Authorization') ?? '';
		return opts.tokens[auth.replace(/^Bearer /, '')]?.[db];
	}

	function wire(entity: Entity, props: string[]) {
		const out: Record<string, unknown> = { _id: entity._id };
		for (const name of props) {
			const values = entity.props[name];
			if (values) out[name] = values.map(({ at: _at, ...v }) => v);
		}
		return out;
	}

	function apply(entity: Entity, body: Array<Record<string, unknown>>) {
		for (const { _id, type, ...value } of body) {
			const name = String(type);
			const list = (entity.props[name] ??= []);
			const at = list.findIndex((v) => v._id === _id);
			const next = { ...(value as Omit<Value, '_id' | 'at'>), _id: nextId('value'), at: now() };
			// Entu answers a type reference's name in `.string`, which the layer search filters on.
			if (name === '_type' && next.reference === INK_TYPE_ID) next.string = 'ink_layer';
			if (at >= 0) list[at] = next;
			else list.push(next);
		}
	}

	const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		if (state.offline) throw new TypeError('Failed to fetch');
		if (state.expired) return json({ message: 'expired' }, 401);
		const url = new URL(String(input));
		const [db, ...rest] = url.pathname.replace(/^\//, '').split('/');
		const path = rest.join('/');
		const method = init?.method ?? 'GET';
		const person = personOf(db, init);
		const q = url.searchParams;
		if (method !== 'GET' && state.refuse) return json({ message: 'refused' }, state.refuse);

		if (method === 'GET' && path === 'entity' && q.get('_type.string') === 'entity') {
			return json({ entities: q.get('name.string') === 'ink_layer' ? [{ _id: INK_TYPE_ID }] : [] });
		}
		if (method === 'GET' && path.startsWith('property/')) {
			const id = path.slice('property/'.length);
			const edition = opts.files[db]?.[id];
			if (edition) return json({ _id: id, entity: edition, type: 'file', created: { at: now() } });
			for (const e of state.entities.filter((x) => x.db === db && x.owner === person)) {
				for (const [type, values] of Object.entries(e.props)) {
					const v = values.find((x) => x._id === id);
					if (v) return json({ _id: id, entity: e._id, type, created: { at: v.at, by: e.owner } });
				}
			}
			return json({ message: 'not found' }, 404);
		}
		if (method === 'GET' && path === 'entity') {
			const filters = [...q.entries()].filter(([k]) => !['props', 'limit', 'sort'].includes(k));
			const props = (q.get('props') ?? '').split(',').filter((p) => p && p !== '_id');
			const seen = state.entities.filter(
				(e) =>
					e.db === db &&
					e.owner === person &&
					filters.every(([k, want]) => {
						const [name, field] = k.split('.');
						return (e.props[name] ?? []).some((v) => String(v[field as keyof Value]) === want);
					})
			);
			// Unsorted, this fake answers newest first: Entu's default order is not the app's to assume.
			if (q.get('sort') !== '_created.datetime') seen.reverse();
			return json({ entities: seen.map((e) => wire(e, props)), count: seen.length });
		}
		if (method === 'POST' && path === 'entity') {
			if (!person) return json({ message: 'no user' }, 403);
			const entity: Entity = { _id: nextId('layer'), db, owner: person, props: {} };
			apply(entity, JSON.parse(String(init?.body)));
			state.entities.push(entity);
			return json({ _id: entity._id });
		}
		if (method === 'DELETE' && path.startsWith('property/')) {
			const id = path.slice('property/'.length);
			for (const e of state.entities.filter((x) => x.db === db && x.owner === person)) {
				for (const values of Object.values(e.props)) {
					const at = values.findIndex((v) => v._id === id);
					if (at >= 0) values.splice(at, 1);
				}
			}
			return json({ deleted: true });
		}
		const one = state.entities.find((e) => e.db === db && path === `entity/${e._id}`);
		if (one && one.owner !== person) return json({ message: 'no access' }, 403);
		if (method === 'GET' && one) {
			return json({ entity: wire(one, (q.get('props') ?? '').split(',')) });
		}
		if (method === 'POST' && one) {
			apply(one, JSON.parse(String(init?.body)));
			return json({ _id: one._id });
		}
		throw new Error(`inkEntu: unexpected request ${method} ${String(input)}`);
	});

	/** Her layers in `db` as Entu holds them, with each page's log parsed. */
	function layers(db: string, personId: string) {
		return state.entities
			.filter((e) => e.db === db && e.owner === personId)
			.map((e) => ({
				_id: e._id,
				props: e.props,
				pages: (e.props.page_ink ?? []).map((v) => JSON.parse(v.string ?? '')),
				place: e.props.last_page?.[0]?.number
			}));
	}

	return { fetchImpl, state, layers };
}

// (*MVOX:Josquin*)
