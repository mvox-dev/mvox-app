// Schema of record for mvox's app-extension types; their rulings are in the extensions doc.

// Plain data in EntityDef's shape, not imported from v4E: Entu enforces neither creators nor
// parentCard. ensure-schema-type.ts turns one definition into live type- and prop-defs.
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
	type: string;
	required?: boolean;
	note?: string;
	descriptionEn: string;
	descriptionEt: string;
	ordinal?: number;
	table?: boolean;
	search?: boolean;
	// Set on every prop-def: an omitted one inherits the TYPE's tier (#265), which need not match
	// its sibling fields. Read the siblings' own sharing and set the match explicitly.
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
	sharing: Sharing;
	inheritsRights: boolean;
	parents: ParentSpec[];
	addFrom?: string;
	properties: PropertySpec[];
	creators: CreatorRule[];
	notes: string[];
	commissionedBy: string;
}

// One property added to an existing type (canonical v4E or an extension).
export interface PropertyAdditionDef {
	onType: string;
	property: PropertySpec;
	commissionedBy: string;
	notes: string[];
}

export const schedule_item: MvoxEntityDef = {
	name: 'schedule_item',
	blurb: 'A single named point in time within an event (call, rehearsal start, performance start).',
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

// Parent is `database`: `organization` was retired in #161 (rulings: mvox-app#265).
export const admin_member_record: MvoxEntityDef = {
	name: 'admin_member_record',
	blurb: "Admin-owned record of a member's real identity — real name, phone, email, birth date — independent of the member's own profile.",
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
		},
		{
			name: 'id_code',
			type: 'string',
			required: false,
			sharing: 'private',
			descriptionEn: 'Estonian personal identification code (isikukood), admin-managed. Used for foreign travel and festival registration. Not readable by members.',
			descriptionEt: 'Isikukood, admini hallatud. Kasutusel välisreisidel ja festivalidel registreerimiseks. Liikmetele mitte nähtav.',
			ordinal: 6
		}
	],
	creators: [{ kind: 'parent_right', right: '_editor' }],
	notes: [
		'Per-property sharing is a PRIVACY control here, not style (Mihkel, comment 5561632474): name -> domain, person -> domain (required for R2 to resolve rows at all), phone/email/birthdate/id_code -> private. Set EXPLICITLY on every prop-def, never left to inherit — omitting `_sharing` on a prop-def inherits the parent TYPE\'s tier (domain), which would silently widen the personal fields (mvox-app#265 live-probe finding).',
		'One admin_member_record per person is an APP-level invariant (check-then-create) — Entu has no native uniqueness constraint. Same discipline as `profile`/`member`.',
		'Instance `_sharing` asserted explicitly as `domain` at create time (not left to inherit) — matches `member`\'s own established pattern of asserting its tier rather than relying on parent inheritance.',
		'R3 (outputs-of-record rule, e.g. a future concert programme): always reads `admin_member_record.name`, never `profile`, unconditionally regardless of the R2 toggle. No such output exists yet — documented contract only, nothing built for it in this commission.',
		'R4 (prefill without dependency): an admin creating a record MAY prefill `name` from the person\'s existing profile display name as a ONE-TIME plain-value copy at creation time — never a formula or live reference. Formula properties cannot "compute once then freeze" (they always live-recompute), so a formula-based prefill would violate "drawing on, but not depending on" profile data the moment it changed.',
		'Provisioning requirement (PO addition, comment 5561754737): after creating each prop-def, read back its effective `_sharing` and assert it matches the intent above, failing loudly on mismatch — the same unasserted-dependency discipline as mvox-app#264 item 6. Result goes in the seed-results ledger. This belongs to the provisioning script (next phase), not this definition.',
		'id_code (isikukood) added mvox-app#282 (2026-09-07, PO-Approved comment 5573048456) — same per-property-sharing discipline as the original four fields, private explicit. Purpose: foreign travel / festival registration, stated by Mihkel, not inferred. Does not duplicate birthdate: a festival/travel form asks for the id_code itself as an identifier, not the DOB encoded inside it. `commissionedBy` on this type stays `mvox-app#265` (Gama\'s own ruling, same comment) — this bullet is the pointer from this field to its own adjudication; a second incrementally-commissioned field is the trigger to reconsider whether notes-as-pointer is still enough.',
		'mvox app extension — not part of the canonical v4E schema (upstream flow retired 2026-09-06; entu/research is historical reference only).'
	],
	commissionedBy: 'mvox-app#265'
};

// `domain` matches the collective's sibling prop-defs, not the type's own `public` (#265).
export const roster_show_real_names: PropertyAdditionDef = {
	onType: 'database',
	property: {
		name: 'roster_show_real_names',
		type: 'boolean',
		required: false,
		sharing: 'domain',
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

// Type tier `domain` matches live section and repertoire_item, not `database`'s `public` (#256).
export const link: MvoxEntityDef = {
	name: 'link',
	blurb: "A named URL kept for the collective's members — an external resource the choir shares (e.g. a recordings archive).",
	sharing: 'domain',
	inheritsRights: true,
	parents: [
		{
			entity: 'database', required: true, parentCard: '1', childCard: '0..N', verb: 'has',
			note: "the collective root IS the database entity (post-#161 org->db-entity migration, both databases) — 'organization-parented' in the issue thread resolves to this live type, same correction admin_member_record needed on #265. `entity: 'database'` here resolves the 'database' TYPE-DEF, not a specific instance."
		}
	],
	addFrom: 'database',
	properties: [
		{
			name: 'name',
			type: 'string',
			required: true,
			note: 'what the link is',
			descriptionEn: 'What this link is.',
			descriptionEt: 'Mis link see on.',
			ordinal: 1,
			table: true,
			search: true
		},
		{
			name: 'url',
			type: 'string',
			required: true,
			note: "stored as given — Gama's explicit ruling (mvox-app#256): no normalising, no scheme-guessing, no validation beyond non-empty; inventing rules about what a URL may look like risks rejecting valid ones",
			descriptionEn: 'The target URL, stored exactly as given — no normalising or validation.',
			descriptionEt: 'Sihtaadress, salvestatud täpselt sellisena kui sisestatud — normaliseerimata, valideerimata.',
			ordinal: 2,
			table: true
		},
		{
			name: 'description',
			type: 'string',
			required: false,
			note: 'one line, optional',
			descriptionEn: 'An optional one-line note about the link.',
			descriptionEt: 'Valikuline üherealine märkus lingi kohta.',
			ordinal: 3
		},
		{
			name: 'display_order',
			type: 'number',
			required: false,
			note: 'manual arrangement, same shape as `section` / `repertoire_item` — a collection of links has no inherent order',
			descriptionEn: 'Manual display order among the collective’s links.',
			descriptionEt: 'Käsitsi määratud kuvamisjärjekord kollektiivi linkide seas.',
			ordinal: 4
		}
	],
	creators: [{ kind: 'parent_right', right: '_editor' }],
	notes: [
		'mvox app extension — not part of the canonical v4E schema (Mihkel, 2026-09-09, verbatim: "link entity is app extension. we are free from v4E."). No entu/research PR.',
		'Admins add/edit/reorder/remove (`parent_right _editor`, same tier as `program_item`/`repertoire_item`/`admin_member_record`). Members read only. Widening to a members-can-add model is a deliberately open future change, not foreclosed (Mihkel ruling 2026-09-05).',
		'`_sharing` cascades from the parent `database` entity at create time (domain-tier in practice — members-only, not public-internet) — matches `section`/`repertoire_item` precedent, verified live (both `domain` on both dbs).',
		'Ordered via `display_order` (Gama: "a collection past five items without ordering becomes a pile") — same shape as `section`/`repertoire_item`, no new pattern.',
		'Title + URL + optional description only. No date, no type marker — both would be guesses about a use nobody has had yet (Gama’s explicit ruling).',
		'Domain-tier visibility inside mvox is not a privacy guarantee over the URL’s destination (Mihkel, 2026-09-05) — the app keeps a members-only pointer; what it points at is governed elsewhere.',
		'Placement: collective-level, one collection per collective. Event-level attachment is deliberately not designed for (Gama, 2026-09-05).',
		'Parent premise-checked live, not assumed from the issue thread\'s prose: `organization` NOT FOUND on either db (probe-256-link-premise-check-2026-09-10.ts) — resolves to `database`, the post-#161 collective root.'
	],
	commissionedBy: 'mvox-app#256'
};

// Sharing and ordinal are unset on purpose: S1 reads the live `event.name` prop-def and derives
// both at run time (same sharing, ordinal + 1), mvox-app#233.
export const event_name: PropertyAdditionDef = {
	onType: 'event',
	property: {
		name: 'event_name',
		type: 'string',
		required: false,
		note: "the event's own free-text name — moves out of `name` once `name` becomes a formula (S4); no fallback (Mihkel's standing no-fallbacks stance) once the app's reads move (S3)",
		descriptionEn: "The event's own name. Read and written by the app; `name` becomes a display formula once this field is fully populated.",
		descriptionEt: 'Sündmuse enda nimi. Rakendus loeb ja kirjutab seda; `name` muutub kuvamise valemiks pärast selle välja täielikku täitmist.'
	},
	commissionedBy: 'mvox-app#233',
	notes: [
		'crede ONLY (Mihkel estate ruling, 2026-09-18) — no other collective receives this or any further schema change; this is the first PropertyAdditionDef whose provisioning script is single (no per-collective twin).',
		"Sharing mirrors event.name's live posture and ordinal sits adjacent to it (name's ordinal + 1) — read at S1 run time, not set here, because no committed artefact records either value for the live crede `event` type.",
		'Step ordering is a data-loss fence (issue body): S1 (this prop-def) -> S2 (backfill every event.name into event_name) -> S3 (move every app read/write off `name`) -> S4 (only then PATCH `name` into a formula) — a formula overwrites the stored value on every save and silently drops POSTs, so S2/S3 must precede it or names are destroyed.'
	]
};

// `_sharing: domain` is set explicitly on the type and every field, never left to inherit
// (ER-1, ER-13). Rulings: mvox-app#395, #611.
export const feedback: MvoxEntityDef = {
	name: 'feedback',
	blurb: "A member's feedback on the app: a screenshot, ink drawn over it, and a description.",
	sharing: 'domain',
	inheritsRights: true,
	parents: [
		{
			entity: 'member',
			required: true,
			parentCard: '1',
			childCard: '0..N',
			verb: 'gives'
		}
	],
	properties: [
		{
			name: 'screenshot',
			type: 'file',
			sharing: 'domain',
			descriptionEn: 'Screenshot of the page the member is giving feedback on.',
			descriptionEt: 'Kuvatõmmis lehest, mille kohta liige tagasisidet annab.',
			ordinal: 1
		},
		{
			name: 'doodle_layer',
			type: 'text',
			sharing: 'domain',
			note: "#394's StrokeData JSON (src/lib/strokes/strokes.ts serialize/parse) — ink drawn over the screenshot",
			descriptionEn: 'Ink drawn over the screenshot — stroke data as JSON (the #394 StrokeData format).',
			descriptionEt: 'Kuvatõmmisele joonistatud märkused — joonte andmed JSON-vormingus (#394 StrokeData).',
			ordinal: 2
		},
		{
			name: 'description',
			type: 'text',
			sharing: 'domain',
			descriptionEn: "The member's feedback in their own words.",
			descriptionEt: 'Liikme tagasiside tema enda sõnadega.',
			ordinal: 3
		},
		{
			name: 'metadata',
			type: 'text',
			sharing: 'domain',
			note: 'JSON: route path, time, app version (the #350 build stamp), locale and viewport; nothing personal (#611)',
			descriptionEn: 'The page the feedback was given on: route path, time, app version, locale and viewport size, as JSON.',
			descriptionEt: 'Leht, mille kohta tagasiside anti: aadress, aeg, rakenduse versioon, keel ja vaate mõõdud JSON-vormingus.',
			ordinal: 4
		}
	],
	creators: [{ kind: 'self' }],
	notes: [
		'mvox app extension — not part of the canonical v4E schema (upstream flow retired 2026-09-06; entu/research is historical reference only).',
		'Created by the member with their own key (`creators: self`) — Entu auto-grants the creator `_owner` on create; no extra grant.',
		"Instance `_sharing` is set EXPLICITLY to `domain` at create time, as #265 does: a type's `_sharing` is a ceiling, not a default (ER-1), and a child copies its parent's `_sharing` only when the parent is non-private (ER-13) — a feedback under a still-private member would otherwise stay private (PO ruling, Gama, 2026-09-28).",
		'`_inheritrights: true` — inheritance left natural (Mihkel, #390): rights on the member cascade to its feedback.',
		'Instances carry a `name` VALUE with no prop-def: page path + UTC submission date, never a member name or description text (PO ruling, Gama, #395 body, 2026-09-29).',
		'`metadata` (#611) was added on crede by hand (Mihkel, 2026-10-01) and is recorded here to match; no provisioning run.'
	],
	commissionedBy: 'mvox-app#395'
};

// (*MVOX:Perotin*)
