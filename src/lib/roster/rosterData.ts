import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { listMyProfiles, resolveField, type MyProfile } from '$lib/profile/profileData';
import { hasVisibleName } from '$lib/profile/completionGate';
import { readRosterNamesSetting } from '$lib/collective/rosterNames';
import { deriveListRead, isTruncated, type ListRead } from '$lib/entu/listRead';

// T3.2/#18 — the roster READ data layer. RED (Tallis): every exported function below
// is a STUB that throws 'not implemented' so `rosterData.spec.ts` compiles and FAILS
// on assertions until Josquin's GREEN. Types are real (compile-time only). See the
// build-contract design doc (Slice-3 #16) for the full rationale; short version:
//
//   - `listActiveMembers` is a NEW query (widened variant of `findMyMemberId`'s
//     pattern, rsvpData.ts:38-53) — no person filter, `status.string=active` only,
//     matching the RULED TARGET member shape (`_sharing:'domain'`, NO `name` prop-def).
//   - `listProfilesForPerson` is a thin, same-file wrapper around the ALREADY-generic
//     `listMyProfiles(cfg, personId, ...)` (profileData.ts:156-198) — reused as-is for
//     call-site clarity only; zero new wire shape.
//   - `toRosterRow` is a PURE per-member resolver: `hasVisibleName` (completionGate.ts,
//     #28/#58) gates presentability — a name at domain OR public tier satisfies (a
//     public name is readable by fellow members too). The displayed name is read the
//     SAME domain-or-public scan `hasVisibleName` itself inlines (never `resolveField`,
//     never `private` — narrower-wins would let a private-only name leak through);
//     domain is preferred when BOTH tiers hold a name. `resolveField` IS correct for
//     email (narrower-wins is exactly "whichever tier she shared it at").
//   - `loadRoster` orchestrates: list members → fan out ONE profile read per member
//     (`Promise.all`, genuinely independent reads) → resolve → drop nameless (#28) →
//     sort by name. Fails loud as a whole on any per-member read rejection. It is
//     PROFILE-NAMES-ONLY and shared by four routes; #269's real-names overlay is the
//     separate, opt-in `loadRosterWithRealNames` that only /roster calls (scope
//     ruling 2026-09-06 — see both functions' docs).
//
// HARD RULE — NO client-side privacy-boundary filtering anywhere in this module. The
// server (entu-api Gate A: list-query `access` pre-filter; Gate B: `cleanupEntity`
// per-entity bucket selection) already ensures `listProfilesForPerson` can only ever
// return a member's domain/public-tier profile entities — her private one never
// crosses the wire. An `if (_sharing === 'private') skip` branch anywhere here would
// be dead code at best and a correctness smell at worst (implies this path could
// legitimately receive private data). The nameless-member exclusion in `toRosterRow`
// is a COMPLETENESS gate (#28), not a privacy filter — see that function's doc.

// ── list active members (new — no direct precedent) ──────────────────────────────

export interface ActiveMember {
	memberId: string;
	personId: string;
	/**
	 * PO ruling 2026-08-11 (#95/#80): the SOLE source of a member's sections is
	 * `_parent.filter(p => p.entity_type === 'section')` — there is no
	 * `current_section` property on member (0/132 members carry it in the dev db;
	 * dead code, removed). [] when the member has no section parent — no
	 * fallback.
	 *
	 * F1 code-review fix: a member can belong to MULTIPLE sections at once (e.g.
	 * a section leader who also sings in the section) — every matching `_parent`
	 * entry is kept, in wire order, not just the first (the earlier single-value
	 * `.find()` collapsed a multi-section member down to one section and silently
	 * dropped her from the rest). `.filter()` widening of the same `.find()`
	 * pattern used at libraryData.ts:118 and entuSeasons.ts:123 — those call
	 * sites' properties genuinely ARE single-valued; a member's section
	 * membership is not.
	 */
	sectionIds: string[];
	/**
	 * #161 (collective = database, Mihkel ruling 2026-08-16) — the member's
	 * COLLECTIVE id: the `_parent` entry with `entity_type === 'database'`.
	 * Threaded through to `RosterRow` so the roster page can hand
	 * `createSection` the correct top-level parent instead of the data layer
	 * guessing. Optional: undefined when this reader cannot see a database
	 * parent, OR when the member's only non-section `_parent` is a LEGACY
	 * "organization"-typed entry — that retired entity kind is not a collective
	 * identity anymore, so it is never used as a fallback. Contract pinned by
	 * rosterData.database.spec.ts.
	 */
	dbEntityId?: string;
}

/**
 * List every ACTIVE member, domain-wide (no person/org filter — the RULED target
 * member is `_sharing:'domain'`, #16, so an ordinary domain reader's query
 * legitimately includes every one of them via the same Gate-A mechanics that admit
 * her own membership row). Widened variant of `findMyMemberId`'s query shape
 * (rsvpData.ts:38-53): drops `person.reference`, widens `props`, widens `limit` to
 * roster scale (500, matching `listEvents`/`listMyRsvps` — entuSeasons.ts:99,
 * rsvpData.ts:67).
 *
 * NEVER projects `name` — the RULED target member carries no name prop-def; the
 * shared subset's name comes solely from the person's domain profile (below). The
 * SHIPPED create path (inviteData.ts:290-299) still puts `name` on `member` — this
 * function targets the RULED shape, not the pre-#29 live one (deliberate).
 *
 * PO ruling 2026-08-11 (#95/#80): sections come SOLELY from
 * `_parent.filter(p => p.entity_type === 'section')` — `current_section` is not
 * a real member property (0/132 members carry it in the dev db) and is never
 * read here. No fallback — YAGNI. F1: EVERY matching `_parent` entry is kept
 * (a member can be in more than one section), widening the `.find()` pattern
 * used at `libraryData.ts:118` and `entuSeasons.ts:123`.
 *
 * #321 class (2) — REACHABLE, so this read reports its own truncation rather than
 * claiming a bound. Its cardinality IS the collective's active membership: there
 * is no structural ceiling to appeal to, only how many people sing, and the live
 * dev db already holds 132 active members against a cap of 500. `count > raw
 * entities.length` on this SAME request is the signal — see `$lib/entu/listRead`
 * for the contract and the two probe ledgers it rests on. `/roster` raises
 * `roster-partial-notice` off it; `loadRoster` (the shared profile-names producer
 * below) deliberately discards the flag and warns instead — see its doc.
 */
export async function listActiveMembers(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<ListRead<ActiveMember>> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=member&status.string=active&props=person,_parent&limit=500',
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listActiveMembers failed: ${res.status}`);
	const body = (await res.json()) as {
		count?: number;
		entities?: Array<{
			_id: string;
			person?: Array<{ reference: string }>;
			_parent?: Array<{ reference: string; entity_type?: string }>;
		}>;
	};
	const raws = body.entities ?? [];
	const items = raws.map((raw) => {
		const personId = raw.person?.[0]?.reference;
		// `person` is REQUIRED on the target member shape — fail loud, naming the
		// object, rather than silently dropping her out of the roster. An absent
		// value here means THIS reader's token couldn't read it — not proof the
		// property doesn't exist (a narrower-than-entity sharing tier can hide it).
		if (!personId) {
			throw new Error(
				`listActiveMembers: member ${raw._id} — cannot read person reference (visible fields insufficient for this reader's rights; may be a narrower-than-entity sharing tier, not necessarily absent data)`
			);
		}
		// PO ruling 2026-08-11 (#95/#80) — every `_parent` entry that is a section
		// is a section this member belongs to; [] when she has none. Sole source,
		// no current_section fallback. F1: kept ALL matches, not just the first.
		const sectionIds = (raw._parent ?? [])
			.filter((p) => p.entity_type === 'section')
			.map((p) => p.reference);
		// #161 — the FIRST `_parent` entry that is the DATABASE entity is the
		// member's collective; undefined when none is visible to this reader
		// (never a throw — visibility must not gate the roster) OR when the only
		// non-section entry is a LEGACY `organization` parent (see
		// rosterData.database.spec.ts).
		const dbEntityId = (raw._parent ?? []).find((p) => p.entity_type === 'database')?.reference;
		return {
			memberId: raw._id,
			personId,
			sectionIds,
			dbEntityId
		};
	});
	// RAW length, not `items.length`: this mapper throws rather than dropping, so
	// the two are equal today — but the contract is "the wire array before any
	// client-side filtering", so a future drop here can never fabricate a
	// truncation the server never reported ($lib/entu/listRead).
	return deriveListRead(items, raws.length, body.count);
}

// ── read another member's shared profile subset (reused, not new) ────────────────

/**
 * Read a member's shared-tier profile entities by her PERSON id. Delegates to the
 * IDENTICAL query `listMyProfiles` already issues (profileData.ts:156-198). That
 * function is verified-generic over `personId` (its "My" reflects its one current
 * call-site, self-edit, not a structural restriction). Kept as a same-file wrapper
 * here — NOT a new export on `profileData.ts` — purely for roster call-site clarity;
 * zero new wire shape, zero duplicated fetch logic.
 *
 * SAFE for any member's personId, not just the caller's own — entu-api enforces the
 * privacy boundary server-side, upstream of this response body ever reaching the
 * browser (see module header). This module therefore contains, and must continue to
 * contain, NO `if (_sharing === 'private') skip` branch anywhere.
 */
export function listProfilesForPerson(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<MyProfile[]> {
	return listMyProfiles(cfg, personId, fetchImpl);
}

// ── shared subset + the #28 completeness gate (new — pure) ───────────────────────

export interface RosterRow {
	memberId: string;
	personId: string;
	name: string;
	email: string;
	/**
	 * TS.1/#95, widened by F1 — every section ENTITY ID this member belongs to
	 * ([] when unassigned), carried through from `ActiveMember.sectionIds` so the
	 * roster page can join rows to the section tree (`groupBySection`,
	 * sectionData.ts) and have a multi-section member land in EVERY one of her
	 * sections' groups, not just one. Optional at the type level for pre-GREEN /
	 * legacy fixtures; `groupBySection` treats undefined the same as [] (Unassigned).
	 */
	sectionIds?: string[];
	/**
	 * #161 — carried through verbatim from `ActiveMember.dbEntityId` (see its doc):
	 * the member's collective (database entity) id, so the page's create wiring
	 * can pass `createSection` an explicit top-level parent. Optional for
	 * pre-#161 fixtures.
	 */
	dbEntityId?: string;
	/**
	 * #269 — the roster's own domain-or-public PROFILE name (`toRosterRow`'s
	 * `name`, unchanged), carried through separately from the DISPLAYED `name`
	 * so every out-of-scope name surface on the roster page (SectionPicker's aria
	 * label, the record-edit pencil, the deactivate/damaged-record banners) can
	 * keep naming the member by her profile name even when her row displays a
	 * real one — the roster-only scope ruling. Set by `loadRoster` on EVERY row
	 * (where it always equals `name`) and carried through unchanged by
	 * `loadRosterWithRealNames`, so both producers emit one row shape;
	 * `undefined` on `toRosterRow`'s own bare output and on
	 * `loadInactiveRoster`'s rows (memberLifecycle.ts — the inactive panel is a
	 * deliberate v1 boundary that never resolves real names at all, see that
	 * module).
	 */
	profileName?: string;
}

/**
 * Pure per-member resolver: member + her already-fetched profile entities → a
 * roster row, or null.
 *
 * NAME: read directly off the domain-tier OR public-tier entity — deliberately NOT
 * `resolveField('name', ...)`, which would let a PRIVATE-only name leak through
 * (narrower-wins sorts private first) — contradicting the #28/#58 ruling this gate
 * exists to enforce. This inlines the identical domain-or-public scan
 * `hasVisibleName` itself uses; when BOTH tiers hold a name, domain is preferred
 * (matches `NARROWNESS`'s domain < public ordering elsewhere in this codebase).
 *
 * EMAIL: `resolveField(profiles, 'email')` IS correct to reuse as-is — "email from
 * whichever tier she shared it at" is exactly narrower-wins semantics, and per
 * `listProfilesForPerson`'s doc, `profiles` can never legitimately contain a private
 * holder for it to wrongly prefer.
 *
 * `null` here is a COMPLETENESS gate (#28/#58: "not shown as a member anywhere
 * until [a domain-or-public name] is filled"), NOT a privacy filter — her
 * `profiles` array has already legitimately crossed the server boundary by the
 * time this function sees it (see module header). Do not conflate the two.
 */
export function toRosterRow(member: ActiveMember, profiles: MyProfile[]): RosterRow | null {
	if (hasVisibleName(profiles) === 'incomplete') return null;
	// Same domain-or-public scan hasVisibleName itself inlines — NEVER resolveField,
	// NEVER private, for the name (see doc comment above).
	let domain: MyProfile | undefined;
	let pub: MyProfile | undefined;
	for (const p of profiles) {
		if (p._sharing === 'domain') domain = p;
		else if (p._sharing === 'public') pub = p;
	}
	const domainName = domain?.name.trim() ?? '';
	const publicName = pub?.name.trim() ?? '';
	return {
		memberId: member.memberId,
		personId: member.personId,
		// hasVisibleName === 'complete' guarantees at least one of these is non-blank.
		name: domainName !== '' ? domainName : publicName,
		email: resolveField(profiles, 'email').value,
		// TS.1/#95, F1 — carried through verbatim from the member (section entity
		// ids, [] when unassigned) so groupBySection can join rows to the section
		// tree and place a multi-section member in every matching group.
		sectionIds: member.sectionIds,
		// TU.1/#109 (finding #10) — carried through verbatim, see RosterRow.dbEntityId doc.
		dbEntityId: member.dbEntityId
	};
}

// ── orchestration (new) ───────────────────────────────────────────────────────────

/**
 * #269 — the ONE bulk `admin_member_record` read behind the real-names overlay:
 * `entity?_type.string=admin_member_record&props=person,name&limit=500` — the
 * PO-ruled incidental-exposure fence (never phone/email/birthdate; the listSections
 * one-fetch idiom, one query for the whole roster, never one per member). Returns a
 * personId → record-name map; a record with no `person` reference, or whose person
 * is not on this roster, is simply never looked up — no throw, no misjoin. A person
 * carrying MORE THAN ONE record is absent from the map entirely (see the loop) — the
 * overlay refuses to guess which name is hers. The name itself is returned RAW
 * (untrimmed) — the caller decides what "non-empty" means.
 *
 * #321 class (2) — REACHABLE, so this reports `truncated` alongside the map. An
 * `admin_member_record` is written once per person an admin has ever recorded and
 * is never archived away, so the collection accumulates over the collective's
 * whole life on top of tracking membership size; there is no bound to state. The
 * consequence is specific and worth naming: a truncated read here silently drops
 * SOME rows from the overlay, so those members revert to their profile name while
 * their neighbours show a real one — byte-indistinguishable, on screen, from "she
 * has no record". `loadRosterWithRealNames` carries the flag out so /roster can
 * say so instead.
 */
async function listRecordNamesByPerson(
	cfg: EntuCfg,
	fetchImpl: typeof fetch
): Promise<{ byPerson: Map<string, string>; truncated: boolean }> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=admin_member_record&props=person,name&limit=500',
		cfg.token,
		{},
		fetchImpl
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
	// #269 review — a person carrying MORE THAN ONE record is the exact condition
	// `loadMemberRecord` classifies as `{state:'damaged'}` (#264 — surface loudly,
	// refuse to guess). Last-wins here would have the roster row confidently display
	// an arbitrary server-order pick while the pencil on the SAME row refuses to
	// guess; the check-then-create is not atomic across admins, so this is
	// live-reachable. So we refuse too: a duplicated person is DROPPED from the map
	// entirely (not first-wins), and the row falls back to the profile name —
	// byte-indistinguishable from "no record at all", per the silent-and-complete
	// fallback rule, and agreeing with what the pencil says about that member.
	const duplicated = new Set<string>();
	for (const raw of raws) {
		const personId = raw.person?.[0]?.reference;
		if (!personId) continue; // orphan record — ignored silently, never misjoined
		if (duplicated.has(personId)) continue; // third+ record — stays dropped
		if (byPerson.has(personId)) {
			duplicated.add(personId);
			byPerson.delete(personId);
			continue;
		}
		byPerson.set(personId, raw.name?.[0]?.string ?? '');
	}
	// RAW length, never `byPerson.size`: the orphan skip and the duplicate drop
	// above are rows this function CHOOSES not to map, and neither is a row the
	// server withheld ($lib/entu/listRead's raw-length rule).
	return { byPerson, truncated: isTruncated(raws.length, body.count) };
}

/**
 * List active members, fan out ONE profile read per member (`Promise.all` — N
 * genuinely independent reads, not a shared cache key like `listEvents`' series
 * cache), resolve each via `toRosterRow`, drop the nameless (#28), sort by name.
 * FAIL LOUD as a whole: any per-member `listProfilesForPerson` rejection (non-2xx /
 * unknown `_sharing`) propagates out of `Promise.all` and rejects `loadRoster` — a
 * member the app couldn't verify never silently vanishes into an incomplete-looking
 * roster; the caller sees the failure and can retry.
 *
 * PROFILE NAMES ONLY, ALWAYS. This is the app-wide member-name producer and it has
 * FOUR production consumers: the /roster page, the event detail page's attendance
 * panel (event/[id]/+page.svelte), the agenda's `getRoster` (attendance panel,
 * conductor chips, all three conductor pickers — cached for ROSTER_CACHE_TTL_MS)
 * and the admin roles page's two person selects + id→name lookup. Henry's
 * 2026-09-06 scope ruling fences #269's real-names overlay to the roster row alone:
 * "Every other place a member's name appears — pickers, chips, the agenda, event
 * pages, the library — keeps profile names, and this slice must not quietly extend
 * to them." So the overlay is NOT here — it lives in `loadRosterWithRealNames`
 * below, which /roster opts into and nobody else calls. Adding the toggle read to
 * this function would silently re-open the leak on all four surfaces; the boundary
 * is pinned by page.agenda-real-names-fence.spec.ts,
 * page.admin-real-names-fence.spec.ts and the "#269 scope fence" case in
 * event/[id]/page.spec.ts (each asserts profile names AND zero
 * `admin_member_record` requests).
 *
 * `row.profileName` is set here, on every row, equal to `row.name` — the ONE row
 * shape both producers emit, so a consumer never has to know which one it got.
 *
 * #321 — returns a `ListRead`, exactly as `loadRosterWithRealNames` does: the rows
 * AND whether the member read behind them was partial. It did not, at first — this
 * function discarded `truncated` with a `console.warn`, on the reasoning that its
 * three consumers (the agenda's cached `getRoster`, the event page's attendance
 * panel, the admin roles page's person selects) were pickers and chips rather than
 * member LISTS, and so had no surface for the fact.
 *
 * The PO's ruling of 2026-09-11 rejects that, and the test it gives is
 * REACHABILITY: every one of those three surfaces is a CLOSED-SET picker over this
 * producer's rows. A truncated read there does not read as a short list — it reads
 * as "that person is not a member", which for the admin selects means a member who
 * cannot be granted a role with nothing on screen saying why. So the flag now
 * reaches all three, each of which states it inside the picker
 * (`picker_partial_members_notice`), and the array-returning wrapper that dropped
 * it is gone rather than kept as a shape nobody should pick.
 */
export async function loadRoster(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<ListRead<RosterRow>> {
	return await loadRosterRead(cfg, fetchImpl);
}

/**
 * #321 — the full-fidelity producer both public orchestrators are built on: the
 * rows AND whether the member read behind them was partial. Not exported: the two
 * wrappers differ only in the real-names overlay (see `loadRoster`'s doc), and a
 * third entry point onto the same read would be one more thing to keep in step.
 *
 * `total` is the member read's server count, NOT the row count: the #28
 * completeness gate below drops nameless members, so `items.length` is already
 * smaller than the members read on a live collective. That mismatch is what the
 * roster notice must not confuse itself with — hence `truncated` comes straight
 * from `listActiveMembers`, which compares the count against its own RAW wire
 * array, before this function's gate ever runs.
 */
async function loadRosterRead(
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

/**
 * #269 — `loadRoster` PLUS the real-names overlay. The OPT-IN producer, called
 * from exactly one place: `src/routes/roster/+page.svelte`. See `loadRoster`'s doc
 * for why the overlay is a separate export rather than a flag on the shared one.
 *
 * The overlay runs after the base resolution, never before it: ONLY when the
 * collective's `roster_show_real_names` is true AND a member's
 * `admin_member_record` carries a non-empty (post-trim) name does `row.name` become
 * that real name; `row.profileName` always carries `loadRoster`'s domain-or-public
 * profile resolution unchanged, for the out-of-scope surfaces ON the roster row
 * (SectionPicker's aria label, the record-edit pencil, the deactivate/damaged
 * banners) that must keep naming her by it regardless. The three sort sites (the
 * sort below, the page's flat re-sort, `groupBySection`'s per-group order) all key
 * off `row.name`, so they follow the displayed name for free.
 *
 * The overlay is DELIBERATELY NOT part of `loadRoster`'s fail-loud contract: it is
 * wrapped in its own try/catch and degrades to "toggle off" (profile names,
 * `recordNameByPerson` empty) on ANY failure — no visible database entity (a
 * legitimate, documented `resolveDatabaseEntityId` answer, not just a test gap), a
 * non-2xx toggle read, a non-2xx records read. A member's presence on the roster is
 * the more critical property; losing the real-names overlay must never take the
 * whole roster down with it. The degrade DIRECTION is what makes that safe: it can
 * only show FEWER real names, never leak one while the toggle is off.
 *
 * #269 review F3 — but the degrade is OBSERVABLE and PINNED, not silent. It
 * deliberately narrows `readRosterNamesSetting`'s stated fail-loud contract
 * (rosterNames.ts: "no visible database entity or a non-2xx anywhere → throw") at
 * this one call site, so it logs a `console.error` breadcrumb: without it, a blipping
 * toggle read on a live collective would silently serve profile names to everyone
 * with no signal to member, admin or console that the setting was being ignored
 * (standing fail-loud-over-fallbacks rule). Both failing branches — the toggle read
 * and the records read — are pinned in rosterData.realNames.spec.ts.
 *
 * #321 — returns a `ListRead`: both reads behind these rows are class (2) and
 * /roster raises `roster-partial-notice` off `truncated`. The flag is the OR of
 * them, because the two failures look the same to the reader — a list that is
 * missing people (the member read) and a list where some people are named wrongly
 * (the records read, which reverts those rows to profile names indistinguishably
 * from "no record") are both "what you see is not the whole truth". `total` stays
 * the MEMBER read's server count; the overlay adds no rows, it only renames them.
 * The overlay's degrade path is the one place `truncated` can be a false NEGATIVE:
 * a records read that threw tells us nothing about its own completeness, and the
 * catch below already logs that degrade loudly.
 */
export async function loadRosterWithRealNames(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<ListRead<RosterRow>> {
	const base = await loadRosterRead(cfg, fetchImpl);
	// Nobody to overlay onto — and no reason to spend the toggle read finding out.
	// The member read's own `truncated` still travels: "no presentable member, and
	// the read was partial" is precisely when the notice matters most.
	if (base.items.length === 0) return base;

	let recordNameByPerson = new Map<string, string>();
	let recordsTruncated = false;
	try {
		const { showRealNames } = await readRosterNamesSetting(cfg, fetchImpl);
		if (showRealNames) {
			const records = await listRecordNamesByPerson(cfg, fetchImpl);
			recordNameByPerson = records.byPerson;
			recordsTruncated = records.truncated;
		}
	} catch (e) {
		// See doc above — an unresolvable overlay degrades to "toggle off", never
		// takes the base roster down with it, and says so loudly in the console
		// (#269 review F3): a silent degrade here would hide a live collective
		// ignoring its own roster_show_real_names setting.
		console.error(
			'loadRosterWithRealNames: real-names overlay unavailable, showing profile names',
			e
		);
		recordNameByPerson = new Map();
		recordsTruncated = false;
	}
	const truncated = base.truncated || recordsTruncated;
	// Toggle off, or nothing to apply: the base rows are already the answer,
	// already carrying `profileName` and already sorted by the displayed name.
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

// (*MVOX:Tallis* — RED stubs + interface)
// (*MVOX:Josquin* — GREEN implementation)
// (*MVOX:Palestrina* — #58: toRosterRow accepts domain OR public name)
// (*MVOX:Palestrina* — F1 code-review fix: multi-section members, TS.1/#95)
// (*MVOX:Palestrina* — #269 GREEN: the real-names overlay)
// (*MVOX:Palestrina* — #269 review F1/F2: the overlay is opt-in at /roster only)
// (*MVOX:Josquin* — #321 review F2: the member + record reads report truncation)
