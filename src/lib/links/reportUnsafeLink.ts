// #1066 — a stored link that may not be shown as a link is kept as one problem report.
import { reportProblem } from '$lib/problems/reportProblem';
import { linkScheme } from './safeLinkUrl';

// Module-level: a page left and revisited in the same load files nothing new.
const reported = new Set<string>();

export function resetReportedLinks(): void {
	reported.clear();
}

export function reportUnsafeLink(area: string, row: { id: string; url: string }): void {
	if (reported.has(row.id)) return;
	reported.add(row.id);
	reportProblem({
		area,
		action: 'showing a link',
		reason: `link ${row.id} uses scheme ${linkScheme(row.url)}`
	});
}

// (*MVOX:Josquin*)
