// mvox-app#369 — FIELD BUG diagnosis (report only, no fix proposed here).
// A real crede singer got "Couldn't save" on an RSVP. Leading suspicion: she
// no longer holds `_editor` on her own person entity (ER-6/ER-9 supersession
// — one direct rights tier per reference per entity; a later direct grant on
// the SAME entity silently retires whichever tier was there before, even
// across different references). Splits two causes: (a) a regression that
// retired an existing grant, or (b) crede members never received the
// self-`_editor` grant at provisioning at all.
//
// HARD TERMS (team-lead relaying Gama's #356-style terms, same discipline):
// READ-ONLY. Rights documents and counts ONLY. No roster/profile content, no
// names, nothing person-identifying read or ledgered.
//
// GOTCHA discovered live while building this (flagging in the findings, not
// just fixing quietly): Entu denormalizes a HUMAN-READABLE NAME into every
// reference-type property value's own `.string` field — `props=_owner,_editor`
// returns entries like `{reference: <id>, string: "Jaan Tamm", ...}` even
// though `name` was never in the requested `props` list, and the SAME
// denormalization happens on `/history`'s `old.string`/`new.string` for any
// reference-type change (entu-api routes/[db]/entity/[_id]/history.get.js:
// 190-219, a $lookup against `private.name.string`). Requesting rights props
// alone is NOT sufficient to keep a read "ids only" — every reference value
// carries its target's name for free. This script strips `.string` at the
// point of extraction, before any console.log or ledger write; nothing
// downstream of `refs()`/`historyRefs()` ever sees it.
//
// Run:
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/probe-369-crede-self-editor-diagnosis-2026-09-15.ts

import { entuFetch } from '$lib/entu/request';
import { loadCredeCfg } from '../lib/script-runner';
import { writeLedger } from '../lib/ledger-writer';

// The three admin/rights-holder ids already established read-only on #356
// (db entity self-reference, and two real admins) — used here only as an
// opaque id set for the admin/non-admin discriminator, never re-resolved to
// anything else.
const KNOWN_ADMIN_IDS = new Set([
	'6a8f471a5eb2498f434e5112', // db entity self-reference (structural, not a person)
	'6a8f471a5eb2498f434e5111',
	'6a92a3fdca67df980f41565d'
]);

interface RawRef {
	_id?: string;
	reference?: string;
	inherited?: boolean;
}

/** Extracts ONLY reference id + inherited flag — never `.string` (see module doc). */
function refs(list: RawRef[] | undefined): Array<{ reference: string; inherited: boolean }> {
	return (list ?? []).flatMap((r) => (r.reference ? [{ reference: r.reference, inherited: !!r.inherited }] : []));
}

interface HistoryEntry {
	type: string;
	at?: string;
	by?: string;
	old?: { reference?: string };
	new?: { reference?: string };
}

async function main(): Promise<void> {
	const cfg = await loadCredeCfg();
	console.log(`db=${cfg.db} (READ-ONLY, RIGHTS DOCUMENTS + COUNTS ONLY — .string stripped at source)\n`);

	const ledger: Record<string, unknown>[] = [];

	// ── 1. Population sweep — self-`_editor` presence, every person ──────
	const personRes = await entuFetch(cfg.db, `entity?_type.string=person&props=_editor&limit=200`, cfg.token);
	if (!personRes.ok) throw new Error(`person list failed: ${personRes.status}`);
	const personBody = (await personRes.json()) as { count: number; entities: Array<{ _id: string; _editor?: RawRef[] }> };
	if (personBody.count > personBody.entities.length) {
		throw new Error(`person count (${personBody.count}) exceeds returned (${personBody.entities.length}) — limit=200 truncated, widen before trusting this run`);
	}

	const withSelfEditor: string[] = [];
	const withoutSelfEditor: string[] = [];
	for (const p of personBody.entities) {
		const editorIds = refs(p._editor).map((r) => r.reference);
		if (editorIds.includes(p._id)) withSelfEditor.push(p._id);
		else withoutSelfEditor.push(p._id);
	}
	console.log(`PERSONS: total=${personBody.count}  with-self-editor=${withSelfEditor.length}  without-self-editor=${withoutSelfEditor.length}`);
	ledger.push({
		step: 'population-sweep',
		total: personBody.count,
		withSelfEditorCount: withSelfEditor.length,
		withoutSelfEditorCount: withoutSelfEditor.length,
		// ids kept in the gitignored ledger only, per team-lead's instruction — not echoed to the report
		withSelfEditorIds: withSelfEditor,
		withoutSelfEditorIds: withoutSelfEditor
	});

	// ── 2. Discriminator — rsvp creator ids vs known admin ids ───────────
	const rsvpRes = await entuFetch(cfg.db, `entity?_type.string=rsvp&props=_owner&limit=200`, cfg.token);
	if (!rsvpRes.ok) throw new Error(`rsvp list failed: ${rsvpRes.status}`);
	const rsvpBody = (await rsvpRes.json()) as { count: number; entities: Array<{ _id: string; _owner?: RawRef[] }> };
	if (rsvpBody.count > rsvpBody.entities.length) {
		throw new Error(`rsvp count (${rsvpBody.count}) exceeds returned (${rsvpBody.entities.length}) — limit=200 truncated, widen before trusting this run`);
	}

	const creatorCounts = new Map<string, number>();
	let ambiguousCount = 0;
	for (const r of rsvpBody.entities) {
		const owners = refs(r._owner);
		const direct = owners.filter((o) => !o.inherited);
		if (direct.length !== 1) {
			// Not the clean single-direct-owner shape the auto-grant mechanic predicts —
			// don't guess a creator id from an ambiguous shape.
			ambiguousCount++;
			continue;
		}
		const creatorId = direct[0].reference;
		creatorCounts.set(creatorId, (creatorCounts.get(creatorId) ?? 0) + 1);
	}
	const nonAdminCreators = [...creatorCounts.keys()].filter((id) => !KNOWN_ADMIN_IDS.has(id));
	const adminCreatedCount = [...creatorCounts.entries()].filter(([id]) => KNOWN_ADMIN_IDS.has(id)).reduce((s, [, c]) => s + c, 0);
	const nonAdminCreatedCount = [...creatorCounts.entries()].filter(([id]) => !KNOWN_ADMIN_IDS.has(id)).reduce((s, [, c]) => s + c, 0);

	console.log(`\nRSVP: total=${rsvpBody.count}  ambiguous-owner-shape=${ambiguousCount}  distinct-creator-ids=${creatorCounts.size}`);
	console.log(`  created-by-known-admin-id: ${adminCreatedCount}`);
	console.log(`  created-by-NON-admin-id: ${nonAdminCreatedCount} (${nonAdminCreators.length} distinct non-admin creator id(s))`);
	console.log(`  DISCRIMINATOR: ${nonAdminCreatedCount > 0 ? 'at least one non-admin-created rsvp EXISTS -> ordinary members COULD answer at some point (strengthens (a))' : 'ZERO non-admin-created rsvp -> no evidence any ordinary member has ever answered (consistent with (b), or with (a) affecting everyone)'}`);

	ledger.push({
		step: 'rsvp-creator-discriminator',
		totalRsvp: rsvpBody.count,
		ambiguousOwnerShapeCount: ambiguousCount,
		distinctCreatorIds: creatorCounts.size,
		adminCreatedCount,
		nonAdminCreatedCount,
		nonAdminCreatorIds: nonAdminCreators,
		creatorCountsById: Object.fromEntries(creatorCounts)
	});

	// ── 3. Retirement evidence — history on up to 2 non-admin WITHOUT-set persons ──
	const candidates = withoutSelfEditor.filter((id) => !KNOWN_ADMIN_IDS.has(id)).slice(0, 2);
	console.log(`\nHISTORY: sampling ${candidates.length} non-admin without-self-editor person id(s)`);
	const historySamples: Array<{ personId: string; rightsChanges: Array<{ type: string; at?: string; by?: string; oldReference?: string; newReference?: string }> }> = [];

	for (const personId of candidates) {
		const histRes = await entuFetch(cfg.db, `entity/${personId}/history?limit=100`, cfg.token);
		if (!histRes.ok) {
			console.log(`  ${personId}: history read failed (${histRes.status})`);
			continue;
		}
		const histBody = (await histRes.json()) as { changes: HistoryEntry[]; count: number };
		const rightsTypes = new Set(['_owner', '_editor', '_viewer', '_expander', '_noaccess']);
		const rightsChanges = histBody.changes
			.filter((c) => rightsTypes.has(c.type))
			.map((c) => ({
				type: c.type,
				at: c.at,
				by: c.by,
				oldReference: c.old?.reference,
				newReference: c.new?.reference
			}));
		console.log(`  ${personId}: ${rightsChanges.length} rights-relevant history entries (of ${histBody.count} total)`);
		for (const rc of rightsChanges) {
			console.log(`    ${rc.at ?? '?'}  ${rc.type}  by=${rc.by ?? '?'}  old->new ref: ${rc.oldReference ?? '(none)'} -> ${rc.newReference ?? '(none)'}`);
		}
		historySamples.push({ personId, rightsChanges });
	}

	ledger.push({ step: 'retirement-evidence', sampledPersonIds: candidates, historySamples });

	writeLedger({
		scriptName: 'probe-369-crede-self-editor-diagnosis',
		dryRun: false,
		db: cfg.db,
		sensitive: true,
		payload: {
			purpose: 'mvox-app#369 — is the missing self-_editor a regression (a) or a provisioning gap (b)? Rights documents and counts only, ids never resolved to names.',
			ledger
		}
	});
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

// (*MVOX:Perotin*)
