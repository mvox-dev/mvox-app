// grantSelfEditor: pre-read, grant and read back a person's own _editor right.
import { describe, expect, it, vi } from 'vitest';
import { grantSelfEditor } from './grant-self-editor';
import { json, testCfg, type Call } from '$lib/testing/entuFetchKit';

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

const BASE = 'https://api.entu-test.invalid/testdb';
const PERSON = 'person-1';
const ADMIN = 'admin-9';
const cfg = testCfg('testdb');

const PRE_READ_URL = `${BASE}/entity/${PERSON}?props=_owner,_editor,_viewer,_expander,_noaccess`;
const READ_BACK_URL = `${BASE}/entity/${PERSON}?props=_editor`;

const GET_HEADERS = { Authorization: 'Bearer jwt', Accept: 'application/json' };
const POST_HEADERS = { ...GET_HEADERS, 'Content-Type': 'application/json' };

function seqFetch(responses: Response[]): { impl: typeof fetch; calls: Call[] } {
	const calls: Call[] = [];
	const impl = (async (url: URL | RequestInfo, init?: RequestInit) => {
		calls.push({
			url: String(url),
			method: init?.method ?? 'GET',
			headers: init?.headers,
			body: typeof init?.body === 'string' ? init.body : undefined
		});
		const next = responses.shift();
		if (!next) throw new Error(`fake fetch: unexpected extra call to ${String(url)}`);
		return next;
	}) as typeof fetch;
	return { impl, calls };
}

type RightsEntry = { reference: string; inherited?: boolean };

function rights(props: Record<string, RightsEntry[]>): Response {
	return json({ entity: props });
}

function cleanPreRead(): Response {
	return rights({ _owner: [{ reference: ADMIN, inherited: false }] });
}

describe('grantSelfEditor — happy path', () => {
	it('1. byte-pins the wire: five-tier pre-read, the invite-path POST, then the read-back GET — full-shape, in order, nothing else', async () => {
		const { impl, calls } = seqFetch([
			cleanPreRead(),
			json({ _id: PERSON }), // write echo — must NOT be what proves the grant
			rights({ _editor: [{ reference: PERSON, inherited: false }] })
		]);

		await expect(grantSelfEditor(cfg, PERSON, impl)).resolves.toEqual({
			action: 'granted',
			personId: PERSON
		});

		expect(calls).toEqual([
			{ url: PRE_READ_URL, method: 'GET', headers: GET_HEADERS, body: undefined },
			{
				url: `${BASE}/entity/${PERSON}`,
				method: 'POST',
				headers: POST_HEADERS,
				body: '[{"type":"_editor","reference":"person-1"}]'
			},
			{ url: READ_BACK_URL, method: 'GET', headers: GET_HEADERS, body: undefined }
		]);
	});

	it('6. an INHERITED self-_editor does not count — the direct grant is still issued (ER: direct vs inherited are different claims)', async () => {
		const { impl, calls } = seqFetch([
			rights({
				_owner: [{ reference: ADMIN, inherited: false }],
				_editor: [{ reference: PERSON, inherited: true }]
			}),
			json({ _id: PERSON }),
			rights({
				_editor: [
					{ reference: PERSON, inherited: true },
					{ reference: PERSON, inherited: false }
				]
			})
		]);

		await expect(grantSelfEditor(cfg, PERSON, impl)).resolves.toEqual({
			action: 'granted',
			personId: PERSON
		});
		expect(calls).toHaveLength(3);
		expect(calls[1]!.method).toBe('POST');
	});
});

describe('grantSelfEditor — the #369 class: payload said yes, rights said no', () => {
	it('2. write 2xx but read-back MISSING the grant -> throws loudly, naming the person and the read-back', async () => {
		const { impl } = seqFetch([
			cleanPreRead(),
			json({ _id: PERSON }), // the write's own payload claims success
			rights({ _editor: [{ reference: ADMIN, inherited: false }] }) // rights say no
		]);

		await expect(grantSelfEditor(cfg, PERSON, impl)).rejects.toThrow(
			new RegExp(`read-back.*${PERSON}|${PERSON}.*read-back`)
		);
	});

	it("2b. read-back showing only an INHERITED self-_editor is still a missing grant — the write's direct grant did not land", async () => {
		const { impl } = seqFetch([
			cleanPreRead(),
			json({ _id: PERSON }),
			rights({ _editor: [{ reference: PERSON, inherited: true }] })
		]);

		await expect(grantSelfEditor(cfg, PERSON, impl)).rejects.toThrow(/read-back/);
	});
});

describe('grantSelfEditor — loud failure on non-2xx', () => {
	it('3. non-2xx write -> throws with the response status surfaced, and never issues the read-back', async () => {
		const { impl, calls } = seqFetch([cleanPreRead(), new Response('Forbidden', { status: 403 })]);

		await expect(grantSelfEditor(cfg, PERSON, impl)).rejects.toThrow(/403/);
		expect(calls).toHaveLength(2); // pre-read + failed write; no read-back after a failed write
	});

	it('3b. non-2xx PRE-READ -> throws with the status surfaced, and never writes (a blind write is the trap the fresh read exists to prevent)', async () => {
		const { impl, calls } = seqFetch([new Response('Server error', { status: 500 })]);

		await expect(grantSelfEditor(cfg, PERSON, impl)).rejects.toThrow(/500/);
		expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
	});
});

describe('grantSelfEditor — check-first (the remedy-369 discipline)', () => {
	it("4. idempotence: direct self-_editor already present at read-before-write -> SKIP-AND-RETURN, no write (remedy-369's 'skip-already-fixed')", async () => {
		const { impl, calls } = seqFetch([
			rights({
				_owner: [{ reference: ADMIN, inherited: false }],
				_editor: [{ reference: PERSON, inherited: false }]
			})
		]);

		await expect(grantSelfEditor(cfg, PERSON, impl)).resolves.toEqual({
			action: 'skip-already-granted',
			personId: PERSON
		});
		expect(calls.map((c) => c.method)).toEqual(['GET']);
	});

	it('5. ER-6/ER-9 downgrade trap: a DIFFERENT direct self-tier (_owner) -> REFUSES, throws naming the tier, and never issues the write that would silently retire it', async () => {
		const { impl, calls } = seqFetch([
			rights({ _owner: [{ reference: PERSON, inherited: false }] })
		]);

		await expect(grantSelfEditor(cfg, PERSON, impl)).rejects.toThrow(/_owner/);
		expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
	});

	it('5b. same refusal for a direct self-_viewer — any non-_editor direct self-tier is named, never overwritten', async () => {
		const { impl, calls } = seqFetch([
			rights({
				_owner: [{ reference: ADMIN, inherited: false }],
				_viewer: [{ reference: PERSON, inherited: false }]
			})
		]);

		await expect(grantSelfEditor(cfg, PERSON, impl)).rejects.toThrow(/_viewer/);
		expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
	});
});

// (*MVOX:Tallis*)
