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
	/** Answer for the create POST; default is a fresh id per create. */
	create?: () => Response | Promise<Response>;
}

export function feedbackEntu(opts: FeedbackEntuOpts = {}) {
	const state = { branch: opts.branch ?? 'main', creates: 0 };
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
			if (opts.create) return opts.create();
			return json({ _id: `fb-${++state.creates}` });
		}
		const meta = url.match(/\/entity\/(fb-\d+)$/);
		if (method === 'POST' && meta) {
			return json({
				_id: meta[1],
				properties: [{ _id: `${meta[1]}-shot`, type: 'screenshot', upload: { url: UPLOAD_URL, method: 'PUT', headers: {} } }]
			});
		}
		if (method === 'PUT' && url === UPLOAD_URL) return new Response('', { status: 200 });
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
