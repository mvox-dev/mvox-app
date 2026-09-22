// mvox-app#445 — REMEDY. Mihkel, verbatim via team-lead/Gama, comment
// 5775480675: "go for cleanup" then "resume on 38", in that order —
// covers cleanup of every row this shape turns up on, not only the first.
//
// GENERALISED (2nd round): `runRemedyDuplicateRights(cfg, dryRun,
// target, ...)` takes the entity id and both value pairs as an explicit
// `target` parameter — nothing about a specific row is hardcoded in the
// engine. `main()` below still targets ONE row per invocation (edit
// `TARGET` and re-run for the next one) — see its own comment for the
// current target and the diagnosis it's based on.
//
// SHAPE this remedies (seen twice: 6a9c3d37...292, 6a9c3d38...729b): an
// entity holds TWO values each for `_sharing` and `_inheritrights` — an
// OLDER pair from the first live run, and a NEWER pair from a later
// resume run whose own POST/read-back never saw the older pair (every
// read from the first run's write until the resume's own write showed it
// absent). Both pairs read identically (`domain` / `true`); this remedy
// keeps the OLDER pair and deletes the newer, matching the "one value per
// rights-type property" shape every other row on this job already holds.
//
// SAFETY: step 1 reads the entity fresh and asserts its `_sharing`/
// `_inheritrights` value ids are EXACTLY the four ids `target` names —
// the two to keep AND the two to delete, nothing more, nothing less,
// nothing renamed. Any other observed state aborts before any write.
//
// Run (dry-run first, always):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/remedy-445-duplicate-rights-values-crede-2026-09-22.ts        # DRY_RUN=true default, targets TARGET below
//   DRY_RUN=false AUTHORIZED_BY='...' node --import tsx \
//     --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/remedy-445-duplicate-rights-values-crede-2026-09-22.ts        # ONLY after dry-run verified + authorization

import { pathToFileURL } from 'node:url';
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { loadCredeCfg, readDryRun, readAuthorizedBy } from '../lib/script-runner';
import { writeLedger, assertLiveRunAuthorized } from '../lib/ledger-writer';

export interface RemedyTarget {
	entityId: string;
	keepSharingId: string;
	deleteSharingId: string;
	keepInheritId: string;
	deleteInheritId: string;
}

// Read-only diagnosis (2026-09-22 11:2xZ), evidence relayed to team-lead:
// entity 6a9c3d38ca67df980f41729b holds a 10:42:54Z pair (first live run)
// and an 11:27:1xZ pair (the aborted resume). Edit this constant and
// re-run for the NEXT row this shape turns up on.
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
	// 'string' is deliberately absent — writeLedger's own blanket rule
	// excludes it from every committed.allow regardless of content (rights-
	// tier text, not PII, but the writer refuses the combination outright;
	// see seed-445-person-rsvp-domain-inherit-crede.ts's identical note).
	// The tier VALUE ('domain') is stripped from the committed twin; the
	// value's _id, and 'cleaned'/'aborted-*' outcome, are what the audit
	// trail needs. Full detail survives in the gitignored instance ledger.
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
