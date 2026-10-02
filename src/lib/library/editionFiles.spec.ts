// @vitest-environment happy-dom
// uploadEditionFiles: the two-step signed-URL upload flow for edition files.
import { describe, expect, it, vi } from 'vitest';
import { json, testCfg } from '$lib/testing/entuFetchKit';

vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import { uploadEditionFiles, formatFileSize } from './editionFiles';

const cfg = testCfg('sampledb', 'jwt-abc');

const API = 'https://api.entu-test.invalid/';

function makeFile(name: string, bytes: number, type: string): File {
	return new File([new Uint8Array(bytes)], name, { type });
}

interface UploadObject {
	url: string;
	method: string;
	headers: Record<string, string | number>;
}

function uploadFor(name: string, size: number, type: string, n: number): UploadObject {
	return {
		url: `https://s3.example.invalid/bucket/path-${n}?signature=sig-${n}`,
		method: 'PUT',
		headers: {
			ACL: 'private',
			'Content-Disposition': `inline;filename="${name}"`,
			'Content-Length': size,
			'Content-Type': type
		}
	};
}

function step1Response(
	entries: Array<{ id: string; name: string; size: number; type: string; upload: UploadObject }>
) {
	return {
		_id: 'edition-1',
		properties: entries.map((e) => ({
			_id: e.id,
			type: 'file',
			filename: e.name,
			filesize: e.size,
			filetype: e.type,
			upload: e.upload
		}))
	};
}

type FetchCall = [input: RequestInfo | URL, init?: RequestInit];

function makeFetchImpl(routes: {
	post?: Response | Error;
	put?: Record<string, Response | Error>; // by upload url
	del?: Record<string, Response | Error>; // by property id
}) {
	const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (method === 'POST') {
			const r = routes.post ?? json({});
			if (r instanceof Error) throw r;
			return r;
		}
		if (method === 'PUT') {
			const r = routes.put?.[url];
			if (r instanceof Error) throw r;
			return r ?? new Response('', { status: 200 });
		}
		if (method === 'DELETE') {
			const propId = url.split('/').pop() ?? '';
			const r = routes.del?.[propId];
			if (r instanceof Error) throw r;
			return r ?? json({ deleted: true });
		}
		throw new Error(`unexpected ${method} ${url}`);
	});
	return impl;
}

function callsOf(impl: ReturnType<typeof makeFetchImpl>, method: string): FetchCall[] {
	return (impl.mock.calls as FetchCall[]).filter((c) => (c[1]?.method ?? 'GET') === method);
}

describe('#275 — step 1: one POST to entity/{editionId} carries EVERY file (append idiom)', () => {
	it('two files ride ONE POST — url, auth, and the FULL body shape pinned (no _type, no _parent, no _sharing: this is an append to an existing entity, not a create)', async () => {
		const a = makeFile('a.pdf', 3, 'application/pdf');
		const b = makeFile('b.mp3', 5, 'audio/mpeg');
		const impl = makeFetchImpl({
			post: json(
				step1Response([
					{ id: 'prop-1', name: 'a.pdf', size: 3, type: 'application/pdf', upload: uploadFor('a.pdf', 3, 'application/pdf', 1) },
					{ id: 'prop-2', name: 'b.mp3', size: 5, type: 'audio/mpeg', upload: uploadFor('b.mp3', 5, 'audio/mpeg', 2) }
				])
			)
		});

		await uploadEditionFiles(cfg, 'edition-1', [a, b], impl);

		const posts = callsOf(impl, 'POST');
		expect(posts, 'several files must ride ONE POST (files/index.md:70), never N POSTs').toHaveLength(1);
		const [url, init] = posts[0];
		expect(String(url)).toBe(`${API}sampledb/entity/edition-1`);
		expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer jwt-abc');
		expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
		expect(JSON.parse(String(init?.body))).toEqual([
			{ type: 'file', filename: 'a.pdf', filesize: 3, filetype: 'application/pdf' },
			{ type: 'file', filename: 'b.mp3', filesize: 5, filetype: 'audio/mpeg' }
		]);
	});

	it('a failed step-1 POST throws — nothing was created, so no PUT and no DELETE ever fires', async () => {
		const impl = makeFetchImpl({ post: json({ message: 'forbidden' }, 403) });

		await expect(
			uploadEditionFiles(cfg, 'edition-1', [makeFile('a.pdf', 3, 'application/pdf')], impl)
		).rejects.toThrow(/403/);

		expect(callsOf(impl, 'PUT')).toHaveLength(0);
		expect(callsOf(impl, 'DELETE')).toHaveLength(0);
	});
});

describe('#275 — step-1 parsing is grounded on the LIVE envelope, and an unreadable one fails LOUDLY', () => {
	it('the ledger\'s own bytes drive a full upload: `properties` as a FLAT ARRAY of property objects, pasted from probe-275-envelope-diagnostic-live-2026-09-07T23-13-25-163Z.json (probe1SingleFile.rawResponse), sends the file to its real signed url and reports it uploaded', async () => {
		const ledgerResponse = {
			_id: '6a9f440dca67df980f417d78',
			properties: [
				{
					_id: '6a9f4512ca67df980f417d81',
					type: 'file',
					filename: 'probe-275-envelope-a-2026-09-07T23-13-22-923Z.txt',
					filesize: 11,
					filetype: 'text/plain',
					upload: {
						url: 'https://entu-files.fra1.digitaloceanspaces.com/sampledb/6a9f440dca67df980f417d78/6a9f4512ca67df980f417d81?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=60&X-Amz-Signature=0da7024c85ad876618e2516ef8ded7f5de60da54f87bcc347f8239f86af53449&x-amz-acl=private&x-id=PutObject',
						method: 'PUT',
						headers: {
							ACL: 'private',
							'Content-Disposition':
								'inline;filename="probe-275-envelope-a-2026-09-07T23-13-22-923Z.txt"',
							'Content-Length': 11,
							'Content-Type': 'text/plain'
						}
					}
				}
			]
		};
		const file = makeFile('probe-275-envelope-a-2026-09-07T23-13-22-923Z.txt', 11, 'text/plain');
		const impl = makeFetchImpl({ post: json(ledgerResponse) });

		const result = await uploadEditionFiles(cfg, '6a9f440dca67df980f417d78', [file], impl);

		const puts = callsOf(impl, 'PUT');
		expect(puts).toHaveLength(1);
		expect(String(puts[0][0])).toBe(ledgerResponse.properties[0].upload.url);
		expect(puts[0][1]?.headers).toEqual(ledgerResponse.properties[0].upload.headers);
		expect(result).toEqual({
			uploaded: [
				{
					propertyId: '6a9f4512ca67df980f417d81',
					filename: 'probe-275-envelope-a-2026-09-07T23-13-22-923Z.txt',
					filesize: 11,
					filetype: 'text/plain'
				}
			],
			failed: []
		});
		expect(callsOf(impl, 'DELETE')).toHaveLength(0);
	});

	it('THE SHIPPED BUG, pinned: the keyed `properties: { file: [...] }` shape (quickstart\'s new-entity-CREATE response — what this module used to parse) is NOT a success. Nothing is announced as attached, every file is reported failed, and no PUT is attempted against a shape we did not understand', async () => {
		const impl = makeFetchImpl({
			post: json({
				_id: 'edition-1',
				properties: {
					file: [
						{
							_id: 'prop-1',
							type: 'file',
							filename: 'a.pdf',
							filesize: 3,
							filetype: 'application/pdf',
							upload: uploadFor('a.pdf', 3, 'application/pdf', 1)
						}
					]
				}
			})
		});

		const result = await uploadEditionFiles(
			cfg,
			'edition-1',
			[makeFile('a.pdf', 3, 'application/pdf')],
			impl
		);

		expect(result).toEqual({
			uploaded: [],
			failed: [{ propertyId: null, filename: 'a.pdf', cleanup: 'not-created' }]
		});
		expect(callsOf(impl, 'PUT')).toHaveLength(0);
		expect(callsOf(impl, 'DELETE')).toHaveLength(0);
		expect(impl.mock.calls).toHaveLength(1);
	});

	it('a 2xx with NO properties at all is the same loud path — both files reported, nothing thrown (a throw would strand server-side properties before any cleanup could run)', async () => {
		const impl = makeFetchImpl({ post: json({ _id: 'edition-1' }) });

		const result = await uploadEditionFiles(
			cfg,
			'edition-1',
			[makeFile('a.pdf', 3, 'application/pdf'), makeFile('b.mp3', 5, 'audio/mpeg')],
			impl
		);

		expect(result).toEqual({
			uploaded: [],
			failed: [
				{ propertyId: null, filename: 'a.pdf', cleanup: 'not-created' },
				{ propertyId: null, filename: 'b.mp3', cleanup: 'not-created' }
			]
		});
		expect(callsOf(impl, 'PUT')).toHaveLength(0);
	});

	it('non-file members of the array are ignored — only `type: "file"` entries are uploaded, and a non-file property is never PUT to nor DELETEd', async () => {
		const upA = uploadFor('a.pdf', 3, 'application/pdf', 1);
		const impl = makeFetchImpl({
			post: json({
				_id: 'edition-1',
				properties: [
					{ _id: 'prop-name', type: 'name', string: 'Kyrie' },
					{
						_id: 'prop-1',
						type: 'file',
						filename: 'a.pdf',
						filesize: 3,
						filetype: 'application/pdf',
						upload: upA
					}
				]
			})
		});

		const result = await uploadEditionFiles(
			cfg,
			'edition-1',
			[makeFile('a.pdf', 3, 'application/pdf')],
			impl
		);

		expect(result).toEqual({
			uploaded: [
				{ propertyId: 'prop-1', filename: 'a.pdf', filesize: 3, filetype: 'application/pdf' }
			],
			failed: []
		});
		const puts = callsOf(impl, 'PUT');
		expect(puts).toHaveLength(1);
		expect(String(puts[0][0])).toBe(upA.url);
		expect(callsOf(impl, 'DELETE')).toHaveLength(0);
	});

	it('a file entry carrying an id but NO usable upload object is a phantom this client CAN clean: no PUT is attempted, the id it handed us is DELETEd, and the file is reported', async () => {
		const impl = makeFetchImpl({
			post: json({
				_id: 'edition-1',
				properties: [
					{
						_id: 'prop-1',
						type: 'file',
						filename: 'a.pdf',
						filesize: 3,
						filetype: 'application/pdf'
					}
				]
			})
		});

		const result = await uploadEditionFiles(
			cfg,
			'edition-1',
			[makeFile('a.pdf', 3, 'application/pdf')],
			impl
		);

		expect(result).toEqual({
			uploaded: [],
			failed: [{ propertyId: 'prop-1', filename: 'a.pdf', cleanup: 'deleted' }]
		});
		expect(callsOf(impl, 'PUT')).toHaveLength(0);
		const dels = callsOf(impl, 'DELETE');
		expect(dels).toHaveLength(1);
		expect(String(dels[0][0])).toBe(`${API}sampledb/property/prop-1`);
	});
});

describe('#275 — step 2: the bytes go straight to upload.url with EXACTLY the four returned headers', () => {
	it('PUTs each file to ITS OWN upload.url — method/url/headers/body pinned; headers are EXACTLY the four returned (toEqual — an Authorization or Accept key smuggled in by entuFetch fails this), and the url is upload.url VERBATIM (no API-base prefix)', async () => {
		const a = makeFile('a.pdf', 3, 'application/pdf');
		const b = makeFile('b.mp3', 5, 'audio/mpeg');
		const upA = uploadFor('a.pdf', 3, 'application/pdf', 1);
		const upB = uploadFor('b.mp3', 5, 'audio/mpeg', 2);
		const impl = makeFetchImpl({
			post: json(
				step1Response([
					{ id: 'prop-1', name: 'a.pdf', size: 3, type: 'application/pdf', upload: upA },
					{ id: 'prop-2', name: 'b.mp3', size: 5, type: 'audio/mpeg', upload: upB }
				])
			)
		});

		await uploadEditionFiles(cfg, 'edition-1', [a, b], impl);

		const puts = callsOf(impl, 'PUT');
		expect(puts).toHaveLength(2);
		const byUrl = new Map(puts.map((c) => [String(c[0]), c[1]]));
		expect([...byUrl.keys()].sort()).toEqual([upA.url, upB.url].sort());
		for (const [up, file] of [
			[upA, a],
			[upB, b]
		] as const) {
			const init = byUrl.get(up.url);
			expect(init, `a PUT must target ${up.url} verbatim`).toBeDefined();
			expect(init?.method).toBe('PUT');
			expect(init?.headers).toEqual(up.headers);
			expect(init?.body).toBe(file);
		}
		for (const url of byUrl.keys()) {
			expect(url.startsWith(API)).toBe(false);
		}
	});

	it('a clean run resolves with every file in `uploaded` — propertyId from step 1, metadata echoed, NO url field anywhere (60s-TTL urls are minted at click time, never stored)', async () => {
		const impl = makeFetchImpl({
			post: json(
				step1Response([
					{ id: 'prop-1', name: 'a.pdf', size: 3, type: 'application/pdf', upload: uploadFor('a.pdf', 3, 'application/pdf', 1) },
					{ id: 'prop-2', name: 'b.mp3', size: 5, type: 'audio/mpeg', upload: uploadFor('b.mp3', 5, 'audio/mpeg', 2) }
				])
			)
		});

		const result = await uploadEditionFiles(
			cfg,
			'edition-1',
			[makeFile('a.pdf', 3, 'application/pdf'), makeFile('b.mp3', 5, 'audio/mpeg')],
			impl
		);

		expect(result).toEqual({
			uploaded: [
				{ propertyId: 'prop-1', filename: 'a.pdf', filesize: 3, filetype: 'application/pdf' },
				{ propertyId: 'prop-2', filename: 'b.mp3', filesize: 5, filetype: 'audio/mpeg' }
			],
			failed: []
		});
		expect(callsOf(impl, 'DELETE')).toHaveLength(0);
	});
});

describe('#275 — a failed PUT deletes its phantom property (DELETE /property/{_id}: the docs hand this endpoint to the uploading caller as THE recovery instruction, files/index.md:72-74, and document no tier restriction for ordinary properties — properties/index.md:124-141 reserves _owner rights for the eight named system props only)', () => {
	it('file 2 of 3 fails its PUT: files 1 and 3 land, file 2 is DELETEd and reported — the DELETE targets THE RIGHT property id, through entuFetch (API base + auth)', async () => {
		const upA = uploadFor('a.pdf', 3, 'application/pdf', 1);
		const upB = uploadFor('b.mp3', 5, 'audio/mpeg', 2);
		const upC = uploadFor('c.pdf', 7, 'application/pdf', 3);
		const impl = makeFetchImpl({
			post: json(
				step1Response([
					{ id: 'prop-1', name: 'a.pdf', size: 3, type: 'application/pdf', upload: upA },
					{ id: 'prop-2', name: 'b.mp3', size: 5, type: 'audio/mpeg', upload: upB },
					{ id: 'prop-3', name: 'c.pdf', size: 7, type: 'application/pdf', upload: upC }
				])
			),
			put: { [upB.url]: new Response('', { status: 403 }) }
		});

		const result = await uploadEditionFiles(
			cfg,
			'edition-1',
			[
				makeFile('a.pdf', 3, 'application/pdf'),
				makeFile('b.mp3', 5, 'audio/mpeg'),
				makeFile('c.pdf', 7, 'application/pdf')
			],
			impl
		);

		expect(result).toEqual({
			uploaded: [
				{ propertyId: 'prop-1', filename: 'a.pdf', filesize: 3, filetype: 'application/pdf' },
				{ propertyId: 'prop-3', filename: 'c.pdf', filesize: 7, filetype: 'application/pdf' }
			],
			failed: [{ propertyId: 'prop-2', filename: 'b.mp3', cleanup: 'deleted' }]
		});

		const dels = callsOf(impl, 'DELETE');
		expect(dels).toHaveLength(1);
		expect(String(dels[0][0])).toBe(`${API}sampledb/property/prop-2`);
		expect((dels[0][1]?.headers as Record<string, string>).Authorization).toBe('Bearer jwt-abc');
	});

	it('a PUT that REJECTS (network death mid-upload) gets the same cleanup as a non-2xx', async () => {
		const upA = uploadFor('a.pdf', 3, 'application/pdf', 1);
		const impl = makeFetchImpl({
			post: json(
				step1Response([
					{ id: 'prop-1', name: 'a.pdf', size: 3, type: 'application/pdf', upload: upA }
				])
			),
			put: { [upA.url]: new Error('network down') }
		});

		const result = await uploadEditionFiles(
			cfg,
			'edition-1',
			[makeFile('a.pdf', 3, 'application/pdf')],
			impl
		);

		expect(result).toEqual({
			uploaded: [],
			failed: [{ propertyId: 'prop-1', filename: 'a.pdf', cleanup: 'deleted' }]
		});
		expect(callsOf(impl, 'DELETE')).toHaveLength(1);
	});

	it('when the cleanup DELETE itself fails the entry says so — cleanup: "delete-failed", never silently promoted to a normal upload and never dropped', async () => {
		const upA = uploadFor('a.pdf', 3, 'application/pdf', 1);
		const impl = makeFetchImpl({
			post: json(
				step1Response([
					{ id: 'prop-1', name: 'a.pdf', size: 3, type: 'application/pdf', upload: upA }
				])
			),
			put: { [upA.url]: new Response('', { status: 500 }) },
			del: { 'prop-1': json({}, 500) }
		});

		const result = await uploadEditionFiles(
			cfg,
			'edition-1',
			[makeFile('a.pdf', 3, 'application/pdf')],
			impl
		);

		expect(result).toEqual({
			uploaded: [],
			failed: [{ propertyId: 'prop-1', filename: 'a.pdf', cleanup: 'delete-failed' }]
		});
	});

	it('a REJECTING cleanup DELETE is "delete-failed" too', async () => {
		const upA = uploadFor('a.pdf', 3, 'application/pdf', 1);
		const impl = makeFetchImpl({
			post: json(
				step1Response([
					{ id: 'prop-1', name: 'a.pdf', size: 3, type: 'application/pdf', upload: upA }
				])
			),
			put: { [upA.url]: new Response('', { status: 500 }) },
			del: { 'prop-1': new Error('network down') }
		});

		const result = await uploadEditionFiles(
			cfg,
			'edition-1',
			[makeFile('a.pdf', 3, 'application/pdf')],
			impl
		);

		expect(result).toEqual({
			uploaded: [],
			failed: [{ propertyId: 'prop-1', filename: 'a.pdf', cleanup: 'delete-failed' }]
		});
	});
});

describe('#275 — returned entries are reconciled with the local files, and every leftover on either side is LOUD', () => {
	it('FEWER entries than files: the surplus file never silently vanishes — it is reported cleanup: "not-created" with a null propertyId, and NO delete fires for it (nothing was ever created to delete)', async () => {
		const upA = uploadFor('a.pdf', 3, 'application/pdf', 1);
		const impl = makeFetchImpl({
			post: json(
				step1Response([
					{ id: 'prop-1', name: 'a.pdf', size: 3, type: 'application/pdf', upload: upA }
				])
			)
		});

		const result = await uploadEditionFiles(
			cfg,
			'edition-1',
			[makeFile('a.pdf', 3, 'application/pdf'), makeFile('b.mp3', 5, 'audio/mpeg')],
			impl
		);

		expect(result).toEqual({
			uploaded: [
				{ propertyId: 'prop-1', filename: 'a.pdf', filesize: 3, filetype: 'application/pdf' }
			],
			failed: [{ propertyId: null, filename: 'b.mp3', cleanup: 'not-created' }]
		});
		expect(callsOf(impl, 'PUT')).toHaveLength(1);
		expect(callsOf(impl, 'DELETE')).toHaveLength(0);
	});

	it('MORE entries than files: the unpairable entry is a phantom — NO PUT fires for it (an undefined body answered 2xx would promote a byte-less property into `uploaded`), it is DELETEd and reported', async () => {
		const upA = uploadFor('a.pdf', 3, 'application/pdf', 1);
		const upGhost = uploadFor('ghost.pdf', 9, 'application/pdf', 2);
		const impl = makeFetchImpl({
			post: json(
				step1Response([
					{ id: 'prop-1', name: 'a.pdf', size: 3, type: 'application/pdf', upload: upA },
					{ id: 'prop-ghost', name: 'ghost.pdf', size: 9, type: 'application/pdf', upload: upGhost }
				])
			)
		});

		const result = await uploadEditionFiles(
			cfg,
			'edition-1',
			[makeFile('a.pdf', 3, 'application/pdf')],
			impl
		);

		expect(result).toEqual({
			uploaded: [
				{ propertyId: 'prop-1', filename: 'a.pdf', filesize: 3, filetype: 'application/pdf' }
			],
			failed: [{ propertyId: 'prop-ghost', filename: 'ghost.pdf', cleanup: 'deleted' }]
		});
		const puts = callsOf(impl, 'PUT');
		expect(puts).toHaveLength(1);
		expect(String(puts[0][0])).toBe(upA.url);
		const dels = callsOf(impl, 'DELETE');
		expect(dels).toHaveLength(1);
		expect(String(dels[0][0])).toBe(`${API}sampledb/property/prop-ghost`);
	});

	it('OUT-OF-ORDER entries pair by filename + filesize, not by position — each file\'s bytes go to ITS OWN signed url', async () => {
		const a = makeFile('a.pdf', 3, 'application/pdf');
		const b = makeFile('b.mp3', 5, 'audio/mpeg');
		const upA = uploadFor('a.pdf', 3, 'application/pdf', 1);
		const upB = uploadFor('b.mp3', 5, 'audio/mpeg', 2);
		const impl = makeFetchImpl({
			post: json(
				step1Response([
					{ id: 'prop-2', name: 'b.mp3', size: 5, type: 'audio/mpeg', upload: upB },
					{ id: 'prop-1', name: 'a.pdf', size: 3, type: 'application/pdf', upload: upA }
				])
			)
		});

		const result = await uploadEditionFiles(cfg, 'edition-1', [a, b], impl);

		const byUrl = new Map(callsOf(impl, 'PUT').map((c) => [String(c[0]), c[1]]));
		expect(byUrl.get(upA.url)?.body, 'a.pdf bytes must ride a.pdf\'s signed url').toBe(a);
		expect(byUrl.get(upB.url)?.body, 'b.mp3 bytes must ride b.mp3\'s signed url').toBe(b);
		expect(result.failed).toEqual([]);
		expect(result.uploaded.map((u) => u.propertyId).sort()).toEqual(['prop-1', 'prop-2']);
	});

	it('AMBIGUOUS pair (two selected files sharing filename AND filesize): position breaks the tie — entry i takes the file at index i, each file is claimed exactly once, and both land', async () => {
		const first = makeFile('dup.pdf', 4, 'application/pdf');
		const second = makeFile('dup.pdf', 4, 'application/pdf');
		const up1 = uploadFor('dup.pdf', 4, 'application/pdf', 1);
		const up2 = uploadFor('dup.pdf', 4, 'application/pdf', 2);
		const impl = makeFetchImpl({
			post: json(
				step1Response([
					{ id: 'prop-1', name: 'dup.pdf', size: 4, type: 'application/pdf', upload: up1 },
					{ id: 'prop-2', name: 'dup.pdf', size: 4, type: 'application/pdf', upload: up2 }
				])
			)
		});

		const result = await uploadEditionFiles(cfg, 'edition-1', [first, second], impl);

		const byUrl = new Map(callsOf(impl, 'PUT').map((c) => [String(c[0]), c[1]]));
		expect(byUrl.get(up1.url)?.body).toBe(first);
		expect(byUrl.get(up2.url)?.body).toBe(second);
		expect(result).toEqual({
			uploaded: [
				{ propertyId: 'prop-1', filename: 'dup.pdf', filesize: 4, filetype: 'application/pdf' },
				{ propertyId: 'prop-2', filename: 'dup.pdf', filesize: 4, filetype: 'application/pdf' }
			],
			failed: []
		});
	});
});

describe('#275 — formatFileSize', () => {
	it('renders bytes plain and 1024-based units with one decimal from KB up', () => {
		expect(formatFileSize(0)).toBe('0 B');
		expect(formatFileSize(512)).toBe('512 B');
		expect(formatFileSize(1023)).toBe('1023 B');
		expect(formatFileSize(1024)).toBe('1.0 KB');
		expect(formatFileSize(1937)).toBe('1.9 KB');
		expect(formatFileSize(245678)).toBe('239.9 KB');
		expect(formatFileSize(5242880)).toBe('5.0 MB');
		expect(formatFileSize(1073741824)).toBe('1.0 GB');
	});
});

// (*MVOX:Tallis* — #275 RED)
// (*MVOX:Palestrina* — #275 fix: envelope fixtures re-grounded on the live
