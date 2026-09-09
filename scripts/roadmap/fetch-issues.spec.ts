/**
 * #305 — roadmap fetch-step unit tests.
 *
 * Only the pure, no-network pieces of fetch-issues.ts are unit-tested here
 * (Link-header pagination parsing, GitHub-issue → RoadmapIssue normalization).
 * The networked functions (fetchAllIssues/fetchSubIssues/fetchBoard/main) are
 * plumbing around those two and are reviewed, not unit-tested — vitest's
 * global fetch guard (src/lib/testing/networkGuard.setup.ts) means any spec
 * that tried to exercise them for real would fail loudly on the first call.
 *
 * (*MVOX:Palestrina*)
 */
import { describe, expect, it } from 'vitest';
import { normalizeIssue, parseNextLink } from './fetch-issues';

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
	it('maps GitHub REST label objects to plain label-name strings', () => {
		const result = normalizeIssue({
			number: 305,
			title: 'Roadmap board',
			state: 'open',
			state_reason: null,
			labels: [{ name: 'task' }, { name: 'ready' }],
			body: null
		});
		expect(result.labels).toEqual(['task', 'ready']);
	});

	it('accepts bare-string labels too', () => {
		const result = normalizeIssue({
			number: 305,
			title: 'Roadmap board',
			state: 'open',
			state_reason: null,
			labels: ['task', 'ready'],
			body: null
		});
		expect(result.labels).toEqual(['task', 'ready']);
	});

	it('normalizes state to the open|closed union regardless of API casing', () => {
		expect(normalizeIssue({ number: 1, title: 't', state: 'closed', labels: [], body: null }).state).toBe(
			'closed'
		);
		expect(normalizeIssue({ number: 1, title: 't', state: 'open', labels: [], body: null }).state).toBe('open');
	});

	it('passes through a recognized state_reason', () => {
		expect(
			normalizeIssue({ number: 1, title: 't', state: 'closed', state_reason: 'not_planned', labels: [], body: null })
				.stateReason
		).toBe('not_planned');
	});

	it('normalizes an unrecognized or missing state_reason to null', () => {
		expect(normalizeIssue({ number: 1, title: 't', state: 'open', labels: [], body: null }).stateReason).toBeNull();
		expect(
			normalizeIssue({ number: 1, title: 't', state: 'open', state_reason: 'reopened', labels: [], body: null })
				.stateReason
		).toBeNull();
	});

	it('starts subIssues empty — the fetch step attaches them separately, only for epics', () => {
		expect(normalizeIssue({ number: 1, title: 't', state: 'open', labels: [], body: null }).subIssues).toEqual([]);
	});
});
