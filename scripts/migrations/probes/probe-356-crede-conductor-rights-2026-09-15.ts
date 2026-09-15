// mvox-app#356 — precondition probe, REDIRECT to mvox_crede (Gama, relayed by
// team-lead 2026-09-15, supersedes the earlier polyphony-scoped brief).
// polyphony has zero events/seasons-with-conductors right now — a vacuous
// pass answers nothing. The real question is whether everyone who marks
// attendance TODAY (the live pilot) already holds owner/editor rights on
// their events, ahead of #356 replacing the seat-based gate with
// `canMarkAttendance` (owner-OR-editor rights, `manageRightsFrom`).
//
// HARD TERMS (Gama, on-issue, overriding the entity-ID-readability
// convention for this run only): READ-ONLY. IDS ONLY. No `name` prop is
// requested on any entity — season, event, or person. Nothing person-
// identifying is read or ledgered; only entity ids and set-membership
// verdicts (does personId ∈ ownerIds ∪ editorIds for this event). The db-root
// API key is the correct instrument for this because the question is what
// grants EXIST, not what a given member can see (private-bucket aggregate
// read, same mechanics as resolveManageRights).
//
// Logic mirrors the app's own real path exactly, not a re-derivation:
//   - resolveConductors(seasonConductors, eventConductors) — src/lib/
//     attendance/conductorLogic.ts (event empty -> inherit season; overlap ->
//     event overrides; no overlap -> union, season-first).
//   - manageRightsFrom(owners, editors, personId) — src/lib/repertoire/
//     repertoireActions.ts (owner OR editor -> 'editor', else 'not-editor').
// Wire shape (props list, parent-reference query) matches src/lib/seasons/
// entuSeasons.ts's listSeasons/listEvents exactly, minus `name` per the terms.
//
// Run:
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/probe-356-crede-conductor-rights-2026-09-15.ts

import { entuFetch } from '$lib/entu/request';
import { loadCredeCfg } from '../lib/script-runner';
import { writeLedger } from '../lib/ledger-writer';
import { resolveConductors } from '$lib/attendance/conductorLogic';
import { manageRightsFrom } from '$lib/repertoire/repertoireActions';

interface RawRef {
	reference?: string;
	entity_type?: string;
}

function refs(list: RawRef[] | undefined): string[] {
	return (list ?? []).flatMap((r) => (r.reference ? [r.reference] : []));
}

async function main(): Promise<void> {
	const cfg = await loadCredeCfg();
	console.log(`db=${cfg.db} (READ-ONLY, IDS ONLY — no name prop requested anywhere)\n`);

	const ledger: Record<string, unknown>[] = [];

	// ── Seasons: id + conductor + _owner/_editor (ids only) ──────────────
	const seasonRes = await entuFetch(cfg.db, `entity?_type.string=season&props=conductor,_owner,_editor&limit=200`, cfg.token);
	if (!seasonRes.ok) throw new Error(`season list failed: ${seasonRes.status}`);
	const seasonBody = (await seasonRes.json()) as { count: number; entities: Array<{ _id: string; conductor?: RawRef[]; _owner?: RawRef[]; _editor?: RawRef[] }> };
	console.log(`seasons: ${seasonBody.count}`);
	const seasonConductorsById = new Map<string, string[]>();
	for (const s of seasonBody.entities) {
		seasonConductorsById.set(s._id, refs(s.conductor));
	}
	ledger.push({ step: 'list-seasons', count: seasonBody.count, seasonIds: seasonBody.entities.map((s) => s._id) });

	// ── Events: id + _parent + conductor + _owner/_editor (ids only) ─────
	const eventRes = await entuFetch(cfg.db, `entity?_type.string=event&props=_parent,conductor,_owner,_editor&limit=500`, cfg.token);
	if (!eventRes.ok) throw new Error(`event list failed: ${eventRes.status}`);
	const eventBody = (await eventRes.json()) as { count: number; entities: Array<{ _id: string; _parent?: RawRef[]; conductor?: RawRef[]; _owner?: RawRef[]; _editor?: RawRef[] }> };
	console.log(`events: ${eventBody.count} (of which returned: ${eventBody.entities.length})`);
	if (eventBody.count > eventBody.entities.length) {
		throw new Error(`event count (${eventBody.count}) exceeds returned entities (${eventBody.entities.length}) — limit=500 truncated, widen before trusting this run`);
	}

	// personId -> { eventId -> holdsRights }
	const perConductor = new Map<string, Map<string, boolean>>();
	const eventLedger: Array<{ eventId: string; seasonId: string | null; activeConductorIds: string[]; ownerIds: string[]; editorIds: string[] }> = [];

	for (const e of eventBody.entities) {
		const seasonParent = (e._parent ?? []).find((p) => p.entity_type === 'season');
		const seasonId = seasonParent?.reference ?? null;
		const seasonConductors = seasonId ? (seasonConductorsById.get(seasonId) ?? []) : [];
		const eventConductors = refs(e.conductor);
		const active = resolveConductors(seasonConductors, eventConductors);
		const ownerIds = refs(e._owner);
		const editorIds = refs(e._editor);

		eventLedger.push({ eventId: e._id, seasonId, activeConductorIds: active, ownerIds, editorIds });

		for (const personId of active) {
			const holds = manageRightsFrom(ownerIds, editorIds, personId) === 'editor';
			if (!perConductor.has(personId)) perConductor.set(personId, new Map());
			perConductor.get(personId)!.set(e._id, holds);
		}
	}
	ledger.push({ step: 'list-events', count: eventBody.count, events: eventLedger });

	// ── Verdict, per conductor id ──────────────────────────────────────
	console.log(`\ndistinct conductor ids across all events: ${perConductor.size}`);
	const verdicts: Array<{ conductorId: string; holdsOnAll: boolean; lackingEventIds: string[]; holdingEventIds: string[] }> = [];
	let anyLacking = false;
	for (const [personId, byEvent] of perConductor) {
		const lacking = [...byEvent.entries()].filter(([, holds]) => !holds).map(([id]) => id);
		const holding = [...byEvent.entries()].filter(([, holds]) => holds).map(([id]) => id);
		const holdsOnAll = lacking.length === 0;
		if (!holdsOnAll) anyLacking = true;
		verdicts.push({ conductorId: personId, holdsOnAll, lackingEventIds: lacking, holdingEventIds: holding });
		console.log(`conductor ${personId}: ${holdsOnAll ? 'HOLDS RIGHTS on all events' : `LACKS RIGHTS on ${lacking.length} event(s): ${lacking.join(', ')}`}`);
	}

	console.log(`\nOVERALL: ${anyLacking ? 'STOP-AND-REPORT — at least one conductor lacks rights on at least one event' : 'CLEAR — every active conductor holds owner or editor rights on every event they conduct'}`);

	ledger.push({ step: 'verdict', distinctConductors: perConductor.size, anyLacking, verdicts });

	writeLedger({
		scriptName: 'probe-356-crede-conductor-rights',
		dryRun: false,
		db: cfg.db,
		sensitive: true,
		payload: {
			purpose: 'mvox-app#356 precondition — does every active conductor on mvox_crede hold owner/editor rights on their events? IDS ONLY, no names, per Gama\'s on-issue terms.',
			ledger
		}
	});
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

// (*MVOX:Perotin*)
