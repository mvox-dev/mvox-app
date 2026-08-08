// #53 (#37-P3.4b) — delete the 7 corroborated orphan member entities (name +
// section-parent-ref match, per the corrected #46 comparison committed at
// `seed-results/probe-46-parent-section-corroboration-2026-08-08T04-31-31-000Z.json`).
// Authorized on #37 by Gama (2026-08-08 07:33) — the delete set fell out
// MECHANICALLY from the recorded criterion, no judgment-call rows. All 7 are
// currently `_sharing:private` (Phase C, #46) — this converts hidden→deleted.
//
// Every row is re-verified LIVE before being treated as a delete target —
// not trusted from the committed artifact alone (state could have moved:
// entity deleted by another path, _sharing changed, etc.).

import { readFileSync } from 'node:fs';
import { entuFetch } from '$lib/entu/request';
import { type EntuCfg } from '$lib/seasons/entuSeasons';

export const CORROBORATION_ARTIFACT_PATH = 'scripts/migrations/seed-results/probe-46-parent-section-corroboration-2026-08-08T04-31-31-000Z.json';

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

type CorroborationArtifact = {
	corroboratedCount: number;
	corroboratedOrphanIds: string[];
	results: Array<{
		orphanId: string;
		orphanName: string;
		orphanSectionRef: string | null;
		twinPersonId: string;
		twinMemberId: string;
		twinParentSectionRef: string | null;
		twinParentSectionName: string | null;
		match: 'yes' | 'no' | 'n-a';
	}>;
};

export type PlannedDelete = {
	orphanId: string;
	twinPersonId: string;
	twinMemberId: string;
	matchedName: string;
	matchedSectionParentId: string;
	corroborationBasis: string;
};

export function loadCorroboratedTargets(): PlannedDelete[] {
	const raw = readFileSync(CORROBORATION_ARTIFACT_PATH, 'utf-8');
	const artifact = JSON.parse(raw) as CorroborationArtifact;
	if (artifact.corroboratedCount !== 7) {
		throw new Error(`loadCorroboratedTargets: artifact reports corroboratedCount=${artifact.corroboratedCount}, expected 7 — artifact may have changed, refuse to proceed`);
	}
	const yesRows = artifact.results.filter((r) => r.match === 'yes');
	if (yesRows.length !== 7) {
		throw new Error(`loadCorroboratedTargets: found ${yesRows.length} rows with match='yes' in results, expected 7 — refuse to proceed`);
	}
	const idsFromResults = new Set(yesRows.map((r) => r.orphanId));
	const idsFromField = new Set(artifact.corroboratedOrphanIds);
	if (idsFromResults.size !== idsFromField.size || [...idsFromResults].some((id) => !idsFromField.has(id))) {
		throw new Error('loadCorroboratedTargets: corroboratedOrphanIds field and results-with-match=yes disagree — artifact internally inconsistent, refuse to proceed');
	}

	return yesRows.map((r) => {
		if (!r.twinParentSectionRef) throw new Error(`loadCorroboratedTargets: corroborated row ${r.orphanId} has no twinParentSectionRef — inconsistent with match='yes', refuse to proceed`);
		return {
			orphanId: r.orphanId,
			twinPersonId: r.twinPersonId,
			twinMemberId: r.twinMemberId,
			matchedName: r.orphanName,
			matchedSectionParentId: r.twinParentSectionRef,
			corroborationBasis: `exact name match ("${r.orphanName}") + section parent ref match (both reference ${r.twinParentSectionRef}, "${r.twinParentSectionName}")`
		};
	});
}

export type VerifiedTarget = PlannedDelete & { liveExists: boolean; liveSharing: string | null; verified: boolean; verifyMessage?: string };

/** Step-0 enumeration (READ-ONLY). Re-verifies each of the 7 planned targets
 * live: still exists, still `_sharing:private` (Phase C's expected state).
 * Also re-confirms none of the 7 ids appear in the wider "stays untouched"
 * populations (the 11 uncorroborated + 97 without-twin) — cross-checked
 * against the same source artifact's full result set, not re-derived. */
export async function verifyAll(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<{ targets: VerifiedTarget[]; crossCheckPassed: boolean; crossCheckMessage: string }> {
	const planned = loadCorroboratedTargets();
	const raw = readFileSync(CORROBORATION_ARTIFACT_PATH, 'utf-8');
	const artifact = JSON.parse(raw) as CorroborationArtifact;
	const noOrNaIds = new Set(artifact.results.filter((r) => r.match !== 'yes').map((r) => r.orphanId));
	const overlap = planned.filter((t) => noOrNaIds.has(t.orphanId));
	const crossCheckPassed = overlap.length === 0 && planned.length === 7;
	const crossCheckMessage = crossCheckPassed
		? 'confirmed: none of the 7 delete targets appear in the 11 uncorroborated (match=no) rows from the same artifact'
		: `FAILED: ${overlap.length} target(s) also appear in the non-corroborated set — ${overlap.map((t) => t.orphanId).join(', ')}`;
	if (!crossCheckPassed) {
		throw new Error(`verifyAll: cross-check failed — ${crossCheckMessage}`);
	}

	const targets: VerifiedTarget[] = [];
	for (const p of planned) {
		const res = await entuFetch(cfg.db, `entity/${p.orphanId}?props=_sharing,name`, cfg.token, {}, fetchImpl);
		if (res.status === 404) {
			targets.push({ ...p, liveExists: false, liveSharing: null, verified: false, verifyMessage: 'entity no longer exists (already deleted?) — refuse to include as a delete target' });
			continue;
		}
		if (!res.ok) {
			targets.push({ ...p, liveExists: false, liveSharing: null, verified: false, verifyMessage: `GET failed unexpectedly: ${res.status}` });
			continue;
		}
		const body = (await res.json()) as { entity?: { _sharing?: Array<{ string: string }>; name?: Array<{ string: string }> } };
		const liveSharing = body.entity?._sharing?.[0]?.string ?? '(absent)';
		const liveName = body.entity?.name?.[0]?.string;
		if (liveName !== p.matchedName) {
			targets.push({ ...p, liveExists: true, liveSharing, verified: false, verifyMessage: `live name=${JSON.stringify(liveName)} != expected ${JSON.stringify(p.matchedName)} — refuse to proceed on a name drift` });
			continue;
		}
		if (liveSharing !== 'private') {
			targets.push({ ...p, liveExists: true, liveSharing, verified: false, verifyMessage: `live _sharing=${JSON.stringify(liveSharing)}, expected 'private' (Phase C's hidden state) — refuse to proceed on unexpected tier` });
			continue;
		}
		targets.push({ ...p, liveExists: true, liveSharing, verified: true });
	}

	return { targets, crossCheckPassed, crossCheckMessage };
}

export type DeleteLedgerEntry = PlannedDelete & { status: 'deleted' | 'failed'; message?: string };

export async function executeDeletes(cfg: EntuCfg, targets: VerifiedTarget[], fetchImpl: typeof fetch = fetch): Promise<DeleteLedgerEntry[]> {
	const entries: DeleteLedgerEntry[] = [];
	for (const t of targets) {
		if (!t.verified) {
			entries.push({ ...t, status: 'failed', message: `not verified live: ${t.verifyMessage}` });
			continue;
		}
		try {
			const res = await entuFetch(cfg.db, `entity/${t.orphanId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
			if (!res.ok) {
				entries.push({ ...t, status: 'failed', message: `DELETE /entity/${t.orphanId} failed: ${res.status}` });
				continue;
			}
		} catch (err) {
			entries.push({ ...t, status: 'failed', message: errMsg(err) });
			continue;
		}
		const getRes = await entuFetch(cfg.db, `entity/${t.orphanId}`, cfg.token, {}, fetchImpl);
		if (getRes.status !== 404) {
			entries.push({ ...t, status: 'failed', message: `post-delete read-back expected 404, got ${getRes.status}` });
			continue;
		}
		entries.push({ ...t, status: 'deleted' });
	}
	return entries;
}

export function renderPlan(result: { targets: VerifiedTarget[]; crossCheckMessage: string }): string {
	const lines: string[] = [];
	lines.push('#53 (#37-P3.4b) — delete 7 corroborated orphan members DRY-RUN plan (NO writes issued)');
	lines.push('');
	lines.push(`── Cross-check against non-corroborated populations: ${result.crossCheckMessage}`);
	lines.push('');
	lines.push('── Per-row ledger (id + twin person/member + matched name + matched section parent + basis)');
	for (const t of result.targets) {
		lines.push(`   Orphan ${t.orphanId} "${t.matchedName}"`);
		lines.push(`     twin person: ${t.twinPersonId}, twin member: ${t.twinMemberId}`);
		lines.push(`     matched section parent: ${t.matchedSectionParentId}`);
		lines.push(`     basis: ${t.corroborationBasis}`);
		lines.push(`     live re-verify: exists=${t.liveExists}, _sharing=${t.liveSharing}, verified=${t.verified}${t.verifyMessage ? ` (${t.verifyMessage})` : ''}`);
		lines.push(`     WOULD: DELETE /entity/${t.orphanId}`);
	}
	lines.push('');
	const okCount = result.targets.filter((t) => t.verified).length;
	lines.push(`Totals: ${result.targets.length} planned, ${okCount} pass live re-verification. Writes issued this run: 0.`);
	return lines.join('\n');
}
