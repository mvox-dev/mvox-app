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
	/** Estonian one-liner for the public board. Required on Task and Epic;
	 *  a Bug or Feature arrives from the field without one. */
	slugline?: string;
	/** Estonian lead — what it changes and for whom. Same rule as slugline. */
	lead?: string;
	/** The in-body author marker, e.g. `(*PO:Gama*)`, or the GitHub login for
	 *  issues filed after per-person accounts (2026-09-18). */
	author: string;
}

/** A shaped piece of work: the done-when is the contract. */
export interface TaskIssue extends BaseIssue {
	kind: 'task';
	slugline: string;
	lead: string;
	/** Checkable statements; never empty — an empty contract is not a task. */
	doneWhen: string[];
	/** Parent epic by reference, never by type structure. */
	epic?: number;
	/** ER-identifiers, only when the task touches rights mechanics (#319). */
	rightsRules?: string[];
}

/** A field report: what was seen, where. Arrives raw — no slugline required. */
export interface BugIssue extends BaseIssue {
	kind: 'bug';
	whatWasSeen: string;
	where: string;
	whoIsAffected?: string;
}

/** Intake, unshaped by definition. One required field: the ask, verbatim. */
export interface FeatureIssue extends BaseIssue {
	kind: 'feature';
	request: string;
	whoIsItFor?: string;
}

/** A PO-owned initiative: the story, children by reference as gates are named. */
export interface EpicIssue extends BaseIssue {
	kind: 'epic';
	slugline: string;
	lead: string;
	story: string;
	children: number[];
}

export type MvoxIssue = TaskIssue | BugIssue | FeatureIssue | EpicIssue;

/** A parse refusal names every missing piece; it is data, not an exception. */
export interface ParseRefusal {
	ok: false;
	missing: string[];
}

export interface Parsed<T extends MvoxIssue> {
	ok: true;
	issue: T;
}

/** @deprecated shape kept one slice for the merged Task parser's callers. */
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
	/** GitHub login of the filing account, when the fetch carries it. */
	authorLogin?: string | null;
}

/** Logins that historically carried EVERY actor's writes — as an author they
 *  identify nobody, so the in-body marker stays the authorship for them. */
const SHARED_LOGINS = new Set(['mitselek']);

/** In-body marker wins; a personal GitHub account stands on its own. */
function resolveAuthor(raw: RawIssue): string | null {
	const marker = AUTHOR_MARKER_RE.exec(raw.body ?? '');
	if (marker) return marker[0];
	if (raw.authorLogin && !SHARED_LOGINS.has(raw.authorLogin)) return raw.authorLogin;
	return null;
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

	const author = resolveAuthor(raw);
	if (!author) missing.push('author (in-body marker, or a personal account)');

	if (missing.length > 0) return { ok: false, missing };

	// First line only: the last form section swallows any trailing free text
	// (there is no next heading to stop at), and a number followed by prose
	// must still read as the number — silently dropping it is the failure this
	// module exists to refuse (caught live on the board's first round-trip, #388).
	const epicLine = field(body, 'parent epic')?.split('\n')[0].trim().replace('#', '');
	const epic = epicLine && /^\d+$/.test(epicLine) ? Number(epicLine) : undefined;

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
			author: author as string,
			doneWhen,
			...(epic !== undefined ? { epic } : {}),
			...(rightsRules && rightsRules.length > 0 ? { rightsRules } : {})
		}
	};
}

function baseOf(raw: RawIssue, kind: MvoxIssue['kind'], author: string): Omit<BaseIssue, 'kind'> & { kind: typeof kind } {
	const body = raw.body ?? '';
	const slugline = field(body, 'slugline');
	const lead = field(body, 'lead');
	return {
		number: raw.number,
		title: raw.title,
		state: raw.state,
		kind,
		motion: raw.labels.filter((l): l is MotionLabel => (MOTION_LABELS as readonly string[]).includes(l)),
		author,
		...(slugline ? { slugline } : {}),
		...(lead ? { lead } : {})
	};
}

function requireKind(raw: RawIssue, expected: string, missing: string[]): void {
	const kind = raw.issueType?.toLowerCase() ?? null;
	if (kind !== expected) missing.push(`issue type is ${raw.issueType ?? 'absent'}, not ${expected[0].toUpperCase()}${expected.slice(1)}`);
}

export function parseBugIssue(raw: RawIssue): Parsed<BugIssue> | ParseRefusal {
	const missing: string[] = [];
	const body = raw.body ?? '';
	requireKind(raw, 'bug', missing);
	const whatWasSeen = field(body, 'what was seen');
	if (!whatWasSeen) missing.push('what was seen');
	const where = field(body, 'where');
	if (!where) missing.push('where');
	const author = resolveAuthor(raw);
	if (!author) missing.push('author (in-body marker, or a personal account)');
	if (missing.length > 0) return { ok: false, missing };
	const whoIsAffected = field(body, 'who is affected');
	return {
		ok: true,
		issue: {
			...baseOf(raw, 'bug', author as string),
			kind: 'bug',
			whatWasSeen: whatWasSeen as string,
			where: where as string,
			...(whoIsAffected ? { whoIsAffected } : {})
		}
	};
}

export function parseFeatureIssue(raw: RawIssue): Parsed<FeatureIssue> | ParseRefusal {
	const missing: string[] = [];
	const body = raw.body ?? '';
	requireKind(raw, 'feature', missing);
	const request = field(body, 'the request');
	if (!request) missing.push('the request');
	const author = resolveAuthor(raw);
	if (!author) missing.push('author (in-body marker, or a personal account)');
	if (missing.length > 0) return { ok: false, missing };
	const whoIsItFor = field(body, 'who is it for');
	return {
		ok: true,
		issue: {
			...baseOf(raw, 'feature', author as string),
			kind: 'feature',
			request: request as string,
			...(whoIsItFor ? { whoIsItFor } : {})
		}
	};
}

/** `- #372` / `372` lines under Children — numbers by reference. */
function childNumbers(text: string): number[] {
	return text
		.split('\n')
		.map((line) => /#?(\d+)/.exec(line.trim())?.[1])
		.filter((n): n is string => n !== undefined)
		.map(Number);
}

export function parseEpicIssue(raw: RawIssue): Parsed<EpicIssue> | ParseRefusal {
	const missing: string[] = [];
	const body = raw.body ?? '';
	requireKind(raw, 'epic', missing);
	const slugline = field(body, 'slugline');
	if (!slugline) missing.push('slugline');
	const lead = field(body, 'lead');
	if (!lead) missing.push('lead');
	const story = field(body, 'the story');
	if (!story) missing.push('the story');
	const author = resolveAuthor(raw);
	if (!author) missing.push('author (in-body marker, or a personal account)');
	if (missing.length > 0) return { ok: false, missing };
	const childrenText = field(body, 'children');
	return {
		ok: true,
		issue: {
			...baseOf(raw, 'epic', author as string),
			kind: 'epic',
			slugline: slugline as string,
			lead: lead as string,
			story: story as string,
			children: childrenText ? childNumbers(childrenText) : []
		}
	};
}

/**
 * Dispatch on the native issue type. An absent or unknown type is a refusal —
 * the board has no kindless issues; the compiler has no fifth kind.
 */
export function parseIssue(raw: RawIssue): Parsed<MvoxIssue> | ParseRefusal {
	switch (raw.issueType?.toLowerCase() ?? '') {
		case 'task': {
			const r = parseTaskIssue(raw);
			return r.ok ? { ok: true, issue: r.task } : r;
		}
		case 'bug':
			return parseBugIssue(raw);
		case 'feature':
			return parseFeatureIssue(raw);
		case 'epic':
			return parseEpicIssue(raw);
		default:
			return { ok: false, missing: [`issue type is ${raw.issueType ?? 'absent'} — not one of Task, Bug, Feature, Epic`] };
	}
}

// (*PO:Gama*)
