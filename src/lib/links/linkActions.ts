// Link collection writes (#256); linkActions.spec.ts pins the full contract.
import { entuFetch } from '$lib/entu/request';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';
import { postEntity } from '$lib/entity/entityCreateShared';

export { renumberDisplayOrder as reorderLinks } from '$lib/sections/sectionTreeWrites';

function hasNonWhitespace(s: string): boolean {
	return /\S/.test(s);
}

export interface CreateLinkInput {
	name: string;
	// Stored as given (#256); the page has already run normalizeUrl (#374/#375).
	url: string;
	description?: string | null;
	displayOrder?: number | null;
	dbEntityId?: string | null;
}

export interface UpdateLinkFields {
	name: string;
	url: string;
	description: string | null;
}

type CreateProp =
	| { type: '_type'; reference: string }
	| { type: '_parent'; reference: string }
	| { type: 'name'; string: string }
	| { type: 'url'; string: string }
	| { type: 'description'; string: string }
	| { type: 'display_order'; number: number }
	| { type: '_sharing'; string: string }
	| { type: '_inheritrights'; boolean: boolean };

// `_sharing: 'domain'` is set at create: the type's own does not propagate, and #256 keeps links
// to members. `_inheritrights: true` states the cascade, as createSection does (#264 item 6).
export async function createLink(
	cfg: EntuCfg,
	input: CreateLinkInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const name = input.name.trim();
	if (!name) {
		throw new Error('createLink: name must not be empty');
	}
	if (!hasNonWhitespace(input.url)) {
		throw new Error('createLink: url must not be empty');
	}

	const typeId = await resolveTypeId(cfg, 'link', fetchImpl);

	let parentRef: string;
	if (input.dbEntityId) {
		parentRef = input.dbEntityId;
	} else {
		const { resolveDatabaseEntityId } = await import('$lib/collective/databaseEntity');
		const dbEntityId = await resolveDatabaseEntityId(cfg, fetchImpl);
		if (!dbEntityId) {
			throw new Error(
				`createLink: no database entity is readable in db '${cfg.db}' — a link requires a parent`
			);
		}
		parentRef = dbEntityId;
	}

	const props: CreateProp[] = [
		{ type: '_type', reference: typeId },
		{ type: '_parent', reference: parentRef },
		{ type: 'name', string: name },
		{ type: 'url', string: input.url }
	];
	if (input.description) {
		props.push({ type: 'description', string: input.description });
	}
	if (typeof input.displayOrder === 'number') {
		props.push({ type: 'display_order', number: input.displayOrder });
	}
	props.push({ type: '_sharing', string: 'domain' });
	props.push({ type: '_inheritrights', boolean: true });

	return postEntity(cfg, 'createLink', props, fetchImpl);
}

interface FieldValue {
	_id: string;
}

export async function updateLink(
	cfg: EntuCfg,
	linkId: string,
	fields: UpdateLinkFields,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const name = fields.name.trim();
	if (!name) {
		throw new Error('updateLink: name must not be empty');
	}
	if (!hasNonWhitespace(fields.url)) {
		throw new Error('updateLink: url must not be empty');
	}

	const getRes = await entuFetch(
		cfg.db,
		`entity/${linkId}?props=name,url,description`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!getRes.ok) throw new Error(`updateLink lookup failed: HTTP ${getRes.status}`);
	const body = (await getRes.json()) as {
		entity?: { name?: FieldValue[]; url?: FieldValue[]; description?: FieldValue[] };
	};
	const existingName = body.entity?.name ?? [];
	const existingUrl = body.entity?.url ?? [];
	const existingDescription = body.entity?.description ?? [];

	const entries: Array<{ _id?: string; type: string; string: string }> = [
		existingName[0]
			? { _id: existingName[0]._id, type: 'name', string: name }
			: { type: 'name', string: name },
		existingUrl[0]
			? { _id: existingUrl[0]._id, type: 'url', string: fields.url }
			: { type: 'url', string: fields.url }
	];
	if (fields.description) {
		entries.push(
			existingDescription[0]
				? { _id: existingDescription[0]._id, type: 'description', string: fields.description }
				: { type: 'description', string: fields.description }
		);
	}

	const postRes = await entuFetch(
		cfg.db,
		`entity/${linkId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(entries)
		},
		fetchImpl
	);
	if (!postRes.ok) throw new Error(`updateLink POST failed: HTTP ${postRes.status}`);

	// A cleared description is deleted by property id, strictly after the POST.
	if (!fields.description && existingDescription[0]) {
		const delRes = await entuFetch(
			cfg.db,
			`property/${existingDescription[0]._id}`,
			cfg.token,
			{ method: 'DELETE' },
			fetchImpl
		);
		if (!delRes.ok) throw new Error(`updateLink delete failed: HTTP ${delRes.status}`);
	}
}

// The entity endpoint: a /property/ DELETE here would 404 and leave the link standing.
export async function deleteLink(
	cfg: EntuCfg,
	linkId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const res = await entuFetch(cfg.db, `entity/${linkId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	if (!res.ok) throw new Error(`deleteLink failed: HTTP ${res.status}`);
}

// (*MVOX:Josquin*)
