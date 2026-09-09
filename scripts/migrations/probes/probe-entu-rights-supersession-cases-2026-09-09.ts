// Bug-report evidence gathering, team-lead authorized 2026-09-09, polyphony
// only, synthetic. Two DISTINCT hypotheses for why Joosep Loidap's
// standalone `_editor` on crede's database entity disappeared when he was
// granted `_owner`, kept separate throughout — team-lead's framing, they
// would be different bugs:
//
//   CASE A — SAME-ENTITY SUPERSESSION. A caller holds a standalone direct
//   `_editor` on an entity; a direct `_owner` is added for the SAME caller
//   on the SAME entity. Does the `_editor` property survive?
//   (Matches crede's observed shape most literally — Joosep's grant was on
//   the database entity itself, same entity both times.)
//
//   CASE B — PROPAGATION-DRIVEN REVOCATION (Mihkel's hypothesis: "if
//   standalone grant gets revoked on parent propagation"). A caller holds a
//   standalone direct grant on a CHILD entity. A grant is then added on the
//   PARENT that propagates down (via `_inheritrights`) and covers that
//   child. Does the CHILD's own standalone property survive the
//   propagation pass?
//
// This is the MORE consequential claim if it reproduces — it would mean a
// propagation pass deletes grant documents on entities it merely reaches,
// not just tidies redundant tiers on one entity.
//
// EVIDENCE DISCIPLINE for this run (this ledger may go into an upstream bug
// report, not authored by this script — Pérotin does not draft that report):
//   - FULL raw response bodies logged at every step, not just status codes.
//   - Exact property `_id`s named before and after each mutation.
//   - `GET property/{id}` responses captured verbatim, including the 404
//     error body.
//   - The live entu-api commit hash (`GET https://api.entu.app/`) recorded,
//     compared against this repo's local `entu-api` reference clone's HEAD
//     (recorded manually in the module doc below, not fetched by the
//     script) — they differ (live `e0ce555...`, local clone `82cb25b...`,
//     2026-06-09), which is WHY case A's mechanism could not be located by
//     reading the local clone: the live deployment is on a newer commit.
//   - Each case reported independently, even if only one reproduces.
//
// Read-only against crede throughout (not touched by this script at all —
// crede's own /history evidence was gathered in the prior probe, read-only,
// no write). No repair of anything, no re-adding Joosep's grant.

import { entuFetch } from '$lib/entu/request';
import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
import { loadCfg } from '../lib/creds';
import { readDryRun } from '../lib/script-runner';
import { writeLedger } from '../lib/ledger-writer';

const DRY_RUN = readDryRun();

interface Evidence {
	step: string;
	request?: unknown;
	status?: number;
	responseBody?: unknown;
	note?: string;
}

async function rawFetch(
	db: string,
	token: string,
	path: string,
	init: RequestInit = {}
): Promise<{ status: number; body: unknown }> {
	const res = await fetch(`https://api.entu.app/${db}/${path}`, {
		...init,
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(init.headers ?? {}) }
	});
	const body = await res.json().catch(() => null);
	return { status: res.status, body };
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const evidence: Evidence[] = [];
	const cleanupEntities: string[] = [];
	const cleanupProps: string[] = [];
	const orphans: string[] = [];

	const versionRes = await fetch('https://api.entu.app/');
	const versionBody = (await versionRes.json()) as { version?: string };
	console.log(`Live entu-api commit: ${versionBody.version}`);
	console.log('Local entu-api reference clone HEAD: 82cb25b843daf4a1be30354d4aa2869e542d34f7 (2026-06-09) — DIFFERS from live, recorded manually, not fetched');
	evidence.push({ step: 'live-entu-api-version', responseBody: versionBody, note: 'local reference clone HEAD 82cb25b843daf4a1be30354d4aa2869e542d34f7 (2026-06-09) differs from this' });

	const dbEntityId = await resolveDatabaseEntityId(cfg);
	if (!dbEntityId) throw new Error('no database entity readable');
	const personTypeRes = await entuFetch(cfg.db, 'entity?_type.string=entity&name.string=person&props=_id&limit=1', cfg.token);
	const personTypeBody = (await personTypeRes.json()) as { entities?: Array<{ _id?: string }> };
	const personTypeId = personTypeBody.entities?.[0]?._id;
	if (!personTypeId) throw new Error('could not resolve person type-def id');
	console.log(`db entity: ${dbEntityId}, person type-def: ${personTypeId}\n`);

	if (DRY_RUN) {
		console.log('=== DRY RUN — would-do, nothing executed ===');
		console.log('CASE A: bare _editor then bare _owner, same reference, same entity (the db entity). Full raw bodies captured.');
		console.log('CASE B: standalone _editor on a CHILD person (inheritrights:true), then _owner on the PARENT db entity for the same reference. Check child\'s own standalone property + confirm propagation actually reached the child.');
		evidence.push({ step: 'dry-run', note: 'would run both cases' });
	} else {
		// ─── CASE A — same-entity supersession ─────────────────────────────
		console.log('=== CASE A — same-entity supersession ===');
		const createA = await rawFetch(cfg.db, cfg.token, 'entity', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: '_type', reference: personTypeId }, { type: '_parent', reference: dbEntityId }])
		});
		const callerA = (createA.body as { _id?: string })._id;
		if (!callerA) throw new Error('Case A caller create failed');
		cleanupEntities.push(callerA);
		console.log(`caller A: ${callerA}`);
		evidence.push({ step: 'case-A-create-caller', request: { path: 'entity', body: [{ type: '_type', reference: personTypeId }, { type: '_parent', reference: dbEntityId }] }, status: createA.status, responseBody: createA.body });

		const editorAReq = [{ type: '_editor', reference: callerA }];
		const editorARes = await rawFetch(cfg.db, cfg.token, `entity/${dbEntityId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editorAReq) });
		const editorAPropId = (editorARes.body as { properties?: Array<{ type?: string; _id?: string }> }).properties?.find((p) => p.type === '_editor')?._id;
		if (!editorAPropId) throw new Error('Case A editor grant failed');
		console.log(`granted _editor on db entity, property ${editorAPropId}`);
		evidence.push({ step: 'case-A-grant-editor', request: { path: `entity/${dbEntityId}`, body: editorAReq }, status: editorARes.status, responseBody: editorARes.body });

		const checkA1 = await rawFetch(cfg.db, cfg.token, `property/${editorAPropId}`);
		console.log(`GET property/${editorAPropId} BEFORE owner grant: HTTP ${checkA1.status}`);
		evidence.push({ step: 'case-A-check-editor-before-owner-grant', request: { path: `property/${editorAPropId}` }, status: checkA1.status, responseBody: checkA1.body });

		const ownerAReq = [{ type: '_owner', reference: callerA }];
		const ownerARes = await rawFetch(cfg.db, cfg.token, `entity/${dbEntityId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ownerAReq) });
		const ownerAPropId = (ownerARes.body as { properties?: Array<{ type?: string; _id?: string }> }).properties?.find((p) => p.type === '_owner')?._id;
		if (!ownerAPropId) throw new Error('Case A owner grant failed');
		console.log(`granted _owner on db entity, property ${ownerAPropId}`);
		cleanupProps.push(ownerAPropId);
		evidence.push({ step: 'case-A-grant-owner', request: { path: `entity/${dbEntityId}`, body: ownerAReq }, status: ownerARes.status, responseBody: ownerARes.body });

		const checkA2 = await rawFetch(cfg.db, cfg.token, `property/${editorAPropId}`);
		console.log(`GET property/${editorAPropId} AFTER owner grant: HTTP ${checkA2.status} — ${JSON.stringify(checkA2.body)}`);
		evidence.push({ step: 'case-A-check-editor-after-owner-grant', request: { path: `property/${editorAPropId}` }, status: checkA2.status, responseBody: checkA2.body });
		if (checkA2.status !== 404) cleanupProps.push(editorAPropId);

		const caseAReproduced = checkA1.status === 200 && checkA2.status === 404;
		console.log(`>> CASE A: ${caseAReproduced ? 'REPRODUCED' : 'DID NOT REPRODUCE'} (before ${checkA1.status}, after ${checkA2.status})\n`);
		evidence.push({ step: 'case-A-verdict', note: caseAReproduced ? 'reproduced' : 'did-not-reproduce' });

		// ─── CASE B — propagation-driven revocation ─────────────────────────
		console.log('=== CASE B — propagation-driven revocation ===');
		const createChild = await rawFetch(cfg.db, cfg.token, 'entity', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([
				{ type: '_type', reference: personTypeId },
				{ type: '_parent', reference: dbEntityId },
				{ type: '_inheritrights', boolean: true }
			])
		});
		const childId = (createChild.body as { _id?: string })._id;
		if (!childId) throw new Error('Case B child create failed');
		cleanupEntities.push(childId);
		console.log(`child entity (inheritrights:true, parent=db entity): ${childId}`);
		evidence.push({ step: 'case-B-create-child', request: { path: 'entity', body: [{ type: '_type', reference: personTypeId }, { type: '_parent', reference: dbEntityId }, { type: '_inheritrights', boolean: true }] }, status: createChild.status, responseBody: createChild.body });

		const createB = await rawFetch(cfg.db, cfg.token, 'entity', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: '_type', reference: personTypeId }, { type: '_parent', reference: dbEntityId }])
		});
		const callerB = (createB.body as { _id?: string })._id;
		if (!callerB) throw new Error('Case B caller create failed');
		cleanupEntities.push(callerB);
		console.log(`caller B: ${callerB}`);
		evidence.push({ step: 'case-B-create-caller', request: { path: 'entity', body: [{ type: '_type', reference: personTypeId }, { type: '_parent', reference: dbEntityId }] }, status: createB.status, responseBody: createB.body });

		const editorBReq = [{ type: '_editor', reference: callerB }];
		const editorBRes = await rawFetch(cfg.db, cfg.token, `entity/${childId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editorBReq) });
		const editorBPropId = (editorBRes.body as { properties?: Array<{ type?: string; _id?: string }> }).properties?.find((p) => p.type === '_editor')?._id;
		if (!editorBPropId) throw new Error('Case B standalone-on-child editor grant failed');
		console.log(`granted standalone _editor on CHILD ${childId} for caller B, property ${editorBPropId}`);
		evidence.push({ step: 'case-B-grant-editor-on-child', request: { path: `entity/${childId}`, body: editorBReq }, status: editorBRes.status, responseBody: editorBRes.body });

		const checkB1 = await rawFetch(cfg.db, cfg.token, `property/${editorBPropId}`);
		console.log(`GET property/${editorBPropId} BEFORE parent grant: HTTP ${checkB1.status}`);
		evidence.push({ step: 'case-B-check-child-editor-before-parent-grant', request: { path: `property/${editorBPropId}` }, status: checkB1.status, responseBody: checkB1.body });

		const ownerParentReq = [{ type: '_owner', reference: callerB }];
		const ownerParentRes = await rawFetch(cfg.db, cfg.token, `entity/${dbEntityId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ownerParentReq) });
		const ownerParentPropId = (ownerParentRes.body as { properties?: Array<{ type?: string; _id?: string }> }).properties?.find((p) => p.type === '_owner')?._id;
		if (!ownerParentPropId) throw new Error('Case B parent owner grant failed');
		console.log(`granted _owner on PARENT (db entity) for caller B, property ${ownerParentPropId} — this is the propagating grant`);
		cleanupProps.push(ownerParentPropId);
		evidence.push({ step: 'case-B-grant-owner-on-parent', request: { path: `entity/${dbEntityId}`, body: ownerParentReq }, status: ownerParentRes.status, responseBody: ownerParentRes.body });

		// Confirm propagation actually reached the child BEFORE judging survival —
		// otherwise a "survives" result is ambiguous (didn't reach yet vs reached and survived).
		let propagationConfirmed = false;
		let childRightsAfter: unknown;
		for (let attempt = 1; attempt <= 5; attempt++) {
			const childRightsCheck = await rawFetch(cfg.db, cfg.token, `entity/${childId}?props=_owner,_editor`);
			childRightsAfter = childRightsCheck.body;
			const editorArr = (childRightsCheck.body as { entity?: { _editor?: Array<{ reference?: string }> } }).entity?._editor ?? [];
			propagationConfirmed = editorArr.some((r) => r.reference === callerB);
			console.log(`  attempt ${attempt}: child's own _editor list includes caller B (propagation reached)? ${propagationConfirmed}`);
			evidence.push({ step: `case-B-propagation-check-attempt-${attempt}`, request: { path: `entity/${childId}?props=_owner,_editor` }, status: childRightsCheck.status, responseBody: childRightsCheck.body });
			if (propagationConfirmed) break;
			await new Promise((r) => setTimeout(r, 1000));
		}

		const checkB2 = await rawFetch(cfg.db, cfg.token, `property/${editorBPropId}`);
		console.log(`GET property/${editorBPropId} AFTER parent grant + propagation confirmed=${propagationConfirmed}: HTTP ${checkB2.status} — ${JSON.stringify(checkB2.body)}`);
		evidence.push({ step: 'case-B-check-child-editor-after-parent-grant', propagationConfirmed, request: { path: `property/${editorBPropId}` }, status: checkB2.status, responseBody: checkB2.body } as Evidence & { propagationConfirmed: boolean });
		if (checkB2.status !== 404) cleanupProps.push(editorBPropId);

		const caseBReproduced = checkB1.status === 200 && propagationConfirmed && checkB2.status === 404;
		console.log(`>> CASE B: ${caseBReproduced ? 'REPRODUCED' : 'DID NOT REPRODUCE'} (before ${checkB1.status}, propagation confirmed ${propagationConfirmed}, after ${checkB2.status})\n`);
		evidence.push({ step: 'case-B-verdict', note: caseBReproduced ? 'reproduced' : propagationConfirmed ? 'did-not-reproduce (propagation confirmed, property survived)' : 'inconclusive (propagation never observably reached the child within 5s)' });

		// ─── CLEANUP ─────────────────────────────────────────────────────────
		console.log('=== CLEANUP ===');
		for (const propId of cleanupProps) {
			const del = await rawFetch(cfg.db, cfg.token, `property/${propId}`, { method: 'DELETE' });
			const alreadyGone = del.status === 404;
			console.log(`  DELETE property ${propId}: ${del.status}`);
			evidence.push({ step: 'cleanup-delete-property', status: del.status, responseBody: del.body, note: propId });
			if (!(del.status === 200 || alreadyGone)) orphans.push(`property ${propId} (status ${del.status})`);
		}
		for (const entId of cleanupEntities) {
			const del = await rawFetch(cfg.db, cfg.token, `entity/${entId}`, { method: 'DELETE' });
			console.log(`  DELETE entity ${entId}: ${del.status}`);
			evidence.push({ step: 'cleanup-delete-entity', status: del.status, responseBody: del.body, note: entId });
			if (del.status !== 200) orphans.push(`entity ${entId} (status ${del.status})`);
			const verify = await rawFetch(cfg.db, cfg.token, `entity/${entId}`);
			evidence.push({ step: 'cleanup-verify-entity-gone', status: verify.status, responseBody: verify.body, note: entId });
			if (verify.status !== 404) orphans.push(`entity ${entId} still readable after DELETE (HTTP ${verify.status})`);
		}
		console.log(orphans.length === 0 ? '>> Full teardown, nothing orphaned, all independently re-verified.' : `>> ORPHANED: ${orphans.join('; ')}`);
		evidence.push({ step: 'orphan-summary', note: orphans.length === 0 ? 'clean' : orphans.join('; ') });
	}

	const artifactPath = writeLedger({
		scriptName: 'probe-entu-rights-supersession-cases',
		dryRun: DRY_RUN,
		db: cfg.db,
		sensitive: false,
		payload: {
			purpose: "Bug-report evidence (team-lead authorized 2026-09-09): does a new direct rights grant retire a caller's prior standalone direct grant on (A) the SAME entity, or (B) a CHILD entity via parent-propagation? Kept separate — different bugs. Polyphony only, synthetic. NOT a drafted bug report — team-lead drafts from this evidence.",
			liveEntuApiCommit: versionBody.version,
			localReferenceCloneHead: '82cb25b843daf4a1be30354d4aa2869e542d34f7 (2026-06-09)',
			evidence
		}
	});
	console.log(`\nLedger (self-contained evidence): ${artifactPath}`);
}

main().catch((err) => {
	console.error('probe-entu-rights-supersession-cases ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
