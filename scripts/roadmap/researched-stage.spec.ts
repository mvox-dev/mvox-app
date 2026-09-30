import { describe, expect, it } from 'vitest';
import { isMotionLabel, renderBoard, type RoadmapIssue, type RoadmapLabel } from './render';
import { isReleased, type RawIssue } from './issue-model';

const GENERATED_AT = '2026-09-30T12:00:00Z';
const STALE_TEXT = 'Valmis tööd seisavad ja keegi ei uuri';

const label = (name: string): RoadmapLabel => ({ name, color: 'c5def5' });
const TASK = label('task');
const READY = label('ready');

function issue(number: number, labels: RoadmapLabel[]): RoadmapIssue {
	return {
		number,
		title: `Issue ${number}`,
		state: 'open',
		stateReason: null,
		labels,
		body: null,
		closedAt: null,
		htmlUrl: `https://example.test/issues/${number}`,
		subIssues: []
	};
}

function order(html: string, numbers: number[]): number[] {
	return [...numbers].sort(
		(a, b) => html.indexOf(`data-issue="${a}"`) - html.indexOf(`data-issue="${b}"`)
	);
}

describe('the researched stage', () => {
	it('sorts between prepped and in research', () => {
		const board = [
			issue(1, [TASK]),
			issue(2, [TASK, label('in research')]),
			issue(3, [TASK, label('researched')]),
			issue(4, [TASK, label('prepped')]),
			issue(5, [TASK, label('in process')])
		];
		expect(order(renderBoard(board, GENERATED_AT), [1, 2, 3, 4, 5])).toEqual([5, 4, 3, 2, 1]);
	});

	it('is a queue label, so it is dropped from closed issues', () => {
		expect(isMotionLabel('researched')).toBe(true);
	});

	it('keeps a ready task from counting as stale', () => {
		const stale = renderBoard([issue(301, [TASK, READY])], GENERATED_AT);
		const researched = renderBoard([issue(301, [TASK, READY, label('researched')])], GENERATED_AT);
		expect(stale).toContain(STALE_TEXT);
		expect(researched).not.toContain(STALE_TEXT);
	});

	it('marks an issue as released', () => {
		expect(isReleased({ labels: ['researched'] } as RawIssue)).toBe(true);
	});
});
