// mvox-side schema-of-record for APP-EXTENSION entity types — types that exist
// because mvox needs them, not because they trace to canonical v4E. Home settled
// on mvox-app#246 (Gama SETTLE, 2026-09-06), following the 2026-09-06 ruling that
// retired the entu/research upstream flow entirely: "mvox is independent and
// upstream flow is retired entirely." All schema evolution is mvox-side now; this
// file is where its DEFINITION lives, owned by this team, in this repo.
//
// Shape note: the vocabulary below (name/blurb/sharing/inheritsRights/parents/
// properties/creators/notes) deliberately MIRRORS the `EntityDef` shape reviewed
// on #246 — familiar documentation shape, reused because the team already knows
// how to read it. It is NOT imported from `docs/schema/v4E/schema.ts` and carries
// no runtime dependency on that file or on entu/research: `creators`/`parentCard`
// are pure documentation even in real v4E (entu-api enforces none of it — see
// architecture-decisions.md "CREATE has NO parent-rights check"), so nothing is
// lost by keeping this a plain local type instead of a real import. Precedent
// checked, not assumed: `mvox_collective`'s own definition lives inline in
// entu-research's `setup-entity-types.ts` — a different repo, a different team's
// file — so "app extensions skip the entu/research flow" has only ever meant
// skipping schema.ts/PR/trailers, never "definitions live outside entu-research."
// This file is the corrected version of that precedent: mvox-side, front door.
//
// The idempotent CREATE primitive that turns one of these into a live type-def +
// prop-defs on a target db is `ensure-schema-type.ts` in this same directory —
// kept separate so this file stays pure data, reviewable without reading wire
// mechanics, and reusable the moment a second extension type needs a home here.

export type Cardinality = '0..1' | '1' | '0..N' | '1..N';
export type Sharing = 'private' | 'domain' | 'public';
export type Right = '_owner' | '_editor' | '_expander' | '_viewer';

export interface ParentSpec {
	entity: string;
	required: boolean;
	parentCard: Cardinality;
	childCard: Cardinality;
	verb: string;
	note?: string;
}

export interface PropertySpec {
	name: string;
	/** Entu wire type (`string`, `datetime`, `number`, `reference`, `text`, …). */
	type: string;
	required?: boolean;
	note?: string;
	/** Bilingual prop-def `description` — what Entu shows on the field's edit view. */
	descriptionEn: string;
	descriptionEt: string;
	/** Admin-list display config, mirrored 1:1 from the sibling type this extension
	 * imitates (`ordinal`/`table`/`search` on Entu prop-defs), not decorative. */
	ordinal?: number;
	table?: boolean;
	search?: boolean;
}

export type CreatorRule =
	| { kind: 'self' }
	| { kind: 'system' }
	| { kind: 'cron' }
	| { kind: 'parent_right'; right: Right }
	| { kind: 'bilateral'; requires: string[] }
	| { kind: 'custom'; description: string };

export interface MvoxEntityDef {
	name: string;
	blurb: string;
	/** The TYPE-DEF's own `_sharing` (gate 2 of the 3-gate-AND bucket model) —
	 * verified empirically against the sibling type this extension imitates, not
	 * copied from aspirational design text (see `schedule_item.notes` below). */
	sharing: Sharing;
	inheritsRights: boolean;
	parents: ParentSpec[];
	/** Another type in this file (or a canonical v4E type, resolved by name on the
	 * target db) that instances may be created from in the Entu admin UI. */
	addFrom?: string;
	properties: PropertySpec[];
	creators: CreatorRule[];
	notes: string[];
	/** mvox-app issue that commissioned + settled this type — the design record
	 * lives there until a durable schema-of-record home is chosen (pending,
	 * per the #246 settle §5; commissioning issues are the record until then). */
	commissionedBy: string;
}

/**
 * A single named point in time within an event (call, rehearsal start,
 * performance start). One event, several named times.
 *
 * Settled mvox-app#246 (Gama, 2026-09-06, after Pérotin conceded the `ordinal`
 * challenge — see commit history / issue thread for the full adjudication):
 * two required properties, no `ordinal` (sort by `datetime`, `name` as the
 * costless tie-break), rights/sharing posture identical to `program_item`.
 */
export const schedule_item: MvoxEntityDef = {
	name: 'schedule_item',
	blurb: 'A single named point in time within an event (call, rehearsal start, performance start).',
	// Verified against LIVE program_item (2026-09-06, read-only probe): the type-def's
	// own `_sharing` is `domain`, not the aspirational `public` the salvaged v4E draft
	// literal carried. "Identical rights posture to program_item" is the ruling's
	// actual intent — matching the live sibling, not its stale schema.ts field.
	sharing: 'domain',
	inheritsRights: true,
	parents: [
		{ entity: 'event', required: true, parentCard: '1', childCard: '0..N', verb: 'in' }
	],
	addFrom: 'event',
	properties: [
		{
			name: 'name',
			type: 'string',
			required: true,
			note: 'what this time is — free text (call, warm-up, sound check, rehearsal, performance, photo, …); open set, not a `set` enum',
			descriptionEn:
				'What this time is — free text (call, warm-up, sound check, rehearsal, performance, photo, …); open set.',
			descriptionEt:
				'Mis ajahetkega on tegu — vabatekst (kutse, soojendus, proovikõla, proov, esitus, pildistamine jne); avatud loend.',
			ordinal: 1,
			table: true,
			search: true
		},
		{
			name: 'datetime',
			type: 'datetime',
			required: true,
			note: 'sort key; `name` is the costless tie-break for two items sharing a minute — deliberately no `ordinal`',
			descriptionEn:
				"The point in time itself. Sort key for the event's schedule; `name` is the tie-break for two items sharing a minute.",
			descriptionEt:
				'Ajahetk ise. Sündmuse ajakava sortimisvõti; kahe samal minutil oleva kirje puhul lahendab järjekorra `name`.',
			ordinal: 2,
			table: true
		}
	],
	creators: [{ kind: 'parent_right', right: '_editor' }],
	notes: [
		'mvox app extension — not part of the canonical v4E schema (upstream flow retired 2026-09-06; entu/research is historical reference only).',
		'Sort by `datetime`; `name` is the costless tie-break for two items sharing a minute — no `ordinal` (mvox-app#246 ruling: a required ordinal buys dense-sequence renumbering maintenance — the exact machinery behind #253 — and no display-order case diverges from chronological order).',
		"`_sharing` cascades from the parent event at create-time (BFF cascade), same as `program_item`.",
		"`event.start_datetime` stays required and directly writable — the agenda's sole sort key. Deriving it as a formula over children is disqualified: a formula property overwrites unconditionally and silently drops POSTs (mvox-app#233 finding).",
		'Entu UI `add_from`: `event`. (Live `program_item` currently lacks this wiring — an observed gap in the sibling, not a reason to repeat it here.)'
	],
	commissionedBy: 'mvox-app#246'
};

// (*MVOX:Perotin*)
