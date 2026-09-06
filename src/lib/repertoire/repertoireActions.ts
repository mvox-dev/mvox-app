import { entuFetch } from '$lib/entu/request';
import { replaceEntityProperty } from '$lib/entu/replaceProperty';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';
import type { Work } from '$lib/library/libraryData';
import type { RepertoireItem } from './repertoireData';
import type { ManageRightsState, RepertoireStatus } from './types';

// #91 TR.3 GREEN — repertoire/programme management: the rights-based WRITE
// layer on top of TR.2's read surfaces. Mirrors attendanceData.ts' per-tap
// write mechanics, with the structural anchors pinned by #91 + schema.ts:
//
//   - `repertoire_item` is a CHILD OF SEASON (`_parent` = seasonId); props:
//     work (ref, required), edition (ref, optional pinned edition), status
//     ('learning | active | retired | dropped', default 'active'). NO
//     sentinels — unlike rsvp/attendance, status here has no `<status>_ref`
//     companion prop.
//   - `program_item` is a CHILD OF EVENT (`_parent` = eventId); props: edition
//     (ref, required), ordinal (NUMBER, concert position — sent as
//     `{ number: n }`, never `{ string: ... }`), notes (text, not written here).
//   - `_type` sent as a resolved REFERENCE, never a string (#10 pinned
//     wire-shape); type names 'repertoire_item' / 'program_item'.
//   - `_sharing` (#133 audit): repertoire_item sends NO explicit `_sharing` —
//     its parent (season) is uniformly `domain` (2/2 live, inherited from the
//     domain org), so inherit already lands `domain`. program_item KEEPS an explicit
//     `_sharing: domain` — its parent (event) is NOT uniformly domain (one live
//     event is `public`), so inherit would be variable; the explicit cap pins
//     the intended tier regardless of the parent event's own tier.
//   - UPDATE = the shared ATOMIC overwrite (#264 PO ruling, branch (i)):
//     `replaceEntityProperty` (entu/replaceProperty.ts) — GET the current
//     value-id(s), then ONE POST whose entry pairs the FIRST existing id with
//     the new value (Entu's native overwrite; `setEntity` soft-deletes the old
//     value in the SAME call). Corrupted-state extras are swept at
//     `/property/{id}` strictly AFTER the POST; the normal (≤1-value) path
//     issues ZERO deletes.
//   - per-tap immediate writes — NOT batch. Each control tap is one round-trip;
//     there is no "save all" payload shape anywhere in this module's API.
//   - rights: management controls render iff the current person holds `_editor`
//     (or `_owner`) on the season (repertoire) / event (programme) — read off
//     the entity's own rights props, same pattern as librarianStore. No new
//     seat wiring.

// The status union is defined next to the view model (repertoire/types.ts) so
// the renderer can name it without importing this module (and its entuFetch
// dependency). Re-exported here for callers that only touch the write layer.
export type { RepertoireStatus } from './types';

export interface CreateRepertoireItemInput {
	seasonId: string;
	workId: string;
	status?: RepertoireStatus;
}

/**
 * Create a repertoire_item under a season. `_type` resolved to a reference
 * (#10 pinned wire-shape). `status` defaults to 'active' (schema default) when
 * omitted.
 *
 * #133: NO explicit `_sharing` — the direct parent (season) is uniformly `domain`
 * (2/2 live, inherited from the domain org), so Entu's create-time copy
 * (utils/entity.js:296-327) already lands `domain` here.
 */
export async function createRepertoireItem(
	cfg: EntuCfg,
	input: CreateRepertoireItemInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const typeId = await resolveTypeId(cfg, 'repertoire_item', fetchImpl);
	const status = input.status ?? 'active';
	// `_sharing` inherited from the season parent (itself inherited from the
	// org) via Entu's create-time copy — #133.
	const props = [
		{ type: '_type', reference: typeId },
		{ type: '_parent', reference: input.seasonId },
		{ type: 'work', reference: input.workId },
		{ type: 'status', string: status }
	];
	const res = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(props) },
		fetchImpl
	);
	if (!res.ok) throw new Error(`createRepertoireItem failed: ${res.status}`);
	const body = (await res.json()) as { _id: string };
	return body._id;
}

/**
 * Change a repertoire_item's status — the shared ATOMIC overwrite (#264,
 * `replaceEntityProperty`). Unlike attendance, status here carries NO
 * sentinel companion prop, so this is a bare single-property replace.
 */
export async function updateRepertoireStatus(
	cfg: EntuCfg,
	itemId: string,
	status: RepertoireStatus,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await replaceEntityProperty(cfg, itemId, { type: 'status', string: status }, fetchImpl, 'updateRepertoireStatus');
}

/**
 * Set/replace a repertoire_item's pinned edition — the shared ATOMIC overwrite
 * (#264, `replaceEntityProperty`). `edition` is a reference prop; a re-pin
 * without the atomic `_id` pairing would leave TWO edition refs.
 */
export async function pinEdition(
	cfg: EntuCfg,
	itemId: string,
	editionId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await replaceEntityProperty(cfg, itemId, { type: 'edition', reference: editionId }, fetchImpl, 'pinEdition');
}

/** Delete a repertoire_item entity ("Remove" — #91). The work itself is untouched. */
export async function deleteRepertoireItem(
	cfg: EntuCfg,
	itemId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const res = await entuFetch(cfg.db, `entity/${itemId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	if (!res.ok) throw new Error(`deleteRepertoireItem failed: ${res.status}`);
}

export interface CreateProgramItemInput {
	eventId: string;
	editionId: string;
	ordinal: number;
}

/**
 * Create a program_item under an event. `ordinal` is a NUMBER prop — always
 * sent as `{ number: n }`, including `0` (the opening piece — a falsy-drop
 * would create an unordered program_item).
 *
 * explicit `_sharing` required (#133 audit): the parent (event) is NOT a
 * uniformly-domain tier — one live event is `public` — so relying on inherit
 * would let a program_item under that event land `public`, and aggregate.js:269
 * then drops its domain-tier prop-defs (edition/ordinal) from ordinary reads.
 * The explicit `domain` pins the intended tier independent of the parent event.
 */
export async function createProgramItem(
	cfg: EntuCfg,
	input: CreateProgramItemInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const typeId = await resolveTypeId(cfg, 'program_item', fetchImpl);
	const props = [
		{ type: '_type', reference: typeId },
		{ type: '_parent', reference: input.eventId },
		{ type: 'edition', reference: input.editionId },
		{ type: 'ordinal', number: input.ordinal },
		{ type: '_sharing', string: 'domain' }
	];
	const res = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(props) },
		fetchImpl
	);
	if (!res.ok) throw new Error(`createProgramItem failed: ${res.status}`);
	const body = (await res.json()) as { _id: string };
	return body._id;
}

/**
 * Reorder: set a program_item's ordinal — the shared ATOMIC overwrite (#264,
 * `replaceEntityProperty`), with a number prop. `0` is a legal target (move to
 * the opening slot); a mid-reorder failure can never leave a program_item
 * with NO ordinal (the atomic entry carries the old `_id`, so a rejected POST
 * changes nothing).
 */
export async function updateProgramItemOrdinal(
	cfg: EntuCfg,
	itemId: string,
	ordinal: number,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await replaceEntityProperty(
		cfg,
		itemId,
		{ type: 'ordinal', number: ordinal },
		fetchImpl,
		'updateProgramItemOrdinal'
	);
}

/** One program_item's position, as read off the rendered programme. */
export interface ProgramOrdinal {
	id: string;
	ordinal: number;
}

/**
 * A one-step reorder, as the full set of ordinal writes it actually needs.
 *
 * `updateProgramItemOrdinal` alone CANNOT reorder anything: moving B (ordinal
 * 1) up to 0 while A stays at 0 leaves two items sharing 0, and
 * `listProgramItems`' `(a, b) => a.ordinal - b.ordinal` is a no-op for equal
 * keys — the move visibly does nothing, and repeated moves pile up duplicates.
 * Every move therefore writes BOTH sides.
 *
 * Implemented as a renumber rather than a bare swap, because duplicate ordinals
 * ALREADY exist in the wild (`mandatory: true` is a soft UI hint in Entu, so
 * two program_items can both default to 0) and swapping two equal ordinals is
 * itself a no-op. The list is renumbered 0..n-1 in display order with the item
 * moved one slot; only items whose ordinal actually CHANGES get a write, so the
 * clean case still emits exactly the two swapped numbers.
 *
 * Pure — no fetch. Returns [] when the move is impossible (unknown id, or a
 * boundary row), which the caller must treat as "do nothing", never as success.
 */
export function planProgramMove(
	items: ProgramOrdinal[],
	itemId: string,
	direction: 'up' | 'down'
): ProgramOrdinal[] {
	// Display order — the same stable sort the renderer uses, so "the row above"
	// here is the row the editor actually saw above.
	const ordered = [...items].sort((a, b) => a.ordinal - b.ordinal);
	const from = ordered.findIndex((item) => item.id === itemId);
	if (from === -1) return [];
	const to = direction === 'up' ? from - 1 : from + 1;
	if (to < 0 || to >= ordered.length) return [];

	const moved = [...ordered];
	const [item] = moved.splice(from, 1);
	moved.splice(to, 0, item);

	const current = new Map(items.map((i) => [i.id, i.ordinal]));
	return moved
		.map((entry, index) => ({ id: entry.id, ordinal: index }))
		.filter((entry) => current.get(entry.id) !== entry.ordinal);
}

/**
 * Apply a `planProgramMove` result. Sequential, not `Promise.all`: each write
 * is itself a GET existing id(s) → ONE POST pairing the first old `_id` with
 * the new value (corrupted extras only are swept after the POST; the normal
 * ≤1-value path issues zero deletes), and a deterministic order makes a
 * partial failure diagnosable (the writes that landed are a prefix of the plan)
 * instead of an arbitrary half-state. Fails loud on the first rejection — the
 * caller reverts its optimistic reorder and surfaces the error.
 */
export async function reorderProgramItems(
	cfg: EntuCfg,
	writes: ProgramOrdinal[],
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	for (const write of writes) {
		await updateProgramItemOrdinal(cfg, write.id, write.ordinal, fetchImpl);
	}
}

/**
 * Delete a program_item entity ("Remove from tonight" — #91). Once the LAST
 * one under an event is gone, that event falls back to the season's
 * repertoire (TR.2's hierarchy) — nothing here special-cases that; it's a
 * pure consequence of resolveEventWorks reading zero program_items.
 */
export async function deleteProgramItem(
	cfg: EntuCfg,
	itemId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const res = await entuFetch(cfg.db, `entity/${itemId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	if (!res.ok) throw new Error(`deleteProgramItem failed: ${res.status}`);
}

// Defined next to the view model (repertoire/types.ts) for the same reason as
// RepertoireStatus — the renderer names it without importing the write layer.
export type { ManageRightsState } from './types';

/**
 * Rights determination for management controls: the current person may
 * manage repertoire iff they hold `_editor` (or `_owner` — ownership subsumes
 * editing) on the given entity (a season for repertoire, an event for
 * programme). Reads the entity's OWN rights props — same pattern as
 * adminStore/librarianStore, no new seat wiring.
 *
 * Rights-bucket mechanics (verified from Entu source): `_owner`/`_editor`
 * props live in the PRIVATE bucket — a caller WITHOUT a rights grant reads
 * the entity (domain `_sharing`) but simply does not see the rights props at
 * all. Absence IS the clean negative signal ('not-editor'); a fetch/HTTP
 * failure is NOT — it surfaces as 'error', never silently collapsed into
 * 'not-editor' (a network blip must not demote an editor).
 */
export function manageRightsFrom(
	owners: readonly string[],
	editors: readonly string[],
	personId: string
): ManageRightsState {
	return owners.includes(personId) || editors.includes(personId) ? 'editor' : 'not-editor';
}

/**
 * Single-entity variant of the above, for callers that hold an entity id and
 * nothing else. NOT the agenda's path (#91 review F1): the season and event
 * reads already carry `_owner`/`_editor`, so the page derives rights with
 * `manageRightsFrom` and spends no round-trip at all. Using this per agenda
 * event fanned out one GET per event (up to `limit=500`) on every page load,
 * for every member, editor or not.
 */
export async function resolveManageRights(
	cfg: EntuCfg,
	entityId: string,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<ManageRightsState> {
	try {
		const res = await entuFetch(
			cfg.db,
			`entity/${entityId}?props=_owner,_editor`,
			cfg.token,
			{},
			fetchImpl
		);
		if (!res.ok) return 'error';
		const body = (await res.json()) as {
			entity?: {
				_owner?: Array<{ reference?: string }>;
				_editor?: Array<{ reference?: string }>;
			};
		};
		const entity = body.entity ?? {};
		const owners = (entity._owner ?? []).flatMap((r) => (r.reference ? [r.reference] : []));
		const editors = (entity._editor ?? []).flatMap((r) => (r.reference ? [r.reference] : []));
		return manageRightsFrom(owners, editors, personId);
	} catch {
		return 'error';
	}
}

/**
 * "Add work" picker: library works NOT already present in the current
 * season's repertoire (by workId), preserving library order. Pure — no
 * fetch. Excludes a work regardless of its repertoire_item's status: a
 * retired/dropped item is STILL a repertoire_item, re-activated via the
 * status toggle, never re-created as a duplicate.
 */
export function pickableWorks(works: Work[], repertoire: RepertoireItem[]): Work[] {
	const presentWorkIds = new Set(repertoire.map((item) => item.workId));
	return works.filter((work) => !presentWorkIds.has(work.id));
}

export interface RepertoireWriteQueueCallbacks {
	/** Mark/unmark `key` as having a write in flight, synchronously. */
	setPending(key: string, pending: boolean): void;
	/** The write for `key` settled successfully — the optimistic value (if any)
	 *  is now real; refresh against the server. */
	reconcile(key: string): void;
	/** The write for `key` failed. Fires AFTER the request's own `rollback`, so
	 *  the local state is already back to its pre-tap value by the time this
	 *  runs — this is the place to surface the failure, not to undo it. */
	revert(key: string): void;
}

/**
 * The optimistic half of a request, supplied per tap because only the caller
 * knows what the tap means locally (a status flipped, a row dropped, two rows
 * swapped). Both are OPTIONAL: a create has nothing to show optimistically —
 * the new entity's id only exists once the server answers — so it runs as a
 * plain pending-then-refresh write.
 */
export interface OptimisticHooks {
	/** Applied SYNCHRONOUSLY before the write is fired — the row must change on
	 *  tap, not after a round-trip. */
	apply?: () => void;
	/** Undo of `apply`, run on rejection before `revert(key)`. Supply it
	 *  whenever `apply` is supplied; without it a failed write leaves a lie on
	 *  screen. */
	rollback?: () => void;
}

export interface RepertoireWriteQueue {
	/** Fire `write` immediately for `key`, unless `key` already has a write in
	 *  flight (defensive backstop — the primary guard is the UI disabling the
	 *  control for a pending key). `hooks.apply` runs synchronously first. */
	request(key: string, write: () => Promise<void>, hooks?: OptimisticHooks): void;
	isPending(key: string): boolean;
}

/**
 * Per-tap optimistic-and-reconcile write queue, generalized across repertoire
 * management's heterogeneous write kinds (create/status/pin/delete/ordinal) —
 * the queue takes the write as a thunk and guards per KEY (the repertoire_item
 * / program_item id, or a caller-chosen key like `add:<workId>` for creates
 * where no item id exists yet).
 *
 * Optimistic in the RSVP/attendance sense (rsvpChangeQueue.ts): the local
 * mutation lands synchronously on tap, the write goes out, and the settle path
 * either reconciles it against the server or rolls it back. The local mutation
 * and its inverse arrive as `hooks` rather than as typed values because the
 * five write kinds have no common value shape — a queue that only flipped a
 * pending flag would leave every control dead until a full refetch, which is
 * exactly what "optimistic" is supposed to avoid.
 *
 * The #15 lesson carries over verbatim: the primary double-tap guard is the
 * UI disabling the control while its key is pending (via setPending); this
 * queue's own per-key guard is a defensive backstop. All callbacks are
 * PER-KEY — there is no whole-map operation in this API for a caller to
 * misuse, so one item's failure structurally cannot clobber another item's
 * in-flight state.
 */
export function createRepertoireWriteQueue(callbacks: RepertoireWriteQueueCallbacks): RepertoireWriteQueue {
	const pending = new Set<string>();

	return {
		request(key, write, hooks) {
			if (pending.has(key)) return;

			pending.add(key);
			callbacks.setPending(key, true);
			// Before the write, not after: the row changes on tap.
			hooks?.apply?.();

			write()
				.then(() => {
					pending.delete(key);
					callbacks.setPending(key, false);
					callbacks.reconcile(key);
				})
				.catch(() => {
					pending.delete(key);
					callbacks.setPending(key, false);
					// Undo the optimistic mutation FIRST, so `revert` observes (and the
					// user sees) the pre-tap state, not the lie.
					hooks?.rollback?.();
					callbacks.revert(key);
				});
		},
		isPending(key) {
			return pending.has(key);
		}
	};
}

// (*MVOX:Josquin*)
