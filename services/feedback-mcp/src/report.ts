import type { RawEntity } from './entu.ts';

export type Report = {
	db: string;
	id: string;
	created: string;
	name: string | null;
	page: string | null;
	kind: 'automatic' | 'singer';
	firstError: string | null;
	action: string | null;
	appVersion: string | null;
	description: string;
	metadata: unknown | null;
	issueUrls: string[];
	senderId: string | null;
	senderName: string | null;
	screenshotFileId: string | null;
	doodleLayer: string | null;
};

export type Filter = {
	db?: string;
	since?: string;
	until?: string;
	page?: string;
	appVersion?: string;
	errorName?: string;
	kind?: 'automatic' | 'singer';
	untriaged?: boolean;
};

type Value = { _id?: string; string?: string; reference?: string; datetime?: string };
type Problem = { action?: unknown; detail?: unknown };

const AUTOMATIC = 'Automatic problem report';
const ERROR_NAME = /^(\w+):/;
const DESCRIBED_ERROR = /\((\w+)\)/;

const values = (e: RawEntity, prop: string): Value[] =>
	Array.isArray(e[prop]) ? (e[prop] as Value[]) : [];

const text = (x: unknown): string | null => (typeof x === 'string' ? x : null);

const isRecord = (x: unknown): x is Record<string, unknown> =>
	typeof x === 'object' && x !== null && !Array.isArray(x);

// Pre-#611 rows carry no metadata or broken JSON; they still list, with nulls.
function parseMetadata(raw: string | undefined): Record<string, unknown> | null {
	if (raw === undefined) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

const problemsOf = (metadata: unknown): Problem[] =>
	isRecord(metadata) && Array.isArray(metadata.problems)
		? metadata.problems.filter(isRecord)
		: [];

export function toReport(db: string, e: RawEntity): Report {
	const name = values(e, 'name')[0]?.string ?? null;
	const description = values(e, 'description')[0]?.string ?? '';
	const metadata = parseMetadata(values(e, 'metadata')[0]?.string);
	const firstProblem = problemsOf(metadata)[0];
	const version = isRecord(metadata?.version) ? metadata.version : null;
	const parent = values(e, '_parent')[0];
	return {
		db,
		id: e._id,
		created: values(e, '_created')[0]?.datetime ?? '',
		name,
		page: text(metadata?.route) ?? (name === null ? null : name.split(' ')[0]),
		kind: description.startsWith(AUTOMATIC) ? 'automatic' : 'singer',
		firstError:
			text(firstProblem?.detail)?.match(ERROR_NAME)?.[1] ??
			description.match(DESCRIBED_ERROR)?.[1] ??
			null,
		action: text(firstProblem?.action),
		appVersion: text(version?.commit),
		description,
		metadata,
		issueUrls: values(e, 'issue_url').flatMap((v) => (v.string ? [v.string] : [])),
		senderId: parent?.reference ?? null,
		senderName: parent?.string ?? null,
		screenshotFileId: values(e, 'screenshot')[0]?._id ?? null,
		doodleLayer: values(e, 'doodle_layer')[0]?.string ?? null
	};
}

function time(iso: string): number {
	const t = Date.parse(iso);
	if (Number.isNaN(t)) throw new Error(`bad date: ${JSON.stringify(iso)}`);
	return t;
}

const contains = (hay: string | null, needle: string) =>
	hay !== null && hay.toLowerCase().includes(needle.toLowerCase());

// `since` is inclusive and `until` exclusive, so a day's reports sit under one of them.
export function matches(r: Report, f: Filter): boolean {
	if (f.db !== undefined && r.db !== f.db) return false;
	if (f.since !== undefined && !(Date.parse(r.created) >= time(f.since))) return false;
	if (f.until !== undefined && !(Date.parse(r.created) < time(f.until))) return false;
	if (f.page !== undefined && !contains(r.page, f.page)) return false;
	if (f.appVersion !== undefined) {
		if (!r.appVersion?.toLowerCase().startsWith(f.appVersion.toLowerCase())) return false;
	}
	if (f.errorName !== undefined) {
		const details = [r.firstError, ...problemsOf(r.metadata).map((p) => text(p.detail))];
		if (!details.some((d) => contains(d, f.errorName as string))) return false;
	}
	if (f.kind !== undefined && r.kind !== f.kind) return false;
	if (f.untriaged !== undefined && (r.issueUrls.length === 0) !== f.untriaged) return false;
	return true;
}

export function countBy(
	rs: Report[],
	key: 'firstError' | 'action' | 'appVersion'
): { value: string; count: number }[] {
	const counts = new Map<string, number>();
	for (const r of rs) {
		const value = r[key] ?? '(none)';
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return [...counts]
		.map(([value, count]) => ({ value, count }))
		.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
