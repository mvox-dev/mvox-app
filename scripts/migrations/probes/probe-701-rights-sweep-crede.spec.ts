// #701: the rights sweep reads only, and reports ids, types and counts, never a property value.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { RIGHTS_WRITES_REGISTER } from '$lib/testing/rightsWrites';
import { stripComments } from '$lib/testing/commentRules';
import { firstMutationIndex } from '../lib/mutation-markers';
import {
	classifySweep,
	extractEntity,
	extractTypeDef,
	formatReport,
	runRightsSweep,
	COMMITTED_ALLOW,
	REGISTER_TARGET_TYPES,
	type RawEntity,
	type SweepReport
} from './probe-701-rights-sweep-crede';

const cfg: EntuCfg = { db: 'mvox_crede', token: 'jwt' };
const PLANTED = 'Jaan Tamm';

const ref = (reference: string, inherited = false) => ({ reference, inherited, string: PLANTED });
const flag = (value: boolean) => [{ boolean: value }];
const sharing = (value: string) => [{ string: value }];

function sweep(types: Record<string, string | undefined>, raws: Array<[string, RawEntity]>): SweepReport {
	const typeDefs = Object.entries(types).map(([name, level]) =>
		extractTypeDef({ _id: `t-${name}`, name: [{ string: name }], ...(level ? { _sharing: sharing(level) } : {}) })
	);
	return classifySweep(
		typeDefs,
		raws.map(([type, raw]) => extractEntity(type, raw))
	);
}

describe('#701 rights sweep: read-only', () => {
	it('the script has no mutating call (the fence ignores comments)', () => {
		const source = readFileSync(join(import.meta.dirname, 'probe-701-rights-sweep-crede.ts'), 'utf-8');
		expect(firstMutationIndex(stripComments(source))).toBe(-1);
	});

	it('the sweep sends GETs only, paging each type until its count is read', async () => {
		const requests: Array<{ path: string; method: string }> = [];
		const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const url = new URL(String(input));
			const path = url.pathname.replace(/^.*\/mvox_crede\//, '') + url.search;
			requests.push({ path, method: init?.method ?? 'GET' });
			const type = url.searchParams.get('_type.string');
			const skip = Number(url.searchParams.get('skip'));
			let body: unknown;
			if (type === 'entity') {
				body = { count: 1, entities: [{ _id: 't-event', name: [{ string: 'event' }], _sharing: sharing('domain') }] };
			} else {
				const all = [{ _id: 'e1' }, { _id: 'e2' }, { _id: 'e3' }];
				body = { count: 3, entities: all.slice(skip, skip + 2) };
			}
			return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
		});

		const report = await runRightsSweep(cfg, fetchImpl as typeof fetch, 2);

		const props = '_inheritrights,_sharing,_owner,_editor,_viewer,_expander';
		expect(requests).toEqual([
			{ path: 'entity?_type.string=entity&props=name,_sharing&limit=2&skip=0', method: 'GET' },
			{ path: `entity?_type.string=event&props=${props}&limit=2&skip=0`, method: 'GET' },
			{ path: `entity?_type.string=event&props=${props}&limit=2&skip=2`, method: 'GET' }
		]);
		expect(report.countsByType).toEqual([{ type: 'event', count: 3 }]);
	});

	it('a page that ends short of the count fails loud', async () => {
		const fetchImpl = vi.fn((input: RequestInfo | URL): Promise<Response> => {
			const isTypes = String(input).includes('_type.string=entity');
			const body = isTypes
				? { count: 1, entities: [{ _id: 't-event', name: [{ string: 'event' }] }] }
				: { count: 5, entities: [] };
			return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
		});
		await expect(runRightsSweep(cfg, fetchImpl as typeof fetch, 2)).rejects.toThrow(/event/);
	});
});

describe('#701 rights sweep: findings', () => {
	it('flags an inheriting type without the flag, and a profile holding it', () => {
		const report = sweep({ event: 'domain', profile: undefined, section: 'domain' }, [
			['event', { _id: 'ev-ok', _inheritrights: flag(true) }],
			['event', { _id: 'ev-none' }],
			['event', { _id: 'ev-false', _inheritrights: flag(false) }],
			['profile', { _id: 'pr-true', _inheritrights: flag(true) }],
			['profile', { _id: 'pr-ok', _inheritrights: flag(false) }],
			['section', { _id: 'se-none' }]
		]);
		expect(report.inheritanceOutliers).toEqual([
			{ id: 'ev-false', type: 'event', expected: true, actual: false },
			{ id: 'ev-none', type: 'event', expected: true, actual: null },
			{ id: 'pr-true', type: 'profile', expected: false, actual: true }
		]);
	});

	it("flags an entity whose _sharing is wider than its type's", () => {
		const report = sweep({ event: 'domain', link: undefined }, [
			['event', { _id: 'ev-public', _sharing: sharing('public') }],
			['event', { _id: 'ev-domain', _sharing: sharing('domain') }],
			['event', { _id: 'ev-absent' }],
			['link', { _id: 'li-domain', _sharing: sharing('domain') }],
			['link', { _id: 'li-private', _sharing: sharing('private') }]
		]);
		expect(report.sharingOutliers).toEqual([
			{ id: 'ev-public', type: 'event', sharing: 'public', typeSharing: 'domain' },
			{ id: 'li-domain', type: 'link', sharing: 'domain', typeSharing: 'unset' }
		]);
	});

	it('flags a direct grant no register row explains, counting each reference at its highest direct tier', () => {
		const report = sweep({ event: 'domain', library: 'domain', person: 'domain' }, [
			[
				'event',
				{
					_id: 'ev-1',
					_owner: [ref('p-creator')],
					_editor: [ref('p-creator'), ref('p-editor'), ref('p-inherited', true)],
					_viewer: [ref('p-creator'), ref('p-editor'), ref('p-inherited', true), ref('p-viewer')],
					_expander: [ref('p-creator'), ref('p-editor'), ref('p-viewer'), ref('p-expander')]
				}
			],
			['library', { _id: 'lib-1', _editor: [ref('p-librarian')], _viewer: [ref('p-librarian')] }],
			['person', { _id: 'pe-1', _editor: [ref('pe-1')], _expander: [ref('p-stray')] }]
		]);
		expect(report.unexplainedGrants).toEqual([
			{ id: 'ev-1', type: 'event', tier: '_editor', reference: 'p-editor' },
			{ id: 'ev-1', type: 'event', tier: '_expander', reference: 'p-expander' },
			{ id: 'ev-1', type: 'event', tier: '_viewer', reference: 'p-viewer' },
			{ id: 'pe-1', type: 'person', tier: '_expander', reference: 'p-stray' }
		]);
	});

	it("states each library's _inheritrights (#695)", () => {
		const report = sweep({ library: 'domain' }, [
			['library', { _id: 'lib-true', _inheritrights: flag(true) }],
			['library', { _id: 'lib-none' }]
		]);
		expect(report.library).toEqual([
			{ id: 'lib-none', inheritrights: null },
			{ id: 'lib-true', inheritrights: true }
		]);
	});

	it('every register row granting a tier names the types it grants on', () => {
		const tierRows = RIGHTS_WRITES_REGISTER.filter((row) =>
			['_owner', '_editor', '_viewer', '_expander'].includes(row.write)
		);
		expect(tierRows.length).toBeGreaterThan(0);
		for (const row of tierRows) {
			expect(REGISTER_TARGET_TYPES[row.fn], `${row.fn} ${row.write}`).toBeDefined();
		}
		expect(Object.keys(REGISTER_TARGET_TYPES).sort()).toEqual([...new Set(tierRows.map((row) => row.fn))].sort());
	});
});

describe('#701 rights sweep: output carries ids, types and counts only', () => {
	it('a planted name reaches neither the printed report nor the ledger fields', () => {
		const report = sweep({ event: 'private', profile: 'public', library: 'domain' }, [
			[
				'event',
				{
					_id: 'ev-1',
					name: [{ string: PLANTED }],
					_sharing: sharing('public'),
					_editor: [ref('p-1')]
				}
			],
			['profile', { _id: 'pr-1', email: [{ string: 'jaan@example.org' }], _inheritrights: flag(true) }],
			['library', { _id: 'lib-1', name: [{ string: PLANTED }] }]
		]);

		const printed = formatReport(report).join('\n');
		expect(printed).not.toContain(PLANTED);
		expect(printed).not.toContain('jaan@');
		expect(JSON.stringify(report)).not.toContain(PLANTED);
		expect(JSON.stringify(report)).not.toContain('jaan@');

		expect(Object.keys(report).sort()).toEqual(
			['countsByType', 'inheritanceOutliers', 'library', 'sharingOutliers', 'unexplainedGrants'].sort()
		);
		const findingKeys = new Set(
			[
				...report.countsByType,
				...report.inheritanceOutliers,
				...report.sharingOutliers,
				...report.unexplainedGrants,
				...report.library
			].flatMap(
				(finding) => Object.keys(finding)
			)
		);
		expect([...findingKeys].sort()).toEqual(
			['actual', 'count', 'expected', 'id', 'inheritrights', 'reference', 'sharing', 'tier', 'type', 'typeSharing'].sort()
		);
		for (const key of [...findingKeys, ...Object.keys(report)]) {
			expect(COMMITTED_ALLOW).toContain(key);
		}
	});
});

// (*MVOX:Josquin*)
