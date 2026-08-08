// #45 (#37-P3.3) — D2 (retire apply-to-join) + D5 (_probe_bulletin cleanup).
// Four independent mutation steps, EACH its own §8.6 authorization gate per the
// issue's explicit instruction ("each its own §8.6 step with committed
// ledger") — this entrypoint refuses to run more than one step per live
// invocation (see `STEP` env var in the entrypoint file).
//
// D2 — apply-to-join retire (grounded in invite-only design, Mihkel's ruling):
//   Step 1: PRIVATIZE the "Applications" menu entry (DELETE its `_sharing`
//     property VALUE, leaving it absent — matches the existing "Billing"
//     admin-only entry's shape exactly, confirmed live in #41: Billing's own
//     `_sharing` is `(absent)`, not an explicit 'private' string). Chosen over
//     full entity deletion as the more reversible action for an equivalent
//     outcome (admin-only visibility) — flagged explicitly for Bentham/
//     team-lead to confirm or override; "remove" (DELETE /entity/{menuId}) is
//     the documented alternative if a harder cut is preferred.
//   Step 2: DELETE the stale specimen `6a2fdac64cd971291c5d5e79` (confirmed
//     live: type=application, status=approved, expires_at=2026-07-15 — over 3
//     weeks past expiry as of this run, 2026-08-08).
//   Step 3: retire the `application` TYPE — delete its 4 prop-def entities
//     (target_org, message, status, expires_at) then the type entity itself.
//     Gated on a live recount confirming ZERO application instances remain
//     (i.e. step 2 has already landed) — deleting a type with live instances
//     would orphan them.
//
// D5 — _probe_bulletin cleanup:
//   Step 4: delete the 3 inert instances, the type's 3 prop-defs (title,
//     summary, draft_notes), then the type entity itself. No menu entry
//     exists for this type (confirmed live — nothing to touch there).
//
// Mechanic: `DELETE /entity/{id}` for entities (including prop-def entities —
// prop-defs ARE entities, confirmed mechanic). `DELETE /property/{id}` for a
// single property VALUE (the menu entry's `_sharing`, step 1 only). Never
// interchangeable (architecture-decisions.md "Entu mutation-op wire shapes").

import { entuFetch } from '$lib/entu/request';
import { type EntuCfg } from '$lib/seasons/entuSeasons';

export const MENU_ENTRY_ID = '6a0f6d314ff8277cd4306a0e';
export const MENU_SHARING_VALUE_ID = '6a0f6d314ff8277cd4306a11';

export const SPECIMEN_ID = '6a2fdac64cd971291c5d5e79';

export const APPLICATION_TYPE_ID = '6a0d2e8390c8df7a1cc7de81';
export const APPLICATION_PROPDEFS = [
	{ id: '6a0d2e8390c8df7a1cc7de8a', name: 'target_org' },
	{ id: '6a0d2e8390c8df7a1cc7de94', name: 'message' },
	{ id: '6a0d2e8490c8df7a1cc7de9d', name: 'status' },
	{ id: '6a0d2e8490c8df7a1cc7dea7', name: 'expires_at' }
];

export const PROBE_BULLETIN_TYPE_ID = '6a320169487a9c1f02f70ad6';
export const PROBE_BULLETIN_INSTANCES = ['6a320182487a9c1f02f70af2', '6a320182487a9c1f02f70af9', '6a320182487a9c1f02f70b01'];
export const PROBE_BULLETIN_PROPDEFS = [
	{ id: '6a320175487a9c1f02f70adb', name: 'title' },
	{ id: '6a320176487a9c1f02f70ae3', name: 'summary' },
	{ id: '6a320176487a9c1f02f70aeb', name: 'draft_notes' }
];

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export type DeleteLedgerEntry = { id: string; label: string; status: 'deleted' | 'failed'; message?: string };

async function deleteEntity(cfg: EntuCfg, id: string, label: string, fetchImpl: typeof fetch): Promise<DeleteLedgerEntry> {
	try {
		const res = await entuFetch(cfg.db, `entity/${id}`, cfg.token, { method: 'DELETE' }, fetchImpl);
		if (!res.ok) return { id, label, status: 'failed', message: `DELETE /entity/${id} failed: ${res.status}` };
	} catch (err) {
		return { id, label, status: 'failed', message: errMsg(err) };
	}
	// Read-back-PROVE: a deleted entity must 404 on GET.
	try {
		const getRes = await entuFetch(cfg.db, `entity/${id}`, cfg.token, {}, fetchImpl);
		if (getRes.status !== 404) {
			return { id, label, status: 'failed', message: `post-delete read-back expected 404, got ${getRes.status} — deletion did not actually land` };
		}
	} catch (err) {
		return { id, label, status: 'failed', message: `post-delete read-back errored: ${errMsg(err)}` };
	}
	return { id, label, status: 'deleted' };
}

// ── Step-0 enumeration (READ-ONLY) — re-verify live, never trust the constants above ──

export type VerifiedTargets = {
	menuEntry: { id: string; name: string; sharingValueId: string | null; currentSharing: string };
	specimen: { id: string; type: string; status: string; expiresAt: string };
	applicationType: { id: string; name: string; instanceCount: number; propDefs: Array<{ id: string; name: string }> };
	probeBulletinType: { id: string; name: string; instanceIds: string[]; propDefs: Array<{ id: string; name: string }>; menuEntryExists: boolean };
};

export async function verifyAllTargets(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<VerifiedTargets> {
	// Menu entry
	const menuRes = await entuFetch(cfg.db, `entity/${MENU_ENTRY_ID}?props=name,_sharing,query`, cfg.token, {}, fetchImpl);
	if (!menuRes.ok) throw new Error(`verifyAllTargets: menu entry ${MENU_ENTRY_ID} GET failed: ${menuRes.status}`);
	const menuBody = (await menuRes.json()) as {
		entity?: { name?: Array<{ string: string }>; _sharing?: Array<{ _id: string; string: string }>; query?: Array<{ string: string }> };
	};
	const menuName = menuBody.entity?.name?.[0]?.string;
	if (menuName !== 'Applications') {
		throw new Error(`verifyAllTargets: menu entry ${MENU_ENTRY_ID} has name=${JSON.stringify(menuName)}, expected 'Applications' — wrong id, refuse to proceed`);
	}
	const menuQuery = menuBody.entity?.query?.[0]?.string ?? '';
	if (!menuQuery.includes('_type.string=application')) {
		throw new Error(`verifyAllTargets: menu entry ${MENU_ENTRY_ID} query=${JSON.stringify(menuQuery)} does not reference application — refuse to proceed`);
	}

	// Specimen
	const specimenRes = await entuFetch(cfg.db, `entity/${SPECIMEN_ID}?props=_type,status,expires_at`, cfg.token, {}, fetchImpl);
	if (!specimenRes.ok) throw new Error(`verifyAllTargets: specimen ${SPECIMEN_ID} GET failed: ${specimenRes.status}`);
	const specimenBody = (await specimenRes.json()) as {
		entity?: { _type?: Array<{ string: string }>; status?: Array<{ string: string }>; expires_at?: Array<{ date: string }> };
	};
	const specimenType = specimenBody.entity?._type?.[0]?.string;
	if (specimenType !== 'application') {
		throw new Error(`verifyAllTargets: specimen ${SPECIMEN_ID} has _type=${JSON.stringify(specimenType)}, expected 'application' — refuse to proceed`);
	}
	const specimenExpiresAt = specimenBody.entity?.expires_at?.[0]?.date;
	if (!specimenExpiresAt || new Date(specimenExpiresAt).getTime() >= Date.now()) {
		throw new Error(`verifyAllTargets: specimen ${SPECIMEN_ID} expires_at=${JSON.stringify(specimenExpiresAt)} is not in the past — the "stale, past expiry" premise no longer holds live, refuse to proceed`);
	}

	// application type
	const appTypeRes = await entuFetch(cfg.db, `entity/${APPLICATION_TYPE_ID}?props=name`, cfg.token, {}, fetchImpl);
	if (!appTypeRes.ok) throw new Error(`verifyAllTargets: application type ${APPLICATION_TYPE_ID} GET failed: ${appTypeRes.status}`);
	const appTypeBody = (await appTypeRes.json()) as { entity?: { name?: Array<{ string: string }> } };
	if (appTypeBody.entity?.name?.[0]?.string !== 'application') {
		throw new Error(`verifyAllTargets: ${APPLICATION_TYPE_ID} is not the 'application' type entity — refuse to proceed`);
	}
	const appCountRes = await entuFetch(cfg.db, `entity?_type.reference=${APPLICATION_TYPE_ID}&props=_id&limit=50`, cfg.token, {}, fetchImpl);
	if (!appCountRes.ok) throw new Error(`verifyAllTargets: application instance count GET failed: ${appCountRes.status}`);
	const appCountBody = (await appCountRes.json()) as { count: number };

	// _probe_bulletin type
	const pbTypeRes = await entuFetch(cfg.db, `entity/${PROBE_BULLETIN_TYPE_ID}?props=name`, cfg.token, {}, fetchImpl);
	if (!pbTypeRes.ok) throw new Error(`verifyAllTargets: _probe_bulletin type ${PROBE_BULLETIN_TYPE_ID} GET failed: ${pbTypeRes.status}`);
	const pbTypeBody = (await pbTypeRes.json()) as { entity?: { name?: Array<{ string: string }> } };
	if (pbTypeBody.entity?.name?.[0]?.string !== '_probe_bulletin') {
		throw new Error(`verifyAllTargets: ${PROBE_BULLETIN_TYPE_ID} is not the '_probe_bulletin' type entity — refuse to proceed`);
	}
	const pbInstancesRes = await entuFetch(cfg.db, `entity?_type.reference=${PROBE_BULLETIN_TYPE_ID}&props=_id&limit=50`, cfg.token, {}, fetchImpl);
	if (!pbInstancesRes.ok) throw new Error(`verifyAllTargets: _probe_bulletin instances GET failed: ${pbInstancesRes.status}`);
	const pbInstancesBody = (await pbInstancesRes.json()) as { entities: Array<{ _id: string }> };
	const liveInstanceIds = pbInstancesBody.entities.map((e) => e._id).sort();
	const expectedIds = [...PROBE_BULLETIN_INSTANCES].sort();
	if (JSON.stringify(liveInstanceIds) !== JSON.stringify(expectedIds)) {
		throw new Error(`verifyAllTargets: _probe_bulletin live instance ids ${JSON.stringify(liveInstanceIds)} != expected ${JSON.stringify(expectedIds)} — population drift, refuse to proceed`);
	}
	const pbMenuRes = await entuFetch(cfg.db, `entity?_type.string=menu&props=query&limit=100`, cfg.token, {}, fetchImpl);
	const pbMenuBody = (await pbMenuRes.json()) as { entities: Array<{ query?: Array<{ string: string }> }> };
	const pbMenuEntryExists = pbMenuBody.entities.some((e) => (e.query?.[0]?.string ?? '').includes('_probe_bulletin'));

	return {
		menuEntry: {
			id: MENU_ENTRY_ID,
			name: menuName,
			sharingValueId: menuBody.entity?._sharing?.[0]?._id ?? null,
			currentSharing: menuBody.entity?._sharing?.[0]?.string ?? '(absent)'
		},
		specimen: { id: SPECIMEN_ID, type: specimenType, status: specimenBody.entity?.status?.[0]?.string ?? '(unknown)', expiresAt: specimenExpiresAt },
		applicationType: { id: APPLICATION_TYPE_ID, name: 'application', instanceCount: appCountBody.count, propDefs: APPLICATION_PROPDEFS },
		probeBulletinType: { id: PROBE_BULLETIN_TYPE_ID, name: '_probe_bulletin', instanceIds: liveInstanceIds, propDefs: PROBE_BULLETIN_PROPDEFS, menuEntryExists: pbMenuEntryExists }
	};
}

// ── Step 1: privatize Applications menu entry ──────────────────────────────────

export async function step1PrivatizeMenu(cfg: EntuCfg, sharingValueId: string, fetchImpl: typeof fetch = fetch): Promise<DeleteLedgerEntry> {
	try {
		const res = await entuFetch(cfg.db, `property/${sharingValueId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
		if (!res.ok) return { id: sharingValueId, label: 'Applications menu _sharing value', status: 'failed', message: `DELETE /property/${sharingValueId} failed: ${res.status}` };
	} catch (err) {
		return { id: sharingValueId, label: 'Applications menu _sharing value', status: 'failed', message: errMsg(err) };
	}
	const getRes = await entuFetch(cfg.db, `entity/${MENU_ENTRY_ID}?props=_sharing`, cfg.token, {}, fetchImpl);
	if (!getRes.ok) return { id: sharingValueId, label: 'Applications menu _sharing value', status: 'failed', message: `read-back GET failed: ${getRes.status}` };
	const body = (await getRes.json()) as { entity?: { _sharing?: Array<{ string: string }> } };
	if (body.entity?._sharing && body.entity._sharing.length > 0) {
		return { id: sharingValueId, label: 'Applications menu _sharing value', status: 'failed', message: `read-back still shows a _sharing value (${body.entity._sharing[0].string}) — deletion did not land` };
	}
	return { id: sharingValueId, label: 'Applications menu _sharing value', status: 'deleted' };
}

// ── Step 2: delete specimen ─────────────────────────────────────────────────────

export async function step2DeleteSpecimen(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<DeleteLedgerEntry> {
	return deleteEntity(cfg, SPECIMEN_ID, 'application specimen', fetchImpl);
}

// ── Step 3: retire application type (GATED on zero live instances) ─────────────

export async function step3RetireApplicationType(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<DeleteLedgerEntry[]> {
	const countRes = await entuFetch(cfg.db, `entity?_type.reference=${APPLICATION_TYPE_ID}&props=_id&limit=50`, cfg.token, {}, fetchImpl);
	if (!countRes.ok) throw new Error(`step3RetireApplicationType: instance recount GET failed: ${countRes.status}`);
	const countBody = (await countRes.json()) as { count: number };
	if (countBody.count > 0) {
		throw new Error(`step3RetireApplicationType: ${countBody.count} application instance(s) still live — refuse to retire the type while instances exist (run step 2 first)`);
	}
	const entries: DeleteLedgerEntry[] = [];
	for (const pd of APPLICATION_PROPDEFS) {
		entries.push(await deleteEntity(cfg, pd.id, `application prop-def ${pd.name}`, fetchImpl));
	}
	if (entries.some((e) => e.status === 'failed')) return entries; // don't delete the type if any prop-def failed
	entries.push(await deleteEntity(cfg, APPLICATION_TYPE_ID, 'application TYPE entity', fetchImpl));
	return entries;
}

// ── Step 4: delete _probe_bulletin type + prop-defs + 3 instances ──────────────

export async function step4DeleteProbeBulletin(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<DeleteLedgerEntry[]> {
	const entries: DeleteLedgerEntry[] = [];
	for (const id of PROBE_BULLETIN_INSTANCES) {
		entries.push(await deleteEntity(cfg, id, '_probe_bulletin instance', fetchImpl));
	}
	if (entries.some((e) => e.status === 'failed')) return entries;
	for (const pd of PROBE_BULLETIN_PROPDEFS) {
		entries.push(await deleteEntity(cfg, pd.id, `_probe_bulletin prop-def ${pd.name}`, fetchImpl));
	}
	if (entries.some((e) => e.status === 'failed')) return entries;
	entries.push(await deleteEntity(cfg, PROBE_BULLETIN_TYPE_ID, '_probe_bulletin TYPE entity', fetchImpl));
	return entries;
}

// ── Dry-run render ──────────────────────────────────────────────────────────────

export function renderPlan(v: VerifiedTargets): string {
	const lines: string[] = [];
	lines.push('#45 (#37-P3.3) — retire apply-to-join + delete _probe_bulletin DRY-RUN plan (NO writes issued)');
	lines.push('');
	lines.push('── D2 Step 1: Applications menu entry — PRIVATIZE (judgment call, flagged for confirmation)');
	lines.push(`   Menu entry ${v.menuEntry.id} "${v.menuEntry.name}", current _sharing='${v.menuEntry.currentSharing}' (value _id ${v.menuEntry.sharingValueId}).`);
	lines.push(`   WOULD: DELETE /property/${v.menuEntry.sharingValueId} — leaves _sharing absent, matching the existing "Billing" admin-only entry's shape exactly (confirmed in #41: Billing's own _sharing is (absent), not an explicit 'private' string).`);
	lines.push('   ALTERNATIVE (not planned, noted for review): full removal via DELETE /entity — harder to reverse for an equivalent visibility outcome; privatize chosen as the more reversible action satisfying "remove/privatize" either-or.');
	lines.push('');
	lines.push('── D2 Step 2: delete stale specimen');
	lines.push(`   Specimen ${v.specimen.id}: type='${v.specimen.type}', status='${v.specimen.status}', expires_at='${v.specimen.expiresAt}' (confirmed in the past live, not assumed).`);
	lines.push(`   WOULD: DELETE /entity/${v.specimen.id}.`);
	lines.push('');
	lines.push('── D2 Step 3: retire application TYPE (GATED on step 2 landing — zero live instances)');
	lines.push(`   Type ${v.applicationType.id} "application", currently ${v.applicationType.instanceCount} live instance(s) (must be 0 at execution time, re-checked live by step3, not assumed from this dry-run snapshot).`);
	for (const pd of v.applicationType.propDefs) {
		lines.push(`   WOULD: DELETE /entity/${pd.id} (prop-def '${pd.name}').`);
	}
	lines.push(`   WOULD: DELETE /entity/${v.applicationType.id} (the type entity itself) — only after all 4 prop-defs delete cleanly.`);
	lines.push('');
	lines.push('── D5 Step 4: delete _probe_bulletin type + registry + 3 instances');
	lines.push(`   Type ${v.probeBulletinType.id} "_probe_bulletin". No menu entry exists for this type (confirmed live: ${v.probeBulletinType.menuEntryExists ? 'FOUND ONE — unexpected, investigate' : 'none found, matches expectation'}).`);
	for (const id of v.probeBulletinType.instanceIds) {
		lines.push(`   WOULD: DELETE /entity/${id} (instance).`);
	}
	for (const pd of v.probeBulletinType.propDefs) {
		lines.push(`   WOULD: DELETE /entity/${pd.id} (prop-def '${pd.name}').`);
	}
	lines.push(`   WOULD: DELETE /entity/${v.probeBulletinType.id} (the type entity itself) — only after all 3 instances + 3 prop-defs delete cleanly.`);
	lines.push('');
	lines.push('EACH STEP IS ITS OWN §8.6 AUTHORIZATION per the issue. Live execution requires STEP=1|2|3|4 set explicitly — this entrypoint refuses to run more than one step per invocation, and refuses ANY step when DRY_RUN is not explicitly false.');
	lines.push('');
	lines.push('Writes issued this run: 0.');
	return lines.join('\n');
}
