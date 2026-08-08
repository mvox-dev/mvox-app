// #46 (#37-P3.4) — orphan-115 disposition. Three phases:
//
//   Phase A (read-only): expand #41's exact-match partition (18/97) via loose
//   matching (case/diacritics/whitespace normalization). Output the full
//   partition with entity ids — this is pure computation over live-read data,
//   no writes, and re-runs identically every time (deterministic).
//
//   Phase B (mutation, GATED, `PHASE=B`): DELETE orphan member rows whose twin
//   match is CORROBORATED — name match (exact or loose) AND section
//   consistency with the twin's linked member row. Per Gama's guard, the
//   delete set falls out MECHANICALLY from this recorded criterion — no
//   judgment calls. Any orphan with an ambiguous match (>1 twin), a twin with
//   no linked member row, or a twin's linked member carrying no section data
//   to compare against, is NOT a delete candidate — it hides instead.
//
//   Phase C (mutation, GATED, `PHASE=C`): every orphan NOT deleted in Phase B
//   gets its OWN `_sharing` narrowed from `domain` to `private` (atomic
//   replace-by-`_id`, same mechanic as #44). History preserved, reversible.
//
// STRUCTURAL FINDING (verified live 2026-08-08, before writing this file):
// NONE of the 131 linked ("twin") member rows carry a `section` OR
// `current_section` value — both are 0/131. Every one of the 115 orphans DOES
// carry a `section` value (115/115). This means the section-consistency gate
// cannot be satisfied by ANY orphan under the literal criterion — Phase B's
// delete set is mechanically EMPTY today, not because of a matching failure
// but because the comparison's other side has no data. This is reported
// explicitly rather than silently producing an empty list — Gama's "falls out
// mechanically" guard is satisfied precisely BECAUSE the criterion, applied
// honestly, yields zero, not because the criterion was loosened to produce a
// result.

import { entuFetch } from '$lib/entu/request';
import { type EntuCfg } from '$lib/seasons/entuSeasons';

export const MEMBER_TYPE_ID = '69c7ea4a8489bfcb0e819edd';
export const PERSON_TYPE_ID = '69bcfd8e9c031ab8e6ce805f';

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Loose-match normalization: NFD-decompose + strip combining diacritics,
 * lowercase, collapse internal whitespace, trim. */
export function normalizeName(s: string): string {
	return s
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.trim()
		.replace(/\s+/g, ' ');
}

export type OrphanRow = { id: string; name: string; sectionRef: string | null; sharingValueId: string | null };
export type PersonRow = { id: string; name: string | null };
export type LinkedMemberRow = { id: string; personRef: string; sectionRef: string | null; currentSectionRef: string | null };

export type EnumeratedData = {
	orphans: OrphanRow[];
	persons: PersonRow[];
	linkedMembers: LinkedMemberRow[];
};

/** Step-0 enumeration (READ-ONLY). Re-reads everything live — no cached ids
 * trusted from #41/#43 memory. HALTs on population drift from the expected
 * counts (115 orphans, 132 persons, 131 linked members) so a live population
 * change surfaces loudly instead of silently mutating a stale set. */
export async function enumerateAll(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<EnumeratedData> {
	const memberRes = await entuFetch(cfg.db, `entity?_type.reference=${MEMBER_TYPE_ID}&props=_id,person,section,current_section,_sharing&limit=1000`, cfg.token, {}, fetchImpl);
	if (!memberRes.ok) throw new Error(`enumerateAll: member census GET failed: ${memberRes.status}`);
	type MemberEntity = {
		_id: string;
		person?: Array<{ reference: string }>;
		section?: Array<{ reference: string }>;
		current_section?: Array<{ reference: string }>;
		_sharing?: Array<{ _id: string; string: string }>;
		name?: Array<{ string: string }>;
	};
	const memberBody = (await memberRes.json()) as { count: number; entities: MemberEntity[] };
	if (memberBody.count !== memberBody.entities.length) {
		throw new Error(`enumerateAll: member census truncated — count=${memberBody.count} entities=${memberBody.entities.length}`);
	}

	// Need `name` too for orphans (residual, no prop-def) — separate targeted fetch since the
	// bulk query above didn't request it (keeping it lean); re-request with name included.
	const memberWithNameRes = await entuFetch(cfg.db, `entity?_type.reference=${MEMBER_TYPE_ID}&props=_id,name&limit=1000`, cfg.token, {}, fetchImpl);
	if (!memberWithNameRes.ok) throw new Error(`enumerateAll: member-name census GET failed: ${memberWithNameRes.status}`);
	const memberNameBody = (await memberWithNameRes.json()) as { entities: Array<{ _id: string; name?: Array<{ string: string }> }> };
	const nameById = new Map(memberNameBody.entities.map((m) => [m._id, m.name?.[0]?.string ?? null]));

	const orphanEntities = memberBody.entities.filter((m) => !(m.person && m.person.length > 0));
	const linkedEntities = memberBody.entities.filter((m) => m.person && m.person.length > 0);

	if (orphanEntities.length !== 115) {
		throw new Error(`enumerateAll: live orphan count is ${orphanEntities.length}, expected 115 — population drift, refuse to proceed`);
	}
	if (linkedEntities.length !== 131) {
		throw new Error(`enumerateAll: live linked-member count is ${linkedEntities.length}, expected 131 — population drift, refuse to proceed`);
	}

	const orphans: OrphanRow[] = orphanEntities.map((m) => {
		const name = nameById.get(m._id);
		if (!name) throw new Error(`enumerateAll: orphan ${m._id} has no residual name value — refuse to proceed, re-verify manually`);
		return {
			id: m._id,
			name,
			sectionRef: m.section?.[0]?.reference ?? null,
			sharingValueId: m._sharing?.[0]?._id ?? null
		};
	});

	const linkedMembers: LinkedMemberRow[] = linkedEntities.map((m) => ({
		id: m._id,
		personRef: m.person![0].reference,
		sectionRef: m.section?.[0]?.reference ?? null,
		currentSectionRef: m.current_section?.[0]?.reference ?? null
	}));

	const personRes = await entuFetch(cfg.db, `entity?_type.reference=${PERSON_TYPE_ID}&props=_id,name&limit=200`, cfg.token, {}, fetchImpl);
	if (!personRes.ok) throw new Error(`enumerateAll: person census GET failed: ${personRes.status}`);
	const personBody = (await personRes.json()) as { count: number; entities: Array<{ _id: string; name?: Array<{ string: string }> }> };
	if (personBody.count !== 132) {
		throw new Error(`enumerateAll: live person count is ${personBody.count}, expected 132 — population drift, refuse to proceed`);
	}
	const persons: PersonRow[] = personBody.entities.map((p) => ({ id: p._id, name: p.name?.[0]?.string ?? null }));

	return { orphans, persons, linkedMembers };
}

export type MatchType = 'exact' | 'loose' | 'none';
export type SectionConsistency = 'yes' | 'no' | 'n-a';
export type Disposition = 'delete' | 'hide';

export type DispositionRow = {
	orphanId: string;
	orphanName: string;
	orphanSectionRef: string | null;
	matchType: MatchType;
	twinPersonIds: string[];
	twinMemberIds: string[];
	twinSectionRefs: Array<string | null>;
	sectionConsistency: SectionConsistency;
	disposition: Disposition;
	reason: string;
};

/** Pure function — the mechanical criterion. Deterministic given the same
 * enumerated data; no randomness, no judgment calls. */
export function computeDispositions(data: EnumeratedData): DispositionRow[] {
	const { orphans, persons, linkedMembers } = data;
	const membersByPerson = new Map<string, LinkedMemberRow[]>();
	for (const lm of linkedMembers) {
		const arr = membersByPerson.get(lm.personRef) ?? [];
		arr.push(lm);
		membersByPerson.set(lm.personRef, arr);
	}

	const rows: DispositionRow[] = [];
	for (const o of orphans) {
		const exactMatches = persons.filter((p) => p.name === o.name);
		const looseMatches = persons.filter((p) => p.name !== o.name && p.name && normalizeName(p.name) === normalizeName(o.name));
		const matchType: MatchType = exactMatches.length > 0 ? 'exact' : looseMatches.length > 0 ? 'loose' : 'none';
		const twins = matchType === 'exact' ? exactMatches : matchType === 'loose' ? looseMatches : [];
		const twinPersonIds = twins.map((t) => t.id);

		if (matchType === 'none') {
			rows.push({ orphanId: o.id, orphanName: o.name, orphanSectionRef: o.sectionRef, matchType, twinPersonIds: [], twinMemberIds: [], twinSectionRefs: [], sectionConsistency: 'n-a', disposition: 'hide', reason: 'no name match (exact or loose) against the 132-person population' });
			continue;
		}
		if (twinPersonIds.length > 1) {
			rows.push({ orphanId: o.id, orphanName: o.name, orphanSectionRef: o.sectionRef, matchType, twinPersonIds, twinMemberIds: [], twinSectionRefs: [], sectionConsistency: 'n-a', disposition: 'hide', reason: `ambiguous — ${twinPersonIds.length} persons share this name (${matchType} match); common-name false-twin risk, not a delete candidate` });
			continue;
		}

		const twinPersonId = twinPersonIds[0];
		const twinLinkedMembers = membersByPerson.get(twinPersonId) ?? [];
		if (twinLinkedMembers.length === 0) {
			rows.push({ orphanId: o.id, orphanName: o.name, orphanSectionRef: o.sectionRef, matchType, twinPersonIds, twinMemberIds: [], twinSectionRefs: [], sectionConsistency: 'n-a', disposition: 'hide', reason: 'matched person has NO linked member row — nothing to corroborate section against' });
			continue;
		}
		if (twinLinkedMembers.length > 1) {
			rows.push({ orphanId: o.id, orphanName: o.name, orphanSectionRef: o.sectionRef, matchType, twinPersonIds, twinMemberIds: twinLinkedMembers.map((m) => m.id), twinSectionRefs: twinLinkedMembers.map((m) => m.sectionRef ?? m.currentSectionRef), sectionConsistency: 'n-a', disposition: 'hide', reason: `matched person has ${twinLinkedMembers.length} linked member rows — ambiguous, not a delete candidate` });
			continue;
		}

		const twinMember = twinLinkedMembers[0];
		const twinSectionRef = twinMember.sectionRef ?? twinMember.currentSectionRef;
		let sectionConsistency: SectionConsistency;
		let disposition: Disposition;
		let reason: string;
		if (!o.sectionRef || !twinSectionRef) {
			sectionConsistency = 'n-a';
			disposition = 'hide';
			reason = !twinSectionRef
				? 'twin\'s linked member carries NO section/current_section value — nothing to compare against'
				: 'orphan itself carries no section value — nothing to compare';
		} else if (o.sectionRef === twinSectionRef) {
			sectionConsistency = 'yes';
			disposition = 'delete';
			reason = `${matchType} name match + section consistency confirmed (both reference ${twinSectionRef})`;
		} else {
			sectionConsistency = 'no';
			disposition = 'hide';
			reason = `${matchType} name match but section MISMATCH (orphan=${o.sectionRef}, twin=${twinSectionRef}) — likely a false twin (common name)`;
		}

		rows.push({
			orphanId: o.id,
			orphanName: o.name,
			orphanSectionRef: o.sectionRef,
			matchType,
			twinPersonIds,
			twinMemberIds: [twinMember.id],
			twinSectionRefs: [twinSectionRef],
			sectionConsistency,
			disposition,
			reason
		});
	}
	return rows;
}

// ── Phase B: delete corroborated twins ──────────────────────────────────────────

export type DeleteLedgerEntry = { orphanId: string; status: 'deleted' | 'failed'; message?: string };

export async function phaseBDelete(cfg: EntuCfg, deleteTargets: DispositionRow[], fetchImpl: typeof fetch = fetch): Promise<DeleteLedgerEntry[]> {
	const entries: DeleteLedgerEntry[] = [];
	for (const t of deleteTargets) {
		try {
			const res = await entuFetch(cfg.db, `entity/${t.orphanId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
			if (!res.ok) {
				entries.push({ orphanId: t.orphanId, status: 'failed', message: `DELETE /entity/${t.orphanId} failed: ${res.status}` });
				continue;
			}
		} catch (err) {
			entries.push({ orphanId: t.orphanId, status: 'failed', message: errMsg(err) });
			continue;
		}
		const getRes = await entuFetch(cfg.db, `entity/${t.orphanId}`, cfg.token, {}, fetchImpl);
		if (getRes.status !== 404) {
			entries.push({ orphanId: t.orphanId, status: 'failed', message: `post-delete read-back expected 404, got ${getRes.status}` });
			continue;
		}
		entries.push({ orphanId: t.orphanId, status: 'deleted' });
	}
	return entries;
}

// ── Phase C: hide remaining orphans (_sharing -> private) ──────────────────────

export type HideLedgerEntry = { orphanId: string; status: 'hidden' | 'failed'; newSharingPropId?: string; message?: string };

export async function phaseCHide(cfg: EntuCfg, hideTargets: OrphanRow[], fetchImpl: typeof fetch = fetch): Promise<HideLedgerEntry[]> {
	const entries: HideLedgerEntry[] = [];
	for (const t of hideTargets) {
		if (!t.sharingValueId) {
			entries.push({ orphanId: t.id, status: 'failed', message: 'orphan has no existing _sharing value to atomically replace — needs a plain create-POST path, not implemented here' });
			continue;
		}
		try {
			const res = await entuFetch(
				cfg.db,
				`entity/${t.id}`,
				cfg.token,
				{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ _id: t.sharingValueId, type: '_sharing', string: 'private' }]) },
				fetchImpl
			);
			if (!res.ok) {
				entries.push({ orphanId: t.id, status: 'failed', message: `POST failed: ${res.status}` });
				continue;
			}
			const body = (await res.json()) as { properties?: Array<{ _id: string; type: string }> };
			const newSharingProp = (body.properties ?? []).find((p) => p.type === '_sharing');
			if (!newSharingProp?._id) {
				entries.push({ orphanId: t.id, status: 'failed', message: 'POST returned 2xx but no _sharing property in response (apparent-success trap)' });
				continue;
			}
			if (newSharingProp._id === t.sharingValueId) {
				entries.push({ orphanId: t.id, status: 'failed', message: `POST returned the SAME property _id (${t.sharingValueId}) — the replace did not actually rotate` });
				continue;
			}
		} catch (err) {
			entries.push({ orphanId: t.id, status: 'failed', message: errMsg(err) });
			continue;
		}
		const getRes = await entuFetch(cfg.db, `entity/${t.id}?props=_sharing`, cfg.token, {}, fetchImpl);
		if (!getRes.ok) {
			entries.push({ orphanId: t.id, status: 'failed', message: `read-back GET failed: ${getRes.status}` });
			continue;
		}
		const getBody = (await getRes.json()) as { entity?: { _sharing?: Array<{ string: string }> } };
		const now = getBody.entity?._sharing?.[0]?.string;
		if (now !== 'private') {
			entries.push({ orphanId: t.id, status: 'failed', message: `read-back shows _sharing=${JSON.stringify(now)}, expected 'private'` });
			continue;
		}
		entries.push({ orphanId: t.id, status: 'hidden' });
	}
	return entries;
}

// ── Dry-run render ──────────────────────────────────────────────────────────────

export function renderPlan(rows: DispositionRow[]): string {
	const lines: string[] = [];
	const deleteRows = rows.filter((r) => r.disposition === 'delete');
	const hideRows = rows.filter((r) => r.disposition === 'hide');
	const exactCount = rows.filter((r) => r.matchType === 'exact').length;
	const looseCount = rows.filter((r) => r.matchType === 'loose').length;
	const noneCount = rows.filter((r) => r.matchType === 'none').length;

	lines.push('#46 (#37-P3.4) — orphan-115 disposition DRY-RUN plan (NO writes issued)');
	lines.push('');
	lines.push(`── Phase A (loose-match refinement): ${exactCount} exact, ${looseCount} loose (NEW beyond #41's exact-only 18), ${noneCount} no match. Total with-a-twin: ${exactCount + looseCount} (vs #41's exact-only 18).`);
	lines.push('');
	lines.push(`── Phase B (delete corroborated twins): ${deleteRows.length} delete candidate(s)`);
	if (deleteRows.length === 0) {
		lines.push('   ZERO. STRUCTURAL FINDING: none of the 131 linked/twin member rows carry a `section` or `current_section` value (0/131, confirmed live) — every orphan (115/115) DOES carry a section. The section-consistency gate cannot be satisfied by ANY row today: the comparison always has nothing on the twin side to compare against ("n-a"), never a true "yes". This is the criterion applied honestly, not a matching-logic gap.');
	} else {
		for (const r of deleteRows) {
			lines.push(`   WOULD DELETE /entity/${r.orphanId} "${r.orphanName}" — ${r.reason}`);
		}
	}
	lines.push('');
	lines.push(`── Phase C (hide remaining): ${hideRows.length} hide candidate(s) — narrow _sharing domain→private`);
	lines.push('   Disposition breakdown for the hide set:');
	const reasonBuckets = new Map<string, number>();
	for (const r of hideRows) {
		const bucket = r.matchType === 'none' ? 'no-name-match' : r.twinPersonIds.length > 1 ? 'ambiguous-multiple-twins' : r.twinMemberIds.length === 0 ? 'twin-has-no-linked-member' : r.sectionConsistency === 'no' ? 'section-mismatch' : 'section-data-absent';
		reasonBuckets.set(bucket, (reasonBuckets.get(bucket) ?? 0) + 1);
	}
	for (const [bucket, count] of reasonBuckets) {
		lines.push(`     ${bucket}: ${count}`);
	}
	lines.push('');
	lines.push('Row-by-row corroboration basis is in the committed JSON artifact (all 115 rows), not inlined here.');
	lines.push('');
	lines.push(`Totals: ${deleteRows.length} deletes planned, ${hideRows.length} hides planned. Writes issued this run: 0.`);
	return lines.join('\n');
}
