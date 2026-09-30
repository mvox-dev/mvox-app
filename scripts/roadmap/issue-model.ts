import { parse as parseYaml } from 'yaml';

export type IssueKind = 'task' | 'bug' | 'feature' | 'epic';

export type MotionLabel =
	| 'ready'
	| 'blocked'
	| 'in process'
	| 'in research'
	| 'researched'
	| 'prepped'
	| 'needs-po';

export const MOTION_LABELS: readonly MotionLabel[] = [
	'ready',
	'blocked',
	'in process',
	'in research',
	'researched',
	'prepped',
	'needs-po'
];

export interface BaseIssue {
	number: number;
	title: string;
	state: 'open' | 'closed';
	kind: IssueKind;
	motion: MotionLabel[];

	slugline?: string;

	lead?: string;

	author: string;
}

export interface TaskIssue extends BaseIssue {
	kind: 'task';
	slugline: string;
	lead: string;

	doneWhen: string[];

	epic?: number;

	rightsRules?: string[];
}

export interface BugIssue extends BaseIssue {
	kind: 'bug';
	whatWasSeen: string;
	where: string;
	whoIsAffected?: string;
}

export interface FeatureIssue extends BaseIssue {
	kind: 'feature';
	request: string;
	whoIsItFor?: string;
}

export interface EpicIssue extends BaseIssue {
	kind: 'epic';
	slugline: string;
	lead: string;
	story: string;
	children: number[];
}

export type MvoxIssue = TaskIssue | BugIssue | FeatureIssue | EpicIssue;

export interface ParseRefusal {
	ok: false;
	missing: string[];
}

export interface Parsed<T extends MvoxIssue> {
	ok: true;
	issue: T;
}

export interface ParsedTask {
	ok: true;
	task: TaskIssue;
}

export function kindFromType(issueType: string | null | undefined): IssueKind | null {
	const t = issueType?.toLowerCase();
	return t === 'task' || t === 'bug' || t === 'feature' || t === 'epic' ? t : null;
}

export const KIND_LABELS: readonly (readonly [string, IssueKind])[] = [
	['task', 'task'],
	['bug', 'bug'],
	['epic', 'epic'],
	['enhancement', 'feature']
];

export function isKindLabel(name: string): boolean {
	return KIND_LABELS.some(([label]) => label === name);
}

export function kindFromLabels(labelNames: readonly string[]): IssueKind | null {
	for (const [label, kind] of KIND_LABELS) {
		if (labelNames.includes(label)) return kind;
	}
	return null;
}

export function kindOf(
	issueType: string | null | undefined,
	labelNames: readonly string[]
): IssueKind | null {
	return kindFromType(issueType) ?? kindFromLabels(labelNames);
}

export interface RawIssue {
	number: number;
	title: string;
	state: 'open' | 'closed';
	body: string | null;
	labels: string[];
	issueType: string | null;

	authorLogin?: string | null;
}

const SHARED_LOGINS = new Set(['mitselek']);

function resolveAuthor(raw: RawIssue): string | null {
	const marker = AUTHOR_MARKER_RE.exec(raw.body ?? '');
	if (marker) return marker[0];
	if (raw.authorLogin && !SHARED_LOGINS.has(raw.authorLogin)) return raw.authorLogin;
	return null;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const AUTHOR_MARKER_RE = /\(\*(?:PO|MVOX):[A-Za-zÀ-ž]+\*\)/;

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

	}
	return null;
}

export function field(body: string, name: string): string | null {

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

export function isReleased(raw: RawIssue): boolean {
	return raw.labels.some((l) => (MOTION_LABELS as readonly string[]).includes(l));
}

function pushMissing(missing: string[], item: string): void {
	if (!missing.includes(item)) missing.push(item);
}

function requireBoardFaceWhenReleased(raw: RawIssue, missing: string[]): void {
	if (!isReleased(raw)) return;
	const body = raw.body ?? '';
	if (!field(body, 'slugline')) pushMissing(missing, 'slugline (released issues carry one, any kind)');
	if (!field(body, 'lead')) pushMissing(missing, 'lead (released issues carry one, any kind)');
}

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
	requireBoardFaceWhenReleased(raw, missing);
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
	requireBoardFaceWhenReleased(raw, missing);
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
