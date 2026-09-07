// Seed migration: assign conductor on at least one season and its events.
// Authorization: Polyphony db is dev/test with synthetic data — routine
// mutations pre-authorized. No schema change (conductor prop-defs already
// exist from attendance-propdefs-rsvp-widen-2026-08-10.ts).
//
// Context (#84 review Finding 2): no conductor property value exists on any
// season or event entity on live polyphony. This means computeConductorEventIds
// returns an empty Set for every person, isConductor resolves 'not-conductor'
// for everyone, and the Take Attendance button never renders. Without at least
// one conductor assignment, the entire TA.3 surface is unreachable and unprobed.
//
// This migration:
//   1. Reads the authenticated user's person ID (from JWT).
//   2. Finds the first season entity.
//   3. Sets conductor=personId on that season.
//   4. Finds all event entities whose _parent is that season.
//   5. Sets conductor=personId on each event.
//   6. Verifies read-back.
//
// After running, the TA.3 panel will be reachable for the conductor, and a
// live smoke-create of an attendance entity can be performed.
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-conductor-on-season-event-2026-08-10.ts       # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-conductor-on-season-event-2026-08-10.ts       # ONLY after dry-run verified

import { join } from 'node:path';
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from './lib/creds';
import { readDryRun } from './lib/script-runner';
import { writeLedger as writeLedgerShared } from './lib/ledger-writer';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const DRY_RUN = readDryRun();

interface LedgerEntry {
	action: string;
	target: string;
	targetId: string;
	personId: string;
	status: 'set' | 'already-has-conductor' | 'failed' | 'dry-run';
	error?: string;
}

const ledger: LedgerEntry[] = [];

// mvox-app#274 — writeLedger now goes through the shared, redaction-aware
// writer, landing in seed-results/ instead of the retired ledgers/ dir;
// `sensitive: false` (polyphony is synthetic, and this ledger carries only
// ids/status/sharing metadata regardless).
function writeLedger(payload: Record<string, unknown>): string {
	return writeLedgerShared({ scriptName: 'seed-conductor-on-season-event-2026-08-10', dryRun: DRY_RUN, db: process.env.ENTU_DATABASE ?? 'polyphony', sensitive: false, payload });
}

/** Resolve the authenticated user's person ID from their JWT. */
async function resolvePersonId(cfg: EntuCfg): Promise<string> {
	const res = await entuFetch(cfg.db, 'auth', cfg.token);
	if (!res.ok) throw new Error(`auth check failed: ${res.status}`);
	const body = (await res.json()) as {
		accounts?: Array<{ _id: string }>;
	};
	const personId = body.accounts?.[0]?._id;
	if (!personId) throw new Error('No authenticated person found (empty accounts)');
	return personId;
}

/** Find season entities. */
async function listSeasons(cfg: EntuCfg): Promise<Array<{ _id: string; name: string; conductors: string[] }>> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=season&props=name,conductor&limit=50',
		cfg.token
	);
	if (!res.ok) throw new Error(`listSeasons failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{
			_id: string;
			name?: Array<{ string: string }>;
			conductor?: Array<{ reference: string }>;
		}>;
	};
	return (body.entities ?? []).map((e) => ({
		_id: e._id,
		name: e.name?.[0]?.string ?? '(unnamed)',
		conductors: (e.conductor ?? []).map((c) => c.reference)
	}));
}

/** Find event entities under a specific season. */
async function listEventsForSeason(cfg: EntuCfg, seasonId: string): Promise<Array<{ _id: string; name: string; conductors: string[] }>> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=event&_parent.reference=${encodeURIComponent(seasonId)}&props=name,conductor&limit=200`,
		cfg.token
	);
	if (!res.ok) throw new Error(`listEventsForSeason failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{
			_id: string;
			name?: Array<{ string: string }>;
			conductor?: Array<{ reference: string }>;
		}>;
	};
	return (body.entities ?? []).map((e) => ({
		_id: e._id,
		name: e.name?.[0]?.string ?? '(unnamed)',
		conductors: (e.conductor ?? []).map((c) => c.reference)
	}));
}

/** Set conductor on an entity. */
async function setConductor(cfg: EntuCfg, entityId: string, personId: string): Promise<void> {
	const writeBody = [{ type: 'conductor', reference: personId }];
	const res = await entuFetch(cfg.db, `entity/${entityId}`, cfg.token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(writeBody)
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`POST conductor failed: ${res.status} -- ${text}`);
	}
}

/** Verify conductor read-back. */
async function verifyConductor(cfg: EntuCfg, entityId: string, expectedPersonId: string): Promise<void> {
	const res = await entuFetch(cfg.db, `entity/${entityId}?props=conductor`, cfg.token);
	if (!res.ok) throw new Error(`verify GET ${entityId} failed: ${res.status}`);
	const body = (await res.json()) as {
		entity?: { conductor?: Array<{ reference: string }> };
	};
	const conductors = (body.entity?.conductor ?? []).map((c) => c.reference);
	if (!conductors.includes(expectedPersonId)) {
		throw new Error(`verify FAILED: conductor references ${JSON.stringify(conductors)} do not include ${expectedPersonId}`);
	}
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'}\n`);

	// Step 1: resolve person ID
	const personId = await resolvePersonId(cfg);
	console.log(`Authenticated person: ${personId}`);

	// Step 2: find seasons
	const seasons = await listSeasons(cfg);
	console.log(`\nFound ${seasons.length} season(s):`);
	for (const s of seasons) {
		console.log(`  ${s._id} (${s.name}): conductors=${s.conductors.length > 0 ? s.conductors.join(', ') : '(none)'}`);
	}

	if (seasons.length === 0) {
		console.error('No seasons found — cannot seed conductor.');
		process.exit(1);
	}

	// Pick the first season without a conductor (or the first season if all have one).
	const targetSeason = seasons.find((s) => s.conductors.length === 0) ?? seasons[0];
	console.log(`\nTarget season: ${targetSeason._id} (${targetSeason.name})`);

	// Step 3: find events under the target season
	const events = await listEventsForSeason(cfg, targetSeason._id);
	console.log(`Found ${events.length} event(s) under season ${targetSeason._id}:`);
	for (const e of events) {
		console.log(`  ${e._id} (${e.name}): conductors=${e.conductors.length > 0 ? e.conductors.join(', ') : '(none)'}`);
	}

	// Build targets list
	const targets: Array<{ type: string; id: string; name: string; hasConductor: boolean }> = [];
	targets.push({
		type: 'season',
		id: targetSeason._id,
		name: targetSeason.name,
		hasConductor: targetSeason.conductors.length > 0
	});
	for (const e of events) {
		targets.push({
			type: 'event',
			id: e._id,
			name: e.name,
			hasConductor: e.conductors.length > 0
		});
	}

	const needsSeed = targets.filter((t) => !t.hasConductor);
	console.log(`\n${needsSeed.length} target(s) need conductor assignment.`);

	if (DRY_RUN) {
		for (const t of targets) {
			if (t.hasConductor) {
				ledger.push({ action: 'seed-conductor', target: `${t.type}.${t.name}`, targetId: t.id, personId, status: 'already-has-conductor' });
			} else {
				ledger.push({ action: 'seed-conductor', target: `${t.type}.${t.name}`, targetId: t.id, personId, status: 'dry-run' });
			}
		}
		console.log(`DRY_RUN: would set conductor=${personId} on ${needsSeed.length} entities.`);
	} else {
		for (const t of targets) {
			if (t.hasConductor) {
				console.log(`  SKIP: ${t.type} ${t.id} (${t.name}) already has conductor`);
				ledger.push({ action: 'seed-conductor', target: `${t.type}.${t.name}`, targetId: t.id, personId, status: 'already-has-conductor' });
				continue;
			}
			try {
				await setConductor(cfg, t.id, personId);
				await verifyConductor(cfg, t.id, personId);
				console.log(`  SET: ${t.type} ${t.id} (${t.name}) conductor=${personId}`);
				ledger.push({ action: 'seed-conductor', target: `${t.type}.${t.name}`, targetId: t.id, personId, status: 'set' });
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`  FAILED: ${t.type} ${t.id} (${t.name}): ${msg}`);
				ledger.push({ action: 'seed-conductor', target: `${t.type}.${t.name}`, targetId: t.id, personId, status: 'failed', error: msg });
			}
		}
	}

	const failures = ledger.filter((e) => e.status === 'failed');
	console.log('\n=== SUMMARY ===');
	console.log(`DRY_RUN: ${DRY_RUN}`);
	console.log(`Targets: ${targets.length}, Seeded: ${ledger.filter((e) => e.status === 'set').length}, Failures: ${failures.length}`);

	const hasFailures = failures.length > 0;
	const artifactPath = writeLedger({
		dryRun: DRY_RUN,
		description: 'Seed conductor on season + events for TA.3 reachability',
		personId,
		seasonId: targetSeason._id,
		ledger,
		exitCode: hasFailures ? 1 : 0
	});
	console.log(`Ledger: ${artifactPath}`);
	process.exit(hasFailures ? 1 : 0);
}

main().catch((err) => {
	console.error('seed-conductor ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Palestrina*)
