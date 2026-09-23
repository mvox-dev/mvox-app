import { entuFetch } from '$lib/entu/request';
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

// #255 — the member LIFECYCLE write layer (deactivate / reinstate) plus the
// inactive-members read that powers the reinstatement surface (done-when 4).
//
// Contract (issue #255 — Gama ruling + Bentham proposal, all four recs accepted):
//
//   - `deactivateMember` / `reinstateMember`: the SAME mechanism in two
//     directions — a `status` flip via the ATOMIC overwrite wire (#264 PO
//     ruling, branch (i): GET value-id(s) → ONE POST pairing the old id with
//     the new value, Entu's native overwrite — supersedes the old clear-then-
//     set choreography, which half-landed EMPTY on a rejected POST). Done-when
//     1: `status` is the ONLY thing that changes — no other property write,
//     no `_parent` change, no rights change, ever.
//   - The off-'active' value is `'archived'` — canonical v4E member.status is
//     noted `active | archived` (schema.ts:323), so no schema change and no
//     invented value. User-facing copy NEVER says "archived" (Gama copy
//     binding: "not active"); the stored value is a wire fact, not copy.
//   - `listInactiveMembers`: the `status.string=archived` mirror of
//     `listActiveMembers` (rosterData.ts:94) — same props (person,_parent),
//     because the surface MUST show each inactive member's section assignment
//     (Gama adopted Bentham's binding: that is what explains the section
//     ghost-blocker, deleteSection's deliberately unscoped count, with zero
//     write-path change).
//   - `loadInactiveRoster`: orchestration mirror of `loadRoster` — profile
//     fan-out via listProfilesForPerson + toRosterRow, so inactive members
//     resolve to displayable names under the same #28 completeness gate, then
//     the SAME real-names overlay `loadRoster` runs (`applyRealNames`,
//     rosterData.ts — #469, Mihkel 2026-09-23, supersedes this module's old
//     "archived rows never resolve real names" v1 boundary).
//   - `listDeactivateBlockers`: the REFUSAL read (accepted rec 1 — deactivate
//     REFUSES while the person holds a manageable `_owner`/`_editor` grant;
//     demotion stays a separate admin action). Built on listAdmins /
//     listLibrarians (roleManagement.ts:310,348) — no new wire shape. FAIL
//     LOUD: a failed rights read must reject, never resolve [] — resolving
//     empty on error would let a deactivate proceed past an unverified grant.

/** The two values the member `status` flip moves between (v4E: active | archived). */
export type MemberLifecycleStatus = 'active' | 'archived';

/**
 * Flip `status` to 'archived' via the atomic overwrite (#264). Writes NOTHING
 * else — the member entity survives whole (history keeps its subject;
 * `_parent` keeps the reinstatement context and the section ghost-blocker
 * explanation).
 */
export async function deactivateMember(
	cfg: EntuCfg,
	memberId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await flipMemberStatus(cfg, memberId, 'archived', fetchImpl);
}

/**
 * Flip `status` back to 'active' via the SAME atomic-overwrite wire (#264) —
 * reinstate WITHOUT a fresh invitation (done-when 4). No invite machinery
 * anywhere near this path.
 */
export async function reinstateMember(
	cfg: EntuCfg,
	memberId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await flipMemberStatus(cfg, memberId, 'active', fetchImpl);
}

/**
 * The shared ATOMIC-overwrite wire (#264 PO ruling, branch (i), item 3 —
 * supersedes the old clear-then-set choreography named in the module header
 * above). GET the member's current `status` value-id(s) → ONE POST whose
 * entry pairs the FIRST existing value's `_id` with `newStatus` (`setEntity`
 * soft-deletes the old value in the SAME call — entu-www docs, "Overwriting a
 * Property Value"), or sends the value bare when none exists. NO property
 * DELETE fires on this path — the old clear-first wire deleted BEFORE
 * posting, so a rejected POST left the member with NO status at all (worse
 * than a stranded duplicate); the atomic overwrite makes that half-landing
 * structurally impossible: a rejected POST changes nothing server-side.
 * Corrupted 2+-value state (should never happen) still gets an EXTRA-sweep
 * DELETE, strictly AFTER the POST. Done-when 1 unchanged: no other property is
 * ever read, cleared or written by this function.
 */
async function flipMemberStatus(
	cfg: EntuCfg,
	memberId: string,
	newStatus: MemberLifecycleStatus,
	fetchImpl: typeof fetch
): Promise<void> {
	const getRes = await entuFetch(cfg.db, `entity/${memberId}?props=status`, cfg.token, {}, fetchImpl);
	if (!getRes.ok) throw new Error(`memberLifecycle: status lookup failed: ${getRes.status}`);
	const body = (await getRes.json()) as { entity?: { status?: Array<{ _id: string }> } };
	const statusValues = body.entity?.status ?? [];
	const [oldValue, ...extras] = statusValues;

	const entry = oldValue
		? { _id: oldValue._id, type: 'status', string: newStatus }
		: { type: 'status', string: newStatus };

	const postRes = await entuFetch(
		cfg.db,
		`entity/${memberId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([entry])
		},
		fetchImpl
	);
	if (!postRes.ok) throw new Error(`memberLifecycle: status write failed: ${postRes.status}`);

	// EXTRA-sweep — corrupted multi-value state only, strictly AFTER the POST.
	for (const value of extras) {
		const delRes = await entuFetch(
			cfg.db,
			`property/${value._id}`,
			cfg.token,
			{ method: 'DELETE' },
			fetchImpl
		);
		if (!delRes.ok) throw new Error(`memberLifecycle: status clear failed: ${delRes.status}`);
	}
}

/** Mirror of `ActiveMember` for the status.string=archived read. */
export interface InactiveMember {
	memberId: string;
	personId: string;
	/** Section `_parent` entries — NOT cleared on deactivate (done-when 1). */
	sectionIds: string[];
	dbEntityId?: string;
	/** #467 — mirror of `ActiveMember.createdAt`, see its doc (rosterData.ts). */
	createdAt?: string;
}

/**
 * `listActiveMembers`'s query shape with `status.string=archived`.
 *
 * #321 class (2) — REACHABLE, and the worst of the roster reads on this axis: a
 * deactivate only flips `status`, it never deletes, so this collection is the
 * collective's ENTIRE membership history minus whoever is currently active. It
 * only grows, for the life of the collective — the same "no natural ceiling"
 * argument `listLendings` (libraryData.ts) is given for the lending log, and
 * strictly worse than the active list next to it, which at least shrinks when
 * people leave. So it reports `truncated` (server `count` > the RAW wire array, on
 * this same request) and /roster's `roster-partial-notice` covers it.
 */
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
		// #456 — same as listActiveMembers: a missing `person` here is genuinely
		// absent data (soft-deleted on the wire), not a rights gap. Skip and warn,
		// naming the member id (house shape: attendanceData.ts, libraryData.ts).
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
		// #467 — `.datetime` only; the author is dropped at extraction (ER-26).
		// #467 review F1 — `typeof` guards the wire, mirroring rosterData.ts: a
		// non-string (JSON `null`) must not ride through typed `string`.
		const rawCreatedAt = raw._created?.[0]?.datetime;
		const createdAt = typeof rawCreatedAt === 'string' ? rawCreatedAt : undefined;
		return [{ memberId: raw._id, personId, sectionIds, dbEntityId, createdAt }];
	});
	// RAW length, not `items.length` — the mapper drops rather than throws, but
	// the contract is the wire array before any client-side filtering
	// ($lib/entu/listRead).
	return deriveListRead(items, raws.length, body.count);
}

/**
 * `loadRoster`'s orchestration over `listInactiveMembers` — rows with names,
 * PROFILE-resolved and un-overlaid. Not exported: `loadInactiveRoster` below
 * overlays it once; `loadRosterIncludingArchived` unions it with the active
 * equivalent (`loadRosterRead`, rosterData.ts) and overlays the union once —
 * see that function's doc for why the overlay must not run per sub-list.
 *
 * #321 — carries the member read's `truncated` through unchanged. `total` is that
 * read's server count, NOT the row count: the #28 completeness gate in
 * `toRosterRow` drops nameless members, so the two legitimately differ and only
 * `truncated` answers "is this list missing people the server has".
 */
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
			// #469 — profileName set here exactly as loadRosterRead sets it
			// (rosterData.ts): the ONE row shape every producer emits, so
			// applyRealNames' per-row-surface guarantee (profileName untouched)
			// holds for archived rows too.
			.map((row) => ({ ...row, profileName: row.name }))
			.sort((a, b) => a.name.localeCompare(b.name)),
		total: members.total,
		truncated: members.truncated
	};
}

/**
 * #469 (Mihkel, 2026-09-23: "all places we are showing member names ... must
 * obey the admin setting") — `loadInactiveRosterRead` PLUS the same real-names
 * overlay `loadRoster` runs (`applyRealNames`, rosterData.ts). Supersedes this
 * module's old "archived rows never resolve real names" v1 boundary: the
 * reinstatement panel now obeys `roster_show_real_names` exactly like every
 * other roster surface.
 *
 * #469 review F1 — DO NOT reach for this beside `loadRoster` on a surface that
 * shows the active AND the archived list at the same time. Each of the two runs
 * its OWN overlay, so the pair spends the database resolve, the
 * `roster_show_real_names` read and the PII-bearing `admin_member_record`
 * read TWICE for one refresh, and the two overlays can degrade INDEPENDENTLY —
 * real names in one list directly above profile names in the other, which
 * `applyRealNames`' own doc calls byte-indistinguishable from "she has no
 * record". `loadActiveAndArchivedRosters` (below) is the one-pass answer for
 * that shape; both of the app's two-list surfaces (the agenda's season-rate
 * table and the /roster page) go through it. This wrapper is the archived list
 * ALONE — correct only where nothing else on the surface is naming members.
 */
export async function loadInactiveRoster(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<ListRead<RosterRow>> {
	const base = await loadInactiveRosterRead(cfg, fetchImpl);
	return applyRealNames(cfg, base, fetchImpl);
}

/**
 * #344 review F1 — `loadRoster` UNIONED with `loadInactiveRoster`: every member
 * the collective has ever had, active or archived, resolved through the SAME
 * `listProfilesForPerson` + `toRosterRow` chain both wrappers already use (no
 * third resolution path, no second name rule).
 *
 * Exists for ONE caller shape: a surface that must name memberIds it did not
 * get from the active roster. The event page's #344 tally card is the first —
 * a PAST event's tally is deliberately NOT joined against the active roster
 * (#255 D: the singer who has since left still answered, and her answer is
 * shown as recorded), so its rows carry archived memberIds that
 * `loadRoster` alone can never name. Resolving those over the active list only
 * printed the raw 24-hex `_id` on screen as the person's name.
 *
 * FUTURE-event surfaces must keep calling `loadRoster`: their id sets are
 * active-only by construction, and the archived read is the collective's whole
 * membership history — not a read to pay for when its answer is unused (the
 * same reasoning `loadTally` gives for skipping the roster read on a past
 * event, in the other direction).
 *
 * ACTIVE WINS on a memberId collision. The two reads are disjoint by query
 * (`status.string=active` vs `=archived`), so a duplicate means one member
 * entity changed status mid-flight between the two requests; naming her by the
 * active row is the answer that matches what the rest of the app shows.
 *
 * #469 — the real-names overlay runs ONCE, over the UNIONED rows, not once per
 * sub-list: the read itself is `loadActiveAndArchivedRosters` (below), which
 * unions the two RAW reads (`loadRosterRead` from rosterData.ts and this
 * module's own `loadInactiveRosterRead`, neither of which touches
 * `roster_show_real_names`) and applies `applyRealNames` to the combined set;
 * this function only merges the two overlaid halves back together. Calling
 * `loadRoster` + `loadInactiveRoster` instead — each already overlaid — would
 * spend the toggle read and the bulk records read TWICE for one page load;
 * rosterData.realNames.spec.ts pins "exactly ONE records query for the whole
 * roster" for the shared producer, and this function's own contract
 * (memberLifecycle.spec.ts) pins the same discipline for the union.
 *
 * #321 — `truncated` is the OR of the two RAW reads (either one short means
 * this list is missing people, same as before #469) and `total` their sum; the
 * overlay's own `truncated` (a records read that itself came back short) folds
 * in on top via `applyRealNames`.
 */
export async function loadRosterIncludingArchived(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<ListRead<RosterRow>> {
	const { active, inactive } = await loadActiveAndArchivedRosters(cfg, fetchImpl);
	return {
		items: [...active.items, ...inactive.items].sort((a, b) => a.name.localeCompare(b.name)),
		total: active.total + inactive.total,
		// Each half carries its OWN raw read's flag OR the overlay's (see
		// `loadActiveAndArchivedRosters`), and this function's answer is ONE list
		// made of both: either half short means this list is missing people.
		truncated: active.truncated || inactive.truncated
	};
}

/** The two halves of one membership read — see `loadActiveAndArchivedRosters`. */
export interface ActiveAndArchivedRosters {
	/** `status.string=active` rows, overlaid. */
	active: ListRead<RosterRow>;
	/** `status.string=archived` rows, overlaid, minus any id the active half claims. */
	inactive: ListRead<RosterRow>;
}

/**
 * #469 review F1 — the ONE-PASS producer for a surface that needs the active
 * and the archived rows SEPARATELY (the agenda's season-rate table: active
 * members get a rate, archived ones a count-only row — attendanceSummary.ts).
 *
 * It is `loadRosterIncludingArchived`'s read, stopped one step earlier: the two
 * RAW reads in parallel, ONE `applyRealNames` over their concatenation, then the
 * overlaid rows partitioned back by the active read's memberId set. The caller
 * that wants them unioned (`loadRosterIncludingArchived`, above) merges the two
 * halves itself.
 *
 * Why this exists rather than `loadRoster(cfg)` + `loadInactiveRoster(cfg)` side
 * by side — the shape the season panel used before this fix: each of those
 * overlays ITSELF, so one panel open spent TWO database resolves, TWO
 * `roster_show_real_names` reads and TWO `admin_member_record?limit=500` reads
 * (the PII-bearing bulk read) for one table. Worse, the two overlays degrade
 * INDEPENDENTLY: one leg's records read failing while the other's succeeds
 * renders a single table mixing real names with profile names, which the
 * overlay's own doc calls byte-indistinguishable from "she has no record". One
 * overlay over both halves makes that split impossible — the table is all real
 * names or all profile names, never half of each.
 *
 * ACTIVE WINS on a memberId collision, exactly as in
 * `loadRosterIncludingArchived`: a duplicate means a status flip landed between
 * the two requests, and the row is dropped from the `inactive` half so no member
 * appears twice in one table.
 *
 * `truncated` is PER-HALF, plus the overlay's own: each half carries its OWN raw
 * member read's flag OR'd with the records read's, because those two shortnesses
 * are facts about different things. A short records read reverts SOME rows to
 * profile names wherever they are shown, so it marks BOTH halves; a short
 * `status.string=archived` read means the ARCHIVED list is missing people and
 * says nothing about the active one. `total` likewise stays per-half (each read's
 * own server count).
 *
 * #469 review F1 shipped this as a single combined flag on both halves, on the
 * reasoning that the season-rate table is ONE table and one overlay serves it.
 * That is the season table's own statement to make — and it makes it, by OR-ing
 * the two halves at the call site (+page.svelte). A caller with TWO
 * independently-closable lists (the /roster page: the active roster, plus the
 * archived panel) cannot recover the per-half fact from a pre-combined flag, and
 * a combined flag left a truncation detected in the archived panel standing over
 * the ACTIVE roster after the panel closed — the exact claim-about-a-list-that-is
 * -no-longer-on-screen #321 review F3 removed. So the producer reports the facts
 * and each surface combines them for what it actually shows.
 */
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
			// Deliberately NOT `active.truncated || inactive.truncated`: this is an
			// intermediate nobody renders, and starting it at false makes
			// `overlaid.truncated` the RECORDS read's own flag alone — the one piece
			// of truncation that belongs to both halves and cannot be recovered
			// afterwards if it is pre-OR'd with the member reads'. Each raw read's
			// own flag is re-applied per half below, unchanged.
			truncated: false
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

/** One manageable grant that blocks deactivation (refusal names the remedy). */
export interface DeactivateBlocker {
	role: 'admin' | 'librarian';
}

/**
 * The grants that make deactivate REFUSE: the person appears in listAdmins on
 * the database entity, or in listLibrarians on the library entity (when the
 * collective has one — `libraryId: null` skips the librarian read entirely).
 * Rejects on a failed rights read — refusal-by-default, never fail-open.
 */
export async function listDeactivateBlockers(
	cfg: EntuCfg,
	personId: string,
	dbEntityId: string,
	libraryId: string | null,
	fetchImpl: typeof fetch = fetch
): Promise<DeactivateBlocker[]> {
	// #255 review r3 F1 — an EMPTY dbEntityId is not a scoped rights read, it is a
	// different request: `fetchRights` builds `entity/${id}?props=_owner,_editor`,
	// so '' collapses it to `entity/?props=…` — entu-api's entity LIST route,
	// which answers 200 with `entities` and no `entity` key. The parse then reads
	// no rights at all and this function resolves [], i.e. "no blockers" on a
	// check that never happened. Refuse the call outright so no caller can
	// reintroduce the empty-string coercion that made it reachable.
	if (!dbEntityId) {
		throw new Error('listDeactivateBlockers: no database entity id — the rights read cannot be scoped');
	}

	const blockers: DeactivateBlocker[] = [];

	// FAIL LOUD by construction: no try/catch here — a rejected rights read
	// propagates straight out of this function rather than being swallowed into
	// an empty (fail-open) blocker list.
	const admins = await listAdmins(cfg, dbEntityId, personId, fetchImpl);
	if (admins.persons.some((p) => p.id === personId)) blockers.push({ role: 'admin' });

	if (libraryId) {
		const librarians = await listLibrarians(cfg, libraryId, personId, fetchImpl);
		if (librarians.persons.some((p) => p.id === personId)) blockers.push({ role: 'librarian' });
	}

	return blockers;
}

// (*MVOX:Josquin*)
// (*MVOX:Josquin* — #467 review F1: _created[0].datetime validated as a string)
// (*MVOX:Palestrina* — #469 GREEN: archived producers overlay via applyRealNames, union overlaid once)
