// mvox-app#445 — REMEDY. Mihkel, verbatim via team-lead/Gama: "go for
// cleanup" (11:16Z). Cleanup ONLY — the resume of the remaining rsvps is
// NOT covered by this authorization and waits for a separate word.
//
// One entity, `6a9c3d37ca67df980f417292` (rsvp), diagnosed read-only
// immediately before this script: it holds TWO values each for `_sharing`
// and `_inheritrights` — one pair from the first live run
// (created.at ≈2026-09-22T10:42:53Z), one pair from the resume run
// (created.at ≈2026-09-22T11:11:29Z). Both pairs read identically
// (`domain` / `true`); this remedy keeps the OLDER pair and deletes the
// newer, matching the same "one value per rights-type property" shape
// every other row on this job already holds.
//
// SAFETY: step 1 reads the entity fresh and asserts its `_sharing`/
// `_inheritrights` value ids are EXACTLY the two known pairs — nothing
// more, nothing less, nothing renamed. Any other observed state aborts
// before any write (a fresh surprise gets reported, not guessed at).
//
// Run (dry-run first, always):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/remedy-445-duplicate-rights-values-crede-2026-09-22.ts        # DRY_RUN=true default
//   DRY_RUN=false AUTHORIZED_BY='...' node --import tsx \
//     --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/remedy-445-duplicate-rights-values-crede-2026-09-22.ts        # ONLY after dry-run verified + authorization

import { pathToFileURL } from 'node:url';
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { loadCredeCfg, readDryRun, readAuthorizedBy } from '../lib/script-runner';
import { writeLedger, assertLiveRunAuthorized } from '../lib/ledger-writer';

export const ENTITY_ID = '6a9c3d37ca67df980f417292';
// 10:42:53Z pair (the first live run) — kept.
export const KEEP_SHARING_ID = '6ab25bad5685992c758ad3d3';
export const KEEP_INHERIT_ID = '6ab25bad5685992c758ad3d4';
// 11:11:29Z pair (the resume run) — deleted.
export const DELETE_SHARING_ID = '6ab262615685992c758ad3d7';
export const DELETE_INHERIT_ID = '6ab262615685992c758ad3d8';

const EXPECTED_SHARING_IDS = [KEEP_SHARING_ID, DELETE_SHARING_ID].sort();
const EXPECTED_INHERIT_IDS = [KEEP_INHERIT_ID, DELETE_INHERIT_ID].sort();

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

export async function runRemedy445(
	cfg: EntuCfg,
	dryRun: boolean,
	fetchImpl: typeof fetch = fetch,
	authorizedBy?: string,
	recheckDelayMs = 30_000,
	sleepFn: (ms: number) => Promise<void> = defaultSleep
): Promise<RemedyResult> {
	// mvox-app#417 — before any request leaves the script.
	assertLiveRunAuthorized(dryRun, authorizedBy);

	// ── Step 1 — read fresh, assert the exact known duplicate shape ──────────
	const res = await entuFetch(cfg.db, `entity/${ENTITY_ID}?props=_sharing,_inheritrights`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`runRemedy445: pre-write read failed: ${res.status}`);
	const body = (await res.json()) as {
		entity?: { _sharing?: Array<{ _id: string; string?: string }>; _inheritrights?: Array<{ _id: string; boolean?: boolean }> };
	};
	const observedSharingIds = (body.entity?._sharing ?? []).map((v) => v._id).sort();
	const observedInheritIds = (body.entity?._inheritrights ?? []).map((v) => v._id).sort();

	const matches =
		JSON.stringify(observedSharingIds) === JSON.stringify(EXPECTED_SHARING_IDS) &&
		JSON.stringify(observedInheritIds) === JSON.stringify(EXPECTED_INHERIT_IDS);

	if (!matches) {
		const ledgerPath = writeLedger({
			scriptName: 'remedy-445-duplicate-rights-values-crede',
			dryRun,
			db: cfg.db,
			sensitive: true,
			authorizedBy,
			committed: { allow: COMMITTED_ALLOW },
			payload: {
				dryRun,
				entityId: ENTITY_ID,
				outcome: 'aborted-state-mismatch',
				observedSharingIds,
				observedInheritIds,
				expectedSharingIds: EXPECTED_SHARING_IDS,
				expectedInheritIds: EXPECTED_INHERIT_IDS
			}
		});
		throw new Error(
			`runRemedy445: ${ENTITY_ID} does not hold exactly the expected duplicate value ids -- refusing to guess -- observed _sharing=${JSON.stringify(observedSharingIds)} _inheritrights=${JSON.stringify(observedInheritIds)}, expected _sharing=${JSON.stringify(EXPECTED_SHARING_IDS)} _inheritrights=${JSON.stringify(EXPECTED_INHERIT_IDS)} (ledger: ${ledgerPath})`
		);
	}

	if (dryRun) {
		const ledgerPath = writeLedger({
			scriptName: 'remedy-445-duplicate-rights-values-crede',
			dryRun,
			db: cfg.db,
			sensitive: true,
			authorizedBy,
			committed: { allow: COMMITTED_ALLOW },
			payload: {
				dryRun,
				entityId: ENTITY_ID,
				outcome: 'dry-run',
				observedSharingIds,
				observedInheritIds,
				deletedIds: dryRun ? [] : [DELETE_SHARING_ID, DELETE_INHERIT_ID]
			}
		});
		return { outcome: 'dry-run', ledgerPath };
	}

	// ── Step 2 — delete the newer (11:11:29Z) pair only ───────────────────────
	const delSharing = await entuFetch(cfg.db, `property/${DELETE_SHARING_ID}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	if (!delSharing.ok) throw new Error(`runRemedy445: DELETE property/${DELETE_SHARING_ID} failed: ${delSharing.status}`);
	const delInherit = await entuFetch(cfg.db, `property/${DELETE_INHERIT_ID}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	if (!delInherit.ok) throw new Error(`runRemedy445: DELETE property/${DELETE_INHERIT_ID} failed: ${delInherit.status}`);

	// ── Step 3 — read back: exactly one value per property, the KEPT ids ─────
	const readRes = await entuFetch(cfg.db, `entity/${ENTITY_ID}?props=_sharing,_inheritrights`, cfg.token, {}, fetchImpl);
	const readBody = (await safeJson(readRes)) as {
		entity?: { _sharing?: Array<{ _id: string; string?: string }>; _inheritrights?: Array<{ _id: string; boolean?: boolean }> };
	} | null;
	const sharingVals = readBody?.entity?._sharing ?? [];
	const inheritVals = readBody?.entity?._inheritrights ?? [];
	const readbackOk =
		readRes.ok &&
		sharingVals.length === 1 &&
		sharingVals[0]?._id === KEEP_SHARING_ID &&
		sharingVals[0]?.string === 'domain' &&
		inheritVals.length === 1 &&
		inheritVals[0]?._id === KEEP_INHERIT_ID &&
		inheritVals[0]?.boolean === true;

	if (!readbackOk) {
		const ledgerPath = writeLedger({
			scriptName: 'remedy-445-duplicate-rights-values-crede',
			dryRun,
			db: cfg.db,
			sensitive: true,
			authorizedBy,
			committed: { allow: COMMITTED_ALLOW },
			payload: {
				dryRun,
				entityId: ENTITY_ID,
				outcome: 'aborted-readback-mismatch',
				deletedIds: [DELETE_SHARING_ID, DELETE_INHERIT_ID],
				readback: { status: readRes.status, body: readBody }
			}
		});
		throw new Error(`runRemedy445: read-back after delete did not show exactly the kept pair (ledger: ${ledgerPath})`);
	}

	// ── Step 4 — delayed recheck, dated ───────────────────────────────────────
	await sleepFn(recheckDelayMs);
	const recheckRes = await entuFetch(cfg.db, `entity/${ENTITY_ID}?props=_sharing,_inheritrights`, cfg.token, {}, fetchImpl);
	const recheckBody = (await safeJson(recheckRes)) as {
		entity?: { _sharing?: Array<{ _id: string; string?: string }>; _inheritrights?: Array<{ _id: string; boolean?: boolean }> };
	} | null;
	const recheckSharing = recheckBody?.entity?._sharing ?? [];
	const recheckInherit = recheckBody?.entity?._inheritrights ?? [];
	const stillCorrect =
		recheckSharing.length === 1 &&
		recheckSharing[0]?._id === KEEP_SHARING_ID &&
		recheckSharing[0]?.string === 'domain' &&
		recheckInherit.length === 1 &&
		recheckInherit[0]?._id === KEEP_INHERIT_ID &&
		recheckInherit[0]?.boolean === true;
	const postRunRecheck = { status: recheckRes.status, _sharing: recheckSharing, _inheritrights: recheckInherit, stillCorrect };

	const ledgerPath = writeLedger({
		scriptName: 'remedy-445-duplicate-rights-values-crede',
		dryRun,
		db: cfg.db,
		sensitive: true,
		authorizedBy,
		committed: { allow: COMMITTED_ALLOW },
		payload: {
			dryRun,
			entityId: ENTITY_ID,
			outcome: 'cleaned',
			deletedIds: [DELETE_SHARING_ID, DELETE_INHERIT_ID],
			readback: { status: readRes.status, body: readBody },
			postRunRecheck
		}
	});

	return { outcome: 'cleaned', ledgerPath };
}

async function main(): Promise<void> {
	const dryRun = readDryRun();
	const authorizedBy = readAuthorizedBy();
	const cfg = await loadCredeCfg();
	console.log(`Mode: ${dryRun ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}, entity=${ENTITY_ID}\n`);

	const result = await runRemedy445(cfg, dryRun, fetch, authorizedBy);
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
