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
	// #307: labels carry name AND colour. GitHub reports the colour as a hex
	// string WITHOUT the leading '#' ("The hexadecimal color code for the
	// label, without the leading #") — normalize stores it exactly as
	// reported; '#' is prepended at render time only.
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
			body: null
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
			body: null
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
			body: null
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
			closed_at: '2026-09-07T16:26:44Z'
		});
		expect(result.closedAt).toBe('2026-09-07T16:26:44Z');
	});

	it('normalizes a missing or null closed_at to closedAt: null', () => {
		expect(normalizeIssue({ number: 1, title: 't', state: 'open', labels: [], body: null }).closedAt).toBeNull();
		expect(
			normalizeIssue({ number: 1, title: 't', state: 'open', labels: [], body: null, closed_at: null }).closedAt
		).toBeNull();
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
