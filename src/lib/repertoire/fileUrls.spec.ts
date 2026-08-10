import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { signFileUrl } from './fileUrls';

// #90 TR.2 — the PDF download seam. entu-www src/api/files/index.md: the url
// returned by `GET /property/{_id}` is "valid for 60 seconds. Do not cache or
// share it; generate a fresh one each time." So this is a per-CLICK call, and
// the tests pin exactly that: one property read, the url returned raw, and a
// loud failure rather than an empty href.

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

describe('signFileUrl', () => {
	it('reads property/{fileId} and returns the signed url', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ url: 'https://s3.example/signed-1' }));
		const url = await signFileUrl(cfg, 'file-1', fetchImpl);
		expect(url).toBe('https://s3.example/signed-1');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(String(fetchImpl.mock.calls[0][0])).toContain('property/file-1');
	});

	it('fails loud on non-2xx — the caller must never open a tab on nothing', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		await expect(signFileUrl(cfg, 'file-1', fetchImpl)).rejects.toThrow(/500/);
	});

	it('fails loud when the response carries no url', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}));
		await expect(signFileUrl(cfg, 'file-1', fetchImpl)).rejects.toThrow(/no url/);
	});
});

// (*MVOX:Josquin*)
