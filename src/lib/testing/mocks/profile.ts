// Profile page mocks: profile reads, saves, field moves and linked identities.
import { vi } from 'vitest';
import { listMyProfilesMock } from './session';

export { listMyProfilesMock };
export const applyProfileSaveMock = vi.fn();
export const applyFieldMoveMock = vi.fn();
export const applyConflictResolutionMock = vi.fn();

export class ProfileSaveError extends Error {
	readonly createdProfileId?: string;
	constructor(message: string, createdProfileId?: string) {
		super(message);
		this.name = 'ProfileSaveError';
		this.createdProfileId = createdProfileId;
	}
}

type Real = () => Promise<unknown>;
const real = async (importOriginal: Real) => (await importOriginal()) as object;
type Profile = { _id: string; name: string; email: string; _sharing: string };
const NARROWNESS: Record<string, number> = { private: 0, domain: 1, public: 2 };

// The whole module: listMyProfiles is the handle, the pure helpers are re-implemented.
export function profileDataModule() {
	return {
		listMyProfiles: listMyProfilesMock,
		profilesByLevel: (ps: Array<{ _sharing: string }>) => {
			const by: Record<string, unknown> = {};
			for (const p of ps) by[p._sharing] = p;
			return by;
		},
		NARROWNESS,
		resolveField: (ps: Profile[], field: 'name' | 'email') => {
			const withValue = ps
				.filter((p) => p[field] !== '')
				.slice()
				.sort((a, b) => NARROWNESS[a._sharing] - NARROWNESS[b._sharing]);
			return {
				value: withValue.length > 0 ? withValue[0][field] : '',
				holders: withValue.map((p) => ({ level: p._sharing, id: p._id }))
			};
		}
	};
}

// 'shared': the ProfileSaveError above; 'bare': a fresh empty subclass per call.
export function applyProfileSaveModule(error: 'shared' | 'bare') {
	return {
		applyProfileSave: applyProfileSaveMock,
		ProfileSaveError: error === 'shared' ? ProfileSaveError : class ProfileSaveError extends Error {}
	};
}

export async function fieldMoveModule(importOriginal: Real) {
	return { ...(await real(importOriginal)), applyFieldMove: applyFieldMoveMock };
}

export async function conflictResolutionModule() {
	const actual = await vi.importActual<object>('$lib/profile/fieldMove');
	return { ...actual, applyConflictResolution: applyConflictResolutionMock };
}

export function noLinkedIdentitiesModule() {
	return { listLinkedIdentities: vi.fn().mockResolvedValue({ identities: [] }) };
}

// (*MVOX:Josquin*)
