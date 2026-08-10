// #90 TR.2 — the ONE definition of the works view model rendered on an agenda
// event row. Single source of truth: RepertoireElement (renderer), AgendaList
// (pass-through prop), workRows.ts (producer) and the page all import this.
// TR.3 will widen it for management writes — a widened shape must break every
// consumer at once, which a duplicated inline type could not do.

export type WorkRow = {
	/** The repertoire_item / program_item entity id — the stable render key.
	 *  NEVER key on `ordinal`: `mandatory: true` is a soft UI hint in Entu, so
	 *  two program_items can both default to ordinal 0 and a keyed `{#each}`
	 *  would throw `each_key_duplicate` and take down the whole agenda. */
	id: string;
	workName: string;
	/** '' = composer unknown. */
	composer: string;
	/** null = program item — a concert programme carries no status. */
	status: 'learning' | 'active' | null;
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

// (*MVOX:Josquin*)
