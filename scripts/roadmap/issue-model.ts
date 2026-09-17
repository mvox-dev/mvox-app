// #384 — the board's own issue model. Derived from what the board does, not
// from anyone else's framework: flat `kind` discriminator, base + per-kind
// required fields, containment as references, motion orthogonal to kind.
//
// This module is the ENFORCEMENT half of the task template
// (.github/ISSUE_TEMPLATE/task.yml). Web-form filings arrive as `### Heading`
// sections; the board's existing issues carry `---` YAML frontmatter with
// slugline/lead. `parseTaskIssue` reads both shapes and refuses — with named
// reasons, never a throw — anything missing a required field. A refusal is a
// value the caller renders (the board can list unparseable issues); silence
// is what let unshaped issues onto the board.
import { parse as parseYaml } from 'yaml';

export type IssueKind = 'task' | 'bug' | 'feature' | 'epic';

export type MotionLabel =
	| 'ready'
	| 'blocked'
	| 'in process'
	| 'in research'
	| 'prepped'
	| 'needs-po';

export const MOTION_LABELS: readonly MotionLabel[] = [
	'ready',
	'blocked',
	'in process',
	'in research',
	'prepped',
	'needs-po'
];

/** What every issue on this board has, whatever its kind. */
export interface BaseIssue {
	number: number;
	title: string;
	state: 'open' | 'closed';
	kind: IssueKind;
	motion: MotionLabel[];
	/** Estonian one-liner for the public board. */
	slugline: string;
	/** Estonian lead — what it changes and for whom. */
	lead: string;
	/** The in-body author marker, e.g. `(*PO:Gama*)`, or the GitHub login for
	 *  issues filed after per-person accounts (2026-09-18). */
	author: string;
}

/** A shaped piece of work: the done-when is the contract. */
export interface TaskIssue extends BaseIssue {
	kind: 'task';
	/** Checkable statements; never empty — an empty contract is not a task. */
	doneWhen: string[];
	/** Parent epic by reference, never by type structure. */
	epic?: number;
	/** ER-identifiers, only when the task touches rights mechanics (#319). */
	rightsRules?: string[];
}

/** A parse refusal names every missing piece; it is data, not an exception. */
export interface ParseRefusal {
	ok: false;
	missing: string[];
}

export interface ParsedTask {
	ok: true;
	task: TaskIssue;
}

/** The raw shape the GitHub fetch hands us — the only place it appears. */
export interface RawIssue {
	number: number;
	title: string;
	state: 'open' | 'closed';
	body: string | null;
	labels: string[];
	issueType: string | null;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const AUTHOR_MARKER_RE = /\(\*(?:PO|MVOX):[A-Za-zÀ-ž]+\*\)/;

/** `### Heading` (or deeper `##`) sections as the issue-form output emits them. */
function formSections(body: string): Map<string, string> {
	const sections = new Map<string, string>();
	const re = /^##+ (.+)$/gm;
	const heads: { name: string; contentStart: number; headStart: number }[] = [];
	for (let m = re.exec(body); m !== null; m = re.exec(body)) {
		heads.push({ name: m[1].trim().toLowerCase(), contentStart: re.lastIndex, headStart: m.index });
	}
	heads.forEach((h, i) => {
		const end = i + 1 < heads.length ? heads[i + 1].headStart : body.length;
		sections.set(h.name, body.slice(h.contentStart, end).trim());
	});
	return sections;
}

function frontmatterField(body: string, key: string): string | null {
	const match = FRONTMATTER_RE.exec(body);
	if (!match) return null;
	try {
		const parsed: unknown = parseYaml(match[1]);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			const value = (parsed as Record<string, unknown>)[key];
			if (typeof value === 'string' && value.length > 0) return value;
		}
	} catch {
		// Malformed YAML is absent frontmatter, never a crash (render.ts precedent).
	}
	return null;
}

/** Both shapes: form `### Slugline` section, or frontmatter `slugline:`. */
function field(body: string, name: string): string | null {
	// The author marker ends the body, not the last section — strip it from
	// section content so it never reads as a field value.
	const fromForm = formSections(body).get(name)?.replace(AUTHOR_MARKER_RE, '').trim();
	if (fromForm !== undefined && fromForm !== '' && fromForm !== '_No response_') return fromForm;
	return frontmatterField(body, name);
}

function checklistItems(text: string): string[] {
	return text
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => /^- \[[ x]\]|^- /.test(line))
		.map((line) => line.replace(/^- \[[ x]\]\s*/, '').replace(/^- /, ''))
		.filter((line) => line.length > 0);
}

/**
 * Parse one raw issue into a TaskIssue, or refuse with every missing field
 * named. Strictness is the point: a task without a done-when, slugline, lead
 * or author is refused, not defaulted — defaults are how unshaped issues got
 * onto the board.
 */
export function parseTaskIssue(raw: RawIssue): ParsedTask | ParseRefusal {
	const missing: string[] = [];
	const body = raw.body ?? '';

	const kind = raw.issueType?.toLowerCase() ?? null;
	if (kind !== 'task') missing.push(`issue type is ${raw.issueType ?? 'absent'}, not Task`);

	const slugline = field(body, 'slugline');
	if (!slugline) missing.push('slugline');
	const lead = field(body, 'lead');
	if (!lead) missing.push('lead');

	const doneWhenText = field(body, 'done when');
	const doneWhen = doneWhenText ? checklistItems(doneWhenText) : [];
	if (doneWhen.length === 0) missing.push('done when (at least one checkable statement)');

	const authorMatch = AUTHOR_MARKER_RE.exec(body);
	if (!authorMatch) missing.push('author marker');

	if (missing.length > 0) return { ok: false, missing };

	const epicText = field(body, 'parent epic');
	const epic = epicText && /^\d+$/.test(epicText.replace('#', '')) ? Number(epicText.replace('#', '')) : undefined;

	const rightsText = field(body, 'rights rules relied on');
	const rightsRules = rightsText
		? rightsText
				.split(/[,\n]/)
				.map((s) => s.trim())
				.filter((s) => s.length > 0)
		: undefined;

	return {
		ok: true,
		task: {
			number: raw.number,
			title: raw.title,
			state: raw.state,
			kind: 'task',
			motion: raw.labels.filter((l): l is MotionLabel => (MOTION_LABELS as readonly string[]).includes(l)),
			slugline: slugline as string,
			lead: lead as string,
			author: authorMatch![0],
			doneWhen,
			...(epic !== undefined ? { epic } : {}),
			...(rightsRules && rightsRules.length > 0 ? { rightsRules } : {})
		}
	};
}

// (*PO:Gama*)
