// Turning raw feedback entities into reports, then filtering and counting them.
import { beforeAll, describe, expect, it } from 'vitest';
import type { RawEntity } from './src/entu';
import { countBy, matches, toReport, type Report } from './src/report';

const str = (s: string) => [{ _id: 'p'.repeat(24), string: s }];

function raw(over: Partial<Record<string, unknown>> & { _id?: string } = {}): RawEntity {
	return {
		_id: 'f00000000000000000000001',
		name: str('/event 2026-10-01'),
		description: str('The button does nothing'),
		_created: [{ datetime: '2026-10-01T10:00:00.000Z' }],
		_parent: [{ reference: 'm00000000000000000000001', string: 'Test Singer' }],
		...over
	};
}

const autoMeta = (detail: string, commit = 'abc1234', action = 'save') =>
	str(
		JSON.stringify({
			route: '/agenda',
			version: { branch: 'main', commit },
			problems: [{ area: 'agenda', action, time: 't', detail }]
		})
	);

const auto = (over: Partial<Record<string, unknown>> = {}) =>
	raw({
		description: str('Automatic problem report: 1 problem — save failed (TypeError).'),
		metadata: autoMeta('TypeError: x is undefined'),
		...over
	});

describe('toReport', () => {
	it('automatic kind from description prefix', () => {
		expect(toReport('mvox_a', auto()).kind).toBe('automatic');
		expect(toReport('mvox_a', raw()).kind).toBe('singer');
		expect(toReport('mvox_a', raw({ description: undefined })).kind).toBe('singer');
	});

	it('maps every field from the wire', () => {
		const r = toReport(
			'mvox_a',
			auto({
				issue_url: [{ string: 'https://github.com/o/r/issues/1' }],
				screenshot: [{ _id: 'abcdefabcdefabcdefabcdef' }],
				doodle_layer: str('{"strokes":[]}')
			})
		);
		expect(r).toEqual({
			db: 'mvox_a',
			id: 'f00000000000000000000001',
			created: '2026-10-01T10:00:00.000Z',
			name: '/event 2026-10-01',
			page: '/agenda',
			kind: 'automatic',
			firstError: 'TypeError',
			action: 'save',
			appVersion: 'abc1234',
			description: 'Automatic problem report: 1 problem — save failed (TypeError).',
			metadata: {
				route: '/agenda',
				version: { branch: 'main', commit: 'abc1234' },
				problems: [{ area: 'agenda', action: 'save', time: 't', detail: 'TypeError: x is undefined' }]
			},
			issueUrls: ['https://github.com/o/r/issues/1'],
			senderId: 'm00000000000000000000001',
			senderName: 'Test Singer',
			screenshotFileId: 'abcdefabcdefabcdefabcdef',
			doodleLayer: '{"strokes":[]}'
		} satisfies Report);
	});

	it('malformed metadata lists with nulls', () => {
		const r = toReport('mvox_a', raw({ metadata: str('{oops') }));
		expect(r.metadata).toBeNull();
		expect(r.appVersion).toBeNull();
		expect(r.firstError).toBeNull();
		expect(r.action).toBeNull();
		expect(r.page).toBe('/event');
	});

	it('a bare entity lists with nulls and empty lists', () => {
		const r = toReport('mvox_a', { _id: 'f00000000000000000000009' });
		expect(r).toMatchObject({
			created: '',
			name: null,
			page: null,
			description: '',
			metadata: null,
			issueUrls: [],
			senderId: null,
			senderName: null,
			screenshotFileId: null,
			doodleLayer: null
		});
	});

	it('firstError falls back to the description', () => {
		const r = toReport('mvox_a', auto({ metadata: undefined }));
		expect(r.firstError).toBe('TypeError');
	});
});

describe('matches', () => {
	let a: Report, b: Report, c: Report, d: Report;
	beforeAll(() => {
		a = toReport('mvox_a', auto({ _created: [{ datetime: '2026-10-05T00:00:00Z' }] }));
		b = toReport('mvox_b', raw({ _created: [{ datetime: '2026-10-05T00:00:00Z' }] }));
		c = toReport(
			'mvox_a',
			auto({
				_created: [{ datetime: '2026-09-01T00:00:00Z' }],
				issue_url: [{ string: 'https://github.com/o/r/issues/2' }]
			})
		);
		d = toReport(
			'mvox_a',
			auto({
				_created: [{ datetime: '2026-10-06T00:00:00Z' }],
				issue_url: [{ string: 'https://github.com/o/r/issues/3' }]
			})
		);
	});

	it('filters combine', () => {
		const f = { since: '2026-10-01', kind: 'automatic', untriaged: true } as const;
		expect([a, b, c, d].filter((r) => matches(r, f))).toEqual([a]);
		expect([a, b, c, d].filter((r) => matches(r, { untriaged: false }))).toEqual([c, d]);
		expect([a, b, c, d].filter((r) => matches(r, {}))).toEqual([a, b, c, d]);
	});

	it('db, until, page, appVersion and errorName each narrow', () => {
		expect(matches(b, { db: 'mvox_a' })).toBe(false);
		expect(matches(a, { until: '2026-10-05T00:00:00Z' })).toBe(false);
		expect(matches(c, { until: '2026-10-05' })).toBe(true);
		expect(matches(a, { page: 'AGEN' })).toBe(true);
		expect(matches(b, { page: 'agenda' })).toBe(false);
		expect(matches(a, { appVersion: 'abc' })).toBe(true);
		expect(matches(a, { appVersion: 'fff' })).toBe(false);
		expect(matches(a, { errorName: 'typeerr' })).toBe(true);
		expect(matches(a, { errorName: 'RangeError' })).toBe(false);
	});

	it('errorName matches any problem, not only the first', () => {
		const meta = JSON.stringify({
			problems: [
				{ action: 'load', detail: 'TypeError: a' },
				{ action: 'save', detail: 'RangeError: b' }
			]
		});
		const r = toReport('mvox_a', raw({ metadata: str(meta) }));
		expect(matches(r, { errorName: 'rangeerror' })).toBe(true);
	});

	it('a bad date is an error, not a silent pass', () => {
		expect(() => matches(a, { since: 'yesterday' })).toThrow(/bad date/);
	});
});

describe('countBy', () => {
	it('countBy groups and sorts', () => {
		const rs = [
			toReport('mvox_a', auto({ metadata: autoMeta('RangeError: r') })),
			toReport('mvox_a', auto()),
			toReport('mvox_a', auto()),
			toReport('mvox_a', raw())
		];
		expect(countBy(rs, 'firstError')).toEqual([
			{ value: 'TypeError', count: 2 },
			{ value: '(none)', count: 1 },
			{ value: 'RangeError', count: 1 }
		]);
		expect(countBy(rs, 'appVersion')).toEqual([
			{ value: 'abc1234', count: 3 },
			{ value: '(none)', count: 1 }
		]);
		expect(countBy(rs, 'action')).toEqual([
			{ value: 'save', count: 3 },
			{ value: '(none)', count: 1 }
		]);
	});
});
