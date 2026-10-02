// Member lifecycle: deactivate and reinstate flip only `status`; plus the archived-roster reads.
import { entuFetch } from '$lib/entu/request';
import { replaceEntityProperty } from '$lib/entu/replaceProperty';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { listAdmins, listLibrarians } from '$lib/admin/roleManagement';
import {
	applyRealNames,
	listProfilesForPerson,
	loadRosterRead,
	toRosterRow,
	type RosterRow
} from './rosterData';
import { deriveListRead, type ListRead } from '$lib/entu/listRead';

/** v4E member.status; user-facing copy says "not active", never "archived". */
export type MemberLifecycleStatus = 'active' | 'archived';

export async function deactivateMember(
	cfg: EntuCfg,
	memberId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await flipMemberStatus(cfg, memberId, 'archived', fetchImpl);
}

export async function reinstateMember(
	cfg: EntuCfg,
	memberId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await flipMemberStatus(cfg, memberId, 'active', fetchImpl);
}

async function flipMemberStatus(
	cfg: EntuCfg,
	memberId: string,
	newStatus: MemberLifecycleStatus,
	fetchImpl: typeof fetch
): Promise<void> {
	await replaceEntityProperty(
		cfg,
		memberId,
		{ type: 'status', string: newStatus },
		fetchImpl,
		'memberLifecycle: status'
	);
}

export interface InactiveMember {
	memberId: string;
	personId: string;
	sectionIds: string[];
	dbEntityId?: string;
	createdAt?: string;
}

export async function listInactiveMembers(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<ListRead<InactiveMember>> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=member&status.string=archived&props=person,_parent,_created&limit=500',
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listInactiveMembers failed: ${res.status}`);
	const body = (await res.json()) as {
		count?: number;
		entities?: Array<{
			_id: string;
			person?: Array<{ reference: string }>;
			_parent?: Array<{ reference: string; entity_type?: string }>;
			_created?: Array<{ datetime?: string }>;
		}>;
	};
	const raws = body.entities ?? [];
	const items = raws.flatMap((raw) => {
		const personId = raw.person?.[0]?.reference;
		if (!personId) {
			console.warn(
				`listInactiveMembers: skipping member ${raw._id} — no readable person reference`
			);
			return [];
		}
		const sectionIds = (raw._parent ?? [])
			.filter((p) => p.entity_type === 'section')
			.map((p) => p.reference);
		const dbEntityId = (raw._parent ?? []).find((p) => p.entity_type === 'database')?.reference;
		const rawCreatedAt = raw._created?.[0]?.datetime;
		const createdAt = typeof rawCreatedAt === 'string' ? rawCreatedAt : undefined;
		return [{ memberId: raw._id, personId, sectionIds, dbEntityId, createdAt }];
	});
	return deriveListRead(items, raws.length, body.count);
}

async function loadInactiveRosterRead(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<ListRead<RosterRow>> {
	const members = await listInactiveMembers(cfg, fetchImpl);
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

// The archived list alone: a surface naming both lists uses loadActiveAndArchivedRosters.
export async function loadInactiveRoster(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<ListRead<RosterRow>> {
	const base = await loadInactiveRosterRead(cfg, fetchImpl);
	return applyRealNames(cfg, base, fetchImpl);
}

// For surfaces naming memberIds the active roster lacks, such as a past event's tally.
export async function loadRosterIncludingArchived(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<ListRead<RosterRow>> {
	const { active, inactive } = await loadActiveAndArchivedRosters(cfg, fetchImpl);
	return {
		items: [...active.items, ...inactive.items].sort((a, b) => a.name.localeCompare(b.name)),
		total: active.total + inactive.total,
		truncated: active.truncated || inactive.truncated
	};
}

export interface ActiveAndArchivedRosters {
	active: ListRead<RosterRow>;
	inactive: ListRead<RosterRow>;
}

// One real-names overlay over both halves; active wins a memberId collision.
// truncated stays per half, OR'd with the records read's own flag.
export async function loadActiveAndArchivedRosters(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<ActiveAndArchivedRosters> {
	const [active, inactive] = await Promise.all([
		loadRosterRead(cfg, fetchImpl),
		loadInactiveRosterRead(cfg, fetchImpl)
	]);
	const activeIds = new Set(active.items.map((r) => r.memberId));
	const archivedOnly = inactive.items.filter((r) => !activeIds.has(r.memberId));
	const overlaid = await applyRealNames(
		cfg,
		{
			items: [...active.items, ...archivedOnly],
			total: active.total + inactive.total,
			truncated: false // so overlaid.truncated is the records read's flag alone
		},
		fetchImpl
	);
	const byName = (a: RosterRow, b: RosterRow) => a.name.localeCompare(b.name);
	return {
		active: {
			items: overlaid.items.filter((r) => activeIds.has(r.memberId)).sort(byName),
			total: active.total,
			truncated: active.truncated || overlaid.truncated
		},
		inactive: {
			items: overlaid.items.filter((r) => !activeIds.has(r.memberId)).sort(byName),
			total: inactive.total,
			truncated: inactive.truncated || overlaid.truncated
		}
	};
}

export interface DeactivateBlocker {
	role: 'admin' | 'librarian';
}

export async function listDeactivateBlockers(
	cfg: EntuCfg,
	personId: string,
	dbEntityId: string,
	libraryId: string | null,
	fetchImpl: typeof fetch = fetch
): Promise<DeactivateBlocker[]> {
	// An empty id turns the rights read into the entity list route, which answers "no blockers".
	if (!dbEntityId) {
		throw new Error('listDeactivateBlockers: no database entity id — the rights read cannot be scoped');
	}

	// No try/catch: a failed rights read must reject, never resolve to no blockers.
	const blockers: DeactivateBlocker[] = [];

	const admins = await listAdmins(cfg, dbEntityId, personId, fetchImpl);
	if (admins.persons.some((p) => p.id === personId)) blockers.push({ role: 'admin' });

	if (libraryId) {
		const librarians = await listLibrarians(cfg, libraryId, personId, fetchImpl);
		if (librarians.persons.some((p) => p.id === personId)) blockers.push({ role: 'librarian' });
	}

	return blockers;
}

// (*MVOX:Josquin*)
// (*MVOX:Palestrina* — #469: archived producers overlay via applyRealNames)
