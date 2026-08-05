import { describe, expect, it, vi } from 'vitest';
import { entuUrl, entuFetch } from './request';

describe('entuUrl (db threaded as path segment)', () => {
	it('composes host + db + path, no double slash', () => {
		expect(entuUrl('polyphony', 'entity?_type.string=member&limit=1')).toBe(
			'https://api.entu.app/polyphony/entity?_type.string=member&limit=1'
		);
	});

	it('tolerates a leading slash on the path', () => {
		expect(entuUrl('polyphony', '/entity/abc123')).toBe(
			'https://api.entu.app/polyphony/entity/abc123'
		);
	});

	it('threads a DIFFERENT db into the same path (no hardcoded db)', () => {
		expect(entuUrl('esmuuseum', 'entity')).toBe('https://api.entu.app/esmuuseum/entity');
		expect(entuUrl('ww', 'entity')).toBe('https://api.entu.app/ww/entity');
	});

	it('refuses an empty db — there is no default db', () => {
		expect(() => entuUrl('', 'entity')).toThrow(/db .*required/);
	});
});

describe('entuFetch', () => {
	it('calls the composed URL with the Bearer token', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
		await entuFetch('polyphony', 'entity?limit=1', 'jwt-abc', {}, fetchImpl);

		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe('https://api.entu.app/polyphony/entity?limit=1');
		expect(init.headers.Authorization).toBe('Bearer jwt-abc');
	});
});
