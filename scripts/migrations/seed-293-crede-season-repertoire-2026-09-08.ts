// mvox-app#293 — Crede 2026/27 season repertoire: 5 works + editions,
// attached to the season (repertoire_item) and today's rehearsal
// (program_item). mvox_crede only.
//
// AUTHORIZATION: Mihkel's commission via Passepartout, recorded on #293 —
// the per-instance say-so for entering THIS data into crede (repertoire/
// org data, no personal data involved; the crede real-PII posture is
// unaffected — nothing person-shaped here). Live mutation still gated
// separately by team-lead's explicit "I authorize this run", per the
// standing two-step gate.
//
// RECON (2026-09-08, read-only, reported to team-lead before writing this
// script): the season, its weekly rehearsal event series, and ONE of the
// five works already exist live — created 2026-09-06 by Joosep Loidap, two
// days before this commission, contradicting the issue's own "no calendar
// entry exists" premise. This script does NOT assume that recon is still
// fresh at run time — every anchor (library, season, today's rehearsal
// event) is resolved by live query, not a hardcoded id, and every create
// step is idempotent check-then-create so a repeat run (or a run after the
// prior recon went stale) never duplicates.
//
// SHAPE — mirrors the shipped app code exactly, not memory or a design
// doc (read src/lib/entity/entityCreate.ts and src/lib/repertoire/
// repertoireActions.ts before writing this):
//   - work: parent=library, NO _sharing/_inheritrights (inherits domain).
//   - edition: parent=work, same no-explicit-sharing rule. Kept MINIMAL —
//     name + publisher-where-verified only (Pärt: 'UE33723', confirmed).
//     The other four editions' identity is genuinely unverified pending
//     Mihkel's PDF upload — that caveat lives in the ledger, not invented
//     into a field the shape doesn't offer a natural home for.
//   - repertoire_item: child of SEASON, {work: ref, status:'active'
//     default}, NO explicit _sharing (inherits domain from season).
//   - program_item: child of EVENT, {edition: ref, ordinal: number,
//     _sharing:'domain' EXPLICIT} — requires an edition, not a work, so
//     editions land before program_items attach. Only created if a
//     rehearsal event for today is actually found live — per the issue's
//     own conditional (works+editions land regardless; attachment waits
//     for the time answer if no event exists). Recon found one; this
//     script still checks live rather than assuming.
//
// Composer names: FULL NAMES ("Lembit Veevo", not "L. Veevo") — matches
// how the issue itself writes them and the existing reused Kreek work
// ("Cyrillus Kreek", full name). Two UNRELATED existing works on this db
// use an abbreviated "P. Uusberg" style — flagged to team-lead as an
// observed inconsistency, not resolved either way by this script.
//
// Run (standalone node, outside Vite -- needs the $env shim via loader.mjs):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-293-crede-season-repertoire-2026-09-08.ts        # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-293-crede-season-repertoire-2026-09-08.ts        # ONLY after team-lead's explicit authorization

import { entuFetch } from '$lib/entu/request';
import { readDryRun, loadCredeCfg } from './lib/script-runner';
import { writeLedger } from './lib/ledger-writer';

const DRY_RUN = readDryRun();

interface WorkDef {
	name: string;
	composer: string;
	note: string; // ledger-only epistemic caveat, per Passepartout's research
}

const WORKS: WorkDef[] = [
	{
		name: 'Kadakad',
		composer: 'Lembit Veevo',
		note: "[unverified] which version — mixed-choir original (1976, presumed for Crede/mixed) vs the composer's own women's-choir arrangement (1996). Confirm from the PDF when uploaded."
	},
	{
		name: 'Von alten Liebesliedern, op. 62 no. 2',
		composer: 'Johannes Brahms',
		note: '[unverified] edition house (from Sieben Lieder op. 62, Simrock 1874; modern editions Carus/Breitkopf exist, CPDL public-domain exists) — edition identity from Mihkel\'s file.'
	},
	{
		name: 'Taaveti laul nr 121',
		composer: 'Cyrillus Kreek',
		note: '[REUSED, already live] incipit "Päeval ei pea päikene sind vaevama" (1923). Discriminator warning (Passepartout): commonly confused with Pärt Uusberg\'s "Ma tõstan silmad mägede poole" (2009), a different work by a different composer — check the PDF\'s first line before treating this as settled.'
	},
	{
		name: 'O magnum mysterium',
		composer: 'Tomás Luis de Victoria',
		note: '[unverified] edition — SATB motet, Motecta (Gardano, Venice) 1572, public domain; editions differ in bar numbering and musica ficta. Edition identity from Mihkel\'s file.'
	},
	{
		name: 'The Deer\'s Cry',
		composer: 'Arvo Pärt',
		note: '[verified] 2007, Louth CMS commission; Universal Edition UE33723; SATB a cappella; text St Patrick\'s Breastplate closing section. In copyright.'
	}
];

const EDITION_PUBLISHERS: Record<string, string | undefined> = {
	"The Deer's Cry": 'UE33723'
};

interface LedgerStep {
	step: string;
	outcome: string;
	id?: string | null;
	[key: string]: unknown;
}

async function findOne(db: string, token: string, query: string): Promise<{ _id: string; name?: string } | null> {
	const res = await entuFetch(db, query, token);
	if (!res.ok) throw new Error(`findOne query failed (${res.status}): ${query}`);
	const body = (await res.json()) as { entities?: Array<{ _id: string; name?: Array<{ string: string }> }> };
	const entity = body.entities?.[0];
	if (!entity) return null;
	return { _id: entity._id, name: entity.name?.[0]?.string };
}

async function resolveTypeId(db: string, token: string, typeName: string): Promise<string> {
	const res = await entuFetch(db, `entity?_type.string=entity&name.string=${encodeURIComponent(typeName)}&props=_id&limit=1`, token);
	if (!res.ok) throw new Error(`resolveTypeId('${typeName}') failed: ${res.status}`);
	const body = (await res.json()) as { entities?: Array<{ _id: string }> };
	const id = body.entities?.[0]?._id;
	if (!id) throw new Error(`resolveTypeId('${typeName}'): type-def not found`);
	return id;
}

async function ensureEntity(
	db: string,
	token: string,
	typeId: string,
	stepName: string,
	parentId: string,
	matchQuery: string,
	createProps: Array<Record<string, unknown>>,
	entityName: string,
	dryRun: boolean,
	ledger: LedgerStep[]
): Promise<string | null> {
	const existing = await findOne(db, token, matchQuery);
	if (existing) {
		ledger.push({ step: stepName, outcome: 'found', id: existing._id, entityName });
		return existing._id;
	}
	if (dryRun) {
		ledger.push({ step: stepName, outcome: 'dry-run-would-create', entityName, parentId });
		return null;
	}
	const res = await entuFetch(db, 'entity', token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify([{ type: '_type', reference: typeId }, { type: '_parent', reference: parentId }, ...createProps])
	});
	if (!res.ok) throw new Error(`ensureEntity('${entityName}') create failed: ${res.status}`);
	const body = (await res.json()) as { _id?: string };
	if (!body._id) throw new Error(`ensureEntity('${entityName}') returned 2xx without _id — apparent-success trap`);
	ledger.push({ step: stepName, outcome: 'created', id: body._id, entityName, parentId });
	return body._id;
}

async function main(): Promise<void> {
	const cfg = await loadCredeCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const ledger: LedgerStep[] = [];

	// --- Anchors, resolved LIVE, never hardcoded ---
	const library = await findOne(cfg.db, cfg.token, `entity?_type.string=library&props=name&limit=1`);
	if (!library) throw new Error('no `library` entity found on crede — cannot anchor works');
	console.log(`Library: ${library._id} (${library.name})`);
	ledger.push({ step: 'resolve-library', outcome: 'found', id: library._id, entityName: library.name });

	const season = await findOne(cfg.db, cfg.token, `entity?_type.string=season&name.string=${encodeURIComponent('2026/2027')}&props=name&limit=1`);
	if (!season) throw new Error('season "2026/2027" not found on crede — recon expected it to exist; aborting rather than inventing one');
	console.log(`Season: ${season._id} (${season.name})`);
	ledger.push({ step: 'resolve-season', outcome: 'found', id: season._id, entityName: season.name });

	// Today's rehearsal: event_type=rehearsal with start_datetime on 2026-09-08 (UTC date match).
	const todaysEvents = await entuFetch(
		cfg.db,
		`entity?_type.string=event&event_type.string=rehearsal&start_datetime.datetime%3Egte%3D2026-09-08T00:00:00.000Z&start_datetime.datetime%3Elte%3D2026-09-08T23:59:59.999Z&props=start_datetime&limit=5`,
		cfg.token
	);
	if (!todaysEvents.ok) throw new Error(`today's-rehearsal query failed: ${todaysEvents.status}`);
	const todaysEventsBody = (await todaysEvents.json()) as { entities?: Array<{ _id: string; start_datetime?: Array<{ datetime: string }> }> };
	const rehearsalEvent = todaysEventsBody.entities?.[0] ?? null;
	if (rehearsalEvent) {
		console.log(`Today's rehearsal event: ${rehearsalEvent._id} (${rehearsalEvent.start_datetime?.[0]?.datetime})`);
		ledger.push({ step: 'resolve-rehearsal-event', outcome: 'found', id: rehearsalEvent._id, startDatetime: rehearsalEvent.start_datetime?.[0]?.datetime });
	} else {
		console.log("No rehearsal event found for today — program_item attachment will be SKIPPED per the issue's own conditional (works+editions still land).");
		ledger.push({ step: 'resolve-rehearsal-event', outcome: 'not-found' });
	}

	const workTypeId = await resolveTypeId(cfg.db, cfg.token, 'work');
	const editionTypeId = await resolveTypeId(cfg.db, cfg.token, 'edition');
	const repertoireItemTypeId = await resolveTypeId(cfg.db, cfg.token, 'repertoire_item');
	const programItemTypeId = rehearsalEvent ? await resolveTypeId(cfg.db, cfg.token, 'program_item') : null;

	const results: Array<{ work: string; workId: string | null; editionId: string | null; repertoireItemId: string | null; programItemId: string | null }> = [];

	for (let i = 0; i < WORKS.length; i++) {
		const def = WORKS[i];
		console.log(`\n--- ${def.name} (${def.composer}) ---`);
		console.log(`  note: ${def.note}`);

		const workId = await ensureEntity(
			cfg.db, cfg.token, workTypeId, 'ensure-work', library._id,
			`entity?_type.reference=${workTypeId}&_parent.reference=${library._id}&name.string=${encodeURIComponent(def.name)}&props=_id,name`,
			[{ type: 'name', string: def.name }, { type: 'composer', string: def.composer }],
			def.name, DRY_RUN, ledger
		);
		console.log(`  work: ${workId ?? '(would create — dry-run)'}`);

		let editionId: string | null = null;
		if (workId) {
			const publisher = EDITION_PUBLISHERS[def.name];
			const editionProps: Array<Record<string, unknown>> = [{ type: 'name', string: def.name }];
			if (publisher) editionProps.push({ type: 'publisher', string: publisher });
			editionId = await ensureEntity(
				cfg.db, cfg.token, editionTypeId, 'ensure-edition', workId,
				`entity?_type.reference=${editionTypeId}&_parent.reference=${workId}&name.string=${encodeURIComponent(def.name)}&props=_id,name`,
				editionProps,
				def.name, DRY_RUN, ledger
			);
			console.log(`  edition: ${editionId ?? '(would create — dry-run)'}${publisher ? ` (publisher: ${publisher})` : ''}`);
		} else {
			ledger.push({ step: 'ensure-edition', outcome: 'skipped', reason: 'dry-run: work not yet created', entityName: def.name });
		}

		let repertoireItemId: string | null = null;
		if (workId) {
			repertoireItemId = await ensureEntity(
				cfg.db, cfg.token, repertoireItemTypeId, 'ensure-repertoire-item', season._id,
				`entity?_type.reference=${repertoireItemTypeId}&_parent.reference=${season._id}&work.reference=${workId}&props=_id`,
				[{ type: 'work', reference: workId }, { type: 'status', string: 'active' }],
				`repertoire_item: ${def.name}`, DRY_RUN, ledger
			);
			console.log(`  repertoire_item: ${repertoireItemId ?? '(would create — dry-run)'}`);
		} else {
			ledger.push({ step: 'ensure-repertoire-item', outcome: 'skipped', reason: 'dry-run: work not yet created', entityName: def.name });
		}

		let programItemId: string | null = null;
		if (rehearsalEvent && editionId && programItemTypeId) {
			programItemId = await ensureEntity(
				cfg.db, cfg.token, programItemTypeId, 'ensure-program-item', rehearsalEvent._id,
				`entity?_type.reference=${programItemTypeId}&_parent.reference=${rehearsalEvent._id}&edition.reference=${editionId}&props=_id`,
				[{ type: 'edition', reference: editionId }, { type: 'ordinal', number: i }, { type: '_sharing', string: 'domain' }],
				`program_item: ${def.name}`, DRY_RUN, ledger
			);
			console.log(`  program_item: ${programItemId ?? '(would create — dry-run)'} (ordinal ${i})`);
		} else if (rehearsalEvent) {
			ledger.push({ step: 'ensure-program-item', outcome: 'skipped', reason: 'dry-run: edition not yet created', entityName: def.name });
		} else {
			ledger.push({ step: 'ensure-program-item', outcome: 'skipped', reason: 'no rehearsal event found for today', entityName: def.name });
		}

		results.push({ work: def.name, workId, editionId, repertoireItemId, programItemId });
	}

	const failures = ledger.filter((e) => e.outcome === 'failed');
	console.log('\n=== SUMMARY ===');
	console.log(`DRY_RUN: ${DRY_RUN}`);
	for (const r of results) console.log(`  ${r.work}: work=${r.workId ?? 'n/a'} edition=${r.editionId ?? 'n/a'} repertoire_item=${r.repertoireItemId ?? 'n/a'} program_item=${r.programItemId ?? 'n/a'}`);
	console.log(`${ledger.length} ledger steps, ${failures.length} failures`);

	const artifactPath = writeLedger({
		scriptName: 'seed-293-crede-season-repertoire',
		dryRun: DRY_RUN,
		db: cfg.db,
		sensitive: false,
		acknowledgedNonSensitive: true,
		payload: {
			purpose: 'mvox-app#293 — Crede 2026/27 season repertoire: 5 works + editions, attached to the season and (if found) today\'s rehearsal. Repertoire/org data only, no personal data — per-instance say-so recorded on the issue.',
			libraryId: library._id,
			seasonId: season._id,
			rehearsalEventId: rehearsalEvent?._id ?? null,
			results,
			ledger
		}
	});
	console.log(`\nLedger: ${artifactPath}`);
	process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('seed-293-crede-season-repertoire ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
