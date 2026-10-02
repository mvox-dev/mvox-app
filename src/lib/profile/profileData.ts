// The sole profile create path (#25, soleCreatePath.spec.ts) and the profile edit reads/writes.
import { entuFetch, type EntuFetchOptions } from '$lib/entu/request';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';
import { postEntity } from '$lib/entity/entityCreateShared';
import { clearEntityProperty, replaceEntityProperty } from '$lib/entu/replaceProperty';

export interface CreateProfileInput {
	personId: string;
	// Both required, never defaulted: a profile must not inherit the person's rights or tier (#133).
	_inheritrights: false;
	_sharing: 'public' | 'domain' | 'private';

	// The admin path runs as db-root and must grant the member; a self-create is already owner.
	ownerIds?: string[];
}

export async function createProfile(
	cfg: EntuCfg,
	input: CreateProfileInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	// Callers that bypass the types are stopped here: the entity's own fields are the only cap.
	if (input._inheritrights !== false) {
		throw new Error(
			`createProfile: _inheritrights must be exactly false (got ${JSON.stringify(input._inheritrights)})`
		);
	}
	if (input._sharing !== 'public' && input._sharing !== 'domain' && input._sharing !== 'private') {
		throw new Error(
			`createProfile: _sharing must be one of public|domain|private (got ${JSON.stringify(input._sharing)})`
		);
	}

	const profileTypeId = await resolveTypeId(cfg, 'profile', fetchImpl);

	const props: Array<{ type: string; reference?: string; string?: string; boolean?: boolean }> = [
		{ type: '_type', reference: profileTypeId },
		{ type: '_parent', reference: input.personId },
		{ type: '_inheritrights', boolean: false },
		{ type: '_sharing', string: input._sharing },
		...(input.ownerIds ?? []).map((id) => ({ type: '_owner', reference: id }))
	];

	return postEntity(cfg, 'createProfile', props, fetchImpl);
}

export type Level = 'public' | 'domain' | 'private';

export interface MyProfile {
	_id: string;
	name: string;
	email: string;
	_sharing: Level;
}

// Wraps createProfile so callers never name the `_inheritrights` literal.
export async function createOwnProfile(
	cfg: EntuCfg,
	personId: string,
	level: Level,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	return createProfile(cfg, { personId, _inheritrights: false, _sharing: level }, fetchImpl);
}

const LEVELS: readonly Level[] = ['public', 'domain', 'private'];

function isLevel(value: string): value is Level {
	return (LEVELS as readonly string[]).includes(value);
}

// `_sharing` with the underscore: a bare `sharing` projection silently returns empty.
export async function listMyProfiles(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<MyProfile[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=profile&_parent.reference=${encodeURIComponent(personId)}&props=name,email,_sharing&limit=10`,
		cfg.token,
		{},
		fetchImpl,
		opts
	);
	if (!res.ok) throw new Error(`listMyProfiles failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{
			_id: string;
			name?: Array<{ string: string }>;
			email?: Array<{ string: string }>;
			_sharing?: Array<{ string: string }>;
		}>;
	};
	return (body.entities ?? []).map((raw) => {
		const sharing = raw._sharing?.[0]?.string ?? '';
		if (!isLevel(sharing)) {
			throw new Error(
				`listMyProfiles: profile ${raw._id} carries an unknown _sharing value ${JSON.stringify(sharing)}`
			);
		}
		return {
			_id: raw._id,
			name: raw.name?.[0]?.string ?? '',
			email: raw.email?.[0]?.string ?? '',
			_sharing: sharing
		};
	});
}

export function profilesByLevel(ps: MyProfile[]): Partial<Record<Level, MyProfile>> {
	const by: Partial<Record<Level, MyProfile>> = {};
	for (const p of ps) {
		if (by[p._sharing]) {
			console.warn(`profilesByLevel: duplicate profile for level ${p._sharing} — last wins`);
		}
		by[p._sharing] = p;
	}
	return by;
}

// Lower is narrower; the narrowest holder renders, failing toward privacy (#27).
export const NARROWNESS: Record<Level, number> = { private: 0, domain: 1, public: 2 };

export interface FieldResolution {
	value: string;
	// More than one holder is an interrupted move; returned, never collapsed.
	holders: { level: Level; id: string }[];
}

export function resolveField(ps: MyProfile[], field: 'name' | 'email'): FieldResolution {
	const withValue = ps
		.filter((p) => p[field] !== '')
		.slice()
		.sort((a, b) => NARROWNESS[a._sharing] - NARROWNESS[b._sharing]);
	return {
		value: withValue.length > 0 ? withValue[0][field] : '',
		holders: withValue.map((p) => ({ level: p._sharing, id: p._id }))
	};
}

// Overwrite-first per field, so a failed write keeps the old value; never sends rights fields.
export async function saveProfileFields(
	cfg: EntuCfg,
	profileId: string,
	fields: { name: string; email: string },
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	for (const field of ['name', 'email'] as const) {
		const value = fields[field];
		if (value === '') {
			await clearEntityProperty(cfg, profileId, field, fetchImpl, 'saveProfileFields');
		} else {
			const entry = { type: field, string: value };
			await replaceEntityProperty(cfg, profileId, entry, fetchImpl, 'saveProfileFields');
		}
	}
}

// (*MVOX:Josquin*)
