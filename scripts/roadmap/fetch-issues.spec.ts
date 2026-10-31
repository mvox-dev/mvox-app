// #305 — the fetch step's no-network pieces: pagination, normalization, forge timeline events,
// and the motion-label strip over a stub. (*MVOX:Palestrina*, forge: *PO:Gama*)
import { describe, expect, it } from 'vitest';
import { normalizeIssue, parseNextLink, publicBody, stripMotionLabels, toLabelEvents } from './fetch-issues';

describe('parseNextLink', () => {
	it('returns null for a null header (last page)', () => {
		expect(parseNextLink(null)).toBeNull();
	});

	it('returns null when the header has no rel="next" entry', () => {
		const header = '<https://api.github.com/repos/o/r/issues?page=1>; rel="prev"';
		expect(parseNextLink(header)).toBeNull();
	});

	it('extracts the next-page URL from a multi-relation Link header', () => {
		const header =
			'<https://api.github.com/repos/o/r/issues?page=1>; rel="prev", ' +
			'<https://api.github.com/repos/o/r/issues?page=3>; rel="next", ' +
			'<https://api.github.com/repos/o/r/issues?page=5>; rel="last"';
		expect(parseNextLink(header)).toBe('https://api.github.com/repos/o/r/issues?page=3');
	});
});

describe('normalizeIssue', () => {
	// #307: labels carry name AND colour. The API reports the colour without a leading '#';
	// normalize stores it as reported, and '#' is added at render time only.
	it('maps GitHub REST label objects to name+colour pairs, hex kept without a leading #', () => {
		const result = normalizeIssue({
			number: 305,
			title: 'Roadmap board',
			state: 'open',
			state_reason: null,
			labels: [
				{ name: 'task', color: '1d76db' },
				{ name: 'ready', color: '0e8a16' }
			],
			body: null,
			html_url: 'https://github.com/mvox-dev/mvox-app/issues/305'
		});
		expect(result.labels).toEqual([
			{ name: 'task', color: '1d76db' },
			{ name: 'ready', color: '0e8a16' }
		]);
	});

	it('accepts bare-string labels too — no colour available, so color is null', () => {
		const result = normalizeIssue({
			number: 305,
			title: 'Roadmap board',
			state: 'open',
			state_reason: null,
			labels: ['task', 'ready'],
			body: null,
			html_url: 'https://github.com/mvox-dev/mvox-app/issues/305'
		});
		expect(result.labels).toEqual([
			{ name: 'task', color: null },
			{ name: 'ready', color: null }
		]);
	});

	it('normalizes a label object arriving without a colour to color: null, never a throw', () => {
		const result = normalizeIssue({
			number: 306,
			title: 'Colourless label',
			state: 'open',
			state_reason: null,
			labels: [{ name: 'völlig-unbekannt' }],
			body: null,
			html_url: 'https://github.com/mvox-dev/mvox-app/issues/306'
		});
		expect(result.labels).toEqual([{ name: 'völlig-unbekannt', color: null }]);
	});

	// #307: done-by-date ordering needs closed_at carried onto RoadmapIssue.
	// Live-probed 2026-09-07 on issue #282: a reopened-then-closed issue's
	// closed_at is the LATEST close — no special case needed beyond null.
	it('carries closed_at through as closedAt', () => {
		const result = normalizeIssue({
			number: 282,
			title: 'Reopened then closed again',
			state: 'closed',
			state_reason: 'completed',
			labels: [],
			body: null,
			closed_at: '2026-09-07T16:26:44Z',
			html_url: 'https://github.com/mvox-dev/mvox-app/issues/282'
		});
		expect(result.closedAt).toBe('2026-09-07T16:26:44Z');
	});

	it('normalizes a missing or null closed_at to closedAt: null', () => {
		expect(
			normalizeIssue({
				number: 1,
				title: 't',
				state: 'open',
				labels: [],
				body: null,
				html_url: 'https://github.com/mvox-dev/mvox-app/issues/1'
			}).closedAt
		).toBeNull();
		expect(
			normalizeIssue({
				number: 1,
				title: 't',
				state: 'open',
				labels: [],
				body: null,
				closed_at: null,
				html_url: 'https://github.com/mvox-dev/mvox-app/issues/1'
			}).closedAt
		).toBeNull();
	});

	it('normalizes state to the open|closed union regardless of API casing', () => {
		expect(
			normalizeIssue({
				number: 1,
				title: 't',
				state: 'closed',
				labels: [],
				body: null,
				html_url: 'https://github.com/mvox-dev/mvox-app/issues/1'
			}).state
		).toBe('closed');
		expect(
			normalizeIssue({
				number: 1,
				title: 't',
				state: 'open',
				labels: [],
				body: null,
				html_url: 'https://github.com/mvox-dev/mvox-app/issues/1'
			}).state
		).toBe('open');
	});

	it('passes through a recognized state_reason', () => {
		expect(
			normalizeIssue({
				number: 1,
				title: 't',
				state: 'closed',
				state_reason: 'not_planned',
				labels: [],
				body: null,
				html_url: 'https://github.com/mvox-dev/mvox-app/issues/1'
			}).stateReason
		).toBe('not_planned');
	});

	it('normalizes an unrecognized or missing state_reason to null', () => {
		expect(
			normalizeIssue({
				number: 1,
				title: 't',
				state: 'open',
				labels: [],
				body: null,
				html_url: 'https://github.com/mvox-dev/mvox-app/issues/1'
			}).stateReason
		).toBeNull();
		expect(
			normalizeIssue({
				number: 1,
				title: 't',
				state: 'open',
				state_reason: 'reopened',
				labels: [],
				body: null,
				html_url: 'https://github.com/mvox-dev/mvox-app/issues/1'
			}).stateReason
		).toBeNull();
	});

	it('starts subIssues empty — the fetch step attaches them separately, only for epics', () => {
		expect(
			normalizeIssue({
				number: 1,
				title: 't',
				state: 'open',
				labels: [],
				body: null,
				html_url: 'https://github.com/mvox-dev/mvox-app/issues/1'
			}).subIssues
		).toEqual([]);
	});

	// #309: card links need the issue's own URL from the API — carried, never
	// built. Full-shape toEqual on purpose: a partial assertion here could go
	// green while the field silently failed to ride along.
	it('carries html_url through as htmlUrl, verbatim — full normalized shape pinned (#309)', () => {
		const rawPayload = {
			number: 309,
			title: 'Roadmap cards link out',
			state: 'open',
			state_reason: null,
			labels: [{ name: 'task', color: '1d76db' }],
			body: null,
			closed_at: null,
			html_url: 'https://github.com/mvox-dev/mvox-app/issues/309'
		};
		expect(normalizeIssue(rawPayload)).toEqual({
			number: 309,
			title: 'Roadmap cards link out',
			state: 'open',
			stateReason: null,
			labels: [{ name: 'task', color: '1d76db' }],
			body: null,
			closedAt: null,
			subIssues: [],
			htmlUrl: 'https://github.com/mvox-dev/mvox-app/issues/309',
			// #373: the type's name rides along, null for the pre-type archive.
			issueType: null,
			// #403: the card's corner time; null when the payload omits it.
			updatedAt: null
		});
	});

	// #403: the corner is only as true as this carry — the renderer reads this
	// one field and has no other source to fall back on.
	it('carries updated_at through as updatedAt, verbatim (#403)', () => {
		expect(
			normalizeIssue({
				number: 403,
				title: 'A roadmap card shows when the issue was last updated',
				state: 'open',
				state_reason: null,
				labels: [],
				body: null,
				closed_at: null,
				updated_at: '2026-09-18T11:53:00Z',
				html_url: 'https://github.com/mvox-dev/mvox-app/issues/403'
			}).updatedAt
		).toBe('2026-09-18T11:53:00Z');
	});
});

describe('toLabelEvents', () => {
	it('reads label add/remove, close and reopen off the forge timeline, and skips the rest', () => {
		expect(
			toLabelEvents([
				{ type: 'comment', body: 'hi', created_at: 'T0' },
				{ type: 'label', body: '1', label: { name: 'ready' }, created_at: 'T1' },
				{ type: 'label', body: '', label: { name: 'ready' }, created_at: 'T2' },
				{ type: 'close', body: '', created_at: 'T3' },
				{ type: 'reopen', body: '', created_at: 'T4' }
			])
		).toEqual([
			{ kind: 'labeled', label: 'ready', at: 'T1' },
			{ kind: 'unlabeled', label: 'ready', at: 'T2' },
			{ kind: 'closed', at: 'T3' },
			{ kind: 'reopened', at: 'T4' }
		]);
	});
});

describe('stripMotionLabels', () => {
	it('deletes only motion labels, by id, and only from the closed issues it lists', async () => {
		const calls: string[] = [];
		const closed = [
			{
				number: 7,
				title: 't',
				state: 'closed',
				labels: [
					{ id: 1, name: 'task' },
					{ id: 2, name: 'in process' },
					{ id: 3, name: 'ready' }
				],
				body: null,
				html_url: 'x'
			}
		];
		const stub = (async (input: RequestInfo | URL, init?: RequestInit) => {
			calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
			return new Response(init?.method === 'DELETE' ? null : JSON.stringify(closed), { status: init?.method === 'DELETE' ? 204 : 200 });
		}) as unknown as typeof fetch;
		expect(await stripMotionLabels('mvox/mvox-app', 't', stub, 'http://forge/api/v1')).toBe(2);
		expect(calls).toEqual([
			'GET http://forge/api/v1/repos/mvox/mvox-app/issues?state=closed&type=issues&limit=50',
			'DELETE http://forge/api/v1/repos/mvox/mvox-app/issues/7/labels/2',
			'DELETE http://forge/api/v1/repos/mvox/mvox-app/issues/7/labels/3'
		]);
	});
});

describe('publicBody', () => {
	it('keeps only the slugline and lead of a form body; the rest stays on the forge', () => {
		const body = '### Slugline\n\nLühike\n\n### Lead\n\nÜks lause.\n\n### What\n\nmari@example.test\n\n(*PO:Gama*)';
		expect(publicBody(body)).toBe('### Slugline\n\nLühike\n\n### Lead\n\nÜks lause.');
	});

	it('reads frontmatter too, and gives null when neither field is there', () => {
		expect(publicBody('---\nslugline: "Vana"\n---\n\nsecret')).toBe('### Slugline\n\nVana');
		expect(publicBody('plain secret body')).toBeNull();
		expect(publicBody(null)).toBeNull();
	});
});
