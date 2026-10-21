// #445 remedy on crede (2026-09-22): delete a newer duplicate `_sharing`/`_inheritrights` pair.
// Keeps the older pair. Authorized by Mihkel, "go for cleanup" (via team-lead/Gama, 5775480675).
// Step 1 aborts unless the entity holds exactly the four value ids `target` names.

// Dry-run first: node --import tsx --import ./scripts/migrations/lib/register-loader.mjs <file>
// Live: DRY_RUN=false AUTHORIZED_BY='...', only after a verified dry run and authorization.

import { pathToFileURL } from 'node:url';
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/entu/cfg';
import { loadCredeCfg, readDryRun, readAuthorizedBy } from '../lib/script-runner';
import { writeLedger, assertLiveRunAuthorized } from '../lib/ledger-writer';

export interface RemedyTarget {
	entityId: string;
	keepSharingId: string;
	deleteSharingId: string;
	keepInheritId: string;
	deleteInheritId: string;
}

// Diagnosed 2026-09-22: this entity holds the first live run's pair and the resume's pair.
// Edit this constant and re-run for the next row with the same shape.
export const TARGET: RemedyTarget = {
	entityId: '6a9c3d38ca67df980f41729b',
	keepSharingId: '6ab25bae5685992c758ad3d5',
	deleteSharingId: '6ab266145685992c758ad3e0',
	keepInheritId: '6ab25bae5685992c758ad3d6',
	deleteInheritId: '6ab266155685992c758ad3e1'
};

export const COMMITTED_ALLOW = [
	'dryRun',
	'entityId',
	'outcome',
	'observedSharingIds',
	'observedInheritIds',
	'expectedSharingIds',
	'expectedInheritIds',
	'deletedIds',
	'status',
	'readback',
	'_sharing',
	'_inheritrights',
	'_id',
	// 'string' is absent: writeLedger refuses it in every committed.allow. The tier value is
	// stripped from the committed twin; full detail stays in the gitignored instance ledger.
	'boolean',
	'postRunRecheck',
	'stillCorrect'
] as const;

async function safeJson(res: Response): Promise<unknown> {
	try {
		return await res.json();
	} catch {
		return null;
	}
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RemedyResult {
	outcome: 'dry-run' | 'cleaned' | 'aborted-state-mismatch' | 'aborted-readback-mismatch';
	ledgerPath: string;
}

export async function runRemedyDuplicateRights(
	cfg: EntuCfg,
	dryRun: boolean,
	target: RemedyTarget,
	fetchImpl: typeof fetch = fetch,
	authorizedBy?: string,
	recheckDelayMs = 30_000,
	sleepFn: (ms: number) => Promise<void> = defaultSleep
): Promise<RemedyResult> {
	// mvox-app#417 — before any request leaves the script.
	assertLiveRunAuthorized(dryRun, authorizedBy);

	const { entityId, keepSharingId, deleteSharingId, keepInheritId, deleteInheritId } = target;
	const expectedSharingIds = [keepSharingId, deleteSharingId].sort();
	const expectedInheritIds = [keepInheritId, deleteInheritId].sort();

	function writeLedgerNow(extra: Record<string, unknown>): string {
		return writeLedger({
			scriptName: 'remedy-445-duplicate-rights-values-crede',
			dryRun,
			db: cfg.db,
			sensitive: true,
			authorizedBy,
			committed: { allow: COMMITTED_ALLOW },
			payload: { dryRun, entityId, ...extra }
		});
	}

	// ── Step 1 — read fresh, assert the exact known duplicate shape ──────────
	const res = await entuFetch(cfg.db, `entity/${entityId}?props=_sharing,_inheritrights`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`runRemedyDuplicateRights: pre-write read failed: ${res.status}`);
	const body = (await res.json()) as {
		entity?: { _sharing?: Array<{ _id: string; string?: string }>; _inheritrights?: Array<{ _id: string; boolean?: boolean }> };
	};
	const observedSharingIds = (body.entity?._sharing ?? []).map((v) => v._id).sort();
	const observedInheritIds = (body.entity?._inheritrights ?? []).map((v) => v._id).sort();

	const matches =
		JSON.stringify(observedSharingIds) === JSON.stringify(expectedSharingIds) &&
		JSON.stringify(observedInheritIds) === JSON.stringify(expectedInheritIds);

	if (!matches) {
		const ledgerPath = writeLedgerNow({
			outcome: 'aborted-state-mismatch',
			observedSharingIds,
			observedInheritIds,
			expectedSharingIds,
			expectedInheritIds
		});
		throw new Error(
			`runRemedyDuplicateRights: ${entityId} does not hold exactly the expected duplicate value ids -- refusing to guess -- observed _sharing=${JSON.stringify(observedSharingIds)} _inheritrights=${JSON.stringify(observedInheritIds)}, expected _sharing=${JSON.stringify(expectedSharingIds)} _inheritrights=${JSON.stringify(expectedInheritIds)} (ledger: ${ledgerPath})`
		);
	}

	if (dryRun) {
		const ledgerPath = writeLedgerNow({
			outcome: 'dry-run',
			observedSharingIds,
			observedInheritIds,
			deletedIds: []
		});
		return { outcome: 'dry-run', ledgerPath };
	}

	// ── Step 2 — delete the newer pair only ───────────────────────────────────
	const delSharing = await entuFetch(cfg.db, `property/${deleteSharingId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	if (!delSharing.ok) throw new Error(`runRemedyDuplicateRights: DELETE property/${deleteSharingId} failed: ${delSharing.status}`);
	const delInherit = await entuFetch(cfg.db, `property/${deleteInheritId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	if (!delInherit.ok) throw new Error(`runRemedyDuplicateRights: DELETE property/${deleteInheritId} failed: ${delInherit.status}`);

	// ── Step 3 — read back: exactly one value per property, the KEPT ids ─────
	const readRes = await entuFetch(cfg.db, `entity/${entityId}?props=_sharing,_inheritrights`, cfg.token, {}, fetchImpl);
	const readBody = (await safeJson(readRes)) as {
		entity?: { _sharing?: Array<{ _id: string; string?: string }>; _inheritrights?: Array<{ _id: string; boolean?: boolean }> };
	} | null;
	const sharingVals = readBody?.entity?._sharing ?? [];
	const inheritVals = readBody?.entity?._inheritrights ?? [];
	const readbackOk =
		readRes.ok &&
		sharingVals.length === 1 &&
		sharingVals[0]?._id === keepSharingId &&
		sharingVals[0]?.string === 'domain' &&
		inheritVals.length === 1 &&
		inheritVals[0]?._id === keepInheritId &&
		inheritVals[0]?.boolean === true;

	if (!readbackOk) {
		const ledgerPath = writeLedgerNow({
			outcome: 'aborted-readback-mismatch',
			deletedIds: [deleteSharingId, deleteInheritId],
			readback: { status: readRes.status, body: readBody }
		});
		throw new Error(`runRemedyDuplicateRights: read-back after delete did not show exactly the kept pair (ledger: ${ledgerPath})`);
	}

	// ── Step 4 — delayed recheck, dated ───────────────────────────────────────
	await sleepFn(recheckDelayMs);
	const recheckRes = await entuFetch(cfg.db, `entity/${entityId}?props=_sharing,_inheritrights`, cfg.token, {}, fetchImpl);
	const recheckBody = (await safeJson(recheckRes)) as {
		entity?: { _sharing?: Array<{ _id: string; string?: string }>; _inheritrights?: Array<{ _id: string; boolean?: boolean }> };
	} | null;
	const recheckSharing = recheckBody?.entity?._sharing ?? [];
	const recheckInherit = recheckBody?.entity?._inheritrights ?? [];
	const stillCorrect =
		recheckSharing.length === 1 &&
		recheckSharing[0]?._id === keepSharingId &&
		recheckSharing[0]?.string === 'domain' &&
		recheckInherit.length === 1 &&
		recheckInherit[0]?._id === keepInheritId &&
		recheckInherit[0]?.boolean === true;
	const postRunRecheck = { status: recheckRes.status, _sharing: recheckSharing, _inheritrights: recheckInherit, stillCorrect };

	const ledgerPath = writeLedgerNow({
		outcome: 'cleaned',
		deletedIds: [deleteSharingId, deleteInheritId],
		readback: { status: readRes.status, body: readBody },
		postRunRecheck
	});

	return { outcome: 'cleaned', ledgerPath };
}

async function main(): Promise<void> {
	const dryRun = readDryRun();
	const authorizedBy = readAuthorizedBy();
	const cfg = await loadCredeCfg();
	console.log(`Mode: ${dryRun ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}, entity=${TARGET.entityId}\n`);

	const result = await runRemedyDuplicateRights(cfg, dryRun, TARGET, fetch, authorizedBy);
	console.log(`outcome=${result.outcome}`);
	console.log(`Ledger: ${result.ledgerPath}`);
}

const isMainModule = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
	main().catch((err) => {
		console.error('remedy-445-duplicate-rights-values-crede ABORTED:', err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}

// (*MVOX:Perotin*)
