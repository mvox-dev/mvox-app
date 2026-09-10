// #256 GREEN — Lingikogu (link collection) WRITE layer. Model: sectionActions.ts
// (the verified closest pattern — see linkActions.spec.ts for the full pinned
// contract):
//
//   - createLink: `_type` sent as a resolved REFERENCE via resolveTypeId
//     (never `{ string: 'link' }`); `_parent` = the collective's DATABASE
//     entity (#161) — `dbEntityId` given is used VERBATIM (mirrors
//     CreateSectionInput.dbEntityId, zero lookup fetches), absent resolves
//     the database entity, no readable one fails loud naming the db. `name`
//     trimmed/required; `url` required non-empty (a non-whitespace char) and
//     otherwise sent VERBATIM — no trim, no normalising, no scheme-guessing
//     (#256 ruling: "URLs are stored as given"). `description` written only
//     when non-empty. `display_order` written when a number is given (the
//     page passes max existing + 1). `_sharing: 'domain'` EXPLICIT at create
//     time (every entity owns its own `_sharing`; the type-def's `domain`
//     does not propagate — unlike createSection's deliberate widen to
//     'public', #256's ruling is members-only visibility, which the parent
//     database's own domain tier already is). `_inheritrights: true`
//     EXPLICIT, same #264-item-6 discipline as createSection.
//   - updateLink: whole-field edit via the atomic overwrite, exactly
//     renameSection's shape but across all three fields in one POST;
//     `description: null` clears an existing value via
//     `DELETE /property/{id}` strictly AFTER the POST (the documented
//     user-facing removal — property-VALUE endpoint, never /entity/).
//   - reorderLinks: exactly reorderSections' atomic-overwrite renumber.
//   - deleteLink: `DELETE /entity/{id}` — the entity side of the endpoint
//     split (a /property/ DELETE here would 404 and leave the link standing).
import { entuFetch } from '$lib/entu/request';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';

function hasNonWhitespace(s: string): boolean {
	return /\S/.test(s);
}

export interface CreateLinkInput {
	/** Required non-empty (trimmed before sending — house name hygiene). */
	name: string;
	/**
	 * Required non-empty (must contain a non-whitespace char). Sent VERBATIM —
	 * no trim, no normalising, no scheme-guessing, no validation beyond
	 * non-empty (#256 ruling: "URLs are stored as given").
	 */
	url: string;
	/** Optional one-liner; absent/empty → NO description property is written. */
	description?: string | null;
	/** 1-based ordinal for the new link; the page passes max existing + 1. */
	displayOrder?: number | null;
	/** The collective's DATABASE entity id when the caller already holds it —
	 *  used as `_parent` VERBATIM, zero lookup fetches (mirrors
	 *  CreateSectionInput.dbEntityId). Absent → resolveDatabaseEntityId. */
	dbEntityId?: string | null;
}

/** Whole-field edit payload — the edit form submits all three fields. */
export interface UpdateLinkFields {
	name: string;
	url: string;
	/** null = the link has no description any more (clears an existing one). */
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

export async function createLink(
	cfg: EntuCfg,
	input: CreateLinkInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	// Name/url hygiene BEFORE any fetch — a defense-in-depth mirror of the
	// page's own guard; the data layer must not create a nameless/urlless link.
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
		// The caller already knows the collective (database entity) id — use it
		// verbatim, ZERO lookup fetches.
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

	// Full create body, exactly: _type + _parent + name + url (+ description)
	// (+ display_order) + _sharing + _inheritrights — see module header.
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
		throw new Error(`createLink: create failed: HTTP ${createRes.status}`);
	}
	const createBody = (await createRes.json()) as { _id?: string };
	if (!createBody._id) {
		throw new Error('createLink: create returned 2xx without _id (apparent-success trap)');
	}
	return createBody._id;
}

interface FieldValue {
	_id: string;
}

/**
 * Whole-field edit via the atomic overwrite (mirrors renameSection, across
 * all three fields in one POST). See module header for the full contract.
 */
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

	// `description: null` clearing an existing value → DELETE /property/{id}
	// strictly AFTER the POST (the documented user-facing removal). No
	// existing value → nothing to delete.
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

interface DisplayOrderValue {
	_id: string;
}

/**
 * Renumber `display_order` on every id in `orderedIds` to its 1-based
 * position — exactly reorderSections' atomic-overwrite renumber (#264). See
 * module header.
 */
export async function reorderLinks(
	cfg: EntuCfg,
	orderedIds: string[],
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const total = orderedIds.length;
	for (let i = 0; i < total; i++) {
		const id = orderedIds[i];
		const number = i + 1;

		const getRes = await entuFetch(
			cfg.db,
			`entity/${id}?props=display_order`,
			cfg.token,
			{},
			fetchImpl
		);
		if (!getRes.ok) {
			throw new Error(`reorderLinks: lookup failed for '${id}': HTTP ${getRes.status}`);
		}
		const body = (await getRes.json()) as { entity?: { display_order?: DisplayOrderValue[] } };
		const existing = body.entity?.display_order ?? [];
		const [oldValue, ...extras] = existing;

		const entry = oldValue
			? { _id: oldValue._id, type: 'display_order', number }
			: { type: 'display_order', number };

		const postRes = await entuFetch(
			cfg.db,
			`entity/${id}`,
			cfg.token,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify([entry])
			},
			fetchImpl
		);
		if (!postRes.ok) {
			throw new Error(`reorderLinks: renumber failed for '${id}': HTTP ${postRes.status}`);
		}

		// EXTRA-sweep — corrupted multi-value state only, strictly AFTER the POST.
		for (const value of extras) {
			const delRes = await entuFetch(
				cfg.db,
				`property/${value._id}`,
				cfg.token,
				{ method: 'DELETE' },
				fetchImpl
			);
			if (!delRes.ok) {
				throw new Error(`reorderLinks: cleanup failed for '${id}': HTTP ${delRes.status}`);
			}
		}
	}
}

/**
 * Delete a `link` entity — DELETE /entity/{id}, the entity side of the
 * endpoint split (a /property/ DELETE here would 404 and leave the link
 * standing).
 */
export async function deleteLink(
	cfg: EntuCfg,
	linkId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const res = await entuFetch(cfg.db, `entity/${linkId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	if (!res.ok) throw new Error(`deleteLink failed: HTTP ${res.status}`);
}

// (*MVOX:Palestrina* — #256 GREEN)
