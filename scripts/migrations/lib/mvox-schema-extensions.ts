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
	/** Per-property sharing override (gate 1 of the 3-gate-AND bucket model). Falls
	 * back to the type's own `sharing` when omitted — but see mvox-app#265's live
	 * finding: omitting `_sharing` on a prop-def at Entu's own create time does NOT
	 * default to private, it silently INHERITS the parent type's tier
	 * (`inheritParentProperties`, confirmed via a live probe whose first private-tier
	 * field silently came back `public`). Set this EXPLICITLY on every prop-def of a
	 * mixed-sharing entity — never omit it to "get private."
	 *
	 * **The same trap has a second pole, also from mvox-app#265**: "inherit the
	 * type's tier" is not the same question as "match the sibling properties'
	 * actual posture." `roster_show_real_names` first tried the omit-and-inherit
	 * route on the reasoning that Mihkel's "no special case, same as the
	 * collective's other properties" meant exactly that — but the TYPE's own
	 * `_sharing` (what omission actually inherits) resolved to `public`, a
	 * platform-generic constant, while the sibling PROP-DEFS on that same type
	 * were empirically 11-12 of 12-13 `domain`. Omission answered a different
	 * question than the one being asked. **When "same as the others" is the
	 * actual intent, establish it empirically (read the sibling prop-defs'
	 * OWN sharing) and set the match EXPLICITLY — never rely on omission's
	 * inherit-from-TYPE behavior to stand in for "matches its siblings."**
	 * Omission is for "no opinion, take whatever the type declares" — a
	 * different, rarer intent than either of the above. */
	sharing?: Sharing;
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
 * A single property added to an EXISTING type (canonical v4E or another
 * extension) — distinct from `MvoxEntityDef`, which defines a whole new type.
 * First use: mvox-app#265's R2 toggle, added to the canonical `database`
 * type (the collective root, post-#161 org→db-entity migration). Same
 * commissioning/PO-Approved discipline applies; this is just a lighter shape
 * for the "one more field on something that already exists" case.
 */
export interface PropertyAdditionDef {
	/** Name of the type this property is added to (canonical or extension). */
	onType: string;
	property: PropertySpec;
	commissionedBy: string;
	notes: string[];
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

/**
 * Admin-owned record of a member's real identity — real name, phone, email,
 * birth date — independent of and never overwriting the member's own profile.
 *
 * Settled mvox-app#265 (Mihkel shape review, 2026-09-06, comment 5561754737,
 * following Mihkel's own posture ruling on the same issue, comment 5561632474):
 * branch (i), ONE entity with per-property sharing, confirmed live — see
 * `docs/architecture/mvox-schema-extensions.md` for the full evidence chain
 * (source read + live partition probe + Mihkel's standing ruling to consult
 * and believe Entu's own documentation on platform behaviour, rather than
 * building further verification ladders). Four corrections applied verbatim
 * from the review: type name (not the proposal's `roster_record`), only
 * `name` required (not `phone` too), R2 toggle default `false`, R2 toggle
 * takes the collective's existing sharing posture (no special case — see
 * `roster_show_real_names` below).
 *
 * **Parent corrected post-review** (team-lead routing, 2026-09-06, following a
 * dry-run halt): the shape review approved `organization` as the parent, but
 * neither polyphony nor mvox_crede has an `organization` type-def live —
 * `organization` was RETIRED in the #161 org→db-entity migration (2026-08,
 * MVOX-11). The collective root has been the database entity itself since
 * then; `member`'s type-def description ("membership record within one
 * organization") is aspirational leftover predating #161, not the current
 * shape. `member`'s own actual live `_parent` on both databases already
 * points at the database entity — this definition now matches that, the
 * post-#161 canonical shape, not a workaround.
 */
export const admin_member_record: MvoxEntityDef = {
	name: 'admin_member_record',
	blurb: "Admin-owned record of a member's real identity — real name, phone, email, birth date — independent of the member's own profile.",
	// Type-level (gate 2): must be domain-or-above or nothing on this type ever
	// reaches a non-owner reader. The admin-only fields stay invisible anyway —
	// that's gate 1 (each prop-def's own sharing below), not this gate.
	sharing: 'domain',
	inheritsRights: true,
	parents: [
		{
			entity: 'database', required: true, parentCard: '1', childCard: '0..N', verb: 'has',
			note: "same attachment point as member — reuses the existing collective owner/editor=admin rights cascade, no new rights mechanism. The collective root IS the database entity (post-#161 migration, both databases) — this is not a single-collective-db special case, it's the universal current shape. `entity: 'database'` here resolves the 'database' TYPE-DEF (for the toggle's own attachment + sharing fallback), not a specific database instance — provisioning this file's type/prop-defs never needs to name a specific instance."
		}
	],
	properties: [
		{
			name: 'person',
			type: 'reference',
			required: true,
			sharing: 'domain',
			note: 'domain, not private: a domain-tier roster reader must be able to resolve which admin_member_record belongs to which person to render per-member rows at all — R2 cannot function if this reference is invisible to the readers R2 is for',
			descriptionEn: 'The person this record belongs to.',
			descriptionEt: 'Isik, kelle kohta see kirje käib.',
			ordinal: 1
		},
		{
			name: 'name',
			type: 'string',
			required: true,
			sharing: 'domain',
			descriptionEn: "The member's real, correct name — always used on outputs of record (R3) regardless of the R2 toggle.",
			descriptionEt: 'Liikme pärisnimi — kasutatakse alati ametlikel väljunditel (R3), sõltumata R2 seadest.',
			ordinal: 2,
			table: true
		},
		{
			name: 'phone',
			type: 'string',
			required: false,
			sharing: 'private',
			descriptionEn: 'Real phone number, admin-managed. Not readable by members.',
			descriptionEt: 'Pärisnumber, admini hallatud. Liikmetele mitte nähtav.',
			ordinal: 3
		},
		{
			name: 'email',
			type: 'string',
			required: false,
			sharing: 'private',
			descriptionEn: 'Real email, admin-managed. Not readable by members.',
			descriptionEt: 'Pärisaadress, admini hallatud. Liikmetele mitte nähtav.',
			ordinal: 4
		},
		{
			name: 'birthdate',
			type: 'datetime',
			required: false,
			sharing: 'private',
			note: 'stored as a full datetime (no distinct date-only wire type observed elsewhere in this schema) — UI renders the date portion only',
			descriptionEn: 'Date of birth, admin-managed. Not readable by members.',
			descriptionEt: 'Sünnikuupäev, admini hallatud. Liikmetele mitte nähtav.',
			ordinal: 5
		}
	],
	creators: [{ kind: 'parent_right', right: '_editor' }],
	notes: [
		'Per-property sharing is a PRIVACY control here, not style (Mihkel, comment 5561632474): name -> domain, person -> domain (required for R2 to resolve rows at all), phone/email/birthdate -> private. Set EXPLICITLY on every prop-def, never left to inherit — omitting `_sharing` on a prop-def inherits the parent TYPE\'s tier (domain), which would silently widen the personal fields (mvox-app#265 live-probe finding).',
		'One admin_member_record per person is an APP-level invariant (check-then-create) — Entu has no native uniqueness constraint. Same discipline as `profile`/`member`.',
		'Instance `_sharing` asserted explicitly as `domain` at create time (not left to inherit) — matches `member`\'s own established pattern of asserting its tier rather than relying on parent inheritance.',
		'R3 (outputs-of-record rule, e.g. a future concert programme): always reads `admin_member_record.name`, never `profile`, unconditionally regardless of the R2 toggle. No such output exists yet — documented contract only, nothing built for it in this commission.',
		'R4 (prefill without dependency): an admin creating a record MAY prefill `name` from the person\'s existing profile display name as a ONE-TIME plain-value copy at creation time — never a formula or live reference. Formula properties cannot "compute once then freeze" (they always live-recompute), so a formula-based prefill would violate "drawing on, but not depending on" profile data the moment it changed.',
		'Provisioning requirement (PO addition, comment 5561754737): after creating each prop-def, read back its effective `_sharing` and assert it matches the intent above, failing loudly on mismatch — the same unasserted-dependency discipline as mvox-app#264 item 6. Result goes in the seed-results ledger. This belongs to the provisioning script (next phase), not this definition.',
		'mvox app extension — not part of the canonical v4E schema (upstream flow retired 2026-09-06; entu/research is historical reference only).'
	],
	commissionedBy: 'mvox-app#265'
};

/**
 * R2 toggle: whether the roster shows real names (from `admin_member_record`)
 * or profile names. Lives on the collective entity, per design input 3 — the
 * collective root IS the database entity (post-#161 org→db-entity migration,
 * both databases), the same entity `admin_member_record.parents` resolves
 * `database` to there.
 *
 * Settled mvox-app#265, corrections 3+4 (Mihkel, comment 5561754737): default
 * `false` (profile names until an admin opts in); sharing takes the SAME
 * posture as the collective's other properties — no special case.
 *
 * **Sharing corrected post-dry-run (team-lead ruling interpretation, 2026-09-06,
 * reported to PO)**: the first version of this definition OMITTED `sharing`,
 * reading "no special case" as "inherit the `database` type's own `_sharing`."
 * Dry-run surfaced that the TYPE's own `_sharing` is `public` on both
 * databases — a platform-generic constant — while the `database` type's
 * EXISTING sibling prop-defs are empirically `domain` (11-12 of 12-13,
 * checked live on both dbs; only `billing_tokens_limit` is `public`). "Same
 * as the collective's other properties" means the empirical sibling PATTERN
 * (`domain`), not the type-level cap omission actually inherits — those are
 * different questions that happened to look interchangeable until checked.
 * **Explicit `domain` below is Mihkel's ruling correctly implemented; the
 * earlier omission was an implementation error against it, not an
 * alternative reading of it.** See `PropertySpec.sharing`'s doc comment above
 * for the general lesson this leaves behind.
 */
export const roster_show_real_names: PropertyAdditionDef = {
	onType: 'database',
	property: {
		name: 'roster_show_real_names',
		type: 'boolean',
		required: false,
		sharing: 'domain', // explicit — see the doc comment above; matches the empirical sibling pattern, NOT the database type's own _sharing (public)
		descriptionEn: "Admin roster display setting: true shows members' real names (admin_member_record.name); false (default) shows profile names.",
		descriptionEt: 'Admini rosteri kuvamisseade: tõene väärtus näitab liikmete pärisnimesid (admin_member_record.name); väär (vaikimisi) näitab profiilinimesid.',
		ordinal: 90
	},
	commissionedBy: 'mvox-app#265',
	notes: [
		'Default false (Mihkel correction 3): roster shows profile names until an admin explicitly turns real names on.',
		'Sharing is `domain`, set EXPLICITLY (Mihkel correction 4, "same posture as the collective\'s other properties" — established empirically, not inherited via omission; see the doc comment above for why omission gave the wrong answer here).',
		'Read by every member\'s client (Path C, browser-direct) to decide what the roster renders for each row — broad READ, admin-only WRITE. Write access needs no new mechanism: whoever already holds `_owner`/`_editor` on the collective can already write any of its existing properties.'
	]
};

// (*MVOX:Perotin*)
