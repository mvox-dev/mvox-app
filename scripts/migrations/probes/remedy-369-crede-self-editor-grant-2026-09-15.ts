// mvox-app#369 — REMEDY. Mihkel's release, verbatim via team-lead: "add
// self-_editor to 19 members. granted." Grants `_editor` (self-reference) on
// each of the 19 person entities the #369 diagnosis found WITHOUT it — the
// exact wire shape `src/lib/invite/inviteData.ts:255-265` uses for a live
// invite acceptance, applied retroactively to the bulk-seeded population that
// never received it (seed-178, 2026-08-27/29).
//
// HARD TERMS, same discipline as the #369 diagnosis: READ-ONLY until DRY_RUN
// is explicitly false; rights documents + counts + ids only; `.string` is
// stripped at the point of extraction, before any print or ledger write —
// never resolved to a name (see `refs()` — same helper shape as probe-369).
//
// SAFETY CHECKS, per entity, BEFORE each write (team-lead's explicit terms —
// this is exactly the ER-6/ER-9 trap #369 documents):
//   1. Fresh read of ALL FIVE rights-type props at write time (not the sweep
//      snapshot — someone may have been fixed, or someone may have picked up
//      an unrelated direct grant, since the #369 sweep). If any DIRECT
//      (non-inherited) entry already references the person's OWN id on ANY
//      rights tier:
//        - if that tier is already `_editor` -> already-fixed, SKIP (no
//          write; a repeat grant would be a needless second write, not a
//          correctness issue, but idempotence means "do nothing" here).
//        - any OTHER tier (most concerning: `_owner` — a self-`_editor`
//          grant would SILENTLY RETIRE it, a downgrade) -> SKIP AND FLAG,
//          never write. ER-6/ER-9: a reference holds at most one active
//          direct tier per entity; a new one always retires the old one,
//          with no error and no notice — the exact failure mode this run
//          exists to avoid inflicting on someone by accident.
//   2. Only entities with genuinely NO direct self-tier at all get the grant.
//
// Run (dry-run first, always):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/remedy-369-crede-self-editor-grant-2026-09-15.ts
// Live:
//   DRY_RUN=false node --import tsx ... (same script)

import { entuFetch } from '$lib/entu/request';
import { loadCredeCfg, readDryRun, readAuthorizedBy } from '../lib/script-runner';
import { writeLedger, assertLiveRunAuthorized } from '../lib/ledger-writer';

// The 19 WITHOUT-self-editor person ids from the #369 population sweep
// (scripts/migrations/seed-results/crede-instance/probe-369-crede-self-editor-
// diagnosis-live-2026-09-15T11-29-47-636Z.json, step 'population-sweep',
// `withoutSelfEditorIds`) — frozen here as the target set for THIS run.
const TARGET_IDS = [
	'6a92a3f0ca67df980f415489',
	'6a92a3f1ca67df980f4154a3',
	'6a92a3f2ca67df980f4154bd',
	'6a92a3f3ca67df980f4154d7',
	'6a92a3f4ca67df980f4154f1',
	'6a92a3f4ca67df980f41550b',
	'6a92a3f5ca67df980f415525',
	'6a92a3f6ca67df980f41553f',
	'6a92a3f6ca67df980f415559',
	'6a92a3f7ca67df980f415573',
	'6a92a3f8ca67df980f41558d',
	'6a92a3f8ca67df980f4155a7',
	'6a92a3f9ca67df980f4155c1',
	'6a92a3faca67df980f4155db',
	'6a92a3faca67df980f4155f5',
	'6a92a3fbca67df980f41560f',
	'6a92a3fcca67df980f415629',
	'6a92a3fcca67df980f415643',
	'6a92a3feca67df980f415677'
];

const RIGHTS_TYPES = ['_owner', '_editor', '_viewer', '_expander', '_noaccess'] as const;

interface RawRef {
	reference?: string;
	inherited?: boolean;
}

function directSelfTier(entity: Record<string, RawRef[] | undefined>, personId: string): string | null {
	for (const tier of RIGHTS_TYPES) {
		const entries = entity[tier] ?? [];
		for (const e of entries) {
			if (e.reference === personId && !e.inherited) return tier;
		}
	}
	return null;
}

async function main(): Promise<void> {
	const dryRun = readDryRun();
	const authorizedBy = readAuthorizedBy();
	assertLiveRunAuthorized(dryRun, authorizedBy); // mvox-app#417 — before any mutating call
	const cfg = await loadCredeCfg();
	console.log(`db=${cfg.db}  DRY_RUN=${dryRun}  targets=${TARGET_IDS.length}\n`);

	const ledger: Record<string, unknown>[] = [];
	const plan: Array<{ personId: string; action: 'grant' | 'skip-already-fixed' | 'skip-different-tier'; existingTier: string | null }> = [];

	for (const personId of TARGET_IDS) {
		const res = await entuFetch(cfg.db, `entity/${personId}?props=_owner,_editor,_viewer,_expander,_noaccess`, cfg.token);
		if (!res.ok) throw new Error(`pre-write read failed for ${personId}: ${res.status}`);
		const body = (await res.json()) as { entity?: Record<string, RawRef[] | undefined> };
		const entity = body.entity ?? {};
		const existing = directSelfTier(entity, personId);

		if (existing === '_editor') {
			plan.push({ personId, action: 'skip-already-fixed', existingTier: existing });
		} else if (existing !== null) {
			plan.push({ personId, action: 'skip-different-tier', existingTier: existing });
		} else {
			plan.push({ personId, action: 'grant', existingTier: null });
		}
	}

	for (const p of plan) {
		const label = p.action === 'grant' ? 'GRANT self-_editor' : p.action === 'skip-already-fixed' ? 'SKIP (already has self-_editor)' : `SKIP+FLAG (already holds direct self-${p.existingTier} — a self-_editor grant would retire it)`;
		console.log(`${p.personId}: ${label}`);
	}

	const toGrant = plan.filter((p) => p.action === 'grant');
	const flagged = plan.filter((p) => p.action === 'skip-different-tier');
	const alreadyFixed = plan.filter((p) => p.action === 'skip-already-fixed');
	console.log(`\nPLAN: ${toGrant.length} to grant, ${alreadyFixed.length} already fixed, ${flagged.length} flagged (different direct self-tier, NOT touched)`);

	ledger.push({ step: 'pre-write-plan', dryRun, plan });

	const results: Array<{ personId: string; status: 'granted' | 'verify-mismatch' | 'skipped' }> = [];
	if (!dryRun) {
		for (const p of toGrant) {
			const grantRes = await entuFetch(cfg.db, `entity/${p.personId}`, cfg.token, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify([{ type: '_editor', reference: p.personId }])
			});
			if (!grantRes.ok) throw new Error(`grant failed for ${p.personId}: HTTP ${grantRes.status}`);

			// Independent read-back — never trust the write's own echo.
			const verifyRes = await entuFetch(cfg.db, `entity/${p.personId}?props=_editor`, cfg.token);
			const verifyBody = (await verifyRes.json()) as { entity?: { _editor?: RawRef[] } };
			const nowHasSelf = (verifyBody.entity?._editor ?? []).some((e) => e.reference === p.personId && !e.inherited);
			results.push({ personId: p.personId, status: nowHasSelf ? 'granted' : 'verify-mismatch' });
			console.log(`${p.personId}: ${nowHasSelf ? 'GRANTED, verified by read-back' : 'WRITE SUCCEEDED BUT READ-BACK DOES NOT SHOW IT — investigate before trusting'}`);
		}
	} else {
		console.log('\nDRY_RUN — no writes issued. Re-run with DRY_RUN=false to execute.');
	}

	ledger.push({ step: 'write-results', dryRun, results });

	// ── Post-verify population sweep (live mode only — dry-run has nothing to re-check) ──
	if (!dryRun) {
		const sweepRes = await entuFetch(cfg.db, `entity?_type.string=person&props=_editor&limit=200`, cfg.token);
		const sweepBody = (await sweepRes.json()) as { count: number; entities: Array<{ _id: string; _editor?: RawRef[] }> };
		let withSelf = 0;
		for (const p of sweepBody.entities) {
			if ((p._editor ?? []).some((e) => e.reference === p._id)) withSelf++;
		}
		console.log(`\nPOST-VERIFY POPULATION SWEEP: ${withSelf}/${sweepBody.count} with self-_editor (expected ${sweepBody.count - flagged.length}/${sweepBody.count} given ${flagged.length} flagged skip(s))`);
		ledger.push({ step: 'post-verify-sweep', total: sweepBody.count, withSelfEditorCount: withSelf, expectedGivenFlags: sweepBody.count - flagged.length });
	}

	writeLedger({
		scriptName: 'remedy-369-crede-self-editor-grant',
		dryRun,
		db: cfg.db,
		sensitive: true,
		authorizedBy,
		// mvox-app#402 — first caller wired to the committed-twin pattern
		// (ledger-writer.ts). Allowlisted by name, not by field-shape guess:
		// ids (personId), counts (total, withSelfEditorCount,
		// expectedGivenFlags), and outcomes (step, dryRun, plan, action,
		// existingTier, results, status) — the containers (`ledger`, `plan`,
		// `results`) must be named too, or their contents never reach the
		// twin. `purpose` (free text) is deliberately NOT allowlisted.
		committed: {
			allow: [
				'ledger',
				'step',
				'dryRun',
				'plan',
				'personId',
				'action',
				'existingTier',
				'results',
				'status',
				'total',
				'withSelfEditorCount',
				'expectedGivenFlags',
				'authorizedBy'
			]
		},
		payload: {
			purpose: 'mvox-app#369 remedy — grant self-_editor on the 19 WITHOUT-set persons, per Mihkel\'s release via team-lead. ids only, .string stripped.',
			ledger
		}
	});
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

// (*MVOX:Perotin*)
