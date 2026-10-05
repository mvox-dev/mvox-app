// A fake Entu and build stamp for a feedback send: the reads and the three writes it makes.
import { vi } from 'vitest';
import { json } from './entuFetchKit';

export const API = 'https://api.entu-test.invalid/';
export const TYPE_ID = 'type-feedback-1';
export const COMMIT = '0123456789abcdef0123456789abcdef01234567';
export const UPLOAD_URL = 'https://s3.example.invalid/bucket/screenshot?signature=sig-1';

export interface FeedbackEntuOpts {
	/** member id per person id; a person missing here has no active member row. */
	members?: Record<string, string>;
	branch?: string;
	/** Answer for the create POST; undefined falls through to a fresh id per create. */
	create?: () => Response | Promise<Response> | undefined;
	/** Answer for a screenshot POST on that entity; undefined falls through to the default. */
	meta?: (id: string) => Response | Promise<Response> | undefined;
}

export function feedbackEntu(opts: FeedbackEntuOpts = {}) {
	const state = {
		branch: opts.branch ?? 'main',
		creates: 0,
		/** Feedback entities that exist in the fake Entu, and those whose screenshot landed. */
		live: new Set<string>(),
		shot: new Set<string>(),
		lastMeta: ''
	};
	const members = opts.members ?? { 'person-p': 'member-p', 'person-q': 'member-q' };
	const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (method === 'GET' && url === '/version.json') {
			return json({ source: 'cloudflare-pages', branch: state.branch, commit: COMMIT });
		}
		if (method === 'GET' && url.includes('_type.string=entity&name.string=')) {
			return json({ entities: [{ _id: TYPE_ID }] });
		}
		if (method === 'GET' && url.includes('_type.string=member&person.reference=')) {
			const person = decodeURIComponent(url.match(/person\.reference=([^&]+)/)![1]);
			return json({ entities: members[person] ? [{ _id: members[person] }] : [] });
		}
		if (method === 'POST' && /\/entity$/.test(url)) {
			const override = opts.create?.();
			if (override) return override;
			const id = `fb-${++state.creates}`;
			state.live.add(id);
			return json({ _id: id });
		}
		const meta = url.match(/\/entity\/(fb-\d+)$/);
		if (method === 'DELETE' && meta) {
			state.live.delete(meta[1]);
			return json({ deleted: true });
		}
		if (method === 'POST' && meta) {
			const override = opts.meta?.(meta[1]);
			if (override) return override;
			state.lastMeta = meta[1];
			return json({
				_id: meta[1],
				properties: [{ _id: `${meta[1]}-shot`, type: 'screenshot', upload: { url: UPLOAD_URL, method: 'PUT', headers: {} } }]
			});
		}
		if (method === 'PUT' && url === UPLOAD_URL) {
			state.shot.add(state.lastMeta);
			return new Response('', { status: 200 });
		}
		if (method === 'GET') return json({ entities: [], count: 0 });
		throw new Error(`unexpected request: ${method} ${url}`);
	});
	return { fetchImpl, state };
}

type Calls = { mock: { calls: unknown[][] } };

/** Every create POST's body, parsed. */
export function createBodies(fetchImpl: Calls): Array<Array<Record<string, string>>> {
	return fetchImpl.mock.calls
		.filter(([u, i]) => /\/entity$/.test(String(u)) && (i as RequestInit | undefined)?.method === 'POST')
		.map(([, i]) => JSON.parse(String((i as RequestInit).body)));
}

/** The value of one property in a create body. */
export function prop(body: Array<Record<string, string>>, type: string): string | undefined {
	const entry = body.find((p) => p.type === type);
	return entry?.string ?? entry?.reference;
}

// (*MVOX:Josquin*)
