// TD.4 (#120) — Entity-level _sharing widen: private → domain
// Scope: library (1), event (21 of 22), event_series (2), member (1 active) = 25 total instances.
// The 1 public event ("Test rehearsal", 6a7a164e23dc1d97bb8f18a1) is kept as-is.
// The 108 private members with no status property are correctly private (legacy/incomplete rows).
//
// Disposition (no-action types):
//   organizations: all 6 already _sharing:domain — no change needed.
//   invitations: 1 exists, already _sharing:domain — correct DB truth, no change needed.
//
// This fixes gate 3 (instance visibility) only. Gate 2 (type) is verified
// live before any writes — all 4 types already pass (library=domain,
// event=public, event_series=public, member=domain). Gate 1 (propdef) is a
// separate concern (TD.2 #118) — this script does not touch propdefs.
//
// This is an entity-level _sharing change (atomic replace of the instance's
// own _sharing value), NOT a propdef widen. The T6.2 re-aggregation lesson
// does not apply here: we are changing the actual instance _sharing value,
// not a propdef that needs propagation. Each POST is a genuine value change
// (private→domain), not a touch-save.
//
// Authorization: polyphony db is dev/test with synthetic data — routine
// mutations pre-authorized. Live execution still requires explicit
// team-lead + PO authorization per standing §8.6 discipline.
//
// DRY_RUN=true by default. Set DRY_RUN=false ONLY after dry-run is verified
// and team-lead + PO have authorized.
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/tidy-td4-entity-visibility.ts                    # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/tidy-td4-entity-visibility.ts                    # ONLY after authorization

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from './lib/creds';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

// ── Known type entity IDs (from prior migrations + live verification) ──────

const TYPE_IDS: Record<string, string> = {
	library: '6a0d2e8090c8df7a1cc7dd9d',
	event: '69c7ea548489bfcb0e81a0a2',
	event_series: '6a0d2e8490c8df7a1cc7deb1',
	member: '69c7ea4a8489bfcb0e819edd'
};

// Member-specific filtering: only active members that are private are anomalous.
// The 108 private members with no status property are legacy/incomplete rows,
// correctly private. Only status=active + _sharing=private is a real visibility bug.
const MEMBER_ACTIVE_ONLY = true;

const DB_ROOT_PERSON_ID = '69bcfd8e9c031ab8e6ce8079';

// ── Types ──────────────────────────────────────────────────────────────────

interface WidenTarget {
	type: string;
	id: string;
	name: string;
	sharingValueId: string;
	currentSharing: string;
}

interface LedgerEntry {
	action: string;
	type: string;
	id: string;
	name: string;
	status: 'widened' | 'skipped' | 'failed' | 'dry-run';
	before: string;
	after?: string;
	newPropId?: string;
	error?: string;
}

interface TypeGateResult {
	type: string;
	typeId: string;
	sharing: string;
	passesGate2: boolean;
}

const ledger: LedgerEntry[] = [];

// ── Result artifact ────────────────────────────────────────────────────────

function writeLedger(payload: Record<string, unknown>): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'ledgers');
	const filename = `tidy-td4-entity-visibility-${DRY_RUN ? 'dry' : 'live'}-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

// ── Gate 2 verification (TYPE entity _sharing) ────────────────────────────

async function verifyGate2(cfg: EntuCfg): Promise<TypeGateResult[]> {
	const results: TypeGateResult[] = [];
	for (const [typeName, typeId] of Object.entries(TYPE_IDS)) {
		const res = await entuFetch(cfg.db, `entity/${typeId}?props=name,_sharing`, cfg.token);
		if (!res.ok) throw new Error(`verifyGate2: GET ${typeId} (${typeName}) failed: ${res.status}`);
		const body = (await res.json()) as {
			entity?: { name?: Array<{ string: string }>; _sharing?: Array<{ string: string }> };
		};
		const liveName = body.entity?.name?.[0]?.string;
		if (liveName !== typeName) {
			throw new Error(
				`verifyGate2: ${typeId} has name=${JSON.stringify(liveName)}, expected ${JSON.stringify(typeName)} — wrong id`
			);
		}
		const sharing = body.entity?._sharing?.[0]?.string ?? '(absent)';
		results.push({
			type: typeName,
			typeId,
			sharing,
			passesGate2: sharing === 'domain' || sharing === 'public'
		});
	}
	return results;
}

// ── Discover instance targets (live query) ─────────────────────────────────

async function discoverTargets(cfg: EntuCfg): Promise<{
	targets: WidenTarget[];
	skipped: Array<{ type: string; id: string; name: string; sharing: string; reason: string }>;
	populationByType: Record<string, { total: number; private: number; nonPrivate: number }>;
}> {
	const targets: WidenTarget[] = [];
	const skipped: Array<{ type: string; id: string; name: string; sharing: string; reason: string }> = [];
	const populationByType: Record<string, { total: number; private: number; nonPrivate: number }> = {};

	for (const [typeName, typeId] of Object.entries(TYPE_IDS)) {
		// Request status prop for member type to distinguish active from legacy rows
		const propsParam = typeName === 'member' ? 'name,_sharing,_owner,status' : 'name,_sharing,_owner';
		const res = await entuFetch(
			cfg.db,
			`entity?_type.reference=${typeId}&props=${propsParam}&limit=500`,
			cfg.token
		);
		if (!res.ok) throw new Error(`discoverTargets(${typeName}): query failed: ${res.status}`);
		const body = (await res.json()) as {
			count: number;
			entities: Array<{
				_id: string;
				name?: Array<{ string: string }>;
				_sharing?: Array<{ _id: string; string: string }>;
				_owner?: Array<{ reference: string }>;
				status?: Array<{ string: string }>;
			}>;
		};

		if (body.count !== body.entities.length) {
			throw new Error(
				`discoverTargets(${typeName}): census truncated — count=${body.count} entities=${body.entities.length}. Raise limit.`
			);
		}

		let privateCount = 0;
		let nonPrivateCount = 0;

		for (const e of body.entities) {
			const sharing = e._sharing?.[0];
			const name = e.name?.[0]?.string ?? '(unnamed)';
			const currentSharing = sharing?.string ?? '(absent)';

			if (currentSharing === 'private' || currentSharing === '(absent)') {
				privateCount++;

				// Member-specific: only active members are anomalous. Private members
				// with no status property are legacy/incomplete rows, correctly private.
				if (typeName === 'member' && MEMBER_ACTIVE_ONLY) {
					const memberStatus = e.status?.[0]?.string;
					if (memberStatus !== 'active') {
						skipped.push({
							type: typeName,
							id: e._id,
							name,
							sharing: currentSharing,
							reason: `member without status=active (status=${memberStatus ?? '(absent)'}) — correctly private`
						});
						continue;
					}
				}

				if (!sharing?._id) {
					skipped.push({
						type: typeName,
						id: e._id,
						name,
						sharing: currentSharing,
						reason: 'no explicit _sharing value — cannot atomic-replace'
					});
					continue;
				}

				// Ownership pre-check: all instances should be db-root-owned.
				const owners = (e._owner ?? []).map((o) => o.reference);
				if (!owners.includes(DB_ROOT_PERSON_ID)) {
					skipped.push({
						type: typeName,
						id: e._id,
						name,
						sharing: currentSharing,
						reason: `not db-root-owned (owners: ${JSON.stringify(owners)})`
					});
					continue;
				}

				targets.push({
					type: typeName,
					id: e._id,
					name,
					sharingValueId: sharing._id,
					currentSharing
				});
			} else {
				nonPrivateCount++;
				skipped.push({
					type: typeName,
					id: e._id,
					name,
					sharing: currentSharing,
					reason: `already ${currentSharing} — no change needed`
				});
			}
		}

		populationByType[typeName] = {
			total: body.count,
			private: privateCount,
			nonPrivate: nonPrivateCount
		};
	}

	return { targets, skipped, populationByType };
}

// ── Widen a single instance's _sharing from private to domain ──────────────

async function widenInstance(cfg: EntuCfg, target: WidenTarget): Promise<LedgerEntry> {
	try {
		const res = await entuFetch(cfg.db, `entity/${target.id}`, cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ _id: target.sharingValueId, type: '_sharing', string: 'domain' }])
		});
		if (!res.ok) {
			return {
				action: 'instance-widen', type: target.type, id: target.id, name: target.name,
				status: 'failed', before: target.currentSharing,
				error: `POST failed: ${res.status}`
			};
		}

		const body = (await res.json()) as { properties?: Array<{ _id: string; type: string }> };
		const newSharingProp = (body.properties ?? []).find((p) => p.type === '_sharing');
		if (!newSharingProp?._id) {
			return {
				action: 'instance-widen', type: target.type, id: target.id, name: target.name,
				status: 'failed', before: target.currentSharing,
				error: 'POST returned 2xx but no _sharing property in response (apparent-success trap)'
			};
		}
		if (newSharingProp._id === target.sharingValueId) {
			return {
				action: 'instance-widen', type: target.type, id: target.id, name: target.name,
				status: 'failed', before: target.currentSharing,
				error: `POST returned the SAME property _id (${target.sharingValueId}) — replace did not rotate`
			};
		}

		// Read-back verify.
		const getRes = await entuFetch(cfg.db, `entity/${target.id}?props=_sharing`, cfg.token);
		if (!getRes.ok) {
			return {
				action: 'instance-widen', type: target.type, id: target.id, name: target.name,
				status: 'failed', before: target.currentSharing,
				error: `read-back GET failed: ${getRes.status}`
			};
		}
		const getBody = (await getRes.json()) as { entity?: { _sharing?: Array<{ string: string }> } };
		const sharingValues = getBody.entity?._sharing ?? [];
		if (sharingValues.length !== 1) {
			return {
				action: 'instance-widen', type: target.type, id: target.id, name: target.name,
				status: 'failed', before: target.currentSharing,
				error: `read-back shows ${sharingValues.length} _sharing values (expected exactly 1) — atomic replace did not cleanly soft-delete the old value`
			};
		}
		if (sharingValues[0].string !== 'domain') {
			return {
				action: 'instance-widen', type: target.type, id: target.id, name: target.name,
				status: 'failed', before: target.currentSharing,
				error: `read-back shows _sharing=${JSON.stringify(sharingValues[0].string)}, expected 'domain'`
			};
		}

		return {
			action: 'instance-widen', type: target.type, id: target.id, name: target.name,
			status: 'widened', before: target.currentSharing, after: 'domain',
			newPropId: newSharingProp._id
		};
	} catch (err) {
		return {
			action: 'instance-widen', type: target.type, id: target.id, name: target.name,
			status: 'failed', before: target.currentSharing,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

// ── Canary pass: one instance per type, verified before full sweep ──────────

async function widenCanaries(
	cfg: EntuCfg,
	targets: WidenTarget[]
): Promise<{ canaryEntries: LedgerEntry[]; remainingTargets: WidenTarget[] }> {
	const canaryByType = new Map<string, WidenTarget>();
	for (const t of targets) {
		if (!canaryByType.has(t.type)) canaryByType.set(t.type, t);
	}
	const canaries = [...canaryByType.values()];
	const canaryEntries: LedgerEntry[] = [];

	for (const c of canaries) {
		const entry = await widenInstance(cfg, c);
		if (entry.status !== 'widened') {
			throw new Error(
				`widenCanaries: canary ${c.type}/${c.id} ("${c.name}") FAILED — ${entry.error}. ` +
				`Refuse to run the full sweep on an unproven mechanic for type '${c.type}'.`
			);
		}
		canaryEntries.push(entry);
		console.log(`  CANARY PASSED: ${c.type} "${c.name}" (${c.id}) — private → domain`);
	}

	const canaryIds = new Set(canaries.map((c) => c.id));
	const remainingTargets = targets.filter((t) => !canaryIds.has(t.id));
	return { canaryEntries, remainingTargets };
}

// ── Dry-run plan render ────────────────────────────────────────────────────

function renderPlan(
	gate2: TypeGateResult[],
	targets: WidenTarget[],
	skipped: Array<{ type: string; id: string; name: string; sharing: string; reason: string }>,
	populationByType: Record<string, { total: number; private: number; nonPrivate: number }>
): string {
	const lines: string[] = [];
	lines.push('TD.4 (#120) — Entity-level _sharing widen DRY-RUN plan (NO writes issued)');
	lines.push('');

	lines.push('── Gate 2 verification (TYPE entities\' own _sharing)');
	for (const g of gate2) {
		const verdict = g.passesGate2
			? 'PASSES (domain/public)'
			: 'FAILS — would cap domain-bucket exposure regardless of gate 3 fix';
		lines.push(`   ${g.type} TYPE (${g.typeId}): _sharing='${g.sharing}' — ${verdict}`);
	}
	const allGate2Pass = gate2.every((g) => g.passesGate2);
	lines.push(
		`   Overall: ${allGate2Pass ? `all ${gate2.length} types PASS gate 2 — safe to proceed` : 'ONE OR MORE TYPES FAIL gate 2 — HALT'}`
	);
	lines.push('');

	lines.push('── Population by type');
	for (const [typeName, pop] of Object.entries(populationByType)) {
		lines.push(`   ${typeName}: ${pop.total} total (${pop.private} private, ${pop.nonPrivate} non-private)`);
	}
	lines.push('');

	lines.push(`── ${targets.length} instances: WOULD REPLACE _sharing private → domain`);
	const byType: Record<string, WidenTarget[]> = {};
	for (const t of targets) {
		(byType[t.type] ??= []).push(t);
	}
	for (const [typeName, typeTargets] of Object.entries(byType)) {
		lines.push(`   ${typeName} (${typeTargets.length}):`);
		for (const t of typeTargets) {
			lines.push(`     ${t.id} "${t.name}" — ${t.currentSharing} → domain`);
		}
	}
	lines.push('');

	const nonTrivialSkips = skipped.filter((s) => !s.reason.startsWith('already '));
	if (nonTrivialSkips.length > 0) {
		lines.push(`── ${nonTrivialSkips.length} instance(s) SKIPPED (not widened):`);
		for (const s of nonTrivialSkips) {
			lines.push(`   ${s.type} ${s.id} "${s.name}" — ${s.reason}`);
		}
		lines.push('');
	}

	const alreadyOk = skipped.filter((s) => s.reason.startsWith('already '));
	if (alreadyOk.length > 0) {
		lines.push(`── ${alreadyOk.length} instance(s) already non-private (no change needed):`);
		for (const s of alreadyOk) {
			lines.push(`   ${s.type} ${s.id} "${s.name}" — ${s.sharing}`);
		}
		lines.push('');
	}

	lines.push('── Execution plan');
	lines.push(`   CANARY: one instance per type (${Object.keys(byType).length} total), widened + read-back verified before full sweep.`);
	lines.push(`   SWEEP: remaining ${targets.length - Object.keys(byType).length} instances, same atomic replace + read-back verify.`);
	lines.push(`   Total writes planned: ${targets.length}`);
	lines.push('');

	lines.push('── Disposition: types with NO ACTION needed');
	lines.push('   organization: all 6 already _sharing:domain — no change needed.');
	lines.push('     Eesti Kammerkooride Liit (69c7f8718489bfcb0e81b05a) — domain');
	lines.push('     Eesti Filharmoonia Kammerkoor (69c7f8718489bfcb0e81b065) — domain');
	lines.push('     Kammernaiskoor Sireen (69c7f8788489bfcb0e81b1a9) — domain');
	lines.push('     Eesti Meeskooride Liit (69c7f87d8489bfcb0e81b2d9) — domain');
	lines.push('     Eesti Rahvusmeeskoor (69c7f87d8489bfcb0e81b2e4) — domain');
	lines.push('     Tartu Akadeemiline Meeskoor (69c7f8868489bfcb0e81b4f0) — domain');
	lines.push('   invitation: 1 entity exists (6a2fd5614cd971291c5d5e67), already _sharing:domain — correct DB truth, no change needed.');
	lines.push('');

	lines.push('── Member filtering note');
	lines.push('   member type has 241 total instances. Only status=active + _sharing=private is an anomaly.');
	lines.push('   108 private members with no status property are legacy/incomplete rows — correctly private.');
	lines.push('   132 active members are already _sharing:domain — correctly visible.');
	lines.push('');

	lines.push('── Privacy notes');
	lines.push('   Only ENTITY tier (gate 3) moves. Prop-def tiers (gate 1) are a separate concern (TD.2 #118).');
	lines.push('   No prop-def re-aggregation needed — this is a genuine instance _sharing value change, not a prop-def widen.');
	lines.push('');

	lines.push(`Totals: ${targets.length} instance replace-writes planned. Writes issued this run: 0.`);
	return lines.join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'}\n`);

	// Step 1: Gate 2 verification.
	console.log('=== Gate 2 verification ===');
	const gate2 = await verifyGate2(cfg);
	for (const g of gate2) {
		console.log(`  ${g.type} TYPE (${g.typeId}): _sharing='${g.sharing}' — ${g.passesGate2 ? 'PASSES' : 'FAILS'}`);
	}

	const gate2Failures = gate2.filter((g) => !g.passesGate2);
	if (gate2Failures.length > 0 && !DRY_RUN) {
		console.error(
			`ABORT: ${gate2Failures.length} type(s) fail gate 2 — widening instances would not make them ` +
			`member-visible: ${JSON.stringify(gate2Failures)}`
		);
		writeLedger({ dryRun: false, halted: 'gate2-failed', gate2Failures, exitCode: 1 });
		process.exit(1);
	}

	// Step 2: Discover targets from live data.
	console.log('\n=== Instance discovery ===');
	const { targets, skipped, populationByType } = await discoverTargets(cfg);
	// Show actual target count per type (not raw private count, which differs for member)
	const targetCountByType: Record<string, number> = {};
	for (const t of targets) targetCountByType[t.type] = (targetCountByType[t.type] ?? 0) + 1;
	console.log(`  Targets: ${targets.length} (${Object.entries(targetCountByType).map(([t, c]) => `${t}=${c}`).join(', ')})`);
	console.log(`  Skipped: ${skipped.length} (already non-private or ineligible)`);

	if (targets.length === 0) {
		console.log('\n  No targets to widen — all instances are already non-private.');
		writeLedger({ dryRun: DRY_RUN, gate2, populationByType, targets: 0, skipped: skipped.length, exitCode: 0 });
		process.exit(0);
	}

	// Step 3: Dry-run plan or live execution.
	if (DRY_RUN) {
		const plan = renderPlan(gate2, targets, skipped, populationByType);
		console.log(`\n${plan}`);
		console.log(
			'\nDRY_RUN=true — no writes issued. Set DRY_RUN=false to execute ONLY after ' +
			'team-lead + PO authorization (per standing §8.6 discipline).'
		);
		const artifactPath = writeLedger({
			dryRun: true,
			gate2,
			populationByType,
			targetCount: targets.length,
			targets: targets.map((t) => ({
				type: t.type,
				id: t.id,
				name: t.name,
				sharingValueId: t.sharingValueId,
				currentSharing: t.currentSharing,
				plannedSharing: 'domain'
			})),
			skipped,
			writesIssued: 0,
			exitCode: 0
		});
		console.log(`Dry-run artifact: ${artifactPath}`);
		process.exit(0);
	}

	// Live execution: canary pass, then full sweep.
	console.log('\n=== Canary pass ===');
	const { canaryEntries, remainingTargets } = await widenCanaries(cfg, targets);
	ledger.push(...canaryEntries);
	console.log(`  ${canaryEntries.length} canaries passed.\n`);

	console.log(`=== Full sweep: ${remainingTargets.length} remaining instances ===`);
	for (const t of remainingTargets) {
		const entry = await widenInstance(cfg, t);
		ledger.push(entry);
		if (entry.status === 'widened') {
			console.log(`  WIDENED: ${t.type} "${t.name}" (${t.id})`);
		} else {
			console.error(`  FAILED: ${t.type} "${t.name}" (${t.id}) — ${entry.error}`);
		}
	}

	// Summary.
	const failures = ledger.filter((e) => e.status === 'failed');
	const widened = ledger.filter((e) => e.status === 'widened');

	console.log('\n=== SUMMARY ===');
	console.log(`DRY_RUN: ${DRY_RUN}`);
	console.log(`Widened: ${widened.length}/${targets.length}`);
	console.log(`Failed:  ${failures.length}`);
	for (const f of failures) {
		console.error(`  FAILED: ${f.type}/${f.id} ("${f.name}") — ${f.error}`);
	}

	const hasFailures = failures.length > 0;
	const artifactPath = writeLedger({
		dryRun: false,
		authorization: 'Polyphony db is dev/test with synthetic data — routine mutations pre-authorized. Per-run team-lead + PO authorization obtained.',
		gate2,
		populationByType,
		targetCount: targets.length,
		widenedCount: widened.length,
		failedCount: failures.length,
		ledger,
		exitCode: hasFailures ? 1 : 0,
		verificationCaveat:
			'Run under ENTU_API_KEY (PO/db-root), which always reads the private bucket regardless of tier. ' +
			'"widened" here means the write landed, the read-back confirms _sharing=\'domain\', and the property ' +
			'_id rotated (fresh aggregation) — NOT an empirically-confirmed non-owner domain read. That last-mile ' +
			'confirmation requires a member-seat test.'
	});
	console.log(`Result artifact: ${artifactPath}`);
	process.exit(hasFailures ? 1 : 0);
}

main().catch((err) => {
	console.error('TD.4 tidy-entity-visibility ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Palestrina*)
