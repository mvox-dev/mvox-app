// Section write layer; specs and pages mock this one path, so every part re-exports here.
import { entuFetch } from '$lib/entu/request';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';

export { assignMemberSection, unassignMemberSection } from './sectionMembership';
export { reorderSections, deleteSection, reparentSection, renameSection } from './sectionTreeWrites';

export interface CreateSectionInput {
	/** Section name (required; trimmed before sending). */
	name: string;
	/** Parent SECTION id; absent/null = top level (direct child of the collective). */
	parentId?: string | null;
	/** The collective's database entity id, which the caller already holds (#161). */
	dbEntityId?: string | null;
}

// Parent: the given section, else the caller's database entity id, else the one database entity
// (#161). A nameless or parentless section is never created; the picker checks duplicate names.
export async function createSection(
	cfg: EntuCfg,
	input: CreateSectionInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const name = input.name.trim();
	if (!name) {
		throw new Error('createSection: name must not be empty');
	}

	const typeId = await resolveTypeId(cfg, 'section', fetchImpl);

	let parentRef: string;
	if (input.parentId) {
		parentRef = input.parentId;
	} else if (input.dbEntityId) {
		parentRef = input.dbEntityId;
	} else {
		const { resolveDatabaseEntityId } = await import('$lib/collective/databaseEntity');
		const dbEntityId = await resolveDatabaseEntityId(cfg, fetchImpl);
		if (!dbEntityId) {
			throw new Error(
				`createSection: no database entity is readable in db '${cfg.db}' — a section requires a parent`
			);
		}
		parentRef = dbEntityId;
	}

	// `public` is a deliberate widen for federation discoverability (#133); inheriting would give
	// `domain`. `_inheritrights` states the cascade the create relied on (#264 item 6): keep both.
	const props: Array<{ type: string; reference?: string; string?: string; boolean?: boolean }> = [
		{ type: '_type', reference: typeId },
		{ type: '_parent', reference: parentRef },
		{ type: 'name', string: name },
		{ type: '_sharing', string: 'public' },
		{ type: '_inheritrights', boolean: true }
	];

	const createRes = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(props)
		},
		fetchImpl
	);
	if (!createRes.ok) {
		throw new Error(`createSection: create failed: HTTP ${createRes.status}`);
	}
	const createBody = (await createRes.json()) as { _id?: string };
	if (!createBody._id) {
		throw new Error('createSection: create returned 2xx without _id (apparent-success trap)');
	}
	return createBody._id;
}
