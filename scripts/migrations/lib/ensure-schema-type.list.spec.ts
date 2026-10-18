// A multi-value PropertySpec makes ensurePropDef create the prop-def with Entu's `list` flag.
import { describe, expect, it } from 'vitest';
import { json, testCfg } from '$lib/testing/entuFetchKit';
import { ensurePropDef, type LedgerStep } from './ensure-schema-type';
import type { PropertySpec } from './mvox-schema-extensions';

const base: PropertySpec = {
	name: 'issue_url',
	type: 'string',
	sharing: 'domain',
	descriptionEn: 'en',
	descriptionEt: 'et'
};

async function createdBody(prop: PropertySpec): Promise<Array<Record<string, unknown>>> {
	let posted: Array<Record<string, unknown>> = [];
	const fetchImpl = (async (_url: string, init?: RequestInit) => {
		if (init?.method === 'POST') {
			posted = JSON.parse(String(init.body));
			return json({ _id: 'new-id' });
		}
		return json({ entities: [] });
	}) as unknown as typeof fetch;
	await ensurePropDef(testCfg('db'), 'meta', 'parent', 'feedback', 'domain', prop, false, [] as LedgerStep[], fetchImpl);
	return posted;
}

describe('ensurePropDef — multi-value', () => {
	it('a list spec is created with the list flag', async () => {
		expect(await createdBody({ ...base, list: true })).toContainEqual({ type: 'list', boolean: true });
	});

	it('a plain spec is created without it', async () => {
		expect((await createdBody(base)).some((p) => p.type === 'list')).toBe(false);
	});
});

// (*MVOX:Perotin*)
