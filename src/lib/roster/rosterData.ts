// The roster's member read and the shared member-name producer with its real-names overlay.
import { entuFetch, type EntuFetchOptions } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { readRosterNamesSetting } from '$lib/collective/rosterNames';
import { deriveListRead, isTruncated, type ListRead } from '$lib/entu/listRead';
import { listProfilesForPerson, toRosterRow, type RosterRow } from './rosterRow';
import { reportProblem } from '$lib/problems/reportProblem';

export { listProfilesForPerson, toRosterRow, type RosterRow } from './rosterRow';

export interface ActiveMember {
	memberId: string;
	personId: string;
	// Sections come only from `_parent` entries of type section (PO ruling 2026-08-11).
	sectionIds: string[];
	dbEntityId?: string;
	createdAt?: string;
	ownerIds?: string[];
}

// Shared reader: hard-wires no cache flag; `opts` threads into the one fetch.
export async function listActiveMembers(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<ListRead<ActiveMember>> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=member&status.string=active&props=person,_parent,_created,_owner&limit=500',
		cfg.token,
		{},
		fetchImpl,
		opts
	);
	if (!res.ok) throw new Error(`listActiveMembers failed: ${res.status}`);
	const body = (await res.json()) as {
		count?: number;
		entities?: Array<{
			_id: string;
			person?: Array<{ reference: string }>;
			_parent?: Array<{ reference: string; entity_type?: string }>;
			_created?: Array<{ datetime?: string }>;
			_owner?: Array<{ reference: string }>;
		}>;
	};
	const raws = body.entities ?? [];
	const items = raws.flatMap((raw) => {
		const personId = raw.person?.[0]?.reference;
		// A deleted person soft-deletes every reference to it: skip the row, never fabricate one.
		if (!personId) {
			console.warn(`listActiveMembers: skipping member ${raw._id} — no readable person reference`);
			return [];
		}
		// Distinct: a repeated id makes the keyed section pickers throw each_key_duplicate.
		const sectionIds = [
			...new Set(
				(raw._parent ?? []).filter((p) => p.entity_type === 'section').map((p) => p.reference)
			)
		];
		const dbEntityId = (raw._parent ?? []).find((p) => p.entity_type === 'database')?.reference;
		// A JSON null would reach the date formatter as new Date(null), a fabricated 1970 date.
		const rawCreatedAt = raw._created?.[0]?.datetime;
		const createdAt = typeof rawCreatedAt === 'string' ? rawCreatedAt : undefined;
		// The baked `.string` is a person name (PII) and never leaves this extraction.
		const ownerIds = (raw._owner ?? []).map((o) => o.reference);
		return [
			{
				memberId: raw._id,
				personId,
				sectionIds,
				dbEntityId,
				createdAt,
				ownerIds
			}
		];
	});
	// Raw length: a dropped row must never fabricate a truncation.
	return deriveListRead(items, raws.length, body.count);
}

// A person with more than one record is dropped from the map: the overlay refuses to guess.
async function listRecordNamesByPerson(
	cfg: EntuCfg,
	fetchImpl: typeof fetch,
	opts: EntuFetchOptions = {}
): Promise<{ byPerson: Map<string, string>; truncated: boolean }> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=admin_member_record&props=person,name&limit=500',
		cfg.token,
		{},
		fetchImpl,
		opts
	);
	if (!res.ok) throw new Error(`listRecordNamesByPerson failed: ${res.status}`);
	const body = (await res.json()) as {
		count?: number;
		entities?: Array<{
			_id: string;
			person?: Array<{ reference: string }>;
			name?: Array<{ string: string }>;
		}>;
	};
	const raws = body.entities ?? [];
	const byPerson = new Map<string, string>();
	const duplicated = new Set<string>();
	for (const raw of raws) {
		const personId = raw.person?.[0]?.reference;
		if (!personId) continue;
		if (duplicated.has(personId)) continue;
		if (byPerson.has(personId)) {
			duplicated.add(personId);
			byPerson.delete(personId);
			continue;
		}
		byPerson.set(personId, raw.name?.[0]?.string ?? '');
	}
	return { byPerson, truncated: isTruncated(raws.length, body.count) };
}

// The one app-wide member-name producer: every caller obeys roster_show_real_names (#469).
export async function loadRoster(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<ListRead<RosterRow>> {
	const base = await loadRosterRead(cfg, fetchImpl);
	return applyRealNames(cfg, base, fetchImpl);
}

export async function loadRosterRead(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<ListRead<RosterRow>> {
	const members = await listActiveMembers(cfg, fetchImpl);
	const rows = await Promise.all(
		members.items.map(async (member) => {
			const profiles = await listProfilesForPerson(cfg, member.personId, fetchImpl);
			return toRosterRow(member, profiles);
		})
	);
	return {
		items: rows
			.filter((r): r is RosterRow => r !== null)
			.map((row) => ({ ...row, profileName: row.name }))
			.sort((a, b) => a.name.localeCompare(b.name)),
		total: members.total,
		truncated: members.truncated
	};
}

// Any failure degrades to "toggle off" with a report, never a rejection,
// so the overlay can only show fewer real names, never leak one.
export async function resolveRealNameByPerson(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<{ byPerson: Map<string, string>; truncated: boolean }> {
	try {
		const { showRealNames } = await readRosterNamesSetting(cfg, fetchImpl, opts);
		if (!showRealNames) return { byPerson: new Map(), truncated: false };
		const records = await listRecordNamesByPerson(cfg, fetchImpl, opts);
		return { byPerson: records.byPerson, truncated: records.truncated };
	} catch (e) {
		reportProblem({ area: 'roster', action: 'loading the real-names overlay', error: e });
		return { byPerson: new Map(), truncated: false };
	}
}

export async function applyRealNames(
	cfg: EntuCfg,
	read: ListRead<RosterRow>,
	fetchImpl: typeof fetch = fetch
): Promise<ListRead<RosterRow>> {
	const base = read;
	if (base.items.length === 0) return base;

	const { byPerson: recordNameByPerson, truncated: recordsTruncated } =
		await resolveRealNameByPerson(cfg, fetchImpl);
	const truncated = base.truncated || recordsTruncated;
	if (recordNameByPerson.size === 0) return { ...base, truncated };

	return {
		items: base.items
			.map((row) => {
				const recordName = recordNameByPerson.get(row.personId)?.trim();
				return {
					...row,
					name: recordName ? recordName : row.name
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name)),
		total: base.total,
		truncated
	};
}
