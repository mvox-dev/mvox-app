// Creates for the library's work and edition, through the same shared POST as the agenda's.
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { optional, postCreate, requireText, type WireProp } from './entityCreateShared';

export interface CreateWorkInput {
	name: string;
	// The library entity, the librarian's rights scope, never the database entity.
	libraryEntityId: string;
	composer?: string;
}

export async function createWork(
	cfg: EntuCfg,
	input: CreateWorkInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const fn = 'createWork';
	const name = requireText(fn, 'name', input.name);
	const libraryEntityId = requireText(fn, 'libraryEntityId', input.libraryEntityId);

	const props: WireProp[] = [
		{ type: 'name', string: name },
		...optional('composer', input.composer)
	];
	return postCreate(cfg, 'work', [libraryEntityId], props, fetchImpl);
}

export interface CreateEditionInput {
	name: string;
	workId: string;
	publisher?: string;
}

// edition_type is not accepted: it stays with the private set (#271).
export async function createEdition(
	cfg: EntuCfg,
	input: CreateEditionInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const fn = 'createEdition';
	const name = requireText(fn, 'name', input.name);
	const workId = requireText(fn, 'workId', input.workId);

	const props: WireProp[] = [
		{ type: 'name', string: name },
		...optional('publisher', input.publisher)
	];
	return postCreate(cfg, 'edition', [workId], props, fetchImpl);
}

// (*MVOX:Josquin*)
