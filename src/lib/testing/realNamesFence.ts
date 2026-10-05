// The shared Entu wire behind the real-names route specs, for both toggle states.
import { vi } from 'vitest';
import { json } from './entuFetchKit';

export const DB_ENTITY_ID = 'db-ent-fence';

export const MEMBER_PERSON: Record<string, string> = {
	m1: 'person-p',
	m2: 'person-q'
};

export const ARCHIVED_MEMBER_PERSON: Record<string, string> = {
	m9: 'person-z'
};

export const PROFILE_NAMES = {
	m1: 'Alice Alto',
	m2: 'Berta Bass',
	m9: 'Gone Girl'
} as const;

export const REAL_NAMES = {
	m1: 'Zoe Zeta',
	m2: 'Aaron Aardvark',
	m9: 'Rita Real'
} as const;

const ALL_MEMBER_PERSON: Array<[string, string]> = [
	...Object.entries(MEMBER_PERSON),
	...Object.entries(ARCHIVED_MEMBER_PERSON)
];

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function realNamesWire(
	opts: { toggle?: boolean; extra?: (url: string) => unknown } = {}
): ReturnType<typeof vi.fn> {
	const toggle = opts.toggle ?? true;
	const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		const extra = opts.extra?.(url);
		if (extra !== undefined) return json(extra, 200, JSON_HEADERS);

		if (url.includes('_type.string=admin_member_record')) {
			return json({
				entities: ALL_MEMBER_PERSON.map(([memberId, personId]) => ({
					_id: `rec-${memberId}`,
					person: [{ reference: personId }],
					name: [{ string: REAL_NAMES[memberId as keyof typeof REAL_NAMES] }]
				}))
			}, 200, JSON_HEADERS);
		}

		if (url.includes('_type.string=database')) {
			return json({ entities: [{ _id: DB_ENTITY_ID }] }, 200, JSON_HEADERS);
		}
		if (url.includes(`entity/${DB_ENTITY_ID}`) && url.includes('roster_show_real_names')) {
			return json({
				entity: {
					_id: DB_ENTITY_ID,
					roster_show_real_names: [{ _id: 'v-toggle', boolean: toggle }]
				}
			}, 200, JSON_HEADERS);
		}

		if (url.includes('props=') && url.includes('_viewer')) {
			return json({
				entity: {
					_viewer: [{ _id: 'gr-fence', reference: 'p-reader', property_type: '_owner' }]
				}
			}, 200, JSON_HEADERS);
		}

		if (url.includes('_type.string=member')) {
			const roster = url.includes('status.string=archived')
				? Object.entries(ARCHIVED_MEMBER_PERSON)
				: Object.entries(MEMBER_PERSON);
			return json({
				entities: roster.map(([memberId, personId]) => ({
					_id: memberId,
					person: [{ reference: personId }],
					_parent: [
						{
							_id: `pv-${memberId}`,
							reference: DB_ENTITY_ID,
							property_type: '_parent',
							string: 'Collective',
							entity_type: 'database'
						}
					]
				}))
			}, 200, JSON_HEADERS);
		}

		if (url.includes('_type.string=profile')) {
			const match = /_parent\.reference=([^&]+)/.exec(url);
			const personId = match ? decodeURIComponent(match[1]) : '';
			const memberId = ALL_MEMBER_PERSON.find(([, pid]) => pid === personId)?.[0];
			if (!memberId) return json({ entities: [] }, 200, JSON_HEADERS);
			return json({
				entities: [
					{
						_id: `prof-${memberId}`,
						name: [{ string: PROFILE_NAMES[memberId as keyof typeof PROFILE_NAMES] }],
						email: [{ string: `${memberId}@example.com` }],
						_sharing: [{ string: 'domain' }]
					}
				]
			}, 200, JSON_HEADERS);
		}

		return json({ entities: [] }, 200, JSON_HEADERS);
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

// (*MVOX:Palestrina*)
// (*MVOX:Tallis*)
