import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { load } from './+page';

async function landingFor(path: string, parent: () => Promise<unknown> = async () => ({})) {
	const event = { url: new URL(`http://localhost${path}`), parent } as unknown as Parameters<
		typeof load
	>[0];
	try {
		await load(event);
	} catch (e) {
		if (isRedirect(e)) return e.location;
		throw e;
	}
	return null;
}

describe('#1063 — `/` opens the agenda at /agenda', () => {
	it('sends a bare `/` to /agenda', async () => {
		expect(await landingFor('/')).toBe('/agenda');
	});

	it('keeps the query, so ?collective=<db> still selects the collective', async () => {
		expect(await landingFor('/?collective=mvox_crede')).toBe('/agenda?collective=mvox_crede');
	});

	it('lets the sign-in guard answer first', async () => {
		const parent = vi.fn(async () => {
			throw new Error('guard redirect');
		});
		await expect(landingFor('/', parent)).rejects.toThrow('guard redirect');
	});
});
