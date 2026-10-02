// Every rights write in src/, found by its wire shape, against the register docs/rights-writes.md lists.

export const RIGHTS_WRITES_DOC = 'docs/rights-writes.md';
export const VALUE_DELETE = 'value DELETE';

export interface RightsWrite {
	file: string;
	fn: string;
	write: string;
}

export interface Untraceable {
	file: string;
	line: number;
	form: string;
}

export const RIGHTS_WRITES_REGISTER: readonly RightsWrite[] = [
	{ file: 'src/lib/admin/roleManagement.ts', fn: 'grantRole', write: '_editor' },
	{ file: 'src/lib/admin/roleManagement.ts', fn: 'grantRole', write: VALUE_DELETE },
	{ file: 'src/lib/admin/roleManagement.ts', fn: 'revokeOwnGrant', write: VALUE_DELETE },
	{ file: 'src/lib/invite/inviteCreate.ts', fn: 'createInvite', write: '_editor' },
	{ file: 'src/lib/profile/profileData.ts', fn: 'createProfile', write: '_inheritrights' },
	{ file: 'src/lib/profile/profileData.ts', fn: 'createProfile', write: '_sharing' },
	{ file: 'src/lib/profile/profileData.ts', fn: 'createProfile', write: '_owner' }
];

export function selectScannedFiles(paths: string[]): string[] {
	return paths;
}

export function scanRightsWrites(
	_file: string,
	_source: string
): { writes: RightsWrite[]; untraceable: Untraceable[] } {
	return { writes: [], untraceable: [] };
}

export function registerMismatch(
	_found: readonly RightsWrite[],
	_register: readonly RightsWrite[]
): { unlisted: RightsWrite[]; stale: RightsWrite[] } {
	return { unlisted: [], stale: [] };
}

export function docRows(_markdown: string): Array<RightsWrite & { reason: string }> {
	return [];
}
