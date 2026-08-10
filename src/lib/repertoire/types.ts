// #90 TR.2 — the ONE definition of the works view model rendered on an agenda
// event row. Single source of truth: RepertoireElement (renderer), AgendaList
// (pass-through prop), workRows.ts (producer) and the page all import this.
// TR.3 widened it for management writes — a widened shape must break every
// consumer at once, which a duplicated inline type could not do.

import type { Work } from '$lib/library/libraryData';

/** The four `repertoire_item.status` values (schema.ts). Lives HERE, not in
 *  repertoireActions.ts, so the pure view model can name it without dragging
 *  the write layer (and its entuFetch import) into every consumer.
 *  repertoireActions re-exports it for callers that only touch the writes. */
export type RepertoireStatus = 'learning' | 'active' | 'retired' | 'dropped';

/** A generic (id, display label) pair for the management pickers — the caller
 *  composes the label (e.g. "Work — Edition") so the renderer never needs to
 *  know the Work/Edition shapes. */
export interface PickerOption {
	id: string;
	label: string;
}

/** Whether the signed-in person may manage a given entity's children.
 *  'error' is a genuine third state: a failed rights read must never be
 *  collapsed into 'not-editor' (a network blip would silently demote an
 *  editor). Resolved by repertoireActions.resolveManageRights, which
 *  re-exports this type for write-layer callers. */
export type ManageRightsState = 'editor' | 'not-editor' | 'error';

export type WorkRow = {
	/** The repertoire_item / program_item entity id — the stable render key.
	 *  NEVER key on `ordinal`: `mandatory: true` is a soft UI hint in Entu, so
	 *  two program_items can both default to ordinal 0 and a keyed `{#each}`
	 *  would throw `each_key_duplicate` and take down the whole agenda. */
	id: string;
	/** #91 TR.3 — WHICH entity `id` names, and therefore which write layer may
	 *  touch this row. An event with no program_items renders the SEASON's
	 *  repertoire as fallback (TR.2's hierarchy), so a programme surface can be
	 *  showing repertoire_item ids: handing one of those to deleteProgramItem
	 *  ("remove from tonight") would destroy the whole collective's season
	 *  repertoire entry. `ordinal !== null` is NOT a safe proxy — a program_item
	 *  whose ordinal failed to read defaults to 0, and repertoire rows are
	 *  always null. The row states its own provenance instead. */
	kind: 'repertoire' | 'program';
	/** The `work` entity id ('' = unresolvable). Drives the per-row "pin
	 *  edition" picker (that work's editions) and the "add work" exclusion set. */
	workId: string;
	/** The PINNED / programmed `edition` entity id ('' = none). Drives the
	 *  "already on tonight's programme" exclusion for the programme picker. */
	editionId: string;
	workName: string;
	/** '' = composer unknown. */
	composer: string;
	/** null = program item (a concert programme carries no status), or a status
	 *  string outside the schema's four values. All FOUR statuses reach a
	 *  management surface: the member-facing agenda filters retired/dropped
	 *  upstream (repertoireData's ACTIVE_STATUSES), but an editor must see them
	 *  to toggle them back — a one-way toggle strands the work forever. */
	status: RepertoireStatus | null;
	/** '' = no pinned edition. */
	editionName: string;
	/** null = unordered (season repertoire fallback). */
	ordinal: number | null;
	/** The edition's `file` PROPERTY id — NOT a url. The S3 download url is
	 *  signed on demand (`GET /property/{_id}`) and expires after 60 seconds
	 *  (entu-www src/api/files/index.md), so it can never be resolved at agenda
	 *  load and stashed in an href. '' = the edition carries no file. */
	fileId: string;
	externalLinks: string[];
	/** Copies exist for this edition — show the Borrow link. */
	canBorrow: boolean;
	/** program_item.notes — soloists, dedications. '' = absent (always '' for a
	 *  season-repertoire row: repertoire_item has no notes prop). */
	notes: string;
};

/**
 * #91 TR.3 — everything AgendaList forwards to each event row's
 * RepertoireElement so the management surface is reachable in the running app.
 *
 * Grouped into ONE prop rather than a dozen loose ones because it travels as a
 * unit (page -> AgendaList -> RepertoireElement) and a per-event RepertoireElement
 * needs the event id bound into every programme callback — which AgendaList,
 * not the page, is the only layer positioned to do (it is the layer that knows
 * which row it is rendering).
 *
 * Absent entirely = the read-only agenda, unchanged.
 */
export interface WorksManage {
	/** `_editor` on the current season — one value for the whole agenda. */
	seasonRights: ManageRightsState;
	/** `_editor` per EVENT id; absent = 'not-editor'. */
	eventRightsByEventId: Record<string, ManageRightsState>;
	/** Library works not yet in the season repertoire (pickableWorks()). */
	pickableWorksList: Work[];
	/** Per EVENT id: editions not already on that event's programme. */
	pickableEditionsByEventId: Record<string, PickerOption[]>;
	/** Per ROW id: the editions of that row's work, for "pin edition". */
	editionOptionsByRowId: Record<string, PickerOption[]>;
	/** Write-queue keys currently in flight (row ids + the ADD_* sentinels). */
	pendingKeys: ReadonlySet<string>;
	onaddwork(workId: string): void;
	onstatuschange(itemId: string, status: RepertoireStatus): void;
	onpinedition(itemId: string, editionId: string): void;
	/** `eventId` is what tells the handler WHICH programme a program_item row
	 *  belongs to; the row's own `kind` tells it which delete to call. */
	onremoveitem(eventId: string, itemId: string): void;
	onmoveitem(eventId: string, itemId: string, direction: 'up' | 'down'): void;
	onaddprogramitem(eventId: string, editionId: string, ordinal: number): void;
}

// (*MVOX:Josquin*)
