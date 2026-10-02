// Section tree writes: renumber, delete, reparent and rename.
import { entuFetch } from '$lib/entu/request';
import { overwriteEntityValues, replaceEntityProperty } from '$lib/entu/replaceProperty';
import {
	SectionNotEmptyError,
	SectionParentDamagedError,
	SectionReparentPartialError
} from './sectionErrors';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { MemberParentValue } from './sectionMembership';

// A broken stream on an already-failing response must not mask the status the caller needs.
async function bodyTextOf(res: Response): Promise<string> {
	try {
		return await res.text();
	} catch {
		return '';
	}
}

// One sibling list, 1-based. The POST pairs the first old value's `_id`, so a failed POST
// leaves the old number; extra duplicates go only after it lands. Stops at the first failure.
export async function renumberDisplayOrder(
	cfg: EntuCfg,
	orderedIds: string[],
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const total = orderedIds.length;
	for (let i = 0; i < total; i++) {
		await replaceEntityProperty(cfg, orderedIds[i], { type: 'display_order', number: i + 1 }, fetchImpl, {
			fail: async (_step, res) =>
				new SectionReparentPartialError('renumber', i, total, res.status, await bodyTextOf(res))
		});
	}
}

export const reorderSections = renumberDisplayOrder;

interface CountBody {
	count?: number;
	entities?: unknown[];
}

async function countOf(res: Response): Promise<number> {
	const body = (await res.json()) as CountBody;
	return body.count ?? body.entities?.length ?? 0;
}

// The server-side counts are the only emptiness check that is neither stale nor narrowed to
// active members; deleting a non-empty section would silently drop members' `_parent` values.
export async function deleteSection(
	cfg: EntuCfg,
	sectionId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const scoped = `_parent.reference=${encodeURIComponent(sectionId)}&limit=1`;
	const [memberRes, childRes] = await Promise.all([
		entuFetch(cfg.db, `entity?_type.string=member&${scoped}`, cfg.token, {}, fetchImpl),
		entuFetch(cfg.db, `entity?_type.string=section&${scoped}`, cfg.token, {}, fetchImpl)
	]);
	if (!memberRes.ok) {
		throw new Error(`deleteSection: member lookup failed: HTTP ${memberRes.status}`);
	}
	if (!childRes.ok) {
		throw new Error(`deleteSection: sub-section lookup failed: HTTP ${childRes.status}`);
	}
	const [memberCount, childCount] = await Promise.all([countOf(memberRes), countOf(childRes)]);
	if (memberCount > 0 || childCount > 0) {
		throw new SectionNotEmptyError(sectionId, memberCount, childCount);
	}

	const res = await entuFetch(cfg.db, `entity/${sectionId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	if (!res.ok) throw new Error(`deleteSection failed: ${res.status}`);
}

// `_parent` DELETE is owner-gated, so the move is one atomic overwrite POST under the editor gate.
// Anything but exactly one `_parent` is damaged data: refuse before any write rather than guess.
export async function reparentSection(
	cfg: EntuCfg,
	sectionId: string,
	newParentId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	if (newParentId === sectionId) {
		throw new Error('reparentSection: a section cannot become its own parent');
	}

	const getRes = await entuFetch(cfg.db, `entity/${sectionId}?props=_parent`, cfg.token, {}, fetchImpl);
	if (!getRes.ok) {
		throw new SectionReparentPartialError('reparent', 0, 0, getRes.status, await bodyTextOf(getRes));
	}
	const body = (await getRes.json()) as { entity?: { _parent?: MemberParentValue[] } };
	const existing = body.entity?._parent ?? [];

	if (existing.length !== 1) {
		throw new SectionParentDamagedError(sectionId, existing.length);
	}

	await overwriteEntityValues(
		cfg,
		sectionId,
		[{ value: { type: '_parent', reference: newParentId }, existing }],
		fetchImpl,
		{
			fail: async (_step, res) =>
				new SectionReparentPartialError('reparent', 0, 0, res.status, await bodyTextOf(res))
		}
	);
}

// Atomic overwrite of `name`; extra duplicate values are deleted only after the POST lands.
export async function renameSection(
	cfg: EntuCfg,
	sectionId: string,
	name: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const trimmed = name.trim();
	if (!trimmed) {
		throw new Error('renameSection: name must not be empty');
	}

	await replaceEntityProperty(
		cfg,
		sectionId,
		{ type: 'name', string: trimmed },
		fetchImpl,
		'renameSection'
	);
}
