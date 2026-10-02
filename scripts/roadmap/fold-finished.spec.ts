// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderBoard, type RoadmapIssue } from './render';

const GENERATED_AT = '2026-10-02T12:00:00Z';

function issue(number: number, state: 'open' | 'closed', subIssues: RoadmapIssue[] = []): RoadmapIssue {
	return {
		number,
		title: `Issue ${number}`,
		state,
		stateReason: state === 'closed' ? 'completed' : null,
		labels: [],
		body: null,
		closedAt: state === 'closed' ? '2026-10-01T00:00:00Z' : null,
		htmlUrl: `https://example.test/issues/${number}`,
		subIssues,
		issueType: subIssues.length > 0 ? 'Epic' : 'Task'
	};
}

function epicArticle(issues: RoadmapIssue[], number: number): Element {
	const doc = new DOMParser().parseFromString(renderBoard(issues, GENERATED_AT), 'text/html');
	const article = doc.querySelector(`article[data-issue="${number}"]`);
	if (!article) throw new Error(`no article for #${number}`);
	return article;
}

describe('#690 — an epic whose sub-issues are all done renders folded', () => {
	it('folds the list behind a closed <details> that names the count', () => {
		const epic = issue(1, 'open', [issue(2, 'closed'), issue(3, 'closed')]);
		const details = epicArticle([epic, ...epic.subIssues!], 1).querySelector(':scope > details');
		expect(details).not.toBeNull();
		expect(details!.hasAttribute('open')).toBe(false);
		expect(details!.querySelector('summary')!.textContent).toBe('2 tehtud alamülesannet');
		expect(details!.querySelectorAll('article[data-issue]').length).toBe(2);
	});

	it('uses the singular for one sub-issue', () => {
		const epic = issue(1, 'closed', [issue(2, 'closed')]);
		const summary = epicArticle([epic, ...epic.subIssues!], 1).querySelector(':scope > details > summary');
		expect(summary!.textContent).toBe('1 tehtud alamülesanne');
	});

	it('leaves the list open when any direct sub-issue is open', () => {
		const epic = issue(1, 'open', [issue(2, 'closed'), issue(3, 'open')]);
		const article = epicArticle([epic, ...epic.subIssues!], 1);
		expect(article.querySelector(':scope > details')).toBeNull();
		expect(article.querySelector(':scope > ul.sub-issues')).not.toBeNull();
	});

	it('leaves the list open when an open issue sits deeper down', () => {
		const grandchild = issue(4, 'open');
		const child = issue(2, 'closed', [grandchild]);
		const epic = issue(1, 'open', [child, issue(3, 'closed')]);
		const article = epicArticle([epic, child, grandchild, ...epic.subIssues!.slice(1)], 1);
		expect(article.querySelector(':scope > details')).toBeNull();
	});

	it('an issue with no sub-issues gets no fold', () => {
		expect(epicArticle([issue(5, 'open')], 5).querySelector('details')).toBeNull();
	});
});

// (*PO:Gama*)
