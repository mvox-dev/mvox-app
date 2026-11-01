// The landing page's reads: a slim set beside the agenda's, so `/` pays only for what it shows.
import type { EntuCfg } from '$lib/entu/cfg';
import { loadFullAgenda } from '$lib/agenda/agendaData';
import { findMyMemberId, listMyRsvps } from '$lib/rsvp/rsvpData';
import { resolveManageRights } from '$lib/repertoire/repertoireActions';
import { listRepertoireItems } from '$lib/repertoire/repertoireData';
import { listWorks, listAllEditions, type Edition } from '$lib/library/libraryReads';
import { listAllRsvpsForEvent } from '$lib/attendance/attendanceData';
import { listActiveMembers } from '$lib/roster/rosterData';
import { listLinks } from '$lib/links/linkData';
import { listMyProfiles, resolveField } from '$lib/profile/profileData';

export { loadFullAgenda, findMyMemberId, listMyRsvps, listLinks };

export interface LearningSheet {
	fileId: string;
	filename: string;
	edition: string;
}

export interface LearningWork {
	workId: string;
	name: string;
	composer: string;
	sheets: LearningSheet[];
}

export interface EventTally {
	going: number;
	notResponded: number;
}

export async function readRsvpRights(cfg: EntuCfg, personId: string): Promise<boolean> {
	return (await resolveManageRights(cfg, personId, personId)) === 'editor';
}

function sheetOf(edition: Edition | undefined): LearningSheet | null {
	if (!edition || edition.files.length === 0) return null;
	const pdf = edition.files.find(
		(f) => f.filetype.toLowerCase().includes('pdf') || f.filename.toLowerCase().endsWith('.pdf')
	);
	const file = pdf ?? edition.files[0];
	return { fileId: file.id, filename: file.filename, edition: edition.name };
}

// One row per work in the season's repertoire marked learning, with a sheet per learning edition.
export async function readLearningWorks(
	cfg: EntuCfg,
	seasonId: string,
	fetchImpl: typeof fetch = fetch
): Promise<LearningWork[]> {
	const items = (await listRepertoireItems(cfg, seasonId, fetchImpl)).filter(
		(i) => i.status === 'learning'
	);
	if (items.length === 0) return [];
	const [works, editions] = await Promise.all([
		listWorks(cfg, fetchImpl),
		listAllEditions(cfg, fetchImpl)
	]);
	const worksById = new Map(works.items.map((w) => [w.id, w]));
	const editionsById = new Map(editions.items.map((e) => [e.id, e]));
	const rows = new Map<string, LearningWork>();
	for (const item of items) {
		const work = worksById.get(item.workId);
		const row = rows.get(item.workId) ?? {
			workId: item.workId,
			name: work?.name || item.name,
			composer: work?.composer ?? '',
			sheets: []
		};
		rows.set(item.workId, row);
		const sheet = sheetOf(editionsById.get(item.editionId));
		if (sheet && !row.sheets.some((s) => s.fileId === sheet.fileId)) row.sheets.push(sheet);
	}
	return [...rows.values()];
}

// Counts only active members, as the event page's tally does.
export async function readEventTally(
	cfg: EntuCfg,
	eventId: string,
	fetchImpl: typeof fetch = fetch
): Promise<EventTally> {
	const [rows, members] = await Promise.all([
		listAllRsvpsForEvent(cfg, eventId, fetchImpl),
		listActiveMembers(cfg, fetchImpl)
	]);
	const active = new Set(members.items.map((m) => m.memberId));
	const answered = new Set(rows.filter((r) => active.has(r.memberId)).map((r) => r.memberId));
	return {
		going: rows.filter((r) => r.status === 'going' && active.has(r.memberId)).length,
		notResponded: [...active].filter((id) => !answered.has(id)).length
	};
}

export function initialsOf(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return '';
	const first = [...words[0]][0];
	const last = words.length > 1 ? [...words[words.length - 1]][0] : '';
	return (first + last).toLocaleUpperCase();
}

export async function readInitials(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	return initialsOf(resolveField(await listMyProfiles(cfg, personId, fetchImpl), 'name').value);
}

// (*MVOX:Josquin*)
