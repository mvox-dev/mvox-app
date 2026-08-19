import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { listMyProfiles, resolveField, type MyProfile } from '$lib/profile/profileData';
import { hasVisibleName } from '$lib/profile/completionGate';

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
//     sort by name. Fails loud as a whole on any per-member read rejection.
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
	orgId?: string;
}

/**
 * List every ACTIVE member, domain-wide (no person/org filter — the RULED target
 * member is `_sharing:'domain'`, #16, so an ordinary domain reader's query
 * legitimately includes every one of them via the same Gate-A mechanics that admit
 * her own membership row). Widened variant of `findMyMemberId`'s query shape
 * (rsvpData.ts:38-53): drops `person.reference`, widens `props`, widens `limit` to
 * roster scale (500, matching `listRehearsals`/`listMyRsvps` — entuSeasons.ts:99,
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
 */
export async function listActiveMembers(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<ActiveMember[]> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=member&status.string=active&props=person,_parent&limit=500',
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listActiveMembers failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{
			_id: string;
			person?: Array<{ reference: string }>;
			_parent?: Array<{ reference: string; entity_type?: string }>;
		}>;
	};
	return (body.entities ?? []).map((raw) => {
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
		const orgId = (raw._parent ?? []).find((p) => p.entity_type === 'database')?.reference;
		return {
			memberId: raw._id,
			personId,
			sectionIds,
			orgId
		};
	});
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
	 * #161 — carried through verbatim from `ActiveMember.orgId` (see its doc):
	 * the member's collective (database entity) id, so the page's create wiring
	 * can pass `createSection` an explicit top-level parent. Optional for
	 * pre-#161 fixtures.
	 */
	orgId?: string;
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
		// TU.1/#109 (finding #10) — carried through verbatim, see RosterRow.orgId doc.
		orgId: member.orgId
	};
}

// ── orchestration (new) ───────────────────────────────────────────────────────────

/**
 * List active members, fan out ONE profile read per member (`Promise.all` — N
 * genuinely independent reads, not a shared cache key like `listRehearsals`' series
 * cache), resolve each via `toRosterRow`, drop the nameless (#28), sort by name.
 * FAIL LOUD as a whole: any per-member `listProfilesForPerson` rejection (non-2xx /
 * unknown `_sharing`) propagates out of `Promise.all` and rejects `loadRoster` — a
 * member the app couldn't verify never silently vanishes into an incomplete-looking
 * roster; the caller sees the failure and can retry.
 */
export async function loadRoster(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<RosterRow[]> {
	const members = await listActiveMembers(cfg, fetchImpl);
	const rows = await Promise.all(
		members.map(async (member) => {
			const profiles = await listProfilesForPerson(cfg, member.personId, fetchImpl);
			return toRosterRow(member, profiles);
		})
	);
	return rows
		.filter((r): r is RosterRow => r !== null)
		.sort((a, b) => a.name.localeCompare(b.name));
}

// (*MVOX:Tallis* — RED stubs + interface)
// (*MVOX:Josquin* — GREEN implementation)
// (*MVOX:Palestrina* — #58: toRosterRow accepts domain OR public name)
// (*MVOX:Palestrina* — F1 code-review fix: multi-section members, TS.1/#95)
