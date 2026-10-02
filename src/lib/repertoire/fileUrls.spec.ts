// PDF download: one property read per click, the signed url returned as is.
import { describe, expect, it, vi } from 'vitest';
import { signFileUrl } from './fileUrls';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('testdb');

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
