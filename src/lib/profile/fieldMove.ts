// Visibility moves between profile tiers, and the repairs for moves cut short.
import type { EntuCfg } from '$lib/entu/cfg';
import type { Level, MyProfile } from './profileData';
import { createOwnProfile, saveProfileFields } from './profileData';

// Lower is narrower; a repair keeps the narrowest holder.
const MOVE_NARROWNESS: Record<Level, number> = { private: 0, domain: 1, public: 2 };

function siblingOf(field: FieldKey): FieldKey {
	return field === 'name' ? 'email' : 'name';
}

// saveProfileFields rewrites the whole name+email pair, so both always go together.
function pair(field: FieldKey, fieldValue: string, sibling: string): { name: string; email: string } {
	return field === 'name' ? { name: fieldValue, email: sibling } : { name: sibling, email: fieldValue };
}

function errMsg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

export type FieldKey = 'name' | 'email';

export type MovePhase = 'created' | 'deleted';

// phase 'create': the value is still only in the source; createdTargetId lets a retry reuse
// the minted shell. phase 'delete': the value is now in both entities.
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
	value: string;
	srcId: string;
	dstId: string | null;
	srcSibling: string;
	dstSibling: string;
}

export interface FieldMoveResult {
	field: FieldKey;
	fromLevel: Level;
	toLevel: Level;
	targetId: string;
	sourceId: string;
}

// Entu has no transaction, so a move is two writes: create in the new tier first, then
// delete from the old. An interruption leaves a duplicate (repaired at load), never a loss.
export async function applyFieldMove(
	input: FieldMoveInput,
	onPhase: (phase: MovePhase, targetId: string) => void,
	fetchImpl: typeof fetch = fetch
): Promise<FieldMoveResult> {
	const { cfg, personId, field, fromLevel, toLevel, value, srcId, dstId, srcSibling, dstSibling } = input;

	let targetId: string;
	if (dstId === null) {
		const shellId = await createOwnProfile(cfg, personId, toLevel, fetchImpl);
		targetId = shellId;
		try {
			await saveProfileFields(cfg, targetId, pair(field, value, ''), fetchImpl);
		} catch (e) {
			throw new FieldMoveError(
				`applyFieldMove: add ${field} to new ${toLevel} profile failed: ${errMsg(e)}`,
				'create',
				shellId
			);
		}
	} else {
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
	onPhase('created', targetId);

	try {
		await saveProfileFields(cfg, srcId, pair(field, '', srcSibling), fetchImpl);
	} catch (e) {
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
	clear: { id: string; sibling: string }[];
}

// Serial and fail-loud: a still-readable wider copy must never be reported as repaired.
export async function applyDuplicateRepair(
	input: DuplicateRepairInput,
	fetchImpl: typeof fetch = fetch
): Promise<{ field: FieldKey; clearedIds: string[] }> {
	const { cfg, field, clear } = input;
	const clearedIds: string[] = [];
	for (const entry of clear) {
		await saveProfileFields(cfg, entry.id, pair(field, '', entry.sibling), fetchImpl);
		clearedIds.push(entry.id);
	}
	return { field, clearedIds };
}

export interface ConflictResolutionInput {
	cfg: EntuCfg;
	field: FieldKey;
	value: string;
	sync: { id: string; sibling: string }[];
}

// A conflict is different legitimate values across tiers: every holder converges onto the
// chosen value and none is cleared.
export async function applyConflictResolution(
	input: ConflictResolutionInput,
	fetchImpl: typeof fetch = fetch
): Promise<{ field: FieldKey; syncedIds: string[] }> {
	const { cfg, field, value, sync } = input;
	const syncedIds: string[] = [];
	for (const entry of sync) {
		await saveProfileFields(cfg, entry.id, pair(field, value, entry.sibling), fetchImpl);
		syncedIds.push(entry.id);
	}
	return { field, syncedIds };
}

export interface DuplicateRepairPlan {
	field: FieldKey;
	narrowLevel: Level;
	narrowId: string;
	widerLevels: Level[];
	clear: { id: string; sibling: string }[];
}

// A value held by 2+ entities is an unfinished move; distinct per-tier values are legitimate.
// The direction is lost at load, so keep the narrowest holder and clear the wider ones.
export function planLoadedDuplicateRepairs(ps: MyProfile[]): DuplicateRepairPlan[] {
	const plans: DuplicateRepairPlan[] = [];
	for (const field of ['name', 'email'] as FieldKey[]) {
		const other = siblingOf(field);
		const holders = ps
			.filter((p) => p[field] !== '')
			.slice()
			.sort((a, b) => MOVE_NARROWNESS[a._sharing] - MOVE_NARROWNESS[b._sharing]);
		if (holders.length < 2) continue;
		const counts = new Map<string, number>();
		for (const p of holders) counts.set(p[field], (counts.get(p[field]) ?? 0) + 1);
		const dupValue = holders.find((p) => (counts.get(p[field]) ?? 0) >= 2)?.[field];
		if (dupValue === undefined) continue;
		const group = holders.filter((p) => p[field] === dupValue); // still narrow→wide
		const [narrow, ...wider] = group;
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
