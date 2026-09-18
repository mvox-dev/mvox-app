import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { grantSelfEditor } from './grant-self-editor';

// ════════════════════════════════════════════════════════════════════════════
// #371 RED — grantSelfEditor, the bulk-provisioning primitive.
//
// Wire shape is the invite path's post-create grant, byte-for-byte
// (src/lib/invite/inviteData.ts:255-265): POST entity/{personId}, body
// [{type:'_editor', reference: personId}]. Check-first + refuse-on-different-
// tier discipline mirrors the remedy-369 script (scripts/migrations/probes/
// remedy-369-crede-self-editor-grant-2026-09-15.ts): direct self-`_editor`
// already present -> SKIP (its 'skip-already-fixed'); any OTHER direct
// self-tier -> never write ('skip-different-tier' — here a loud THROW, since a
// bulk seed proceeding past it would silently strand the person). ER-6/ER-9:
// one active direct tier per reference per entity; a new grant retires the old
// one with no error and no notice — the downgrade trap test 5 pins.
//
// The done-when's read-back proof (#369 class — payload said yes, rights said
// no) is IN the primitive: after a 2xx write it re-READs `_editor` and asserts
// the DIRECT self grant, never trusting the write's echo (remedy-369's
// "Independent read-back" step).
//
// INTEGRATION NOTE: this is a migrations-lib primitive — there is no page
// route to render on. Its integration surface is the Entu wire, and these
// tests drive the REAL producer chain (grantSelfEditor -> entuFetch ->
// entuUrl -> ENTU_API_BASE): only bare `fetch` is faked, so the byte-pinned
// URLs and Authorization/Accept header merge below prove the real composition
// code, not a mock of it. No live calls anywhere (networkGuard enforces).
// ════════════════════════════════════════════════════════════════════════════

vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

const BASE = 'https://api.entu-test.invalid/testdb';
const PERSON = 'person-1';
const ADMIN = 'admin-9';
const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

// The five-tier pre-read URL (fresh read at call time, remedy-369 step 1) and
// the read-back URL (step 4). Pinned exactly — the primitive owns this shape.
const PRE_READ_URL = `${BASE}/entity/${PERSON}?props=_owner,_editor,_viewer,_expander,_noaccess`;
const READ_BACK_URL = `${BASE}/entity/${PERSON}?props=_editor`;

const GET_HEADERS = { Authorization: 'Bearer jwt', Accept: 'application/json' };
const POST_HEADERS = { ...GET_HEADERS, 'Content-Type': 'application/json' };

interface Call {
	url: string;
	method: string;
	headers: unknown;
	body: string | undefined;
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

/** Queue-driven fake fetch: records every call full-shape, throws on overrun. */
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

/** Rights-read body in the live wire shape ({ entity: { _owner: [...], ... } }). */
function rights(props: Record<string, RightsEntry[]>): Response {
	return json({ entity: props });
}

/** Clean pre-read fixture: admin holds the create-time direct _owner (that is
 * exactly the #371 defect state — the person themselves holds nothing). */
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
				// Byte-identical to inviteData.ts:262 — JSON.stringify([{type:'_editor',reference:personId}])
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
		// One call total: the pre-read. No POST, no read-back.
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
