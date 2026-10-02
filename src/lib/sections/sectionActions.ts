// Section write layer; specs and pages mock this one path, so every part re-exports here.
import { postEntity } from '$lib/entity/entityCreateShared';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';

export { assignMemberSection, unassignMemberSection } from './sectionMembership';
export { reorderSections, deleteSection, reparentSection, renameSection } from './sectionTreeWrites';

export interface CreateSectionInput {
	name: string;
	parentId?: string | null;
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

	const props: Array<{ type: string; reference?: string; string?: string }> = [
		{ type: '_type', reference: typeId },
		{ type: '_parent', reference: parentRef },
		{ type: 'name', string: name }
	];

	return postEntity(cfg, 'createSection', props, fetchImpl);
}
