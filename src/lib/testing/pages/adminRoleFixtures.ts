// Admin role fixtures typed as RolePerson, for the specs that pass them to typed reads.
import type { RolePerson } from '$lib/admin/roleManagement';

export const ANNA: RolePerson = {
	id: 'p-anna',
	name: 'Anna Arro',
	role: 'owner',
	valueIds: ['pv-own-anna']
};

// (*MVOX:Josquin*)
