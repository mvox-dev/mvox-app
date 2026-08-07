import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { Level, MyProfile } from './profileData';
import { createOwnProfile, saveProfileFields } from './profileData';

/** Local narrowness ordering (private⊂domain⊂public). Kept local — the fieldMove
 *  module never depends on profileData's runtime exports for the pure load-time
 *  duplicate PLAN (the queue spec mocks './profileData' to only the two write
 *  primitives), so re-declaring the tiny ordering here keeps `planLoadedDuplicateRepairs`
 *  self-contained. RECON A §1: LOWER = more restrictive = the safe/kept holder. */
const MOVE_NARROWNESS: Record<Level, number> = { private: 0, domain: 1, public: 2 };

/** The sibling field — a whole-pair `saveProfileFields` write must always carry both. */
function siblingOf(field: FieldKey): FieldKey {
	return field === 'name' ? 'email' : 'name';
}

/** Build the whole-pair `{name,email}` body: the field's value plus its preserved sibling. */
function pair(field: FieldKey, fieldValue: string, sibling: string): { name: string; email: string } {
	return field === 'name' ? { name: fieldValue, email: sibling } : { name: sibling, email: fieldValue };
}

function errMsg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

// T4.7/#27 — the visibility-MOVE dispatch layer. A move changes one field's
// visibility, which (there being NO Entu transaction — RECON A §3, grep
// `withTransaction|startSession` = 0 repo-wide) is TWO independent writes to TWO
// entities. The ONLY safety is create-before-delete ordering (AC1): CREATE the value
// in the new-level entity FIRST (server-confirmed), DELETE it from the old-level
// entity SECOND. An interruption between the two leaves a DUPLICATE (value in both),
// never a LOSS — surfaced + repaired by the AC3 path below.
//
// Every write funnels through a T4.6 primitive — `createOwnProfile` (create branch)
// or `saveProfileFields` (add/delete branches). This module never writes the
// create-only rights literal and never resolves the profile type id directly (those
// stay sole to profileData.ts), so it does not trip `soleCreatePath.spec.ts` and needs
// no allowlist entry (asserted there).
//
// `saveProfileFields` is WHOLE-PAIR (rewrites an entity's entire name+email
// projection), so every call must pass the entity's FULL intended `{name,email}` —
// the moved field PLUS the entity's other field unchanged (RECON C §0). Passing a
// single field would wipe its sibling.

export type FieldKey = 'name' | 'email';

/** The two server-confirmed milestones of a move: the create landed, then the delete landed. */
export type MovePhase = 'created' | 'deleted';

/**
 * A visibility move failed. `phase` says WHERE:
 *   - `'create'` — step 1 (create-in-new) failed. When a shell was minted but its
 *     field write failed, `createdTargetId` carries that shell id so a retry UPDATES
 *     it instead of minting a duplicate (mirrors `ProfileSaveError.createdProfileId`).
 *     The value is still ONLY in the source → no loss, no duplicate.
 *   - `'delete'` — step 2 (delete-from-old) failed AFTER the create was confirmed →
 *     the value is now in BOTH entities (a DUPLICATE the AC3 path must surface/repair).
 */
export class FieldMoveError extends Error {
	readonly phase: 'create' | 'delete';
	readonly createdTargetId?: string;
	constructor(message: string, phase: 'create' | 'delete', createdTargetId?: string) {
		super(message);
		this.name = 'FieldMoveError';
		this.phase = phase;
		this.createdTargetId = createdTargetId;
	}
}

export interface FieldMoveInput {
	cfg: EntuCfg;
	personId: string;
	field: FieldKey;
	fromLevel: Level;
	toLevel: Level;
	/** The value being moved (the source entity's current value for `field`). */
	value: string;
	/** The source (old-level) entity id — always exists (it holds `value`). */
	srcId: string;
	/** The target (new-level) entity id, or null when it must be lazily created first. */
	dstId: string | null;
	/** The source entity's OTHER field's value — preserved on the delete-from-old rewrite. */
	srcSibling: string;
	/** The target entity's OTHER field's value — preserved on the create/add rewrite (ignored when dstId null). */
	dstSibling: string;
}

export interface FieldMoveResult {
	field: FieldKey;
	fromLevel: Level;
	toLevel: Level;
	/** The entity the value now lives in (created or existing target). */
	targetId: string;
	/** The entity the value was deleted from. */
	sourceId: string;
}

/**
 * Dispatch one visibility move, create-before-delete (AC1):
 *   step 1 — create-in-new: `dstId` null → `createOwnProfile(cfg, personId, toLevel)`
 *     then `saveProfileFields(dstNew, { [field]: value, [other]: '' })`; `dstId` set →
 *     `saveProfileFields(dstId, { [field]: value, [other]: dstSibling })`. On a
 *     shell-minted-then-field-write failure → throw `FieldMoveError('...', 'create',
 *     shellId)`. `onPhase('created', targetId)` fires ONLY after this is server-confirmed.
 *   step 2 — delete-from-old: `saveProfileFields(srcId, { [field]: '', [other]:
 *     srcSibling })`. On failure → throw `FieldMoveError('...', 'delete')` (value now
 *     in both). `onPhase('deleted', targetId)` fires after this is server-confirmed.
 * The delete is NEVER issued until the create resolves — the load-bearing ordering.
 */
export async function applyFieldMove(
	input: FieldMoveInput,
	onPhase: (phase: MovePhase, targetId: string) => void,
	fetchImpl: typeof fetch = fetch
): Promise<FieldMoveResult> {
	const { cfg, personId, field, fromLevel, toLevel, value, srcId, dstId, srcSibling, dstSibling } = input;

	// ── Step 1 — CREATE-IN-NEW (always first; the only safety, no transaction exists) ──
	let targetId: string;
	if (dstId === null) {
		// The target-level entity doesn't exist yet — lazily create the shell through the
		// sole create path (createOwnProfile → createProfile), THEN add the moved value.
		// The shell is a bare `_sharing`-only entity; the sibling is empty on it.
		const shellId = await createOwnProfile(cfg, personId, toLevel, fetchImpl);
		targetId = shellId;
		try {
			await saveProfileFields(cfg, targetId, pair(field, value, ''), fetchImpl);
		} catch (e) {
			// Shell was minted but its field-write failed — carry the shell id so a retry
			// UPDATES it (no duplicate shell). Value is still ONLY in the source → no loss.
			throw new FieldMoveError(
				`applyFieldMove: add ${field} to new ${toLevel} profile failed: ${errMsg(e)}`,
				'create',
				shellId
			);
		}
	} else {
		// The target-level entity already exists — add the moved value, preserving its
		// existing sibling (whole-pair rewrite).
		targetId = dstId;
		try {
			await saveProfileFields(cfg, targetId, pair(field, value, dstSibling), fetchImpl);
		} catch (e) {
			throw new FieldMoveError(
				`applyFieldMove: add ${field} to existing ${toLevel} profile failed: ${errMsg(e)}`,
				'create'
			);
		}
	}
	// Step 1 is SERVER-CONFIRMED — only now may the delete run.
	onPhase('created', targetId);

	// ── Step 2 — DELETE-FROM-OLD (only after create confirmed) ──
	try {
		await saveProfileFields(cfg, srcId, pair(field, '', srcSibling), fetchImpl);
	} catch (e) {
		// The create WAS confirmed → the value now lives in BOTH entities: a detectable
		// duplicate (the AC3 privacy repair completes this delete), never a loss.
		throw new FieldMoveError(
			`applyFieldMove: delete ${field} from old ${fromLevel} profile failed: ${errMsg(e)}`,
			'delete'
		);
	}
	onPhase('deleted', targetId);

	return { field, fromLevel, toLevel, targetId, sourceId: srcId };
}

export interface DuplicateRepairInput {
	cfg: EntuCfg;
	field: FieldKey;
	/** Each entity to clear the field from, with its OTHER field's value preserved. */
	clear: { id: string; sibling: string }[];
}

/**
 * Complete an interrupted move by DELETING the field from every `clear` entity —
 * `saveProfileFields(cfg, id, { [field]: '', [other]: sibling })` per entry. This is
 * the AC3 repair: it retracts the exposure (a tightening left the value live in the
 * wider entity — narrower-wins hides it on OUR render but it is genuinely readable off
 * the Entu API, Flag 3). Fails loud — the first failure propagates.
 */
export async function applyDuplicateRepair(
	input: DuplicateRepairInput,
	fetchImpl: typeof fetch = fetch
): Promise<{ field: FieldKey; clearedIds: string[] }> {
	const { cfg, field, clear } = input;
	const clearedIds: string[] = [];
	// Serial, fail-loud: the FIRST failure propagates (never a partial silent success) —
	// a still-live wider copy that we falsely reported as repaired would hide the exposure.
	for (const entry of clear) {
		await saveProfileFields(cfg, entry.id, pair(field, '', entry.sibling), fetchImpl);
		clearedIds.push(entry.id);
	}
	return { field, clearedIds };
}

/** An actionable, load-detected repair for one duplicated field (AC3 surfacing). */
export interface DuplicateRepairPlan {
	field: FieldKey;
	/** The narrowest holder — the value is KEPT here (fails toward privacy). */
	narrowLevel: Level;
	narrowId: string;
	/** The wider holders whose copy must be cleared to complete the move. */
	widerLevels: Level[];
	/** The concrete delete list (id + preserved sibling) to hand to `applyDuplicateRepair`. */
	clear: { id: string; sibling: string }[];
}

/**
 * Pure — DETECT interrupted moves at load and PLAN their repair (AC3). For each field
 * (name, email), a value present on ≥2 entities is an unfinished move (an
 * inconsistency, NOT a legitimate state). At load the direction is lost, so the
 * privacy-safe universal rule applies: keep the NARROWEST holder, clear every wider
 * one. Returns an actionable plan per duplicated field — the ACTIVE repair surface
 * (not two passive icons); an empty array when nothing is duplicated.
 */
export function planLoadedDuplicateRepairs(ps: MyProfile[]): DuplicateRepairPlan[] {
	const plans: DuplicateRepairPlan[] = [];
	for (const field of ['name', 'email'] as FieldKey[]) {
		const other = siblingOf(field);
		// Non-empty holders, narrow→wide.
		const holders = ps
			.filter((p) => p[field] !== '')
			.slice()
			.sort((a, b) => MOVE_NARROWNESS[a._sharing] - MOVE_NARROWNESS[b._sharing]);
		if (holders.length < 2) continue;
		// An interrupted MOVE copies the SAME value into a second entity — so a duplicate
		// is a value held by ≥2 entities. Distinct per-level values are legitimate (T4.6
		// let each level carry its own name/email), NOT an unfinished move. Pick the value
		// shared by ≥2 holders (at most one such group exists across ≤3 levels).
		const counts = new Map<string, number>();
		for (const p of holders) counts.set(p[field], (counts.get(p[field]) ?? 0) + 1);
		const dupValue = holders.find((p) => (counts.get(p[field]) ?? 0) >= 2)?.[field];
		if (dupValue === undefined) continue;
		const group = holders.filter((p) => p[field] === dupValue); // still narrow→wide
		const [narrow, ...wider] = group;
		// Privacy-safe universal rule (direction is lost at load, Flag 3): KEEP the
		// narrowest, CLEAR every wider holder — completing the delete toward privacy.
		plans.push({
			field,
			narrowLevel: narrow._sharing,
			narrowId: narrow._id,
			widerLevels: wider.map((p) => p._sharing),
			clear: wider.map((p) => ({ id: p._id, sibling: p[other] }))
		});
	}
	return plans;
}

// (*MVOX:Tallis* — RED specs) (*MVOX:Josquin* — GREEN implementation)
